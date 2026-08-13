import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CityData {
  city_name: string;
  city_lat: number;
  city_lng: number;
  radius_km: number;
  services: { service_key: string; is_active: boolean; service_name: string; icon: string }[];
}

interface PlatformService {
  key: string;
  name: string;
  icon: string;
}

export default function CityServices() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newCity, setNewCity] = useState({ name: "", lat: "", lng: "", radius: "30" });
  const [showAddCity, setShowAddCity] = useState(false);

  const { data: cities = [], isLoading } = useQuery<CityData[]>({
    queryKey: ["/api/admin/city-services"],
    queryFn: async () => {
      const r = await adminFetch("/api/admin/city-services");
      if (!r.ok) throw new Error("Failed");
      const d = await r.json();
      return d.cities;
    },
  });

  const { data: allServices = [] } = useQuery<PlatformService[]>({
    queryKey: ["/api/platform-services"],
    queryFn: async () => {
      const r = await adminFetch("/api/platform-services");
      if (!r.ok) return [];
      const data = await r.json();
      return (data as any[]).map(s => ({ key: s.service_key, name: s.service_name, icon: s.icon }));
    },
  });

  const toggleMut = useMutation({
    mutationFn: async ({ city, serviceKey, isActive }: { city: string; serviceKey: string; isActive: boolean }) => {
      const r = await adminFetch("/api/admin/city-services/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityName: city, serviceKey, isActive }),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/city-services"] }),
    onError: (e: any) => { qc.invalidateQueries({ queryKey: ["/api/admin/city-services"] }); toast({ title: "Toggle failed", description: e.message, variant: "destructive" }); },
  });

  const addCityMut = useMutation({
    mutationFn: async ({ cityName, cityLat, cityLng, serviceKey, radiusKm }: any) => {
      const r = await adminFetch("/api/admin/city-services/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityName, cityLat, cityLng, serviceKey, radiusKm }),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/city-services"] });
    },
    onError: (e: any) => toast({ title: "Failed to add city service", description: e.message, variant: "destructive" }),
  });

  const enableAllServicesForCity = async (cityName: string, lat: number, lng: number) => {
    for (const svc of allServices) {
      await addCityMut.mutateAsync({ cityName, cityLat: lat, cityLng: lng, serviceKey: svc.key, radiusKm: 30 });
    }
    qc.invalidateQueries({ queryKey: ["/api/admin/city-services"] });
  };

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#10B981,#059669)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(16,185,129,0.35)" }}>
            <i className="bi bi-geo-alt-fill" style={{ color: "#fff", fontSize: 22 }} />
          </div>
          <div>
            <h4 style={{ fontWeight: 800, margin: 0, letterSpacing: -0.3, fontSize: 20 }}>City Service Configuration</h4>
            <p style={{ margin: 0, fontSize: 13, color: "#6B7280" }}>Control which services are available in each city</p>
          </div>
        </div>
        <button onClick={() => setShowAddCity(!showAddCity)} style={{ padding: "10px 20px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", boxShadow: "0 4px 14px rgba(16,185,129,0.3)" }}>
          <i className="bi bi-plus-circle" style={{ marginRight: 6 }} />Add City
        </button>
      </div>

      {/* Add City Form */}
      {showAddCity && (
        <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 24, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #E5E7EB" }}>
          <h5 style={{ fontWeight: 700, margin: "0 0 16px", fontSize: 15 }}>Add New City</h5>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>City Name</label>
              <input value={newCity.name} onChange={e => setNewCity(c => ({ ...c, name: e.target.value }))} placeholder="Vijayawada" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>Latitude</label>
              <input value={newCity.lat} onChange={e => setNewCity(c => ({ ...c, lat: e.target.value }))} placeholder="16.5062" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>Longitude</label>
              <input value={newCity.lng} onChange={e => setNewCity(c => ({ ...c, lng: e.target.value }))} placeholder="80.6480" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>Radius (km)</label>
              <input value={newCity.radius} onChange={e => setNewCity(c => ({ ...c, radius: e.target.value }))} placeholder="30" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }} />
            </div>
          </div>
          <button onClick={async () => {
            if (!newCity.name || !newCity.lat || !newCity.lng) return;
            await enableAllServicesForCity(newCity.name, parseFloat(newCity.lat), parseFloat(newCity.lng));
            setNewCity({ name: "", lat: "", lng: "", radius: "30" });
            setShowAddCity(false);
          }} disabled={addCityMut.isPending} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            {addCityMut.isPending ? "Adding..." : "Add City with All Services"}
          </button>
        </div>
      )}

      {/* Info Banner */}
      <div style={{ background: "linear-gradient(135deg,rgba(16,185,129,0.1),rgba(5,150,105,0.06))", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 16, padding: "14px 20px", marginBottom: 28, display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 28 }}>🌍</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Location-Based Service Visibility</div>
          <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>
            Services appear in customer/driver apps <strong>only</strong> if they are active both globally (Service Management) and in the user's city.
            Toggle services per city to control regional availability.
          </div>
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div className="spinner-border" style={{ color: "#10B981" }} />
          <p style={{ marginTop: 12, color: "#6B7280" }}>Loading cities...</p>
        </div>
      ) : cities.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, background: "#F9FAFB", borderRadius: 16, border: "1px dashed #D1D5DB" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏙️</div>
          <h5 style={{ fontWeight: 700, marginBottom: 8 }}>No Cities Configured</h5>
          <p style={{ color: "#6B7280", fontSize: 13 }}>Add your first city to enable location-based service visibility.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 20 }}>
          {cities.map(city => {
            const activeCount = city.services.filter(s => s.is_active).length;
            return (
              <div key={city.city_name} style={{ background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", border: "1px solid #E5E7EB" }}>
                <div style={{ background: "linear-gradient(135deg,#060D1E,#0D1B3E)", padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 800, color: "#fff", fontSize: 17, marginBottom: 2 }}>📍 {city.city_name}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                        {Number(city.city_lat).toFixed(4)}, {Number(city.city_lng).toFixed(4)} · {city.radius_km}km radius
                      </div>
                    </div>
                    <div style={{ background: "rgba(16,185,129,0.15)", color: "#10B981", padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                      {activeCount}/{city.services.length} active
                    </div>
                  </div>
                </div>
                <div style={{ padding: 16 }}>
                  {city.services.map(svc => (
                    <div key={svc.service_key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, marginBottom: 6, background: svc.is_active ? "rgba(16,185,129,0.06)" : "#F9FAFB", border: `1px solid ${svc.is_active ? "rgba(16,185,129,0.2)" : "#F3F4F6"}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 22 }}>{svc.icon}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{svc.service_name}</div>
                          <div style={{ fontSize: 11, color: svc.is_active ? "#10B981" : "#9CA3AF" }}>
                            {svc.is_active ? "Active in this city" : "Disabled"}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => toggleMut.mutate({ city: city.city_name, serviceKey: svc.service_key, isActive: !svc.is_active })} style={{ width: 48, height: 26, borderRadius: 13, border: "none", background: svc.is_active ? "linear-gradient(135deg,#10B981,#059669)" : "#D1D5DB", cursor: "pointer", position: "relative", transition: "all .25s" }}>
                        <div style={{ position: "absolute", top: 2, left: svc.is_active ? 24 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .25s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />
                      </button>
                    </div>
                  ))}
                  {allServices.filter(s => !city.services.find(cs => cs.service_key === s.key)).length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <select onChange={async (e) => {
                        if (!e.target.value) return;
                        await addCityMut.mutateAsync({
                          cityName: city.city_name,
                          cityLat: city.city_lat,
                          cityLng: city.city_lng,
                          serviceKey: e.target.value,
                          radiusKm: city.radius_km,
                        });
                        e.target.value = "";
                      }} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px dashed #D1D5DB", fontSize: 12, color: "#6B7280", background: "#FAFAFA" }}>
                        <option value="">+ Add service to {city.city_name}...</option>
                        {allServices.filter(s => !city.services.find(cs => cs.service_key === s.key)).map(s => (
                          <option key={s.key} value={s.key}>{s.icon} {s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
