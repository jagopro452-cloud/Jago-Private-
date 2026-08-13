import type { Request, Response } from "express";
import { isAuthApiError } from "./auth.errors";
import { sendOtpServiceWithMeta, verifyOtpService } from "./otp.service";

type SessionIssuer = (
  userId: string,
  context: { deviceId: string; ipAddress?: string | null; userAgent?: string | null },
  options?: { allowDeviceReset?: boolean },
) => Promise<{
  accessToken: string;
  refreshToken: string;
}>;

export function createSendOtpController() {
  return async function sendOtpController(req: Request, res: Response) {
    try {
      const result = await sendOtpServiceWithMeta(req.body || {}, {
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
      return res.status(500).json({
        success: false,
        code: "SERVER_ERROR",
        message: "Server error",
      });
    }
  };
}

export function createVerifyOtpController(issueSession: SessionIssuer) {
  return async function verifyOtpController(req: Request, res: Response) {
    try {
      const result = await verifyOtpService(req.body || {}, issueSession, {
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
      return res.status(500).json({
        success: false,
        code: "SERVER_ERROR",
        message: "Server error",
      });
    }
  };
}
