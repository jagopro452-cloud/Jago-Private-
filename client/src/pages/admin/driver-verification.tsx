import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, apiRequest, getSavedAdminSession } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminHasPermission } from "@shared/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, X, ShieldCheck, MapPin, Phone, Car, Calendar, ExternalLink, Info } from "lucide-react";

const ApiConfig = ""; // Base URL for server paths if needed, but per T001 it might be handled or relative

export default function DriverVerificationPage() {
  const [activeTab, setActiveTab] = useState("pending");
  // Document review / driver verification / service activation are identity
  // -verification gates (KYC/fraud-control) - restricted to users.write
  // holders per the Business Authorization Matrix. Everyone with User
  // Management access can still view driver records and their status.
  const canManageDrivers = adminHasPermission(getSavedAdminSession().role, "users.write");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rejectionNotes, setRejectionNotes] = useState<Record<string, string>>({});
  const [activationDrafts, setActivationDrafts] = useState<Record<string, any>>({});

  const { data: drivers, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/drivers/pending-verification", activeTab],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/drivers/pending-verification?status=${activeTab}`);
      if (!res.ok) throw new Error("Failed to fetch drivers");
      const json = await res.json();
      return json.drivers || [];
    }
  });

  const docReviewMutation = useMutation({
    mutationFn: async ({ driverId, docType, status, adminNote }: { driverId: string, docType: string, status: string, adminNote?: string }) => {
      return apiRequest("PATCH", `/api/admin/drivers/${driverId}/doc-review`, { docType, status, adminNote });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/drivers/pending-verification", activeTab] });
      toast({ title: "Document status updated" });
    }
  });

  const verifyDriverMutation = useMutation({
    mutationFn: async ({ driverId, status, note }: { driverId: string, status: string, note?: string }) => {
      return apiRequest("PATCH", `/api/admin/drivers/${driverId}/verify-driver`, { status, note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/drivers/pending-verification", activeTab] });
      toast({ title: "Driver verification status updated" });
    }
  });

  const serviceActivationMutation = useMutation({
    mutationFn: async ({ driverId, payload }: { driverId: string; payload: any }) => {
      return apiRequest("PATCH", `/api/admin/drivers/${driverId}/service-activation`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/drivers/pending-verification", activeTab] });
      toast({ title: "Driver service activation updated" });
    }
  });

  const handleDocReview = (driverId: string, docType: string, status: string) => {
    docReviewMutation.mutate({ driverId, docType, status });
  };

  const handleVerifyDriver = (driverId: any, status: string) => {
    const note = rejectionNotes[driverId];
    if (status === 'rejected' && !note) {
      toast({ title: "Rejection note required", variant: "destructive" });
      return;
    }
    verifyDriverMutation.mutate({ driverId, status, note });
  };

  const getActivationDraft = (driver: any) => activationDrafts[driver.id] || {
    serviceEligibility: Array.isArray(driver.serviceEligibility) ? driver.serviceEligibility : [],
    parcelEligibility: driver.parcelEligibility === true,
    poolEligibility: driver.poolEligibility === true,
    outstationEligibility: driver.outstationEligibility === true,
    seatCapacity: driver.seatCapacity ?? 4,
  };

  const updateActivationDraft = (driverId: string, patch: any) => {
    setActivationDrafts((prev) => ({
      ...prev,
      [driverId]: {
        ...(prev[driverId] || {}),
        ...patch,
      },
    }));
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved": return <Badge className="bg-green-500 hover:bg-green-600 no-default-hover-elevate">Approved</Badge>;
      case "rejected": return <Badge variant="destructive" className="no-default-hover-elevate">Rejected</Badge>;
      default: return <Badge className="bg-yellow-500 hover:bg-yellow-600 no-default-hover-elevate text-black">Pending</Badge>;
    }
  };

  const renderDocImage = (fileUrl: string) => {
    const src = fileUrl.startsWith("data:") ? fileUrl : (fileUrl.startsWith("/") ? fileUrl : `/${fileUrl}`);
    return (
      <Dialog>
        <DialogTrigger asChild>
          <div className="relative group cursor-pointer overflow-hidden rounded-md border aspect-video bg-muted flex items-center justify-center">
            <img 
              src={src} 
              alt="Document" 
              className="object-cover w-full h-full transition-transform group-hover:scale-105" 
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <ExternalLink className="text-white w-6 h-6" />
            </div>
          </div>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Document Preview</DialogTitle>
          </DialogHeader>
          <img src={src} alt="Document Full Size" className="w-full h-auto rounded-lg" />
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight" data-testid="page-title">Driver Verification</h1>
        <p className="text-muted-foreground" data-testid="text-subtitle">
          {isLoading ? "Loading..." : `${drivers?.length || 0} drivers found in this status`}
        </p>
      </div>

      <Tabs defaultValue="pending" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="pending" data-testid="tab-pending">Pending</TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected" data-testid="tab-rejected">Rejected</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i} className="w-full h-[400px]">
                  <CardHeader className="flex flex-row items-center gap-4 space-y-0">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-[150px]" />
                      <Skeleton className="h-4 w-[100px]" />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-32 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : drivers?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center bg-muted/50 rounded-lg border-2 border-dashed">
              <ShieldCheck className="w-12 h-12 text-muted-foreground mb-4 opacity-20" />
              <p className="text-lg font-medium text-muted-foreground">No drivers with this status</p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
              {drivers?.map((driver) => (
                <Card key={driver.id} className="flex flex-col overflow-hidden hover-elevate shadow-sm" data-testid={`card-driver-${driver.id}`}>
                  <CardHeader className="flex flex-row items-start justify-between gap-4 p-6 bg-muted/30">
                    <div className="flex gap-4">
                      <Avatar className="h-16 w-16 border-2 border-background shadow-sm">
                        <AvatarImage src={driver.selfie_image} />
                        <AvatarFallback className="bg-primary/10 text-primary font-bold text-xl">
                          {driver.fullName?.charAt(0) || "D"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="space-y-1">
                        <CardTitle className="text-xl font-bold" data-testid={`text-driver-name-${driver.id}`}>{driver.fullName}</CardTitle>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Phone className="w-3 h-3" />
                          <span data-testid={`text-driver-phone-${driver.id}`}>{driver.phone}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="w-3 h-3" />
                          <span data-testid={`text-driver-city-${driver.id}`}>{driver.city}</span>
                        </div>
                      </div>
                    </div>
                    {getStatusBadge(driver.verification_status)}
                  </CardHeader>

                  <CardContent className="flex-1 p-6 space-y-6">
                    <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-accent/50 border">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase">Vehicle</p>
                        <div className="flex items-center gap-2 font-semibold">
                          <Car className="w-4 h-4 text-primary" />
                          <span data-testid={`text-driver-vehicle-${driver.id}`}>
                            {driver.vehicle_brand} {driver.vehicle_category_name}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{driver.vehicle_color} • {driver.vehicle_year}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase">Reg. Number</p>
                        <div className="flex items-center gap-2 font-mono font-bold">
                          <Info className="w-4 h-4 text-primary" />
                          <span data-testid={`text-driver-reg-${driver.id}`}>{driver.vehicle_number || "N/A"}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Joined: {new Date(driver.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    {driver.rejection_note && (
                      <Alert variant="destructive" className="bg-destructive/10">
                        <AlertDescription className="text-xs font-medium">
                          <strong>Rejection Note:</strong> {driver.rejection_note}
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="space-y-3">
                      <h4 className="text-sm font-bold flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-primary" />
                        Documents
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {driver.documents?.map((doc: any) => (
                          <div key={doc.id} className="space-y-2 border rounded-lg p-2 bg-background shadow-sm" data-testid={`doc-${doc.doc_type}-${driver.id}`}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] font-bold uppercase truncate opacity-70">{doc.doc_type.replace(/_/g, ' ')}</span>
                              {doc.status === 'approved' ? (
                                <Check className="w-3 h-3 text-green-500" />
                              ) : doc.status === 'rejected' ? (
                                <X className="w-3 h-3 text-red-500" />
                              ) : (
                                <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                              )}
                            </div>
                            
                            {renderDocImage(doc.file_url)}

                            <div className="flex gap-1 pt-1">
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="h-7 w-full p-0 border-green-200 hover:bg-green-50 hover:text-green-700 text-green-600"
                                onClick={() => handleDocReview(driver.id, doc.doc_type, 'approved')}
                                disabled={!canManageDrivers || docReviewMutation.isPending}
                                data-testid={`button-approve-doc-${doc.doc_type}`}
                              >
                                <Check className="w-3 h-3" />
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="h-7 w-full p-0 border-red-200 hover:bg-red-50 hover:text-red-700 text-red-600"
                                onClick={() => handleDocReview(driver.id, doc.doc_type, 'rejected')}
                                disabled={!canManageDrivers || docReviewMutation.isPending}
                                data-testid={`button-reject-doc-${doc.doc_type}`}
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                            {doc.admin_note && (
                              <p className="text-[10px] text-red-500 font-medium leading-tight line-clamp-2 mt-1">
                                {doc.admin_note}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {(() => {
                      const draft = getActivationDraft(driver);
                      const serviceEligibility = Array.isArray(draft.serviceEligibility) ? draft.serviceEligibility : [];
                      return (
                        <div className="space-y-3">
                          <h4 className="text-sm font-bold flex items-center gap-2">
                            <Car className="w-4 h-4 text-primary" />
                            Service Activation
                          </h4>
                          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <label className="flex items-center gap-2 text-sm font-medium">
                                <input
                                  type="checkbox"
                                  checked={draft.parcelEligibility === true}
                                  onChange={(e) => updateActivationDraft(driver.id, { parcelEligibility: e.target.checked })}
                                />
                                Parcel
                              </label>
                              <label className="flex items-center gap-2 text-sm font-medium">
                                <input
                                  type="checkbox"
                                  checked={draft.poolEligibility === true}
                                  onChange={(e) => updateActivationDraft(driver.id, { poolEligibility: e.target.checked })}
                                />
                                Local Pool
                              </label>
                              <label className="flex items-center gap-2 text-sm font-medium">
                                <input
                                  type="checkbox"
                                  checked={draft.outstationEligibility === true}
                                  onChange={(e) => updateActivationDraft(driver.id, { outstationEligibility: e.target.checked })}
                                />
                                Outstation Pool
                              </label>
                              <label className="flex items-center gap-2 text-sm font-medium">
                                <span>Seat Capacity</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={8}
                                  value={draft.seatCapacity ?? 4}
                                  onChange={(e) => updateActivationDraft(driver.id, { seatCapacity: e.target.value })}
                                  className="w-20 rounded border px-2 py-1 text-sm"
                                />
                              </label>
                            </div>
                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-muted-foreground uppercase">Service Keys</div>
                              <div className="flex flex-wrap gap-2">
                                {["bike_ride", "auto_ride", "mini_car", "sedan", "suv", "city_pool", "outstation_pool", "parcel_delivery"].map((serviceKey) => {
                                  const active = serviceEligibility.includes(serviceKey);
                                  return (
                                    <button
                                      key={serviceKey}
                                      type="button"
                                      onClick={() => {
                                        const next = active
                                          ? serviceEligibility.filter((entry: string) => entry !== serviceKey)
                                          : [...serviceEligibility, serviceKey];
                                        updateActivationDraft(driver.id, { serviceEligibility: next });
                                      }}
                                      className={`btn btn-sm ${active ? "btn-primary" : "btn-outline-secondary"}`}
                                    >
                                      {serviceKey}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                onClick={() => serviceActivationMutation.mutate({
                                  driverId: driver.id,
                                  payload: {
                                    serviceEligibility,
                                    parcelEligibility: draft.parcelEligibility === true,
                                    poolEligibility: draft.poolEligibility === true,
                                    outstationEligibility: draft.outstationEligibility === true,
                                    seatCapacity: draft.seatCapacity,
                                  },
                                })}
                                disabled={!canManageDrivers || serviceActivationMutation.isPending}
                              >
                                Save Activation
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    
                    <div className="pt-4 border-t space-y-4 mt-auto">
                      {driver.verification_status === 'pending' && (
                        <div className="space-y-3">
                          <Textarea 
                            placeholder="Reason for rejection (required if rejecting)..." 
                            className="text-sm min-h-[80px] resize-none"
                            value={rejectionNotes[driver.id] || ""}
                            onChange={(e) => setRejectionNotes(prev => ({ ...prev, [driver.id]: e.target.value }))}
                            data-testid={`textarea-rejection-${driver.id}`}
                          />
                          <div className="flex gap-3">
                            <Button 
                              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold h-11"
                              onClick={() => handleVerifyDriver(driver.id, 'approved')}
                              disabled={!canManageDrivers || verifyDriverMutation.isPending}
                              data-testid={`button-approve-driver-${driver.id}`}
                            >
                              <Check className="w-5 h-5 mr-2" />
                              Approve Driver
                            </Button>
                            <Button 
                              variant="destructive" 
                              className="flex-1 font-bold h-11"
                              onClick={() => handleVerifyDriver(driver.id, 'rejected')}
                              disabled={!canManageDrivers || verifyDriverMutation.isPending}
                              data-testid={`button-reject-driver-${driver.id}`}
                            >
                              <X className="w-5 h-5 mr-2" />
                              Reject Driver
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      {driver.verification_status !== 'pending' && (
                        <Button 
                          variant="outline" 
                          className="w-full h-11 border-dashed hover:bg-muted font-medium"
                          onClick={() => verifyDriverMutation.mutate({ driverId: driver.id, status: 'pending' })}
                          disabled={!canManageDrivers}
                          data-testid={`button-reset-driver-${driver.id}`}
                        >
                          Reset to Pending
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
