import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminConfirm } from "./components/AdminPrimitives";
import L from "leaflet";

const SERVICE_TYPES = [
  { value: "both", label: "Ride & Parcel", icon: "bi-grid-fill", color: "#7c3aed" },
  { value: "ride", label: "Ride Only", icon: "bi-car-front-fill", color: "#1a73e8" },
  { value: "parcel", label: "Parcel Only", icon: "bi-box-seam-fill", color: "#16a34a" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
// Calculate polygon area in km2 using equirectangular projection + Shoelace
function polygonAreaKm2(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const latC = coords.reduce((s, c) => s + c[0], 0) / coords.length * Math.PI / 180;
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const x1 = coords[i][1] * Math.cos(latC) * 111.32;
    const y1 = coords[i][0] * 111.32;
    const x2 = coords[j][1] * Math.cos(latC) * 111.32;
    const y2 = coords[j][0] * 111.32;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

// Calculate perimeter in km
function polygonPerimKm(coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  let p = 0;
  const R = 6371;
  const toR = (d: number) => d * Math.PI / 180;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const dLat = toR(coords[j][0] - coords[i][0]);
    const dLng = toR(coords[j][1] - coords[i][1]);
    const a = Math.sin(dLat/2)**2 + Math.cos(toR(coords[i][0])) * Math.cos(toR(coords[j][0])) * Math.sin(dLng/2)**2;
    p += 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  return p;
}

// ── Map Modal ─────────────────────────────────────────────────────────────────
function ZoneMapModal({ open, onClose, editing, initialForm, onSave, saving }: {
  open: boolean; onClose: () => void; editing: any; initialForm: any;
  onSave: (data: any) => void; saving: boolean;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const polygonRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const firstCircleRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [drawMode, setDrawMode] = useState<"pan" | "draw">("pan");
  const [points, setPoints] = useState<[number, number][]>([]);
  const [closed, setClosed] = useState(false);
  const [form, setForm] = useState(initialForm);

  useEffect(() => { setForm(initialForm); }, [JSON.stringify(initialForm)]);

  // Reset draw mode to pan when modal opens
  useEffect(() => { if (open) setDrawMode("pan"); }, [open]);

  // Load initial points from existing coordinates
  useEffect(() => {
    if (!open) return;
    try {
      if (initialForm.coordinates) {
        const geo = JSON.parse(initialForm.coordinates);
        if (geo.type === "Polygon" && geo.coordinates?.[0]) {
          const ring = geo.coordinates[0];
          const pts: [number, number][] = ring.slice(0, -1).map(([lng, lat]: number[]) => [lat, lng] as [number, number]);
          setPoints(pts);
          setClosed(true);
          return;
        }
      }
    } catch {}
    setPoints([]);
    setClosed(false);
  }, [open, initialForm.coordinates]);

  // Init Leaflet — inject CSS on demand
  useEffect(() => {
    if (!open) return;
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    setMapReady(true);
    return () => {
      if (mapInst.current) { mapInst.current.remove(); mapInst.current = null; }
      setMapReady(false);
    };
  }, [open]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { center: [17.43, 78.49], zoom: 10, zoomControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; CARTO', maxZoom: 19, subdomains: "abcd",
    }).addTo(map);
    mapInst.current = map;

    // Fit to points if editing
    if (points.length > 0) {
      try { map.fitBounds(points.map(p => p as [number, number])); } catch {}
    }
  }, [mapReady]);

  // Redraw polygon/markers when points change
  useEffect(() => {
    if (!mapReady || !mapInst.current) return;
    const map = mapInst.current;

    // Clear old layers
    markersRef.current.forEach(m => { try { map.removeLayer(m); } catch {} });
    markersRef.current = [];
    if (polylineRef.current) { try { map.removeLayer(polylineRef.current); } catch {} polylineRef.current = null; }
    if (polygonRef.current) { try { map.removeLayer(polygonRef.current); } catch {} polygonRef.current = null; }
    if (firstCircleRef.current) { try { map.removeLayer(firstCircleRef.current); } catch {} firstCircleRef.current = null; }

    if (points.length === 0) return;

    // Point markers
    points.forEach((pt, i) => {
      const isFirst = i === 0;
      const icon = L.divIcon({
        html: `<div style="
          width:${isFirst ? 14 : 10}px;height:${isFirst ? 14 : 10}px;
          border-radius:50%;background:${isFirst ? "#ef4444" : "#1a73e8"};
          border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);
        "></div>`,
        className: "", iconSize: [isFirst ? 14 : 10, isFirst ? 14 : 10],
        iconAnchor: [isFirst ? 7 : 5, isFirst ? 7 : 5],
      });
      const m = L.marker(pt, { icon, interactive: false }).addTo(map);
      markersRef.current.push(m);
    });

    if (closed && points.length >= 3) {
      // Filled polygon
      const poly = L.polygon(points, {
        color: "#1a73e8", weight: 2.5, fillColor: "#1a73e8", fillOpacity: 0.18, dashArray: undefined,
      }).addTo(map);
      polygonRef.current = poly;
    } else {
      // Open polyline + ghost circle on first point
      const line = L.polyline(points, { color: "#1a73e8", weight: 2.5 }).addTo(map);
      polylineRef.current = line;
      if (points.length >= 2 && !closed) {
        const c = L.circle(points[0], { radius: 60, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.2, weight: 1.5 }).addTo(map);
        firstCircleRef.current = c;
      }
    }
  }, [points, closed, mapReady]);

  // Click to draw
  useEffect(() => {
    if (!mapReady || !mapInst.current) return;
    const map = mapInst.current;

    const onClick = (e: any) => {
      if (drawMode !== "draw" || closed) return;
      const { lat, lng } = e.latlng;

      setPoints(prev => {
        if (prev.length >= 2) {
          // Pixel-based snap: close polygon if click is within 20px of first point
          const firstPx = map.latLngToContainerPoint(L.latLng(prev[0][0], prev[0][1]));
          const clickPx = e.containerPoint;
          const pixelDist = Math.sqrt((firstPx.x - clickPx.x) ** 2 + (firstPx.y - clickPx.y) ** 2);
          if (pixelDist < 20) {
            setClosed(true);
            return prev;
          }
        }
        return [...prev, [lat, lng] as [number, number]];
      });
    };

    map.on("click", onClick);
    map.getContainer().style.cursor = drawMode === "draw" ? "crosshair" : "";
    return () => { map.off("click", onClick); map.getContainer().style.cursor = ""; };
  }, [mapReady, drawMode, closed]);

  const clearDraw = () => { setPoints([]); setClosed(false); };
  const completePolygon = () => { if (points.length >= 3) setClosed(true); };

  const area = polygonAreaKm2(points);
  const perim = polygonPerimKm(points);

  const buildGeoJson = () => {
    if (points.length < 3) return "";
    const ring = [...points, points[0]].map(([lat, lng]) => [lng, lat]);
    return JSON.stringify({ type: "Polygon", coordinates: [ring] });
  };

  // Compute centroid of polygon points
  const computeCentroid = (pts: [number, number][]): { lat: number; lng: number } | null => {
    if (pts.length < 3) return null;
    const sumLat = pts.reduce((s, p) => s + p[0], 0);
    const sumLng = pts.reduce((s, p) => s + p[1], 0);
    return { lat: parseFloat((sumLat / pts.length).toFixed(6)), lng: parseFloat((sumLng / pts.length).toFixed(6)) };
  };

  const handleSave = () => {
    if (!form.name) return;
    const hasPolygon = closed && points.length >= 3;
    const coords = hasPolygon ? buildGeoJson() : form.coordinates;
    let lat = form.latitude, lng = form.longitude;
    // Auto-populate centroid from polygon if admin hasn't set lat/lng manually
    if (hasPolygon && (!lat || !lng)) {
      const c = computeCentroid(points);
      if (c) { lat = c.lat; lng = c.lng; }
    }
    onSave({ ...form, coordinates: coords, latitude: lat, longitude: lng });
  };

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
    }}>
      <div style={{
        background: "white", borderRadius: 16, width: "100%", maxWidth: 1100, maxHeight: "94vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="bi bi-map-fill" style={{ color: "#1a73e8", fontSize: 16 }}></i>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>
              {editing ? "Edit Service Zone" : "Create Service Zone"}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Draw polygon on map to define zone boundary</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94a3b8", lineHeight: 1, padding: 4 }}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>
          {/* Left panel */}
          <div style={{ width: 300, borderRight: "1px solid #f1f5f9", padding: "20px 18px", overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Instructions */}
            <div style={{ background: "#f8fafc", borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, color: "#1a73e8", fontSize: 14, marginBottom: 10 }}>
                <i className="bi bi-info-circle-fill me-2"></i>Instructions
              </div>
              <p style={{ fontSize: 12.5, color: "#475569", margin: 0, lineHeight: 1.6 }}>
                Create zone by clicking on map to place points and connect them.
              </p>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#e0e7ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className="bi bi-hand-index-fill" style={{ color: "#6366f1", fontSize: 14 }}></i>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
                    <b>Pan mode:</b> Drag map to find the right area
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className="bi bi-bounding-box" style={{ color: "#16a34a", fontSize: 14 }}></i>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
                    <b>Draw mode:</b> Click to add points. Click near first point (red dot) to close polygon. Min 3 points.
                  </div>
                </div>
              </div>
            </div>

            {/* Zone name */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, display: "block" }}>
                Zone Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input className="admin-form-control" value={form.name}
                onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Hyderabad Central" data-testid="input-zone-name"
                style={{ width: "100%" }} />
            </div>

            {/* Service Type */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8, display: "block" }}>Service Type</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {SERVICE_TYPES.map(st => (
                  <button key={st.value} type="button"
                    onClick={() => setForm((f: any) => ({ ...f, serviceType: st.value }))}
                    data-testid={`btn-service-${st.value}`}
                    style={{
                      padding: "8px 12px", borderRadius: 9, fontWeight: 600, fontSize: 12, cursor: "pointer",
                      textAlign: "left", transition: "all 0.15s",
                      background: form.serviceType === st.value ? st.color : "#f8fafc",
                      color: form.serviceType === st.value ? "#fff" : "#64748b",
                      border: `1.5px solid ${form.serviceType === st.value ? st.color : "#e2e8f0"}`,
                    }}>
                    <i className={`bi ${st.icon} me-2`}></i>{st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Surge Factor */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, display: "block" }}>
                Surge Factor
              </label>
              <input type="number" step="0.1" min="1" max="5" className="admin-form-control"
                value={form.surgeFactor}
                onChange={e => setForm((f: any) => ({ ...f, surgeFactor: parseFloat(e.target.value) || 1.0 }))}
                placeholder="1.0" data-testid="input-surge-factor" style={{ width: "100%" }} />
              <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 4 }}>x base fare multiplier (1.0 = normal)</div>
            </div>

            {/* Status */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Status</label>
              <label className="switcher ms-auto">
                <input type="checkbox" className="switcher_input" checked={form.isActive}
                  onChange={e => setForm((f: any) => ({ ...f, isActive: e.target.checked }))} />
                <span className="switcher_control"></span>
              </label>
              <span style={{ fontSize: 11, color: form.isActive ? "#16a34a" : "#94a3b8", fontWeight: 600 }}>
                {form.isActive ? "Active" : "Inactive"}
              </span>
            </div>

            {/* Area info */}
            {points.length >= 3 && (
              <div style={{ background: closed ? "#f0fdf4" : "#fefce8", border: `1px solid ${closed ? "#86efac" : "#fde047"}`, borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: closed ? "#16a34a" : "#ca8a04", marginBottom: 8 }}>
                  <i className={`bi ${closed ? "bi-check-circle-fill" : "bi-exclamation-triangle-fill"} me-1`}></i>
                  {closed ? "Polygon Complete" : `${points.length} points - click first point to close`}
                </div>
                {closed && (
                  <>
                    <div style={{ display: "flex", gap: 12 }}>
                      <div style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a" }}>{area.toFixed(2)}</div>
                        <div style={{ fontSize: 10, color: "#64748b" }}>km2 Area</div>
                      </div>
                      <div style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a73e8" }}>{perim.toFixed(2)}</div>
                        <div style={{ fontSize: 10, color: "#64748b" }}>km Perimeter</div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Surge warning */}
            {form.surgeFactor > 1 && (
              <div style={{ background: "#fefce8", border: "1px solid #fde047", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#92400e" }}>
                <i className="bi bi-lightning-fill me-1" style={{ color: "#d97706" }}></i>
                <b>Surge x{Number(form.surgeFactor).toFixed(1)}</b> - rides starting inside this zone will be charged {Math.round((form.surgeFactor - 1) * 100)}% extra
              </div>
            )}

            {/* No boundary warning */}
            {!closed && points.length === 0 && (
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 11.5, color: "#64748b" }}>
                <i className="bi bi-info-circle me-1"></i>
                No polygon drawn - zone detection will use center point and radius below.
              </div>
            )}

            {/* Center point + radius (fallback detection) */}
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10 }}>
                <i className="bi bi-crosshair2 me-1" style={{ color: "#1a73e8" }}></i>
                Center Point &amp; Radius
                <span style={{ fontSize: 10, fontWeight: 400, color: "#94a3b8", marginLeft: 6 }}>(used if no polygon)</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10.5, color: "#64748b", display: "block", marginBottom: 3 }}>Latitude</label>
                  <input type="number" step="0.000001" className="admin-form-control" style={{ width: "100%", fontSize: 12 }}
                    value={form.latitude ?? ""}
                    onChange={e => setForm((f: any) => ({ ...f, latitude: e.target.value ? parseFloat(e.target.value) : null }))}
                    placeholder="e.g. 17.3850" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10.5, color: "#64748b", display: "block", marginBottom: 3 }}>Longitude</label>
                  <input type="number" step="0.000001" className="admin-form-control" style={{ width: "100%", fontSize: 12 }}
                    value={form.longitude ?? ""}
                    onChange={e => setForm((f: any) => ({ ...f, longitude: e.target.value ? parseFloat(e.target.value) : null }))}
                    placeholder="e.g. 78.4867" />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10.5, color: "#64748b", display: "block", marginBottom: 3 }}>Radius (km)</label>
                <input type="number" step="0.5" min="0.5" max="100" className="admin-form-control" style={{ width: "100%", fontSize: 12 }}
                  value={form.radiusKm ?? 5}
                  onChange={e => setForm((f: any) => ({ ...f, radiusKm: parseFloat(e.target.value) || 5 }))}
                  placeholder="5" />
              </div>
              {closed && points.length >= 3 && (
                <button type="button" style={{ marginTop: 8, fontSize: 11, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 7, padding: "4px 10px", cursor: "pointer", color: "#1d4ed8" }}
                  onClick={() => { const c = computeCentroid(points); if (c) setForm((f: any) => ({ ...f, latitude: c.lat, longitude: c.lng })); }}>
                  <i className="bi bi-bullseye me-1"></i>Auto-fill from polygon centroid
                </button>
              )}
            </div>

            {/* Save button */}
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn btn-primary w-100" disabled={!form.name || saving} onClick={handleSave}
                data-testid="btn-save-zone">
                {saving ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving...</> :
                  editing ? "Update Zone" : "Create Zone"}
              </button>
              <button className="btn btn-outline-secondary w-100" onClick={onClose}>Cancel</button>
            </div>
          </div>

          {/* Right: map */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {/* Toolbar */}
            <div className="zones-map-toolbar" style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: "#64748b", marginRight: 4 }}>Mode:</div>
              <button
                onClick={() => setDrawMode("pan")}
                data-testid="btn-mode-pan"
                style={{
                  padding: "6px 14px", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer",
                  background: drawMode === "pan" ? "#0f172a" : "#f8fafc",
                  color: drawMode === "pan" ? "white" : "#64748b",
                  border: `1.5px solid ${drawMode === "pan" ? "#0f172a" : "#e2e8f0"}`,
                }}>
                <i className="bi bi-hand-index-fill me-1"></i>Pan
              </button>
              <button
                onClick={() => setDrawMode("draw")}
                data-testid="btn-mode-draw"
                style={{
                  padding: "6px 14px", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer",
                  background: drawMode === "draw" ? "#1a73e8" : "#f8fafc",
                  color: drawMode === "draw" ? "white" : "#64748b",
                  border: `1.5px solid ${drawMode === "draw" ? "#1a73e8" : "#e2e8f0"}`,
                }}>
                <i className="bi bi-bounding-box me-1"></i>Draw Zone
              </button>
              {points.length >= 3 && !closed && (
                <button onClick={completePolygon}
                  style={{ padding: "6px 14px", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer", background: "#16a34a", color: "white", border: "none" }}>
                  <i className="bi bi-check-lg me-1"></i>Complete
                </button>
              )}
              {points.length > 0 && (
                <button onClick={clearDraw} data-testid="btn-clear-draw"
                  style={{ padding: "6px 14px", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer", background: "#fee2e2", color: "#dc2626", border: "1.5px solid #fca5a5", marginLeft: "auto" }}>
                  <i className="bi bi-trash me-1"></i>Clear
                </button>
              )}
              <div style={{ marginLeft: points.length > 0 ? 0 : "auto", fontSize: 11, color: "#94a3b8" }}>
                {points.length} point{points.length !== 1 ? "s" : ""} placed
              </div>
            </div>

            {/* Map */}
            <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
              {!mapReady && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", zIndex: 10 }}>
                  <div className="spinner-border text-primary" role="status" />
                </div>
              )}
              {drawMode === "draw" && (
                <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1000, background: "rgba(26,115,232,0.92)", color: "white", borderRadius: 20, padding: "5px 14px", fontSize: 11, fontWeight: 600, pointerEvents: "none", whiteSpace: "nowrap" }}>
                  <i className="bi bi-plus-circle me-1"></i>
                  {closed ? "Polygon drawn - clear to redraw" : points.length < 2 ? "Click map to place first point" : "Click near red point to close polygon"}
                </div>
              )}
              <div ref={mapRef} data-testid="zone-map" style={{ width: "100%", height: "100%", minHeight: 400 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Zones() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");

  const defaultForm = { name: "", coordinates: "", serviceType: "both", surgeFactor: 1.0, isActive: true, latitude: null, longitude: null, radiusKm: 5 };
  const [formForModal, setFormForModal] = useState(defaultForm);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/zones"],
    queryFn: async () => {
      const response = await adminFetch("/api/zones");
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.message || "Failed to load zones");
      }
      return response.json();
    },
  });

  const save = useMutation({
    mutationFn: (d: any) => editing
      ? apiRequest("PUT", `/api/zones/${editing.id}`, d)
      : apiRequest("POST", "/api/zones", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/zones"] });
      toast({ title: editing ? "Zone updated" : "Zone created successfully" });
      setOpen(false); setEditing(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/zones/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/zones"] }); toast({ title: "Zone deleted" }); },
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/zones/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/zones"] }),
    onError: (e: any) => toast({ title: "Failed to update zone", description: e.message, variant: "destructive" }),
  });

  const openEdit = (zone: any) => {
    setEditing(zone);
    setFormForModal({ name: zone.name, coordinates: zone.coordinates || "", serviceType: zone.serviceType || "both", surgeFactor: Number(zone.surgeFactor) || 1.0, isActive: zone.isActive, latitude: zone.latitude ?? null, longitude: zone.longitude ?? null, radiusKm: Number(zone.radiusKm) || 5 });
    setOpen(true);
  };

  const zones: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

  const filtered = zones.filter(z => {
    const ok1 = filterStatus === "all" || (filterStatus === "active" ? z.isActive : !z.isActive);
    const ok2 = !search || z.name.toLowerCase().includes(search.toLowerCase());
    return ok1 && ok2;
  });
  const activeCount = zones.filter(z => z.isActive).length;
  const getServiceConfig = (type: string) => SERVICE_TYPES.find(s => s.value === type) || SERVICE_TYPES[0];

  // Calculate area from stored coordinates for display
  const getZoneArea = (zone: any): number => {
    try {
      if (!zone.coordinates) return 0;
      const geo = JSON.parse(zone.coordinates);
      if (geo.type === "Polygon" && geo.coordinates?.[0]) {
        const pts: [number, number][] = geo.coordinates[0].map(([lng, lat]: number[]) => [lat, lng] as [number, number]);
        return polygonAreaKm2(pts.slice(0, -1));
      }
    } catch {}
    return 0;
  };

  return (
    <div className="container-fluid zones-page">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">Zone Setup</h4>
          <div className="text-muted small">Draw service zones on map with area calculations</div>
        </div>
        <button className="btn btn-primary" data-testid="btn-add-zone"
          onClick={() => { setEditing(null); setFormForModal(defaultForm); setOpen(true); }}>
          <i className="bi bi-plus-circle me-1"></i> Add Zone
        </button>
      </div>

      {/* Summary strip */}
      <div className="row g-3 mb-3">
        {[
          { label: "Total Zones", val: zones.length, icon: "bi-map-fill", color: "#7c3aed", bg: "#f5f3ff" },
          { label: "Active", val: activeCount, icon: "bi-check-circle-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Inactive", val: zones.length - activeCount, icon: "bi-pause-circle-fill", color: "#64748b", bg: "#f8fafc" },
          { label: "With Surge", val: zones.filter((z: any) => Number((z.surgeFactor ?? z.surge_factor) || 1) > 1).length, icon: "bi-lightning-fill", color: "#d97706", bg: "#fefce8" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 44, height: 44, background: s.bg, color: s.color, fontSize: "1.1rem" }}>
                  <i className={`bi ${s.icon}`}></i>
                </div>
                <div>
                  <div className="fw-bold lh-1 mb-1" style={{ fontSize: 22, color: s.color }}>
                    {isLoading ? "-" : s.val}
                  </div>
                  <div className="text-muted small">{s.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4 d-flex align-items-center justify-content-between flex-wrap gap-3"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <ul className="nav nav--tabs p-1 rounded bg-light flex-grow-1">
            {[["all","All"],["active","Active"],["inactive","Inactive"]].map(([val, label]) => (
              <li key={val} className="nav-item">
                <button className={`nav-link${filterStatus === val ? " active" : ""}`}
                  onClick={() => setFilterStatus(val)} data-testid={`tab-${val}`}>{label}</button>
              </li>
            ))}
          </ul>
          <div className="zones-search-shell" style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "6px 12px" }}>
            <i className="bi bi-search" style={{ fontSize: 12, color: "#94a3b8" }}></i>
            <input style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, width: 220 }}
              placeholder="Search zones..." value={search} onChange={e => setSearch(e.target.value)}
              data-testid="input-search" />
          </div>
        </div>

        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-borderless align-middle table-hover mb-0">
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  {["#","Zone Name","Service Type","Area (km2)","Surge","Status","Active","Actions"].map((h, i) => (
                    <th key={i} className={i === 0 ? "ps-4" : i === 7 ? "text-center pe-4" : ""}
                      style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", paddingTop: 12, paddingBottom: 12 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array(3).fill(0).map((_, i) => (
                    <tr key={i}>{Array(8).fill(0).map((_, j) => <td key={j}><div style={{ height: 14, background: "#f1f5f9", borderRadius: 4 }} /></td>)}</tr>
                  ))
                ) : filtered.length ? (
                  filtered.map((zone: any, idx: number) => {
                    const sc = getServiceConfig(zone.serviceType || "both");
                    const surge = Number(zone.surgeFactor) || 1;
                    const area = getZoneArea(zone);
                    return (
                      <tr key={zone.id} data-testid={`zone-row-${zone.id}`}>
                        <td className="ps-4 text-muted small">{idx + 1}</td>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                              style={{ width: 36, height: 36, background: "#f5f3ff", color: "#7c3aed", fontSize: 14 }}>
                              <i className="bi bi-map-fill"></i>
                            </div>
                            <div>
                              <div className="fw-semibold" style={{ fontSize: 13 }}>{zone.name}</div>
                              <div style={{ fontSize: 10.5, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}>
                                {zone.coordinates ? "Boundary set" : "No boundary"}
                                {surge > 1 && <span style={{ background: "#fef08a", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontSize: 9, fontWeight: 700 }}>SURGE ACTIVE</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="badge rounded-pill"
                            style={{ background: sc.color + "18", color: sc.color, fontSize: 11, padding: "4px 10px", fontWeight: 600 }}>
                            <i className={`bi ${sc.icon} me-1`}></i>{sc.label}
                          </span>
                        </td>
                        <td>
                          {area > 0 ? (
                            <div>
                              <div className="fw-semibold" style={{ fontSize: 13, color: "#0f172a" }}>{area.toFixed(2)}</div>
                              <div style={{ fontSize: 10, color: "#94a3b8" }}>km2</div>
                            </div>
                          ) : <span className="text-muted small">-</span>}
                        </td>
                        <td>
                          <span className={`badge ${surge > 1 ? "bg-warning text-dark" : "bg-secondary"}`} style={{ fontSize: 11 }}>
                            {surge.toFixed(1)}x{surge > 1 && <i className="bi bi-lightning-fill ms-1"></i>}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${zone.isActive ? "bg-success" : "bg-secondary"}`} style={{ fontSize: 10 }}>
                            {zone.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>
                          <label className="switcher">
                            <input type="checkbox" className="switcher_input" checked={zone.isActive}
                              onChange={() => toggle.mutate({ id: zone.id, isActive: !zone.isActive })}
                              data-testid={`toggle-zone-${zone.id}`} />
                            <span className="switcher_control"></span>
                          </label>
                        </td>
                        <td className="text-center pe-4">
                          <div className="d-flex justify-content-center gap-1">
                            <button className="btn btn-sm btn-outline-primary" style={{ borderRadius: 8 }}
                              onClick={() => openEdit(zone)} data-testid={`btn-edit-zone-${zone.id}`}>
                              <i className="bi bi-pencil-fill"></i>
                            </button>
                            <button className="btn btn-sm btn-outline-danger" style={{ borderRadius: 8 }}
                              onClick={async () => { if (await adminConfirm(`Delete zone "${zone.name}"?`)) remove.mutate(zone.id); }}
                              data-testid={`btn-delete-zone-${zone.id}`}>
                              <i className="bi bi-trash-fill"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr><td colSpan={8}>
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-map fs-1 d-block mb-2" style={{ opacity: 0.25 }}></i>
                      <p className="fw-semibold mb-1">No zones found</p>
                      <p className="small">Click "Add Zone" to draw your first service zone on the map</p>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ZoneMapModal
        open={open}
        onClose={() => { setOpen(false); setEditing(null); }}
        editing={editing}
        initialForm={formForModal}
        onSave={d => save.mutate(d)}
        saving={save.isPending}
      />
    </div>
  );
}
