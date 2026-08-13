import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function VehicleRequestsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("pending");

  const { data, isLoading } = useQuery<any[]>({ queryKey: ["/api/vehicle-requests"] });
  const requests = Array.isArray(data) ? data : [];
  const filtered = requests.filter((r: any) => r.status === tab);

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: any) => apiRequest("PATCH", `/api/vehicle-requests/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-requests"] });
      toast({ title: "Status updated" });
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const tabs = ["pending", "approved", "denied"];

  return (
    <>
    
      <div className="content-header">
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <h2 className="h5 mb-0">New Vehicle Request List</h2>
          </div>
        </div>
      </div>
      <div className="container-fluid">
        <div className="card">
          <div className="card-header border-bottom py-3">
            <ul className="nav nav--tabs p-1 rounded bg-white">
              {tabs.map(t => (
                <li key={t} className="nav-item">
                  <button className={`nav-link text-capitalize${tab === t ? " active" : ""}`} onClick={() => setTab(t)} data-testid={`tab-vreq-${t}`}>
                    {t}
                    <span className="badge bg-primary ms-1">{requests.filter((r: any) => r.status === t).length}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-borderless align-middle table-hover">
                <thead className="table-light">
                  <tr>
                    <th>#</th>
                    <th>Driver</th>
                    <th>Vehicle</th>
                    <th>Registration</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={6} className="text-center py-4"><div className="spinner-border spinner-border-sm" role="status" /></td></tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-5 text-muted">
                        <i className="bi bi-car-front-fill fs-2 d-block mb-2 opacity-25"></i>
                        No {tab} vehicle requests found
                      </td>
                    </tr>
                  ) : filtered.map((r: any, idx: number) => (
                    <tr key={r.id} data-testid={`row-vreq-${r.id}`}>
                      <td>{idx + 1}</td>
                      <td>{r.driverName || "—"}</td>
                      <td>{r.vehicleName || "—"}</td>
                      <td>{r.registrationNo || "—"}</td>
                      <td>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}</td>
                      <td className="d-flex gap-1">
                        {r.status === "pending" && (
                          <>
                            <button className="btn btn-sm btn-success" onClick={() => updateMutation.mutate({ id: r.id, status: "approved" })} data-testid={`btn-approve-${r.id}`}>Approve</button>
                            <button className="btn btn-sm btn-danger" onClick={() => updateMutation.mutate({ id: r.id, status: "denied" })} data-testid={`btn-deny-${r.id}`}>Deny</button>
                          </>
                        )}
                        {r.status !== "pending" && <span className="badge bg-secondary text-capitalize">{r.status}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    
    </>
  );
}
