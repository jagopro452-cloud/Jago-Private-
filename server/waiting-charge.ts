export interface WaitingChargeInputs {
  driverArrivedAt: Date | string | null | undefined;
  rideStartedAt: Date | string | null | undefined;
  waitingChargePerMin: number | string | null | undefined;
  gracePeriodSeconds?: number;
  fallbackRate?: number;
}

export interface WaitingChargeResult {
  billableSeconds: number;
  billableMinutes: number;
  waitingCharge: number;
}

export function calculateWaitingCharge(input: WaitingChargeInputs): WaitingChargeResult {
  const gracePeriodSeconds = input.gracePeriodSeconds ?? 60;
  const fallbackRate = input.fallbackRate ?? 2;

  if (!input.driverArrivedAt || !input.rideStartedAt) {
    return { billableSeconds: 0, billableMinutes: 0, waitingCharge: 0 };
  }

  const arrivedAt = new Date(input.driverArrivedAt).getTime();
  const startedAt = new Date(input.rideStartedAt).getTime();
  if (!Number.isFinite(arrivedAt) || !Number.isFinite(startedAt) || startedAt <= arrivedAt) {
    return { billableSeconds: 0, billableMinutes: 0, waitingCharge: 0 };
  }

  const elapsedSeconds = Math.max(0, Math.floor((startedAt - arrivedAt) / 1000));
  const billableSeconds = Math.max(0, elapsedSeconds - gracePeriodSeconds);
  const billableMinutes = billableSeconds > 0 ? Math.ceil(billableSeconds / 60) : 0;
  const rawRate = Number(input.waitingChargePerMin ?? fallbackRate);
  const rate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : fallbackRate;
  const waitingCharge = Number((billableMinutes * rate).toFixed(2));

  return { billableSeconds, billableMinutes, waitingCharge };
}
