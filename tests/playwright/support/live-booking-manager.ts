import { createQaTag, runtime } from "./runtime";
import { LiveClient, type MobileSession } from "./live-client";
import {
  getRecentLiveBookingEvents,
  recordLiveBookingEvent,
  recordLiveNote,
  requireLiveSuiteState,
  upsertLiveActor,
} from "./live-suite-state";
import { extractTripId } from "./live-utils";

const SAFE_BOOKINGS_PER_CUSTOMER_PER_HOUR = 8;
const GLOBAL_BOOKING_COOLDOWN_MS = 2_500;

type ManagedCustomer = {
  actorKey: "customerPrimary" | "customerSecondary";
  session: MobileSession;
};

let lastBookingAt = 0;

export async function getManagedCustomers(client: LiveClient) {
  const state = await requireLiveSuiteState();
  const primary: ManagedCustomer = {
    actorKey: "customerPrimary",
    session: state.actors.customerPrimary.session,
  };

  if (state.actors.customerSecondary?.session?.token) {
    return [primary, {
      actorKey: "customerSecondary",
      session: state.actors.customerSecondary.session,
    }] satisfies ManagedCustomer[];
  }

  const session = await client.loginMobile(runtime.liveCustomerPhone2, "customer");
  await upsertLiveActor("customerSecondary", {
    label: "customer-secondary",
    phone: runtime.liveCustomerPhone2,
    session,
  });

  return [primary, {
    actorKey: "customerSecondary",
    session,
  }] satisfies ManagedCustomer[];
}

export async function pickCustomerForRideBooking(client: LiveClient, bookingKind: string) {
  const candidates = await getManagedCustomers(client);
  const bookingEvents = await getRecentLiveBookingEvents();

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      recentCount: bookingEvents.filter((event) => event.customerPhone === candidate.session.user.phone).length,
    }))
    .sort((left, right) => left.recentCount - right.recentCount);

  const preferred = ranked.find((candidate) => candidate.recentCount < SAFE_BOOKINGS_PER_CUSTOMER_PER_HOUR);
  if (preferred) {
    return preferred;
  }

  const oldestEvent = bookingEvents
    .slice()
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())[0];

  if (oldestEvent) {
    const waitMs = Math.max(5_000, (new Date(oldestEvent.createdAt).getTime() + (60 * 60 * 1000)) - Date.now());
    await recordLiveNote(`Booking budget exhausted for ${bookingKind}; cooling down for ${Math.ceil(waitMs / 1000)}s.`);
    await delay(waitMs);
    return pickCustomerForRideBooking(client, bookingKind);
  }

  return ranked[0];
}

export async function createManagedRideBooking(
  client: LiveClient,
  bookingKind: string,
  buildPayload: (session: MobileSession) => Record<string, unknown>,
  preferredCustomer?: ManagedCustomer["session"] | ManagedCustomer,
) {
  await enforceGlobalBookingCooldown();

  const candidates = await getManagedCustomers(client);
  const preferredPhone = extractPreferredCustomerPhone(preferredCustomer);
  const preferred = preferredCustomer
    ? candidates.find((candidate) => candidate.session.user.phone === preferredPhone) || await pickCustomerForRideBooking(client, bookingKind)
    : await pickCustomerForRideBooking(client, bookingKind);
  const ordered = [
    preferred,
    ...candidates.filter((candidate) => candidate.session.user.phone !== preferred.session.user.phone),
  ];

  let lastError: Error | null = null;
  for (const candidate of ordered) {
    try {
      const booking = await client.bookRide(candidate.session, buildPayload(candidate.session));
      const tripId = extractTripId(booking) || extractTripId(await client.getCustomerActiveTrip(candidate.session));
      if (tripId) {
        await recordLiveBookingEvent({
          id: String(tripId),
          customerPhone: candidate.session.user.phone,
          kind: bookingKind,
        });
      }
      lastBookingAt = Date.now();
      return {
        customer: candidate.session,
        tripId: tripId ? String(tripId) : null,
        booking,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimited = /RATE_LIMIT_EXCEEDED|Too many bookings/i.test(message);
      const hasActiveTrip = /ACTIVE_TRIP_EXISTS|active trip in progress/i.test(message);
      if (!isRateLimited && !hasActiveTrip) {
        throw error;
      }
      lastError = error as Error;
      await recordLiveNote(
        hasActiveTrip
          ? `Ride booking candidate ${candidate.session.user.phone} still has an active trip during ${bookingKind}; trying another QA customer.`
          : `Ride booking budget hit for ${candidate.session.user.phone} during ${bookingKind}; trying another QA customer.`,
      );
    }
  }

  throw lastError || new Error(`Unable to allocate a booking slot for ${bookingKind}.`);
}

function extractPreferredCustomerPhone(preferredCustomer?: ManagedCustomer["session"] | ManagedCustomer) {
  if (!preferredCustomer) return null;
  if ("session" in preferredCustomer) {
    return preferredCustomer.session.user.phone;
  }
  return preferredCustomer.user.phone;
}

async function enforceGlobalBookingCooldown() {
  const elapsed = Date.now() - lastBookingAt;
  if (elapsed >= GLOBAL_BOOKING_COOLDOWN_MS) {
    return;
  }
  await delay(GLOBAL_BOOKING_COOLDOWN_MS - elapsed);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
