import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FareCalculator } from "./fares";

function money(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? `Rs. ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
}

function ReadOnlyRateCard({ title, rows, editHref, note }: { title: string; rows: { label: string; value: string }[]; editHref: string; note: string }) {
  return (
    <div className="card">
      <div className="card-body">
        <div className="fw-semibold mb-2" style={{ fontSize: 13.5 }}>{title}</div>
        <div className="table-responsive">
          <table className="table table-sm table-borderless mb-2">
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td style={{ color: "#64748b", fontSize: 12.5 }}>{r.label}</td>
                  <td className="fw-semibold text-end" style={{ fontSize: 12.5 }}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: "#94a3b8" }}>{note}</div>
        <a href={editHref} className="btn btn-sm btn-outline-primary mt-2">Edit these rates</a>
      </div>
    </div>
  );
}

export default function FareSimulatorPage() {
  const [tab, setTab] = useState<"ride" | "parcel" | "local-pool" | "outstation" | "car-sharing">("ride");

  const { data: zones } = useQuery<any[]>({ queryKey: ["/api/zones"] });
  const { data: vehicleCategories } = useQuery<any[]>({ queryKey: ["/api/vehicle-categories"] });
  const { data: parcelFares } = useQuery<any[]>({ queryKey: ["/api/parcel-fares"] });
  const { data: localPoolSettings } = useQuery<any>({ queryKey: ["/api/admin/local-pool/settings"], enabled: tab === "local-pool" });
  const { data: outstationPricing } = useQuery<any>({ queryKey: ["/api/admin/outstation-pool/pricing"], enabled: tab === "outstation" });

  const safeZones = Array.isArray(zones) ? zones : [];
  const safeVehicleCategories = Array.isArray(vehicleCategories) ? vehicleCategories : [];
  const safeParcelFares = Array.isArray(parcelFares) ? parcelFares : [];

  const lp = localPoolSettings?.settings || {};

  const tabs: { key: typeof tab; label: string; icon: string }[] = [
    { key: "ride", label: "Ride", icon: "bi-sign-intersection-y-fill" },
    { key: "parcel", label: "Parcel", icon: "bi-box" },
    { key: "local-pool", label: "Local Pool", icon: "bi-people-fill" },
    { key: "outstation", label: "Outstation Pool", icon: "bi-signpost-2-fill" },
    { key: "car-sharing", label: "Car Sharing", icon: "bi-car-front-fill" },
  ];

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <h2 className="h5 mb-0">Fare Simulator</h2>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Preview what a customer will be charged, using the same rates configured in each pricing module.</div>
        </div>
      </div>

      <div className="container-fluid">
        <ul className="nav nav-pills mb-3 flex-wrap" style={{ gap: 6 }}>
          {tabs.map((t) => (
            <li className="nav-item" key={t.key}>
              <button
                className={`nav-link ${tab === t.key ? "active" : ""}`}
                onClick={() => setTab(t.key)}
                data-testid={`simulator-tab-${t.key}`}
              >
                <i className={`bi ${t.icon} me-1`}></i>{t.label}
              </button>
            </li>
          ))}
        </ul>

        {tab === "ride" && (
          <FareCalculator zones={safeZones} vehicleCategories={safeVehicleCategories} />
        )}

        {tab === "parcel" && (
          <div className="row g-3">
            {safeParcelFares.length === 0 ? (
              <div className="col-12">
                <div className="card"><div className="card-body text-center text-muted py-4">
                  <i className="bi bi-box fs-2 d-block mb-2 opacity-25"></i>
                  No parcel fares configured yet.
                  <div className="mt-2"><a href="/admin/parcel-fares" className="btn btn-sm btn-primary">Set up Parcel Fares</a></div>
                </div></div>
              </div>
            ) : (
              safeParcelFares.map((f: any) => (
                <div className="col-md-6 col-lg-4" key={f.id}>
                  <ReadOnlyRateCard
                    title={f.zoneName || f.zone_name || "Zone"}
                    rows={[
                      { label: "Base Fare", value: money(f.baseFare) },
                      { label: "Per Km", value: money(f.farePerKm) },
                      { label: "Per Kg", value: money(f.farePerKg) },
                      { label: "Minimum Fare", value: money(f.minimumFare) },
                    ]}
                    editHref="/admin/parcel-fares"
                    note="Live rate — final price also depends on weight/distance entered by the customer."
                  />
                </div>
              ))
            )}
          </div>
        )}

        {tab === "local-pool" && (
          <div className="row g-3">
            <div className="col-md-6 col-lg-4">
              <ReadOnlyRateCard
                title="Local Pool — Per Seat Rate"
                rows={[
                  { label: "Base Fare / seat", value: money(lp.base_fare_per_seat) },
                  { label: "Fare / km / seat", value: money(lp.fare_per_km_per_seat) },
                  { label: "Min Fare / seat", value: money(lp.min_fare_per_seat) },
                  { label: "Max Fare / seat", value: money(lp.max_fare_per_seat) },
                ]}
                editHref="/admin/local-pool?openSettings=1"
                note="Formula: fare/seat = clamp(base + distanceKm × per-km rate, min, max)."
              />
            </div>
          </div>
        )}

        {tab === "outstation" && (
          <div className="row g-3">
            <div className="col-md-6 col-lg-4">
              <ReadOnlyRateCard
                title="Outstation Pool — Rate Caps"
                rows={[
                  { label: "Min Rate / km / seat", value: money(outstationPricing?.min_price_per_km_per_seat) },
                  { label: "Max Rate / km / seat", value: money(outstationPricing?.max_price_per_km_per_seat) },
                ]}
                editHref="/admin/outstation-pool?tab=settings"
                note="Driver sets the actual rate per km per seat within this floor/ceiling when posting a ride."
              />
            </div>
          </div>
        )}

        {tab === "car-sharing" && (
          <div className="row g-3">
            <div className="col-12">
              <div className="card"><div className="card-body text-center text-muted py-4">
                <i className="bi bi-car-front-fill fs-2 d-block mb-2 opacity-25"></i>
                Car Sharing uses driver-set fare per seat, capped by min/max limits.
                <div className="mt-2"><a href="/admin/car-sharing?tab=settings" className="btn btn-sm btn-primary">View Car Sharing Pricing Settings</a></div>
              </div></div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
