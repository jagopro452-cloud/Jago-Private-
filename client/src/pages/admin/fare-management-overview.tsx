import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

function StatusCard({ ok, label, okText, warnText, href }: { ok: boolean | null; label: string; okText: string; warnText: string; href: string }) {
  const loading = ok === null;
  return (
    <Link href={href} className="text-decoration-none">
      <div
        className="card h-100"
        style={{ border: `1px solid ${loading ? "#e2e8f0" : ok ? "#bbf7d0" : "#fde68a"}`, cursor: "pointer" }}
        data-testid={`status-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div className="card-body d-flex align-items-start gap-3">
          <div
            style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: loading ? "#f1f5f9" : ok ? "#dcfce7" : "#fef3c7",
              color: loading ? "#94a3b8" : ok ? "#16a34a" : "#d97706",
              fontSize: 16,
            }}
          >
            <i className={`bi ${loading ? "bi-hourglass-split" : ok ? "bi-check-circle-fill" : "bi-exclamation-triangle-fill"}`}></i>
          </div>
          <div>
            <div className="fw-semibold" style={{ fontSize: 13 }}>{label}</div>
            <div style={{ fontSize: 12, color: loading ? "#94a3b8" : ok ? "#16a34a" : "#b45309" }}>
              {loading ? "Checking..." : ok ? okText : warnText}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function QuickLinkCard({ icon, label, desc, href }: { icon: string; label: string; desc: string; href: string }) {
  return (
    <Link href={href} className="text-decoration-none" data-testid={`quicklink-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="card h-100 admin-hover-card">
        <div className="card-body">
          <div className="d-flex align-items-center gap-2 mb-1">
            <i className={`bi ${icon} text-primary`}></i>
            <span className="fw-semibold" style={{ fontSize: 13.5 }}>{label}</span>
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{desc}</div>
        </div>
      </div>
    </Link>
  );
}

export default function FareManagementOverview() {
  const { data: fares } = useQuery<any[]>({ queryKey: ["/api/fares"] });
  const { data: parcelFares } = useQuery<any[]>({ queryKey: ["/api/parcel-fares"] });
  const { data: zones } = useQuery<any[]>({ queryKey: ["/api/zones"] });
  const { data: surges } = useQuery<any[]>({ queryKey: ["/api/surge-pricing"] });
  const { data: localPoolSettings } = useQuery<any>({ queryKey: ["/api/admin/local-pool/settings"] });
  const { data: outstationPricing } = useQuery<any>({ queryKey: ["/api/admin/outstation-pool/pricing"] });
  const { data: revenueModules } = useQuery<any>({ queryKey: ["/api/admin/module-revenue"] });

  const faresOk = Array.isArray(fares) ? fares.length > 0 : null;
  const parcelOk = Array.isArray(parcelFares) ? parcelFares.length > 0 : null;
  const activeZoneOk = Array.isArray(zones) ? zones.some((z: any) => z.isActive) : null;
  const surgeOk = Array.isArray(surges) ? surges.some((s: any) => s.isActive) : null;

  const lp = localPoolSettings?.settings || {};
  const localPoolOk = localPoolSettings === undefined ? null : Number(lp.base_fare_per_seat) > 0 && Number(lp.fare_per_km_per_seat) > 0;

  const outstationOk = outstationPricing === undefined ? null :
    Number(outstationPricing?.min_price_per_km_per_seat) > 0 && Number(outstationPricing?.max_price_per_km_per_seat) > 0;

  const modules = Array.isArray(revenueModules?.modules) ? revenueModules.modules : (revenueModules === undefined ? null : []);
  const commissionOk = modules === null ? null : modules.length > 0;

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-1">
            <div>
              <h2 className="h5 mb-0">Fare Management Overview</h2>
              <div style={{ fontSize: 12.5, color: "#64748b" }}>Every pricing setting across Rides, Parcel, Pool, Car Sharing and Surge — in one place.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="container-fluid">
        <div className="mb-4">
          <div className="fw-semibold mb-2" style={{ fontSize: 13, color: "#475569" }}>Configuration Health</div>
          <div className="row g-3">
            <div className="col-md-4 col-lg-3">
              <StatusCard ok={faresOk} label="Ride Fare" okText="Configured" warnText="No Ride Fare Configured" href="/admin/fares" />
            </div>
            <div className="col-md-4 col-lg-3">
              <StatusCard ok={parcelOk} label="Parcel Fare" okText="Configured" warnText="Parcel Pricing Missing" href="/admin/parcel-fares" />
            </div>
            <div className="col-md-4 col-lg-3">
              <StatusCard ok={localPoolOk} label="Local Pool Pricing" okText="Configured" warnText="Local Pool Pricing Incomplete" href="/admin/local-pool?openSettings=1" />
            </div>
            <div className="col-md-4 col-lg-3">
              <StatusCard ok={outstationOk} label="Outstation Pricing" okText="Configured" warnText="Outstation Pricing Not Configured" href="/admin/outstation-pool?tab=settings" />
            </div>
            <div className="col-md-4 col-lg-3">
              <StatusCard ok={surgeOk} label="Surge Rules" okText="Active rule found" warnText="Surge Rules Disabled" href="/admin/surge-pricing" />
            </div>
            <div className="col-md-4 col-lg-3">
              <StatusCard ok={commissionOk} label="Commission Rules" okText="Configured" warnText="Commission Rules Missing" href="/admin/revenue-model" />
            </div>
            <div className="col-md-4 col-lg-3">
              <StatusCard ok={activeZoneOk} label="Active Fare Zone" okText="At least one active zone" warnText="No Active Fare Zone" href="/admin/zones" />
            </div>
          </div>
        </div>

        <div className="mb-4">
          <div className="fw-semibold mb-2" style={{ fontSize: 13, color: "#475569" }}>All Pricing Modules</div>
          <div className="row g-3">
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-sign-intersection-y-fill" label="Ride Fares" desc="Zone-wise base fare, per-km, per-min" href="/admin/fares" />
            </div>
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-box" label="Parcel Fares" desc="Zone-wise parcel delivery pricing" href="/admin/parcel-fares" />
            </div>
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-people-fill" label="Local Pool Pricing" desc="Base fare/seat, fare/km/seat, caps" href="/admin/local-pool?openSettings=1" />
            </div>
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-signpost-2-fill" label="Outstation Pool Pricing" desc="Min/max rate per km per seat" href="/admin/outstation-pool?tab=settings" />
            </div>
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-car-front-fill" label="Car Sharing Pricing" desc="Min/max fare per seat" href="/admin/car-sharing?tab=settings" />
            </div>
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-graph-up-arrow" label="Surge Pricing" desc="Zone/time-based multipliers" href="/admin/surge-pricing" />
            </div>
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-diagram-3-fill" label="Commission Rules" desc="Revenue model per service module" href="/admin/revenue-model" />
            </div>
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-x-circle-fill" label="Cancel Reasons" desc="Cancellation fee reasons" href="/admin/cancellation-reasons" />
            </div>
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-calculator-fill" label="Fare Simulator" desc="Preview what a customer pays" href="/admin/fare-simulator" />
            </div>
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-clock-history" label="Pricing Audit Logs" desc="Who changed what pricing, when" href="/admin/pricing-audit-logs" />
            </div>
          </div>
        </div>

        <div className="mb-4">
          <div className="fw-semibold mb-2" style={{ fontSize: 13, color: "#475569" }}>Discounts, Coupons &amp; Driver Incentives</div>
          <div className="row g-3">
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-percent" label="Discount Setup" desc="Automatic customer discounts" href="/admin/discounts" />
            </div>
            <div className="col-md-4 col-lg-3">
              <QuickLinkCard icon="bi-ticket-fill" label="Coupon Setup" desc="Promo codes and campaigns" href="/admin/coupons" />
            </div>
            <div className="col-md-4 col-lg-6">
              <div className="card h-100">
                <div className="card-body">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <i className="bi bi-gift-fill text-primary"></i>
                    <span className="fw-semibold" style={{ fontSize: 13.5 }}>Driver Incentives</span>
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    <Link href="/admin/wallet-bonus" className="btn btn-sm btn-outline-secondary" data-testid="link-wallet-bonus">Wallet Bonus</Link>
                    <Link href="/admin/driver-levels" className="btn btn-sm btn-outline-secondary" data-testid="link-driver-levels">Driver Level Setup</Link>
                    <Link href="/admin/subscriptions" className="btn btn-sm btn-outline-secondary" data-testid="link-subscriptions">Subscription Plans</Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
