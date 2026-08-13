import { LiveClient } from "./live-client";
import { runtime } from "./runtime";
import { readLiveSuiteState, writeLiveSuiteState } from "./live-suite-state";

export default async function globalSetup() {
  if (!runtime.useLiveBackend) return;

  const client = await LiveClient.create();
  try {
    try {
      const existing = await readLiveSuiteState();
      const ageMs = Date.now() - new Date(existing.createdAt).getTime();
      if (ageMs < 12 * 60 * 60 * 1000) {
        const adminCheck = await client.get("/api/dashboard/stats", {
          Authorization: `Bearer ${existing.admin.session.token}`,
        });
        if (adminCheck.status() === 401) {
          existing.admin.session = await client.loginAdmin();
        }
        if (!existing.actors.customerSecondary?.session?.token) {
          existing.actors.customerSecondary = {
            label: "customer-secondary",
            phone: runtime.liveCustomerPhone2,
            session: await client.loginMobile(runtime.liveCustomerPhone2, "customer"),
          };
        }
        if (!existing.actors.driverAutoPrimary?.session?.token) {
          existing.actors.driverAutoPrimary = {
            label: "driver-auto-primary",
            phone: runtime.liveDriverAutoPhone,
            session: await client.loginMobile(runtime.liveDriverAutoPhone, "driver"),
          };
        }
        await writeLiveSuiteState(existing);
        return;
      }
    } catch {
      // Fall through to a fresh bootstrap.
    }

    const state = await client.initializeSharedState();
    await writeLiveSuiteState(state);
  } finally {
    await client.dispose();
  }
}
