import { applyWalletChange } from "../server/revenue-engine";

async function debit(i: number) {
  try {
    const r = await applyWalletChange({
      userId: process.argv[2],
      amount: 10,
      type: "DEBIT",
      reason: "stress_test",
      refId: `stress_${i}_${Math.random().toString(36).slice(2)}`,
    });
    return { i, ok: true, newBalance: r.newBalance };
  } catch (e: any) {
    return { i, ok: false, error: e.message };
  }
}

async function run() {
  const N = 10;
  const results = await Promise.all(Array.from({ length: N }, (_, i) => debit(i)));
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}
run();
