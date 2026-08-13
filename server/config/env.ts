import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.string().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DB_HOST: z.string().optional(),
  DB_PORT: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_SSL: z.string().optional(),
  DB_SSL_REJECT_UNAUTHORIZED: z.string().optional(),
  DB_CA_CERT: z.string().optional(),
  DATABASE_CA_CERT: z.string().optional(),

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_NAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_PHONE: z.string().optional(),
  ADMIN_SESSION_TTL_HOURS: z.string().optional(),
  ADMIN_2FA_REQUIRED: z.string().optional(),
  ENABLE_DEV_OTP_RESPONSES: z.string().optional(),

  GOOGLE_MAPS_KEY: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  SOCKET_ALLOWED_ORIGINS: z.string().optional(),
  OPS_API_KEY: z.string().optional(),
  ALERT_WEBHOOK_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  APP_URL: z.string().optional(),
  API_BASE_URL: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  AI_ASSISTANT_SERVICE_URL: z.string().optional(),
  FF_VOICE_ASSISTANT_V2: z.string().optional(),
  FF_VOICE_BOOKING: z.string().optional(),
  REQUIRE_EXTERNAL_ALERT_WEBHOOK: z.string().optional(),
  ADMIN_RESET_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  JWT_SECRET: z.string().optional(),
  REFRESH_TOKEN_SECRET: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  DEVICE_TOKEN_SECRET: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_KEY: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_API_KEY: z.string().optional(),
  FIREBASE_APP_ID: z.string().optional(),
  FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_WEB_API_KEY: z.string().optional(),
  AUTH_JWT_SECRET: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

function normalizeEnv(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const normalized = { ...input };

  normalized.AUTH_JWT_SECRET =
    normalized.AUTH_JWT_SECRET ||
    normalized.JWT_SECRET ||
    "";
  normalized.GOOGLE_MAPS_API_KEY =
    normalized.GOOGLE_MAPS_API_KEY ||
    normalized.GOOGLE_MAPS_KEY ||
    "";
  normalized.SOCKET_ALLOWED_ORIGINS =
    normalized.SOCKET_ALLOWED_ORIGINS ||
    normalized.SOCKET_ALLOWED_ORIGIN ||
    "";
  normalized.FIREBASE_WEB_API_KEY =
    normalized.FIREBASE_WEB_API_KEY ||
    normalized.FIREBASE_API_KEY ||
    "";
  normalized.APP_BASE_URL =
    normalized.APP_BASE_URL ||
    normalized.API_BASE_URL ||
    normalized.APP_URL ||
    "";

  return normalized;
}

export function parseEnv(): AppEnv {
  const parsed = EnvSchema.safeParse(normalizeEnv(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export function isTrue(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function isFalse(value: string | undefined): boolean {
  if (!value) return false;
  return ["0", "false", "no", "off"].includes(value.toLowerCase());
}

export function validateProductionReadiness(env: AppEnv): void {
  if (env.NODE_ENV !== "production") return;

  const critical: string[] = [];
  const warnings: string[] = [];
  const invalid: string[] = [];

  if (!env.GOOGLE_MAPS_API_KEY) critical.push("GOOGLE_MAPS_API_KEY");
  if (!env.ALLOWED_ORIGINS) critical.push("ALLOWED_ORIGINS");
  if (!env.SOCKET_ALLOWED_ORIGINS) critical.push("SOCKET_ALLOWED_ORIGINS");
  if (!env.REDIS_URL) critical.push("REDIS_URL");
  if (!env.AUTH_JWT_SECRET) critical.push("AUTH_JWT_SECRET");
  if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) critical.push("FIREBASE_SERVICE_ACCOUNT_KEY");

  // Razorpay and Firebase-web-client config are intentionally deferred (payments
  // not yet live) - unconfigured, this disables payments/client-Firebase features
  // only (see getRazorpayKeys()/FIREBASE_WEB_API_KEY call sites), it must not
  // block server boot. Previously fatal here, which crashed startup the moment
  // NODE_ENV=production - confirmed root cause of a real production outage
  // (2026-08-03) when these were legitimately still unset. Kept as warnings so
  // an operator is still told, without taking the whole app down over it.
  if (!env.RAZORPAY_KEY_ID) warnings.push("RAZORPAY_KEY_ID");
  if (!env.RAZORPAY_KEY_SECRET) warnings.push("RAZORPAY_KEY_SECRET");
  if (!env.RAZORPAY_WEBHOOK_SECRET) warnings.push("RAZORPAY_WEBHOOK_SECRET");
  if (!env.FIREBASE_WEB_API_KEY) warnings.push("FIREBASE_WEB_API_KEY");

  if (!env.OPS_API_KEY) warnings.push("OPS_API_KEY");
  if (!env.ADMIN_PASSWORD) warnings.push("ADMIN_PASSWORD");
  if (isTrue(env.REQUIRE_EXTERNAL_ALERT_WEBHOOK) && !env.ALERT_WEBHOOK_URL) {
    warnings.push("ALERT_WEBHOOK_URL (external ops webhook required by REQUIRE_EXTERNAL_ALERT_WEBHOOK=true)");
  }
  if (!env.APP_BASE_URL) warnings.push("APP_BASE_URL");
  const voiceAssistantEnabled = isTrue(env.FF_VOICE_ASSISTANT_V2) || isTrue(env.FF_VOICE_BOOKING);
  if (voiceAssistantEnabled && !env.AI_ASSISTANT_SERVICE_URL) {
    warnings.push("AI_ASSISTANT_SERVICE_URL (required only when voice assistant feature flags are enabled)");
  }
  if (env.AI_ASSISTANT_SERVICE_URL?.includes("localhost")) warnings.push("AI_ASSISTANT_SERVICE_URL points to localhost");
  if (!env.ADMIN_RESET_KEY) warnings.push("ADMIN_RESET_KEY");
  if (!env.ANTHROPIC_API_KEY) warnings.push("ANTHROPIC_API_KEY");

  const productionUrlChecks = [
    ["DATABASE_URL", env.DATABASE_URL],
    ["APP_BASE_URL", env.APP_BASE_URL],
    ["ALLOWED_ORIGINS", env.ALLOWED_ORIGINS],
    ["SOCKET_ALLOWED_ORIGINS", env.SOCKET_ALLOWED_ORIGINS],
    ["AI_ASSISTANT_SERVICE_URL", env.AI_ASSISTANT_SERVICE_URL],
  ] as const;
  for (const [name, value] of productionUrlChecks) {
    if (!value) continue;
    if (/localhost|127\.0\.0\.1/i.test(value)) {
      invalid.push(`${name} points to localhost`);
    }
    if (/changeme|example|your_|placeholder|test_/i.test(value)) {
      invalid.push(`${name} contains a placeholder value`);
    }
  }

  const secretChecks = [
    ["AUTH_JWT_SECRET", env.AUTH_JWT_SECRET],
    ["RAZORPAY_KEY_ID", env.RAZORPAY_KEY_ID],
    ["RAZORPAY_KEY_SECRET", env.RAZORPAY_KEY_SECRET],
    ["RAZORPAY_WEBHOOK_SECRET", env.RAZORPAY_WEBHOOK_SECRET],
    ["FIREBASE_WEB_API_KEY", env.FIREBASE_WEB_API_KEY],
    ["GOOGLE_MAPS_API_KEY", env.GOOGLE_MAPS_API_KEY],
    ["DATABASE_URL", env.DATABASE_URL],
    ["REDIS_URL", env.REDIS_URL],
  ] as const;
  for (const [name, value] of secretChecks) {
    if (!value) continue;
    if (/changeme|example|your_|placeholder|test_/i.test(value)) {
      invalid.push(`${name} contains a placeholder value`);
    }
  }

  if (critical.length) {
    throw new Error(`[config] FATAL: Critical production env vars not set: ${critical.join(", ")} - cannot start in production without these.`);
  }
  if (invalid.length) {
    throw new Error(`[config] FATAL: Invalid production env vars detected: ${invalid.join(", ")}.`);
  }
  if (warnings.length) {
    console.warn(`[config] WARNING: Production env vars not set: ${warnings.join(", ")} - some features will be unavailable.`);
  }
}
