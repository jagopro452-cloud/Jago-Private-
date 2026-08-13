import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function BusinessSetupPage() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["/api/business-settings"] });
  const settings = Array.isArray(data) ? data : [];

  const getSetting = (key: string) => settings.find((s: any) => s.keyName === key)?.value || "";

  const [form, setForm] = useState({
    business_name: "",
    business_email: "",
    business_phone: "",
    business_address: "",
    default_currency: "INR",
    default_currency_symbol: "₹",
    commission_percentage: "20",
    driver_min_balance: "0",
  });

  useEffect(() => {
    if (settings.length > 0) {
      setForm({
        business_name: getSetting("business_name"),
        business_email: getSetting("business_email"),
        business_phone: getSetting("business_phone"),
        business_address: getSetting("business_address"),
        default_currency: getSetting("default_currency") || "INR",
        default_currency_symbol: getSetting("default_currency_symbol") || "₹",
        commission_percentage: getSetting("commission_percentage") || "20",
        driver_min_balance: getSetting("driver_min_balance") || "0",
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const entries = Object.entries(values);
      for (const [key, value] of entries) {
        await apiRequest("POST", "/api/business-settings", { keyName: key, value, settingsType: "business_info" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-settings"] });
      toast({ title: "Business settings saved" });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const tabs = [
    { label: "Business Info", href: "/admin/business-setup" },
    { label: "Pages & Media", href: "/admin/pages-media" },
    { label: "Configurations", href: "/admin/configurations" },
    { label: "System Settings", href: "/admin/settings" },
  ];

  return (
    <>
    
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <h2 className="h5 mb-0">Business Setup</h2>
          </div>
        </div>
      </div>
      <div className="container-fluid">
        <div className="card mb-4">
          <div className="card-header border-bottom py-3">
            <ul className="nav nav--tabs p-1 rounded bg-white">
              {tabs.map(t => (
                <li key={t.href} className="nav-item">
                  <Link href={t.href} className={`nav-link${t.href === "/admin/business-setup" ? " active" : ""}`}>
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="card-body">
            {isLoading ? (
              <div className="text-center py-4"><div className="spinner-border spinner-border-sm" role="status" /></div>
            ) : (
              <div className="row g-4">
                <div className="col-md-6">
                  <h6 className="fw-bold mb-3">Business Information</h6>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Business Name</label>
                    <input className="form-control" value={form.business_name} onChange={e => setForm({ ...form, business_name: e.target.value })} data-testid="input-biz-name" />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Business Email</label>
                    <input className="form-control" type="email" value={form.business_email} onChange={e => setForm({ ...form, business_email: e.target.value })} data-testid="input-biz-email" />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Business Phone</label>
                    <input className="form-control" value={form.business_phone} onChange={e => setForm({ ...form, business_phone: e.target.value })} data-testid="input-biz-phone" />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Business Address</label>
                    <textarea className="form-control" rows={3} value={form.business_address} onChange={e => setForm({ ...form, business_address: e.target.value })} data-testid="input-biz-address" />
                  </div>
                </div>
                <div className="col-md-6">
                  <h6 className="fw-bold mb-3">Financial Settings</h6>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Default Currency</label>
                    <input className="form-control" value={form.default_currency} onChange={e => setForm({ ...form, default_currency: e.target.value })} data-testid="input-currency" />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Currency Symbol</label>
                    <input className="form-control" value={form.default_currency_symbol} onChange={e => setForm({ ...form, default_currency_symbol: e.target.value })} data-testid="input-currency-symbol" />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Admin Commission (%)</label>
                    <input className="form-control" type="number" min="0" max="100" value={form.commission_percentage} onChange={e => setForm({ ...form, commission_percentage: e.target.value })} data-testid="input-commission" />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Driver Minimum Balance (₹)</label>
                    <input className="form-control" type="number" min="0" value={form.driver_min_balance} onChange={e => setForm({ ...form, driver_min_balance: e.target.value })} data-testid="input-min-balance" />
                  </div>
                </div>
              </div>
            )}
          </div>
          {!isLoading && (
            <div className="card-footer border-top bg-transparent py-3">
              <button
                className="btn btn-primary"
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                data-testid="btn-save-biz"
              >
                {saveMutation.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </div>
      </div>
    
    </>
  );
}
