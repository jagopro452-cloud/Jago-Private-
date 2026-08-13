import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import L from "leaflet";

const DEMAND_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

const SERVICE_LABELS: Record<string, string> = {
  ride: "Ride",
  parcel: "Parcel",
  pool: "Pool",
  cargo: "Cargo",
};

const TILE_STYLES = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    label: "Dark",
  },
  voyager: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    label: "Map",
  },
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    label: "Light",
  },
} as const;

type TileStyle = keyof typeof TILE_STYLES;
type ViewMode = "heatmap" | "grid";

function HeatMapConfigField({
  label,
  value,
  type = "number",
  onChange,
}: {
  label: string;
  value: string | number;
  type?: string;
  onChange: (value: string | number) => void;
}) {
  return (
    <div className="mb-3">
      <label className="form-label small fw-semibold">{label}</label>
      <input
        type={type}
        className="form-control form-control-sm"
        value={value ?? ""}
        onChange={(event) => onChange(type === "number" ? Number(event.target.value) : event.target.value)}
      />
    </div>
  );
}

export default function HeatMapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);
  const gridLayerRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);

  const [mapReady, setMapReady] = useState(false);
  const [tileStyle, setTileStyle] = useState<TileStyle>("dark");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [zoom, setZoom] = useState(11);
  const [configOpen, setConfigOpen] = useState(false);
  const [configForm, setConfigForm] = useState<Record<string, any>>({});

  const queryClient = useQueryClient();

  const { data: points = [] } = useQuery<any[]>({
    queryKey: ["/api/heatmap-points"],
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/admin/heatmap/stats"],
    refetchInterval: 30000,
  });

  const { data: config } = useQuery<any>({
    queryKey: ["/api/admin/heatmap/config"],
    refetchInterval: 60000,
  });

  const saveConfigMutation = useMutation({
    mutationFn: async () => apiRequest("PUT", "/api/admin/heatmap/config", configForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/heatmap/config"] });
      setConfigOpen(false);
    },
  });

  useEffect(() => {
    if (config) {
      setConfigForm({ ...config });
    }
  }, [config]);

  useEffect(() => {
    // Inject leaflet CSS on demand — only when this page is actually rendered
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    setMapReady(true);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [17.43, 78.49],
      zoom: 11,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);
    tileLayerRef.current = L.tileLayer(TILE_STYLES[tileStyle].url, {
      attribution: "&copy; CARTO",
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);

    map.on("zoomend", () => setZoom(map.getZoom()));
    mapInstanceRef.current = map;
  }, [mapReady, tileStyle]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || viewMode !== "heatmap") return;

    if (gridLayerRef.current) {
      mapInstanceRef.current.removeLayer(gridLayerRef.current);
      gridLayerRef.current = null;
    }

    if (heatLayerRef.current) {
      mapInstanceRef.current.removeLayer(heatLayerRef.current);
    }

    const latlngs = points
      .filter((point: any) => point.lat && point.lng)
      .map((point: any) => [
        Number.parseFloat(point.lat),
        Number.parseFloat(point.lng),
        Number.parseFloat(point.intensity) || 1,
      ]);

    if (!latlngs.length) return;

    const layer = L.layerGroup();
    latlngs.forEach(([lat, lng, intensity]: any[]) => {
      const normalized = Math.max(0.2, Math.min(1, Number(intensity) / 10));
      const color = normalized > 0.75 ? "#ef4444" : normalized > 0.5 ? "#f59e0b" : normalized > 0.3 ? "#22c55e" : "#3b82f6";
      L.circle([lat, lng], {
        radius: Math.max(120, 220 + normalized * 380),
        stroke: false,
        fillColor: color,
        fillOpacity: 0.18 + normalized * 0.32,
      }).addTo(layer);
    });

    heatLayerRef.current = layer.addTo(mapInstanceRef.current);
  }, [mapReady, points, viewMode, zoom]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || viewMode !== "grid") return;

    if (heatLayerRef.current) {
      mapInstanceRef.current.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }

    if (gridLayerRef.current) {
      mapInstanceRef.current.removeLayer(gridLayerRef.current);
      gridLayerRef.current = null;
    }

    const zones: any[] = stats?.topZones || [];
    if (!zones.length) return;

    const layer = L.layerGroup();
    const gridMeters = config?.gridSizeMeters || 500;
    const filteredZones =
      serviceFilter === "all"
        ? zones
        : zones.filter((zone: any) => {
            const breakdown = zone.serviceBreakdown || {};
            return (breakdown[serviceFilter] || 0) > 0;
          });

    filteredZones.forEach((zone: any) => {
      const color = DEMAND_COLORS[zone.demandLevel] || "#94a3b8";
      const circle = L.circle([Number.parseFloat(zone.centerLat), Number.parseFloat(zone.centerLng)], {
        radius: gridMeters * 0.45,
        color,
        fillColor: color,
        fillOpacity: 0.25,
        weight: 2,
      });

      const serviceBreakdown = zone.serviceBreakdown || {};
      const serviceLines = Object.entries(serviceBreakdown)
        .filter(([, count]) => Number(count) > 0)
        .map(([key, count]) => `${SERVICE_LABELS[key] || key}: ${count}`)
        .join(" · ");

      circle.bindPopup(`
        <div style="font-family:system-ui;min-width:190px">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px">
            <span style="color:${color}">●</span> ${zone.demandLevel?.toUpperCase()} Demand Zone
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">
            Score: <b>${Number.parseFloat(zone.demandScore || 0).toFixed(2)}</b> ·
            ${zone.requestCount} requests · ${zone.activeDrivers} drivers
          </div>
          ${
            zone.estimatedEarningMin > 0
              ? `<div style="font-size:11px;color:#16a34a;font-weight:600">
                  Est. Rs.${zone.estimatedEarningMin} - Rs.${zone.estimatedEarningMax}/30 min
                </div>`
              : ""
          }
          ${serviceLines ? `<div style="font-size:10px;color:#94a3b8;margin-top:4px">${serviceLines}</div>` : ""}
        </div>
      `);

      layer.addLayer(circle);
    });

    layer.addTo(mapInstanceRef.current);
    gridLayerRef.current = layer;
  }, [config, mapReady, serviceFilter, stats, viewMode]);

  const totalZones = (stats?.gridSummary || []).reduce((total: number, row: any) => total + Number.parseInt(row.zones || 0, 10), 0);
  const highZones = (stats?.gridSummary || []).find((row: any) => row.demandLevel === "high")?.zones || 0;
  const mediumZones = (stats?.gridSummary || []).find((row: any) => row.demandLevel === "medium")?.zones || 0;
  const totalRequests = (stats?.gridSummary || []).reduce(
    (total: number, row: any) => total + Number.parseInt(row.totalRequests || 0, 10),
    0,
  );

  const switchTile = (style: TileStyle) => {
    setTileStyle(style);

    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    mapInstanceRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(TILE_STYLES[style].url, {
      attribution: "&copy; CARTO",
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(mapInstanceRef.current);
  };

  const renderConfigField = (key: string, label: string, type = "number") => (
    <HeatMapConfigField
      key={key}
      label={label}
      type={type}
      value={configForm[key] ?? ""}
      onChange={(value) => setConfigForm((previous) => ({ ...previous, [key]: value }))}
    />
  );

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <h2 className="h5 mb-0 fw-bold">
              <i className="bi bi-fire text-danger me-2"></i>
              Driver Heat Map and Demand Predictor
            </h2>

            <div className="d-flex gap-2 align-items-center flex-wrap">
              <div className="btn-group btn-group-sm">
                <button
                  className={`btn ${viewMode === "grid" ? "btn-primary" : "btn-outline-secondary"}`}
                  style={{ fontSize: 11 }}
                  onClick={() => setViewMode("grid")}
                >
                  <i className="bi bi-grid-3x3-gap-fill me-1"></i>
                  Demand Grid
                </button>
                <button
                  className={`btn ${viewMode === "heatmap" ? "btn-danger" : "btn-outline-secondary"}`}
                  style={{ fontSize: 11 }}
                  onClick={() => setViewMode("heatmap")}
                >
                  <i className="bi bi-fire me-1"></i>
                  Heat Map
                </button>
              </div>

              {viewMode === "grid" && (
                <div className="btn-group btn-group-sm">
                  {["all", "ride", "parcel", "pool", "cargo"].map((service) => (
                    <button
                      key={service}
                      className={`btn ${serviceFilter === service ? "btn-dark" : "btn-outline-secondary"}`}
                      style={{ fontSize: 11 }}
                      onClick={() => setServiceFilter(service)}
                    >
                      {service === "all" ? "All" : SERVICE_LABELS[service]}
                    </button>
                  ))}
                </div>
              )}

              <div className="btn-group btn-group-sm">
                {(Object.entries(TILE_STYLES) as [TileStyle, (typeof TILE_STYLES)[TileStyle]][]).map(([key, value]) => (
                  <button
                    key={key}
                    className={`btn ${tileStyle === key ? "btn-dark" : "btn-outline-secondary"}`}
                    style={{ fontSize: 11 }}
                    onClick={() => switchTile(key)}
                  >
                    {value.label}
                  </button>
                ))}
              </div>

              <button
                className="btn btn-sm btn-outline-primary"
                style={{ fontSize: 11 }}
                onClick={() => setConfigOpen((previous) => !previous)}
              >
                <i className="bi bi-sliders me-1"></i>
                Config
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container-fluid heatmap-page">
        {configOpen && (
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 14 }}>
            <div
              className="card-header d-flex align-items-center justify-content-between py-2 px-3"
              style={{ borderBottom: "1px solid #f1f5f9" }}
            >
              <h6 className="mb-0 fw-semibold">
                <i className="bi bi-sliders me-2 text-primary"></i>
                Heat Map Configuration
              </h6>

              <div className="d-flex align-items-center gap-2">
                <div className="form-check form-switch mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="hmActive"
                    checked={configForm.isActive ?? true}
                    onChange={(event) => setConfigForm((previous) => ({ ...previous, isActive: event.target.checked }))}
                  />
                  <label className="form-check-label small" htmlFor="hmActive">
                    Heat Map Active
                  </label>
                </div>

                <button className="btn btn-sm btn-primary" onClick={() => saveConfigMutation.mutate()} disabled={saveConfigMutation.isPending}>
                  {saveConfigMutation.isPending ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>

            <div className="card-body py-3">
              <div className="row g-3">
                <div className="col-md-4">
                  <h6 className="small fw-bold text-muted text-uppercase mb-3">Grid Settings</h6>
                  {renderConfigField("gridSizeMeters", "Grid Cell Size (meters)")}
                  {renderConfigField("lookbackMinutes", "Lookback Window (minutes)")}
                  {renderConfigField("refreshIntervalSeconds", "Refresh Interval (seconds)")}
                  {renderConfigField("idleTimeoutMinutes", "Idle Driver Timeout (minutes)")}
                </div>

                <div className="col-md-4">
                  <h6 className="small fw-bold text-muted text-uppercase mb-3">Demand Thresholds</h6>
                  {renderConfigField("lowDemandThreshold", "Low Demand Threshold")}
                  {renderConfigField("mediumDemandThreshold", "Medium Demand Threshold")}
                  {renderConfigField("highDemandThreshold", "High Demand Threshold")}
                </div>

                <div className="col-md-4">
                  <h6 className="small fw-bold text-muted text-uppercase mb-3">Earning Predictions (Rs.)</h6>
                  <div className="row g-2">
                    <div className="col-6">{renderConfigField("earningLowMin", "Low Zone Min")}</div>
                    <div className="col-6">{renderConfigField("earningLowMax", "Low Zone Max")}</div>
                    <div className="col-6">{renderConfigField("earningMediumMin", "Medium Zone Min")}</div>
                    <div className="col-6">{renderConfigField("earningMediumMax", "Medium Zone Max")}</div>
                    <div className="col-6">{renderConfigField("earningHighMin", "High Zone Min")}</div>
                    <div className="col-6">{renderConfigField("earningHighMax", "High Zone Max")}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="row g-3 mb-3">
          {[
            {
              label: "Total Active Zones",
              value: totalZones,
              icon: "bi-grid-3x3-gap-fill",
              color: "#8b5cf6",
              background: "linear-gradient(135deg,#8b5cf612,#c4b5fd12)",
            },
            {
              label: "High Demand Zones",
              value: highZones,
              icon: "bi-fire",
              color: "#ef4444",
              background: "linear-gradient(135deg,#ef444412,#fca5a512)",
            },
            {
              label: "Medium Demand Zones",
              value: mediumZones,
              icon: "bi-activity",
              color: "#f59e0b",
              background: "linear-gradient(135deg,#f59e0b12,#fde68a12)",
            },
            {
              label: "Total Ride Requests",
              value: totalRequests,
              icon: "bi-arrow-up-circle",
              color: "#22c55e",
              background: "linear-gradient(135deg,#22c55e12,#86efac12)",
            },
          ].map((card) => (
            <div key={card.label} className="col-sm-6 col-xl-3">
              <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
                <div className="card-body d-flex align-items-center gap-3 py-3">
                  <div
                    className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                    style={{ width: 46, height: 46, background: card.background }}
                  >
                    <i className={`bi ${card.icon} fs-5`} style={{ color: card.color }}></i>
                  </div>
                  <div>
                    <div className="fw-bold fs-4 lh-1" style={{ color: card.color }}>
                      {card.value}
                    </div>
                    <div className="text-muted small mt-1">{card.label}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 16, overflow: "hidden" }}>
          <div
            className="card-header bg-white py-2 px-3 d-flex align-items-center justify-content-between flex-wrap gap-3"
            style={{ borderBottom: "1px solid #f1f5f9" }}
          >
            <h6 className="mb-0 fw-semibold">
              <i className={`bi ${viewMode === "grid" ? "bi-grid-fill" : "bi-map"} me-2 text-primary`}></i>
              {viewMode === "grid" ? "Live Demand Grid" : "Trip Density Heat Map"}
            </h6>

            <div className="d-flex align-items-center gap-3 flex-wrap">
              {viewMode === "grid" && (
                <div className="d-flex gap-2 heatmap-page__legend" style={{ fontSize: 11 }}>
                  {Object.entries(DEMAND_COLORS).map(([level, color]) => (
                    <span key={level} className="d-flex align-items-center gap-1">
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          background: color,
                          borderRadius: 2,
                          display: "inline-block",
                        }}
                      ></span>
                      <span className="text-muted text-capitalize">{level}</span>
                    </span>
                  ))}
                </div>
              )}

              <span className="badge bg-secondary-subtle text-secondary" style={{ fontSize: 10 }}>
                Auto-refresh 30s
              </span>
            </div>
          </div>

          <div className="heatmap-page__map-frame">
            <div ref={mapRef} style={{ height: "60vh", minHeight: 460, width: "100%", background: "#e2e8f0" }} />

            {!mapReady && (
              <div className="heatmap-page__loading">
                <div className="heatmap-page__loading-card">
                  <div className="spinner-border text-primary" role="status" aria-hidden="true"></div>
                  <div>
                    <div className="fw-semibold text-dark">Preparing Heat Map</div>
                    <div className="small text-muted">Loading map engine and live demand overlays...</div>
                  </div>
                </div>
              </div>
            )}

            {viewMode === "grid" && stats?.topZones?.length > 0 && (
              <div className="heatmap-page__overlay-note">
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Demand Legend</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>Click a circle for zone details</div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>Score = Requests / Active Drivers</div>
              </div>
            )}
          </div>
        </div>

        {stats?.topZones?.length > 0 && (
          <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
            <div className="card-header py-2 px-3 bg-white" style={{ borderBottom: "1px solid #f1f5f9" }}>
              <h6 className="mb-0 fw-semibold">
                <i className="bi bi-table me-2 text-primary"></i>
                Top Demand Zones
              </h6>
            </div>

            <div className="table-responsive">
              <table className="table table-hover table-sm mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th style={{ fontSize: 11 }}>Level</th>
                    <th style={{ fontSize: 11 }}>Location (Lat, Lng)</th>
                    <th style={{ fontSize: 11 }}>Demand Score</th>
                    <th style={{ fontSize: 11 }}>Requests</th>
                    <th style={{ fontSize: 11 }}>Active Drivers</th>
                    <th style={{ fontSize: 11 }}>Est. Earning (30 min)</th>
                    <th style={{ fontSize: 11 }}>Services</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats.topZones as any[]).map((zone: any, index: number) => {
                    const color = DEMAND_COLORS[zone.demandLevel] || "#94a3b8";
                    const serviceBreakdown = zone.serviceBreakdown || {};
                    return (
                      <tr key={`${zone.centerLat}-${zone.centerLng}-${index}`}>
                        <td>
                          <span
                            className="badge rounded-pill"
                            style={{ background: `${color}20`, color, fontSize: 10, fontWeight: 700 }}
                          >
                            ● {zone.demandLevel?.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ fontSize: 11, fontFamily: "monospace" }}>
                          {Number.parseFloat(zone.centerLat).toFixed(4)}, {Number.parseFloat(zone.centerLng).toFixed(4)}
                        </td>
                        <td style={{ fontSize: 12, fontWeight: 700, color }}>
                          {Number.parseFloat(zone.demandScore || 0).toFixed(2)}
                        </td>
                        <td style={{ fontSize: 12 }}>{zone.requestCount}</td>
                        <td style={{ fontSize: 12 }}>{zone.activeDrivers}</td>
                        <td style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
                          {zone.estimatedEarningMin > 0
                            ? `Rs.${zone.estimatedEarningMin} - Rs.${zone.estimatedEarningMax}`
                            : "-"}
                        </td>
                        <td style={{ fontSize: 10 }}>
                          {Object.entries(serviceBreakdown)
                            .filter(([, count]) => Number(count) > 0)
                            .map(([key, count]) => (
                              <span key={key} className="badge bg-light text-secondary me-1">
                                {SERVICE_LABELS[key] || key} {String(count)}
                              </span>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {stats?.eventCounts?.length > 0 && (
          <div className="row g-3 mt-1">
            {(stats.eventCounts as any[]).map((eventRow: any) => (
              <div key={eventRow.eventType} className="col-auto">
                <div className="card border-0 shadow-sm px-3 py-2" style={{ borderRadius: 10 }}>
                  <div className="d-flex align-items-center gap-2">
                    <span className="text-muted small">{eventRow.eventType}</span>
                    <span className="fw-bold">{eventRow.cnt}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
