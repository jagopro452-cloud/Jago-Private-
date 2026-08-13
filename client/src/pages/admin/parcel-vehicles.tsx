import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/queryClient";

interface ParcelVehicle {
  id: string;
  vehicle_key: string;
  name: string;
  subtitle: string;
  icon: string;
  image_url: string;
  capacity_label: string;
  max_weight_kg: number;
  suitable_items: string;
  accent_color: string;
  base_fare: number;
  per_km: number;
  per_kg: number;
  load_charge: number;
  is_active: boolean;
  sort_order: number;
}

const DEFAULT_NEW: Partial<ParcelVehicle> = {
  vehicle_key: "", name: "", subtitle: "", icon: "📦", image_url: "",
  capacity_label: "", max_weight_kg: 10, suitable_items: "", accent_color: "#2F7BFF",
  base_fare: 40, per_km: 12, per_kg: 4, load_charge: 0, is_active: true, sort_order: 99,
};

export default function ParcelVehiclesAdmin() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newForm, setNewForm] = useState<Record<string, any>>({ ...DEFAULT_NEW });

  const { data: vehicles = [], isLoading } = useQuery<ParcelVehicle[]>({
    queryKey: ["/api/admin/parcel-vehicles"],
    queryFn: async () => {
      const r = await adminFetch("/api/admin/parcel-vehicles");
      if (!r.ok) throw new Error("Failed");
      const d = await r.json();
      return d.vehicles;
    },
  });

  const updateMut = useMutation({
    mutationFn: async ({ key, data }: { key: string; data: Record<string, any> }) => {
      const r = await adminFetch(`/api/admin/parcel-vehicles/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ["/api/admin/parcel-vehicles"] }); },
  });

  const addMut = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const r = await adminFetch("/api/admin/parcel-vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => { setShowAdd(false); setNewForm({ ...DEFAULT_NEW }); qc.invalidateQueries({ queryKey: ["/api/admin/parcel-vehicles"] }); },
  });

  const activeCount = vehicles.filter(v => v.is_active).length;

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#FF6B35,#F59E0B)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(255,107,53,0.35)" }}>
            <i className="bi bi-truck" style={{ color: "#fff", fontSize: 22 }} />
          </div>
          <div>
            <h4 style={{ fontWeight: 800, margin: 0, letterSpacing: -0.3, fontSize: 20 }}>Parcel Vehicle Types</h4>
            <p style={{ margin: 0, fontSize: 13, color: "#6B7280" }}>Configure parcel delivery vehicles — Porter-style dynamic vehicle selection</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ background: "rgba(255,107,53,0.1)", color: "#FF6B35", padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
            {activeCount}/{vehicles.length} active
          </span>
          <button onClick={() => setShowAdd(!showAdd)} style={{ padding: "10px 20px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#FF6B35,#F59E0B)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", boxShadow: "0 4px 14px rgba(255,107,53,0.3)" }}>
            <i className="bi bi-plus-circle" style={{ marginRight: 6 }} />Add Vehicle Type
          </button>
        </div>
      </div>

      {/* Info */}
      <div style={{ background: "linear-gradient(135deg,rgba(255,107,53,0.08),rgba(245,158,11,0.05))", border: "1px solid rgba(255,107,53,0.2)", borderRadius: 16, padding: "14px 20px", marginBottom: 24, display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 28 }}>📦</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Dynamic Parcel Vehicle System</div>
          <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>
            Vehicles appear dynamically in the customer app. Add new vehicle types without any app update.
            Configure fares, weight limits, images, and availability per city.
          </div>
        </div>
      </div>

      {/* Add New Vehicle Form */}
      {showAdd && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.06)", border: "1px solid #E5E7EB" }}>
          <h5 style={{ fontWeight: 700, margin: "0 0 16px" }}>Add New Vehicle Type</h5>
          <VehicleForm form={newForm} setForm={setNewForm} />
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={() => addMut.mutate(newForm)} disabled={addMut.isPending || !newForm.vehicle_key || !newForm.name} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#FF6B35,#F59E0B)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              {addMut.isPending ? "Adding..." : "Add Vehicle"}
            </button>
            <button onClick={() => { setShowAdd(false); setNewForm({ ...DEFAULT_NEW }); }} style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid #E5E7EB", background: "#fff", color: "#6B7280", fontSize: 13, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Vehicle Cards */}
      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div className="spinner-border" style={{ color: "#FF6B35" }} />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
          {vehicles.map(v => {
            const isEditing = editing === v.vehicle_key;
            return (
              <div key={v.vehicle_key} style={{ background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: v.is_active ? `0 4px 20px ${v.accent_color}18` : "0 2px 12px rgba(0,0,0,0.04)", border: v.is_active ? `1.5px solid ${v.accent_color}30` : "1.5px solid #F3F4F6", transition: "all .25s" }}>
                {/* Color bar */}
                <div style={{ height: 4, background: v.is_active ? `linear-gradient(90deg,${v.accent_color},${v.accent_color}88)` : "#E5E7EB" }} />

                {isEditing ? (
                  <div style={{ padding: 20 }}>
                    <VehicleForm form={editForm} setForm={setEditForm} />
                    <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                      <button onClick={() => updateMut.mutate({ key: v.vehicle_key, data: editForm })} disabled={updateMut.isPending} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: `linear-gradient(135deg,${v.accent_color},${v.accent_color}bb)`, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                        {updateMut.isPending ? "Saving..." : "Save"}
                      </button>
                      <button onClick={() => setEditing(null)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", color: "#6B7280", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                      {v.image_url ? (
                        <img src={v.image_url} alt={v.name} style={{ width: 60, height: 60, borderRadius: 16, objectFit: "cover", border: `2px solid ${v.accent_color}30` }} />
                      ) : (
                        <div style={{ width: 60, height: 60, borderRadius: 16, background: v.is_active ? `linear-gradient(135deg,${v.accent_color},${v.accent_color}bb)` : "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>
                          {v.icon}
                        </div>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                          <span style={{ fontWeight: 800, fontSize: 16 }}>{v.name}</span>
                          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: v.is_active ? `${v.accent_color}15` : "#F3F4F6", color: v.is_active ? v.accent_color : "#9CA3AF" }}>
                            {v.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>{v.subtitle}</div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                      <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "8px 12px" }}>
                        <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 600, marginBottom: 2 }}>CAPACITY</div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: v.accent_color }}>{v.capacity_label || `${v.max_weight_kg} kg`}</div>
                      </div>
                      <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "8px 12px" }}>
                        <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 600, marginBottom: 2 }}>BASE FARE</div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>₹{v.base_fare}</div>
                      </div>
                      <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "8px 12px" }}>
                        <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 600, marginBottom: 2 }}>PER KM</div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>₹{v.per_km}</div>
                      </div>
                      <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "8px 12px" }}>
                        <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 600, marginBottom: 2 }}>PER KG</div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>₹{v.per_kg}</div>
                      </div>
                    </div>

                    {v.suitable_items && (
                      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 14, padding: "6px 0" }}>
                        <strong>Suitable for:</strong> {v.suitable_items}
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => { setEditForm({ ...v }); setEditing(v.vehicle_key); }} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", color: "#374151", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                        <i className="bi bi-pencil" style={{ marginRight: 4 }} />Edit
                      </button>
                      <button onClick={() => updateMut.mutate({ key: v.vehicle_key, data: { is_active: !v.is_active } })} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: v.is_active ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)", color: v.is_active ? "#EF4444" : "#10B981", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                        {v.is_active ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VehicleForm({ form, setForm }: { form: Record<string, any>; setForm: (fn: (f: Record<string, any>) => Record<string, any>) => void }) {
  const field = (label: string, key: string, type = "text", placeholder = "") => (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>{label}</label>
      <input type={type} value={form[key] ?? ""} onChange={e => setForm(f => ({ ...f, [key]: type === "number" ? parseFloat(e.target.value) || 0 : e.target.value }))} placeholder={placeholder} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }} />
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
      {field("Vehicle Key", "vehicle_key", "text", "bike_parcel")}
      {field("Name", "name", "text", "Bike Parcel")}
      {field("Subtitle", "subtitle", "text", "Fast & lightweight")}
      {field("Icon (emoji)", "icon", "text", "🏍️")}
      {field("Image URL", "image_url", "text", "/uploads/bike.png")}
      {field("Capacity Label", "capacity_label", "text", "Up to 10 kg")}
      {field("Max Weight (kg)", "max_weight_kg", "number")}
      {field("Suitable Items", "suitable_items", "text", "Docs · Boxes")}
      {field("Accent Color", "accent_color", "text", "#2F7BFF")}
      {field("Base Fare (₹)", "base_fare", "number")}
      {field("Per KM (₹)", "per_km", "number")}
      {field("Per KG (₹)", "per_kg", "number")}
      {field("Load Charge (₹)", "load_charge", "number")}
      {field("Sort Order", "sort_order", "number")}
    </div>
  );
}
