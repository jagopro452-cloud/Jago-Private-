import { settleDriverPaymentByOrder } from "../server/payment-settlement";

async function run() {
  try {
    const result = await settleDriverPaymentByOrder({
      orderId: process.argv[2],
      paymentId: "pay_QATEST" + Date.now() + "_" + Math.random().toString(36).slice(2),
      driverId: process.argv[3],
      planId: process.argv[4],
      source: "app_verify",
    });
    console.log("RESULT:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.error("SETTLEMENT ERROR:", e.message);
    console.error(e.stack);
  }
  process.exit(0);
}
run();
