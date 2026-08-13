import type { Request, Response } from "express";
import { loginWithPasswordService } from "./auth.service";
import { isAuthApiError } from "./auth.errors";

type SessionIssuer = (
  userId: string,
  context: { deviceId: string; ipAddress?: string | null; userAgent?: string | null },
  options?: { allowDeviceReset?: boolean },
) => Promise<{
  accessToken: string;
  refreshToken: string;
}>;

export function createLoginController(issueSession: SessionIssuer) {
  return async function loginController(req: Request, res: Response) {
    try {
      const result = await loginWithPasswordService(req.body || {}, issueSession, {
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || null,
      });
      return res.status(200).json(result);
    } catch (err: any) {
      if (isAuthApiError(err)) {
        return res.status(err.status).json({
          success: false,
          code: err.code,
          message: err.message,
        });
      }

      console.error("[AUTH] LOGIN_FAIL_UNHANDLED", {
        ts: new Date().toISOString(),
        phone: String(req.body?.phone || ""),
        userType: String(req.body?.userType || "customer"),
        error: err?.message || String(err),
      });

      return res.status(500).json({
        success: false,
        code: "SERVER_ERROR",
        message: "Server error",
      });
    }
  };
}
