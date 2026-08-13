export function canWalletCoverCharge(balance: number, amount: number): boolean {
  if (!Number.isFinite(balance) || !Number.isFinite(amount)) return false;
  if (amount < 0) return false;
  return balance >= amount;
}

export function shouldApplyCustomerLateCancelFee(
  previousStatus: string | null | undefined,
  driverId: string | null | undefined,
): boolean {
  if (!driverId) return false;
  return ["driver_assigned", "accepted", "arrived"].includes(String(previousStatus || "").trim());
}

export function clampSeatRequest(value: unknown, maxSeats = 6): number {
  const parsed = Number.parseInt(String(value ?? 1), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(maxSeats, parsed));
}
