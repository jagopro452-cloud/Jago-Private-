import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import L from "leaflet";

/*  CSS injected once — only when map page is actually rendered  */
function injectMapStyles() {
  if (document.getElementById("jago-map-styles")) return;
  // Leaflet CSS — load on demand (not at import time) to avoid affecting non-map pages
  if (!document.getElementById("leaflet-css")) {
    const leafletCss = document.createElement("link");
    leafletCss.id = "leaflet-css";
    leafletCss.rel = "stylesheet";
    leafletCss.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(leafletCss);
  }
  const style = document.createElement("style");
  style.id = "jago-map-styles";
  style.textContent = `
    .leaflet-marker-icon { transition: transform 1.6s cubic-bezier(.25,.8,.25,1) !important; }
    .jago-popup .leaflet-popup-content-wrapper {
      border-radius: 14px !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18) !important;
      padding: 0 !important; overflow: hidden;
    }
    .jago-popup .leaflet-popup-content { margin: 0 !important; }
    .jago-popup .leaflet-popup-tip-container { margin-top: -1px; }
    .jago-marker-tooltip {
      background: rgba(15,23,42,0.92) !important;
      color: #fff !important; border: none !important;
      border-radius: 8px !important; font-size: 12px !important;
      padding: 4px 10px !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
      white-space: nowrap;
    }
    .jago-marker-tooltip::before { display: none; }
    .live-badge { display: inline-flex; align-items: center; gap: 5px; }
    .live-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #ef4444;
      animation: liveDot 1.4s ease infinite;
    }
    @keyframes liveDot {
      0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
      70%  { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
      100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
    }
    .trip-card-hover { transition: all 0.18s ease; }
    .trip-card-hover:hover { background: #f8fafc !important; transform: translateX(3px); }
    .trip-card-active { background: #f1f5f9 !important; }
    .prog-bar-anim { transition: width 1.8s cubic-bezier(.4,0,.2,1); }
    .map-stat-card {
      background: white; border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
      padding: 14px 18px; transition: box-shadow 0.2s;
    }
    .map-stat-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
    .jago-vehicle-float {
      display: flex; flex-direction: column; align-items: center;
      pointer-events: none; filter: drop-shadow(0 6px 16px rgba(0,0,0,0.5)) drop-shadow(0 1px 3px rgba(0,0,0,0.3));
    }
    .jago-vehicle-shadow {
      border-radius: 50%; opacity: 0.3;
      filter: blur(5px); margin-top: -2px;
    }
  `;
  document.head.appendChild(style);
}

const VEHICLE_CONFIG: Record<string, { color: string; dark: string; label: string; bg: string }> = {
  "Car":         { color: "#1a73e8", dark: "#0d47a1", bg: "#e8f0fe", label: "Car" },
  "Bike":        { color: "#f97316", dark: "#c2410c", bg: "#fff7ed", label: "Bike" },
  "SUV":         { color: "#8b5cf6", dark: "#5b21b6", bg: "#f5f3ff", label: "SUV" },
  "Auto":        { color: "#d97706", dark: "#92400e", bg: "#fffbeb", label: "Auto" },
  "Parcel Bike": { color: "#16a34a", dark: "#064e3b", bg: "#f0fdf4", label: "Parcel" },
  "default":     { color: "#475569", dark: "#1e293b", bg: "#f8fafc", label: "Vehicle" },
};
const getVC = (t: string) => VEHICLE_CONFIG[t] || VEHICLE_CONFIG["default"];

/* SVG vehicle silhouettes  top-down view */
function getVehicleSVG(type: string, color: string, dark: string): string {
  const w = `rgba(255,255,255,0.55)`;
  const wm = `rgba(255,255,255,0.3)`;
  if (type === "Bike") {
    return `<svg width="18" height="52" viewBox="0 0 18 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="9" cy="7" rx="7" ry="7" fill="${dark}"/>
      <ellipse cx="9" cy="7" rx="4" ry="4" fill="${color}"/>
      <rect x="6.5" y="13" width="5" height="22" rx="2.5" fill="${color}"/>
      <rect x="2" y="14" width="14" height="2.5" rx="1.2" fill="${dark}"/>
      <ellipse cx="9" cy="45" rx="7" ry="7" fill="${dark}"/>
      <ellipse cx="9" cy="45" rx="4" ry="4" fill="${color}"/>
      <rect x="5" y="20" width="8" height="14" rx="3" fill="${w}"/>
    </svg>`;
  }
  if (type === "Auto") {
    return `<svg width="36" height="46" viewBox="0 0 36 46" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 6 L28 6 C31 6 33 8 33 11 L33 38 C33 41 31 43 28 43 L8 43 C5 43 3 41 3 38 L3 11 C3 8 5 6 8 6Z" fill="${color}"/>
      <path d="M10 8 L26 8 L26 22 L10 22 Z" rx="2" fill="${w}"/>
      <rect x="3" y="10" width="5" height="10" rx="2" fill="${dark}"/>
      <rect x="28" y="10" width="5" height="10" rx="2" fill="${dark}"/>
      <rect x="3" y="32" width="5" height="10" rx="2" fill="${dark}"/>
      <rect x="28" y="32" width="5" height="10" rx="2" fill="${dark}"/>
      <rect x="10" y="6" width="16" height="3" rx="1.5" fill="${wm}"/>
      <rect x="4" y="26" width="28" height="2" rx="1" fill="${wm}"/>
    </svg>`;
  }
  if (type === "SUV") {
    return `<svg width="40" height="58" viewBox="0 0 40 58" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="8" width="32" height="42" rx="7" fill="${color}"/>
      <rect x="6" y="11" width="28" height="14" rx="3" fill="${w}"/>
      <rect x="6" y="34" width="28" height="11" rx="2" fill="${wm}"/>
      <rect x="0" y="12" width="6" height="12" rx="3" fill="${dark}"/>
      <rect x="34" y="12" width="6" height="12" rx="3" fill="${dark}"/>
      <rect x="0" y="36" width="6" height="12" rx="3" fill="${dark}"/>
      <rect x="34" y="36" width="6" height="12" rx="3" fill="${dark}"/>
      <rect x="5" y="8" width="30" height="4" rx="2" fill="rgba(255,255,255,0.7)"/>
      <polygon points="20,1 26,8 14,8" fill="${dark}"/>
    </svg>`;
  }
  if (type === "Parcel Bike") {
    return `<svg width="34" height="50" viewBox="0 0 34 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="16" width="28" height="22" rx="4" fill="${color}"/>
      <rect x="7" y="19" width="20" height="16" rx="2" fill="${w}"/>
      <line x1="17" y1="19" x2="17" y2="35" stroke="${dark}" stroke-width="1.5"/>
      <line x1="7" y1="27" x2="27" y2="27" stroke="${dark}" stroke-width="1.5"/>
      <ellipse cx="17" cy="8" rx="7" ry="7" fill="${dark}"/>
      <ellipse cx="17" cy="8" rx="4" ry="4" fill="${color}"/>
      <ellipse cx="17" cy="44" rx="7" ry="6" fill="${dark}"/>
      <ellipse cx="17" cy="44" rx="4" ry="3.5" fill="${color}"/>
      <rect x="3" y="15" width="5" height="8" rx="2" fill="${dark}"/>
      <rect x="26" y="15" width="5" height="8" rx="2" fill="${dark}"/>
    </svg>`;
  }
  /* Default: Car */
  return `<svg width="36" height="56" viewBox="0 0 36 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="9" width="28" height="38" rx="7" fill="${color}"/>
    <rect x="6" y="12" width="24" height="13" rx="3" fill="${w}"/>
    <rect x="7" y="34" width="22" height="9" rx="2" fill="${wm}"/>
    <rect x="0" y="13" width="6" height="11" rx="3" fill="${dark}"/>
    <rect x="30" y="13" width="6" height="11" rx="3" fill="${dark}"/>
    <rect x="0" y="34" width="6" height="11" rx="3" fill="${dark}"/>
    <rect x="30" y="34" width="6" height="11" rx="3" fill="${dark}"/>
    <rect x="5" y="9" width="26" height="4" rx="2" fill="rgba(255,255,255,0.75)"/>
    <polygon points="18,2 24,9 12,9" fill="${dark}"/>
  </svg>`;
}

function createVehicleIcon(L: any, type: string) {
  const cfg = getVC(type);
  const svg = getVehicleSVG(type, cfg.color, cfg.dark);
  const w = type === "Bike" ? 18 : type === "SUV" ? 40 : type === "Parcel Bike" ? 34 : 36;
  const h = type === "Bike" ? 52 : type === "SUV" ? 58 : type === "Auto" ? 46 : type === "Parcel Bike" ? 50 : 56;
  return L.divIcon({
    html: `<div class="jago-vehicle-float">
      ${svg}
      <div class="jago-vehicle-shadow" style="width:${Math.round(w*0.6)}px;height:6px;background:${cfg.color};"></div>
    </div>`,
    className: "",
    iconSize: [w, h + 8],
    iconAnchor: [Math.round(w / 2), h + 6],
    popupAnchor: [0, -(h + 6)],
  });
}

function createEndIcon(L: any, type: "pickup" | "dest") {
  const isPick = type === "pickup";
  const c = isPick ? "#16a34a" : "#dc2626";
  const icon = isPick ? "" : "";
  // Teardrop pin style  clean, no thick circles
  return L.divIcon({
    html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">
      <div style="
        width:22px;height:22px;
        background:${c};
        border:2.5px solid white;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        box-shadow:0 3px 10px rgba(0,0,0,0.3);
        display:flex;align-items:center;justify-content:center;
      "><span style="transform:rotate(45deg);font-size:10px;">${icon}</span></div>
    </div>`,
    className: "",
    iconSize: [22, 26],
    iconAnchor: [11, 24],
  });
}

function enableSmoothMarker(marker: any) {
  // Add CSS transition to Leaflet's internal marker element
  setTimeout(() => {
    if (marker._icon) {
      marker._icon.style.transition = "transform 1.6s cubic-bezier(.25,.8,.25,1)";
    }
  }, 50);
}

function createDriverIcon(L: any, status: string) {
  const color = status === "active" ? "#16a34a" : "#94a3b8";
  const bg = status === "active" ? "#f0fdf4" : "#f8fafc";
  return L.divIcon({
    html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">
      <div style="
        width:36px;height:36px;border-radius:50%;
        background:${bg};border:2.5px solid ${color};
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 3px 12px rgba(0,0,0,0.18);font-size:18px;
      "></div>
      <div style="width:8px;height:8px;border-radius:50%;background:${color};margin-top:2px;box-shadow:0 0 0 2px white;"></div>
    </div>`,
    className: "",
    iconSize: [36, 48],
    iconAnchor: [18, 46],
    popupAnchor: [0, -48],
  });
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

export default function FleetViewPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const layersRef = useRef<Map<string, any>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "ride" | "parcel">("all");
  const [tileStyle, setTileStyle] = useState<"light" | "voyager" | "dark">("voyager");
  const [viewMode, setViewMode] = useState<"trips" | "drivers">("trips");
  const [driverStatusFilter, setDriverStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [zoneFilter, setZoneFilter] = useState<string>("all");

  const { data: trips = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/live-tracking"],
    refetchInterval: 5000,
  });
  const { data: allData } = useQuery<any>({ queryKey: ["/api/trips"] });
  const { data: fleetDrivers = [], isLoading: driversLoading } = useQuery<any[]>({
    queryKey: ["/api/fleet-drivers"],
    refetchInterval: 8000,
  });
  const { data: zones = [] } = useQuery<any[]>({ queryKey: ["/api/zones"] });

  const tripItems = asArray<any>(trips);
  const fleetDriverItems = asArray<any>(fleetDrivers);
  const zoneItems = asArray<any>(zones);

  const filtered = tripItems.filter((t: any) => {
    const typeMatch = filter === "all" ? true : t.type === filter;
    const zoneMatch = zoneFilter === "all" ? true : t.zoneId === zoneFilter;
    return typeMatch && zoneMatch;
  });
  const rideCount = tripItems.filter((t: any) => t.type === "ride").length;
  const parcelCount = tripItems.filter((t: any) => t.type === "parcel").length;

  const filteredDrivers = fleetDriverItems.filter((d) => {
    if (zoneFilter !== "all" && d.zoneId !== zoneFilter) return false;
    if (driverStatusFilter === "active") return d.status === "active";
    if (driverStatusFilter === "inactive") return d.status !== "active";
    return true;
  });
  const onlineDriverCount = fleetDriverItems.filter((d) => d.status === "active").length;
  const offlineDriverCount = fleetDriverItems.length - onlineDriverCount;

  const TILES: Record<string, { url: string; attr: string }> = {
    voyager: {
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      attr: '&copy; <a href="https://carto.com/">CARTO</a>',
    },
    light: {
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      attr: '&copy; <a href="https://carto.com/">CARTO</a>',
    },
    dark: {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attr: '&copy; <a href="https://carto.com/">CARTO</a>',
    },
  };

  useEffect(() => {
    injectMapStyles();
    setMapReady(true);
    return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, {
      center: [17.43, 78.49], zoom: 11,
      zoomControl: false,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const tile = TILES[tileStyle];
    L.tileLayer(tile.url, { attribution: tile.attr, maxZoom: 19, subdomains: "abcd" }).addTo(map);
    mapInstance.current = map;
  }, [mapReady]);

  // Clear all map markers helper
  const clearAllMarkers = useCallback(() => {
    if (!mapInstance.current) return;
    layersRef.current.forEach(entry => {
      if (entry.all) entry.all.forEach((l: any) => { try { mapInstance.current.removeLayer(l); } catch {} });
      else if (entry._leaflet_id !== undefined) { try { mapInstance.current.removeLayer(entry); } catch {} }
    });
    layersRef.current.clear();
  }, []);

  // Switch mode: clear all markers
  useEffect(() => {
    if (mapReady && mapInstance.current) clearAllMarkers();
  }, [viewMode, clearAllMarkers, mapReady]);

  // Driver markers (when in drivers mode)
  useEffect(() => {
    if (!mapReady || !mapInstance.current || viewMode !== "drivers") return;
    const map = mapInstance.current;
    const currentIds = new Set(filteredDrivers.map((d: any) => `drv-${d.id}`));

    layersRef.current.forEach((entry, id) => {
      if (!currentIds.has(id)) {
        if (entry.all) entry.all.forEach((l: any) => { try { map.removeLayer(l); } catch {} });
        layersRef.current.delete(id);
      }
    });

    filteredDrivers.forEach((driver: any) => {
      const key = `drv-${driver.id}`;
      const existing = layersRef.current.get(key);
      const statusColor = driver.status === "active" ? "#16a34a" : "#94a3b8";
      const statusLabel = driver.status === "active" ? "Online" : "Offline";

      if (existing) {
        existing.marker.setLatLng([driver.lat, driver.lng]);
      } else {
        const marker = L.marker([driver.lat, driver.lng], {
          icon: createDriverIcon(L, driver.status),
          zIndexOffset: driver.status === "active" ? 800 : 400,
        }).addTo(map);
        marker.bindTooltip(driver.name, { className: "jago-marker-tooltip", direction: "top", offset: [0, -8] });
        marker.bindPopup(`
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;width:200px">
            <div style="background:${statusColor};padding:12px 14px;color:white">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700">DRV</div>
                <div>
                  <div style="font-weight:700;font-size:14px">${driver.name}</div>
                  <div style="font-size:11px;opacity:.85">${statusLabel}</div>
                </div>
              </div>
            </div>
            <div style="padding:12px 14px">
              <div style="margin-bottom:8px">
                <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Phone</div>
                <div style="font-weight:600;font-size:13px">${driver.phone || "-"}</div>
              </div>
              <div style="margin-bottom:8px">
                <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Coverage</div>
                <div style="font-weight:600;font-size:13px">${driver.zoneName || "All zones"}</div>
                <div style="font-size:12px;color:#64748b">${driver.vehicleCategoryName || "General fleet"}</div>
              </div>
              <div style="display:flex;gap:8px;margin-top:8px">
                <div style="flex:1;background:#f8fafc;border-radius:8px;padding:8px;text-align:center">
                  <div style="font-weight:700;font-size:12px;color:${statusColor}">LIVE</div>
                  <div style="font-size:10px;color:#94a3b8">Status</div>
                  <div style="font-size:11px;font-weight:600;color:${statusColor}">${statusLabel}</div>
                </div>
              </div>
            </div>
          </div>
        `, { className: "jago-popup", maxWidth: 200 });
        marker.on("click", () => setSelected(driver));
        layersRef.current.set(key, { marker, all: [marker] });
      }
    });
  }, [mapReady, filteredDrivers, viewMode]);

  // Update markers on each data refresh (TRIP mode)
  useEffect(() => {
    if (!mapReady || !mapInstance.current || viewMode !== "trips") return;
    const map = mapInstance.current;
    const currentIds = new Set(filtered.map((t: any) => t.id));

    // Remove stale
    layersRef.current.forEach((entry, id) => {
      if (!currentIds.has(id)) {
        if (entry.all) entry.all.forEach((l: any) => { try { map.removeLayer(l); } catch {} });
        layersRef.current.delete(id);
      }
    });

    filtered.forEach((trip: any) => {
      const cfg = getVC(trip.vehicleType);
      const existing = layersRef.current.get(trip.id);

      if (existing) {
        // Smooth position update
        existing.vehicle.setLatLng([trip.currentLat, trip.currentLng]);
        existing.traveled.setLatLngs([
          [trip.pickupLat, trip.pickupLng],
          [trip.currentLat, trip.currentLng],
        ]);
      } else {
        const all: any[] = [];

        // Dashed full route
        const routeLine = L.polyline(
          [[trip.pickupLat, trip.pickupLng], [trip.destinationLat, trip.destinationLng]],
          { color: cfg.color, weight: 2.5, dashArray: "8 8", opacity: 0.35 }
        ).addTo(map);
        all.push(routeLine);

        // Traveled path (solid glow)
        const traveled = L.polyline(
          [[trip.pickupLat, trip.pickupLng], [trip.currentLat, trip.currentLng]],
          { color: cfg.color, weight: 5, opacity: 0.85 }
        ).addTo(map);
        all.push(traveled);

        // Pickup marker
        const pickM = L.marker([trip.pickupLat, trip.pickupLng], { icon: createEndIcon(L, "pickup") })
          .addTo(map)
          .bindTooltip(`Pickup: ${trip.pickupAddress}`, { className: "jago-marker-tooltip", direction: "top", offset: [0, -8] });
        all.push(pickM);

        // Destination marker
        const destM = L.marker([trip.destinationLat, trip.destinationLng], { icon: createEndIcon(L, "dest") })
          .addTo(map)
          .bindTooltip(`Drop: ${trip.destinationAddress}`, { className: "jago-marker-tooltip", direction: "top", offset: [0, -8] });
        all.push(destM);

        // Vehicle marker with popup
        const vehicleM = L.marker([trip.currentLat, trip.currentLng], {
          icon: createVehicleIcon(L, trip.vehicleType),
          zIndexOffset: 1000,
        }).addTo(map).bindPopup(`
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;width:220px">
            <div style="background:${cfg.color};padding:14px 16px;color:white">
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;">
                  ${getVehicleSVG(trip.vehicleType, "white", "rgba(255,255,255,0.5)")}
                </div>
                <div>
                  <div style="font-weight:700;font-size:15px">${cfg.label}</div>
                  <div style="font-size:11px;opacity:.85">${trip.refId}</div>
                </div>
              </div>
            </div>
            <div style="padding:12px 16px">
              <div style="margin-bottom:8px">
                <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Customer</div>
                <div style="font-weight:600;font-size:13px;color:#1e293b">${trip.customerName}</div>
              </div>
              <div style="display:flex;gap:8px;margin-bottom:8px">
                <div style="flex:1;background:#f8fafc;border-radius:8px;padding:8px">
                  <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Zone</div>
                  <div style="font-weight:600;font-size:12px;color:#1e293b">${trip.zoneName || "Unassigned"}</div>
                </div>
                <div style="flex:1;background:#f8fafc;border-radius:8px;padding:8px">
                  <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Status</div>
                  <div style="font-weight:600;font-size:12px;color:#1e293b">${trip.status || "Active"}</div>
                </div>
              </div>
              <div style="margin-bottom:8px">
                <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Route</div>
                <div style="font-size:12px;color:#475569">Pickup: ${trip.pickupAddress}</div>
                <div style="font-size:12px;color:#475569">Drop: ${trip.destinationAddress}</div>
              </div>
              <div style="background:#f8fafc;border-radius:8px;padding:10px;margin-top:10px">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
                  <span style="color:#64748b">Progress</span>
                  <span style="font-weight:700;color:${cfg.color}">${trip.progress}%</span>
                </div>
                <div style="height:6px;background:#e2e8f0;border-radius:6px">
                  <div style="height:6px;background:${cfg.color};border-radius:6px;width:${trip.progress}%;transition:width 1s ease"></div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px">
                  <span style="color:#1e293b;font-weight:600">Rs. ${parseFloat(trip.estimatedFare).toFixed(0)}</span>
                  <span style="color:#64748b">${parseFloat(trip.estimatedDistance).toFixed(1)} km</span>
                </div>
              </div>
            </div>
          </div>
        `, { className: "jago-popup", maxWidth: 220 });

        vehicleM.on("click", () => setSelected(trip));
        enableSmoothMarker(vehicleM);
        all.push(vehicleM);

        layersRef.current.set(trip.id, { vehicle: vehicleM, traveled, all });
      }
    });
  }, [mapReady, filtered]);

  const focusTrip = useCallback((trip: any) => {
    setSelected(trip);
    if (mapInstance.current) {
      mapInstance.current.flyTo([trip.currentLat, trip.currentLng], 14, { animate: true, duration: 1.2 });
      setTimeout(() => {
        const entry = layersRef.current.get(trip.id);
        if (entry?.vehicle) entry.vehicle.openPopup();
      }, 1300);
    }
  }, []);

  const tripStats = [
    { label: "Live Trips", val: tripItems.length, icon: "bi-broadcast-pin", color: "#ef4444", bg: "linear-gradient(135deg,#ef444415,#fca5a515)" },
    { label: "Rides", val: rideCount, icon: "bi-car-front-fill", color: "#1a73e8", bg: "linear-gradient(135deg,#1a73e815,#93c5fd15)" },
    { label: "Parcels", val: parcelCount, icon: "bi-box-seam-fill", color: "#16a34a", bg: "linear-gradient(135deg,#16a34a15,#86efac15)" },
    { label: "Total Trips", val: allData?.total || 0, icon: "bi-graph-up-arrow", color: "#8b5cf6", bg: "linear-gradient(135deg,#8b5cf615,#c4b5fd15)" },
  ];
  const driverStats = [
    { label: "Total Drivers", val: fleetDriverItems.length, icon: "bi-people-fill", color: "#0f172a", bg: "linear-gradient(135deg,#0f172a15,#64748b15)" },
    { label: "Online", val: onlineDriverCount, icon: "bi-circle-fill", color: "#16a34a", bg: "linear-gradient(135deg,#16a34a15,#86efac15)" },
    { label: "Offline", val: offlineDriverCount, icon: "bi-circle", color: "#94a3b8", bg: "linear-gradient(135deg,#94a3b815,#cbd5e115)" },
    { label: "Zones", val: zoneItems.length, icon: "bi-map-fill", color: "#7c3aed", bg: "linear-gradient(135deg,#7c3aed15,#c4b5fd15)" },
  ];
  const stats = viewMode === "drivers" ? driverStats : tripStats;
  const activeZoneName =
    zoneFilter === "all"
      ? "All zones"
      : (zoneItems.find((zone: any) => zone.id === zoneFilter)?.name || "Selected zone");

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div
            className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3 px-3 py-3"
            style={{
              borderRadius: 18,
              background: "linear-gradient(135deg, rgba(255,255,255,.95), rgba(239,246,255,.9))",
              boxShadow: "0 18px 40px rgba(15,23,42,.06)",
              border: "1px solid rgba(226,232,240,.8)",
            }}
          >
            <div className="d-flex flex-column gap-2">
              <div className="d-flex align-items-center gap-3">
                <h2 className="h5 mb-0 fw-bold">{viewMode === "drivers" ? "All Drivers Map" : "Live Vehicle Tracking"}</h2>
                <span className="live-badge">
                  <span className="live-dot"></span>
                  <span className="text-danger fw-semibold" style={{ fontSize: 12 }}>LIVE</span>
                </span>
              </div>
              <div className="d-flex flex-wrap gap-2 align-items-center" style={{ fontSize: 12 }}>
                <span
                  className="badge rounded-pill"
                  style={{ background: "rgba(37,99,235,.1)", color: "#1d4ed8", padding: "0.45rem 0.7rem" }}
                >
                  {viewMode === "drivers" ? "Driver visibility" : "Trip telemetry"}
                </span>
                <span
                  className="badge rounded-pill"
                  style={{ background: "rgba(15,23,42,.06)", color: "#475569", padding: "0.45rem 0.7rem" }}
                >
                  {activeZoneName}
                </span>
              </div>
            </div>
            <div className="d-flex gap-2 align-items-center flex-wrap">
              {/* Mode toggle */}
              <div className="btn-group btn-group-sm" data-testid="btn-group-view-mode">
                <button className={`btn ${viewMode === "trips" ? "btn-primary" : "btn-outline-secondary"}`}
                  style={{ fontSize: 11 }} onClick={() => { setViewMode("trips"); setSelected(null); }}
                  data-testid="btn-mode-trips">
                  <i className="bi bi-broadcast-pin me-1"></i>Live Trips
                </button>
                <button className={`btn ${viewMode === "drivers" ? "btn-primary" : "btn-outline-secondary"}`}
                  style={{ fontSize: 11 }} onClick={() => { setViewMode("drivers"); setSelected(null); }}
                  data-testid="btn-mode-drivers">
                  <i className="bi bi-people-fill me-1"></i>All Drivers
                </button>
              </div>
              {/* Zone filter */}
              {zoneItems.length > 0 && (
                <select className="form-select form-select-sm" style={{ fontSize: 11, maxWidth: 150 }}
                  value={zoneFilter} onChange={e => setZoneFilter(e.target.value)}
                  data-testid="select-zone-filter">
                  <option value="all">All Zones</option>
                  {zoneItems.map((z: any) => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
              )}
              {/* Tile switcher */}
              <div className="btn-group btn-group-sm">
                {(["voyager","light","dark"] as const).map(s => (
                  <button key={s}
                    className={`btn ${tileStyle === s ? "btn-primary" : "btn-outline-secondary"}`}
                    style={{ fontSize: 11, textTransform: "capitalize" }}
                    onClick={() => {
                      setTileStyle(s);
                      if (mapInstance.current) {
                        mapInstance.current.eachLayer((l: any) => {
                          if (l._url) mapInstance.current.removeLayer(l);
                        });
                        const tile = TILES[s];
                        L.tileLayer(tile.url, { attribution: tile.attr, maxZoom: 19, subdomains: "abcd" })
                          .addTo(mapInstance.current);
                      }
                    }}
                  >{s}</button>
                ))}
              </div>
              <button className="btn btn-sm btn-outline-danger"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/live-tracking"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/fleet-drivers"] });
                }}
                data-testid="button-refresh-tracking">
                <i className="bi bi-arrow-clockwise me-1"></i>Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container-fluid">
        {/* Stat cards */}
        <div className="row g-3 mb-3">
          {stats.map((s, i) => (
            <div key={i} className="col-sm-6 col-xl-3">
              <div className="map-stat-card d-flex align-items-center gap-3" style={{ background: "linear-gradient(180deg,#ffffff,#f8fafc)" }}>
                <div className="rounded-3 p-2 d-flex align-items-center justify-content-center"
                  style={{ background: s.bg, width: 48, height: 48, flexShrink: 0 }}>
                  <i className={`bi ${s.icon} fs-5`} style={{ color: s.color }}></i>
                </div>
                <div>
                  <div className="fw-bold fs-4 lh-1" style={{ color: s.color }}
                    data-testid={`stat-${s.label.toLowerCase().replace(/ /g,"-")}`}>{s.val}</div>
                  <div className="text-muted small mt-1">{s.label}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="row g-3">
          {/* Map panel */}
          <div className="col-lg-8">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 48px rgba(15,23,42,.08)" }}>
              <div className="card-header bg-white py-3 px-3 d-flex align-items-center justify-content-between flex-wrap gap-2"
                style={{ borderBottom: "1px solid #f1f5f9", background: "linear-gradient(180deg,#ffffff,#f8fafc)" }}>
                <div>
                  <h6 className="mb-1 fw-semibold d-flex align-items-center gap-2">
                    <i className="bi bi-map text-primary"></i> Live Map
                  </h6>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {viewMode === "drivers"
                      ? "Real-time driver availability with zone-aware filtering"
                      : "Live trip positions with route progress and fare visibility"}
                  </div>
                </div>
                <div className="d-flex gap-3 flex-wrap" style={{ fontSize: 11 }}>
                  {Object.entries(VEHICLE_CONFIG).filter(([k]) => k !== "default").map(([k, v]) => (
                    <span key={k} className="d-flex align-items-center gap-1">
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: v.color, display: "inline-block", boxShadow: `0 0 0 2px ${v.color}30` }} />
                      <span className="fw-semibold" style={{ color: v.color }}>{v.label}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ position: "relative" }}>
                {isLoading && (
                  <div className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
                    style={{ background: "rgba(255,255,255,0.75)", zIndex: 1000, backdropFilter: "blur(2px)" }}>
                    <div className="text-center">
                      <div className="spinner-border text-primary mb-2" role="status" />
                      <div className="text-muted small">Loading trips</div>
                    </div>
                  </div>
                )}
                <div ref={mapRef} data-testid="div-tracking-map"
                  style={{ height: "62vh", width: "100%" }} />
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div className="col-lg-4">
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 48px rgba(15,23,42,.08)" }}>
              <div className="card-header bg-white py-3 px-3" style={{ borderBottom: "1px solid #f1f5f9", background: "linear-gradient(180deg,#ffffff,#f8fafc)" }}>
                <div className="d-flex align-items-center justify-content-between gap-2 mb-2 flex-wrap">
                  <div>
                    <div className="fw-semibold" style={{ color: "#0f172a" }}>
                      {viewMode === "trips" ? "Trip Feed" : "Driver Feed"}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {viewMode === "trips"
                        ? `${filtered.length} visible trip${filtered.length === 1 ? "" : "s"} in ${activeZoneName}`
                        : `${filteredDrivers.length} visible driver${filteredDrivers.length === 1 ? "" : "s"} in ${activeZoneName}`}
                    </div>
                  </div>
                </div>
                {viewMode === "trips" ? (
                  <div className="d-flex gap-1">
                    {(["all","ride","parcel"] as const).map(f => {
                      const cnt = f === "all" ? tripItems.length : f === "ride" ? rideCount : parcelCount;
                      const active = filter === f;
                      return (
                        <button key={f} className="btn btn-sm flex-fill fw-semibold"
                          style={{ fontSize: 12, borderRadius: 10, background: active ? "#1a73e8" : "#f1f5f9", color: active ? "white" : "#64748b", border: "none", transition: "all 0.2s" }}
                          onClick={() => setFilter(f)} data-testid={`tab-trip-${f}`}>
                          {f === "all" ? "All" : f === "ride" ? "Rides" : "Parcels"}
                          <span className="ms-1 badge rounded-pill"
                            style={{ background: active ? "rgba(255,255,255,0.25)" : "#e2e8f0", color: active ? "white" : "#475569", fontSize: 10 }}>
                            {cnt}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="d-flex gap-1">
                    {(["all","active","inactive"] as const).map(f => {
                      const cnt = f === "all" ? fleetDriverItems.length : f === "active" ? onlineDriverCount : offlineDriverCount;
                      const active = driverStatusFilter === f;
                      return (
                        <button key={f} className="btn btn-sm flex-fill fw-semibold"
                          style={{ fontSize: 12, borderRadius: 10, background: active ? "#16a34a" : "#f1f5f9", color: active ? "white" : "#64748b", border: "none", transition: "all 0.2s" }}
                          onClick={() => setDriverStatusFilter(f)} data-testid={`tab-driver-${f}`}>
                          {f === "all" ? "All" : f === "active" ? "Online" : "Offline"}
                          <span className="ms-1 badge rounded-pill"
                            style={{ background: active ? "rgba(255,255,255,0.25)" : "#e2e8f0", color: active ? "white" : "#475569", fontSize: 10 }}>
                            {cnt}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ overflowY: "auto", maxHeight: "58vh" }}>
                {viewMode === "trips" ? (
                  filtered.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <div style={{ fontSize: 42, marginBottom: 10 }}></div>
                      <div className="fw-semibold">No active trips</div>
                      <div className="small mt-1">Live trips appear here</div>
                    </div>
                  ) : filtered.map((trip: any) => {
                    const cfg = getVC(trip.vehicleType);
                    const isSel = selected?.id === trip.id;
                    return (
                      <div key={trip.id}
                        className={`px-3 py-2 border-bottom trip-card-hover ${isSel ? "trip-card-active" : ""}`}
                        style={{ cursor: "pointer", borderLeft: `3.5px solid ${isSel ? cfg.color : "transparent"}` }}
                        onClick={() => focusTrip(trip)} data-testid={`card-trip-${trip.id}`}>
                        <div className="d-flex align-items-start gap-2">
                          <div className="d-flex align-items-center justify-content-center flex-shrink-0"
                            style={{ width: 40, height: 40, background: cfg.bg, borderRadius: 10, border: `2px solid ${cfg.color}33`, overflow: "hidden" }}
                            dangerouslySetInnerHTML={{ __html: getVehicleSVG(trip.vehicleType, cfg.color, cfg.dark) }} />
                          <div className="flex-grow-1" style={{ minWidth: 0 }}>
                            <div className="d-flex justify-content-between align-items-center">
                              <span className="fw-bold small" style={{ color: "#0f172a" }}>{trip.refId}</span>
                              <span className="badge rounded-pill" style={{ background: cfg.color + "18", color: cfg.color, fontSize: 9, fontWeight: 700 }}>{cfg.label}</span>
                            </div>
                            <div className="text-truncate mt-1" style={{ fontSize: 11, color: "#64748b" }}>
                              Customer: <b style={{ color: "#374151" }}>{trip.customerName}</b>
                            </div>
                            <div style={{ fontSize: 10.5, color: "#64748b" }} className="text-truncate">
                              Zone: {trip.zoneName || "Unassigned"}
                            </div>
                            <div style={{ fontSize: 10.5, color: "#94a3b8" }} className="text-truncate">Pickup: {trip.pickupAddress}</div>
                            <div style={{ fontSize: 10.5, color: "#94a3b8" }} className="text-truncate">Drop: {trip.destinationAddress}</div>
                            <div className="mt-2">
                              <div className="d-flex justify-content-between align-items-center mb-1" style={{ fontSize: 10 }}>
                                <span style={{ color: "#94a3b8" }}>Journey</span>
                                <span className="fw-bold" style={{ color: cfg.color }}>{trip.progress}%</span>
                              </div>
                              <div style={{ height: 5, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                                <div className="prog-bar-anim"
                                  style={{ height: "100%", width: `${trip.progress}%`, background: `linear-gradient(90deg,${cfg.color}99,${cfg.color})`, borderRadius: 4 }} />
                              </div>
                            </div>
                            <div className="d-flex justify-content-between mt-2" style={{ fontSize: 11 }}>
                              <span className="fw-semibold" style={{ color: "#1e293b" }}>Rs. {parseFloat(trip.estimatedFare).toFixed(0)}</span>
                              <span style={{ color: "#94a3b8" }}>{parseFloat(trip.estimatedDistance).toFixed(1)} km</span>
                              <span className="badge rounded-pill"
                                style={{ fontSize: 9, background: trip.type === "ride" ? "#dbeafe" : "#dcfce7", color: trip.type === "ride" ? "#1E5FCC" : "#166534" }}>
                                {trip.type}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  driversLoading ? (
                    <div className="text-center py-5"><div className="spinner-border text-success" role="status" /></div>
                  ) : filteredDrivers.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <div style={{ fontSize: 42, marginBottom: 10 }}>DRV</div>
                      <div className="fw-semibold">No drivers found</div>
                    </div>
                  ) : filteredDrivers.map((driver: any) => {
                    const isOnline = driver.status === "active";
                    const statusColor = isOnline ? "#16a34a" : "#94a3b8";
                    const isSel = selected?.id === driver.id;
                    return (
                      <div key={driver.id}
                        className={`px-3 py-2 border-bottom trip-card-hover ${isSel ? "trip-card-active" : ""}`}
                        style={{ cursor: "pointer", borderLeft: `3.5px solid ${isSel ? statusColor : "transparent"}` }}
                        onClick={() => {
                          setSelected(driver);
                          if (mapInstance.current) {
                            mapInstance.current.flyTo([driver.lat, driver.lng], 15, { animate: true, duration: 1 });
                            setTimeout(() => {
                              const entry = layersRef.current.get(`drv-${driver.id}`);
                              if (entry?.marker) entry.marker.openPopup();
                            }, 1100);
                          }
                        }}
                        data-testid={`card-driver-${driver.id}`}>
                        <div className="d-flex align-items-center gap-2">
                          <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                            style={{ width: 38, height: 38, background: statusColor + "15", fontSize: 18, border: `2px solid ${statusColor}33` }}>
                            DRV
                          </div>
                          <div className="flex-grow-1" style={{ minWidth: 0 }}>
                            <div className="d-flex justify-content-between align-items-center">
                              <span className="fw-semibold" style={{ fontSize: 13, color: "#0f172a" }}>{driver.name}</span>
                              <span className="badge rounded-pill"
                                style={{ background: statusColor + "18", color: statusColor, fontSize: 9, fontWeight: 700 }}>
                                {isOnline ? "Live Online" : "Currently Offline"}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                              <i className="bi bi-phone me-1"></i>{driver.phone || "-"}
                            </div>
                            <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2 }} className="text-truncate">
                              Zone: {driver.zoneName || "All zones"}
                            </div>
                            <div style={{ fontSize: 10.5, color: "#94a3b8" }} className="text-truncate">
                              Category: {driver.vehicleCategoryName || "General fleet"}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="card-footer bg-white border-0 text-center py-2" style={{ fontSize: 11, color: "#94a3b8" }}>
                <i className="bi bi-arrow-clockwise me-1"></i>
                {viewMode === "trips" ? "Positions update every 5 seconds" : "Driver status updates every 8 seconds"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

