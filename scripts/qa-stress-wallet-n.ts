import { applyWalletChange } from "../server/revenue-engine";

async function debit(i: number) {
  try {
    const r = await applyWalletChange({
      userId: process.argv[2],
      amount: 10,
      type: "DEBIT",
      reason: "stress_test_n",
      refId: `stressn_${i}_${Math.random().toString(36).slice(2)}`,
    });
    return { i, ok: true, newBalance: r.newBalance };
  } catch (e: any) {
    return { i, ok: false, error: e.message };
  }
}

async function run() {
  const N = parseInt(process.argv[3] || "25", 10);
  const start = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, i) => debit(i)));
  const elapsed = Date.now() - start;
  const failed = results.filter((r: any) => !r.ok);
  const balances = results.filter((r:any)=>r.ok).map((r: any) => r.newBalance).sort((a:number,b:number)=>a-b);
  const uniqueBalances = new Set(balances).size;
  console.log(`N=${N} elapsed=${elapsed}ms failed=${failed.length} uniqueFinalBalances=${uniqueBalances}/${balances.length}`);
  if (failed.length) console.log("FAILURES:", JSON.stringify(failed));
  process.exit(0);
}
run();
