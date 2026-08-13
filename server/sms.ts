import { getConf } from "./config-db";

function normalizeIndianPhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length <= 10) return digits;
  return digits.slice(-10);
}

// SMS type for SMSLogin: 1=OTP, 2=Transactional, 4=Promotional
function getSmsLoginType(purpose?: string): string {
  const p = (purpose || "").toLowerCase();
  if (p.includes("login") || p.includes("otp") || p.includes("reset") || p.includes("verify")) return "1";
  return "2";
}

type SmsMeta = {
  purpose?: string;
  userType?: string;
  templateId?: string;
};

async function sendViaTwilio(phone: string, text: string): Promise<boolean> {
  const accountSid = await getConf("TWILIO_ACCOUNT_SID", "twilio_account_sid");
  const authToken = await getConf("TWILIO_AUTH_TOKEN", "twilio_auth_token");
  const fromNumber = await getConf("TWILIO_PHONE_NUMBER", "twilio_phone_number");
  if (!accountSid || !authToken || !fromNumber) return false;

  try {
    const twilioModule = await import("twilio");
    const twilioFactory = (twilioModule.default ?? twilioModule) as any;
    const client = twilioFactory(accountSid, authToken);
    await client.messages.create({
      body: text,
      from: fromNumber,
      to: `+91${phone}`,
    });
    return true;
  } catch (error: any) {
    console.warn(`[SMS] Twilio send failed: ${error?.message || error}`);
    return false;
  }
}

async function sendViaSmsLogin(phone: string, text: string, meta: SmsMeta = {}): Promise<boolean> {
  // SMSLogin v3 credentials
  const username = await getConf("SMSLOGIN_USERNAME", "smslogin_username");
  const password = await getConf("SMSLOGIN_PASSWORD", "smslogin_password");
  const sender   = await getConf("SMSLOGIN_SENDER_ID", "smslogin_sender_id");
  if (!username || !password || !sender) return false;

  // Base URL — normalised to always end with sendmsg.php
  const rawUrl = (await getConf("SMSLOGIN_API_URL", "smslogin_api_url") || "https://smslogin.co/v3/http/").trim();
  const apiUrl = rawUrl.endsWith("sendmsg.php") ? rawUrl : rawUrl.replace(/\/?$/, "/") + "sendmsg.php";

  // DLT IDs (mandatory for India post-2021)
  const entityId  = await getConf("SMSLOGIN_ENTITY_ID", "smslogin_entity_id");
  // Per-purpose template override, then global fallback
  const purposeKey = `SMSLOGIN_TEMPLATE_${(meta.purpose || "").toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const templateId = meta.templateId
    || (await getConf(purposeKey, purposeKey.toLowerCase()))
    || (await getConf("SMSLOGIN_TEMPLATE_ID", "smslogin_template_id"));

  const smsType = getSmsLoginType(meta.purpose);

  const params = new URLSearchParams();
  params.set("username", username);
  params.set("password", password);
  params.set("type",     smsType);
  params.set("sender",   sender);
  params.set("number",   phone);
  params.set("message",  text);
  if (templateId) params.set("template_id", templateId);
  if (entityId)   params.set("entity_id",   entityId);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const raw = await response.text().catch(() => "");
    const body = raw.trim();
    console.log(`[SMS] SMSLogin response (${response.status}): ${body}`);

    if (!response.ok) {
      console.warn(`[SMS] SMSLogin HTTP ${response.status}: ${body}`);
      return false;
    }

    if (!body) return true;

    // SMSLogin returns JSON or plain text
    try {
      const payload = JSON.parse(body) as any;
      const ok =
        payload?.success === true ||
        payload?.status === true ||
        String(payload?.status  || "").toLowerCase() === "success" ||
        String(payload?.message || "").toLowerCase().includes("success") ||
        String(payload?.code    || "") === "200";
      if (!ok) console.warn(`[SMS] SMSLogin rejected: ${body}`);
      return !!ok;
    } catch {
      // Plain text response: "success", "1701", "sent", etc.
      const ok = /success|^1[0-9]{3}$|sent|queued|accepted/i.test(body);
      if (!ok) console.warn(`[SMS] SMSLogin unexpected: ${body}`);
      return ok;
    }
  } catch (error: any) {
    console.warn(`[SMS] SMSLogin send failed: ${error?.message || error}`);
    return false;
  }
}

async function sendViaFast2Sms(phone: string, text: string): Promise<boolean> {
  const apiKey = await getConf("FAST2SMS_API_KEY", "fast2sms_api_key");
  if (!apiKey) return false;

  try {
    const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        route: "q",
        message: text,
        language: "english",
        flash: 0,
        numbers: phone,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(`[SMS] Fast2SMS HTTP ${response.status}: ${body}`);
      return false;
    }

    const payload = await response.json().catch(() => null) as any;
    const ok = payload?.return === true || payload?.message?.some?.((item: string) => /sms sent/i.test(item));
    if (!ok) console.warn(`[SMS] Fast2SMS rejected: ${JSON.stringify(payload)}`);
    return !!ok;
  } catch (error: any) {
    console.warn(`[SMS] Fast2SMS send failed: ${error?.message || error}`);
    return false;
  }
}

export async function sendCustomSms(phone: string, text: string, meta: SmsMeta = {}): Promise<boolean> {
  const normalizedPhone = normalizeIndianPhone(phone);
  if (normalizedPhone.length !== 10) {
    console.warn(`[SMS] Invalid phone for SMS: ${phone}`);
    return false;
  }

  if (String(process.env.AUTH_DEV_CONSOLE_SMS || "").trim().toLowerCase() === "true") {
    console.log(`[SMS-DEV] ${normalizedPhone}: ${text}`);
    return true;
  }

  // Try SMSLogin first (primary provider)
  if (await sendViaSmsLogin(normalizedPhone, text, meta)) {
    console.log(`[SMS] Sent via SMSLogin to ${normalizedPhone}`);
    return true;
  }

  // Twilio fallback
  if (await sendViaTwilio(normalizedPhone, text)) {
    console.log(`[SMS] Sent via Twilio to ${normalizedPhone}`);
    return true;
  }

  // Fast2SMS fallback
  if (await sendViaFast2Sms(normalizedPhone, text)) {
    console.log(`[SMS] Sent via Fast2SMS to ${normalizedPhone}`);
    return true;
  }

  // Dev mode: always succeed, log to console
  if (process.env.NODE_ENV !== "production") {
    console.log(`[SMS-DEV] ${normalizedPhone}: ${text}`);
    return true;
  }

  console.warn(`[SMS] All providers failed for ${normalizedPhone}`);
  return false;
}
