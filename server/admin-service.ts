import { cancelRideState } from "./ride-state";

export async function adminCancelRide(rideId: string, adminId?: string, reason = "manual override") {
  return cancelRideState(rideId, reason, {
    actorId: adminId,
    actorType: "admin",
    cancelledBy: "admin",
  });
}
