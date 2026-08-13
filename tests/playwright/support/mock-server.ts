import crypto from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type net from "node:net";
import { URL } from "node:url";
import { runtime } from "./runtime";

const require = createRequire(import.meta.url);
const { Server } = require("socket.io") as typeof import("socket.io");

type OtpRecord = {
  otp: string;
  phone: string;
  userType: string;
  attempts: number;
  expiresAt: number;
  deviceId: string;
};

type BookingRecord = {
  id: string;
  serviceType: string;
  customerId: string;
  driverId: string | null;
  pickup: string;
  destination: string;
  amount: number;
  status: "pending" | "accepted" | "rejected" | "paid";
  paymentStatus: "pending" | "paid";
  pickupOtp: string;
  deliveryOtp: string;
  history: Array<{ status: string; at: string }>;
};

const otpStore = new Map<string, OtpRecord>();
const bookings = new Map<string, BookingRecord>();
const connections = new Set<net.Socket>();

function nowIso() {
  return new Date().toISOString();
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const httpServer = createServer(async (req, res) => {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = url.pathname;
  const body = method === "GET" ? {} : await readJson(req);

  if (method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { status: "ok", ts: nowIso() });
  }

  if (method === "POST" && pathname === "/auth/otp/send") {
    const phone = String((body as any)?.phone || runtime.testPhone);
    const userType = String((body as any)?.userType || "customer");
    const deviceId = String((body as any)?.deviceId || "device-1");
    const otp = "123456";

    otpStore.set(phone, {
      otp,
      phone,
      userType,
      attempts: 0,
      expiresAt: Date.now() + 120_000,
      deviceId,
    });

    return sendJson(res, 200, { success: true, phone, otp, expiresInSeconds: 120 });
  }

  if (method === "POST" && pathname === "/auth/otp/verify") {
    const phone = String((body as any)?.phone || runtime.testPhone);
    const otp = String((body as any)?.otp || "");
    const userType = String((body as any)?.userType || "customer");
    const deviceId = String((body as any)?.deviceId || "device-1");
    const record = otpStore.get(phone);

    if (!record) return sendJson(res, 404, { message: "OTP not requested" });
    if (record.deviceId !== deviceId) return sendJson(res, 409, { message: "OTP belongs to a different device" });
    if (record.expiresAt < Date.now()) return sendJson(res, 410, { message: "OTP expired" });
    if (record.attempts >= 3) return sendJson(res, 429, { message: "Too many invalid attempts" });
    if (record.otp !== otp) {
      record.attempts += 1;
      return sendJson(
        res,
        record.attempts >= 3 ? 429 : 400,
        { message: record.attempts >= 3 ? "Too many invalid attempts" : "Invalid OTP" },
      );
    }

    return sendJson(res, 200, {
      success: true,
      token: `token-${phone}`,
      refreshToken: `refresh-${phone}`,
      user: {
        id: userType === "driver" ? runtime.driverId : runtime.customerId,
        phone,
        userType,
      },
    });
  }

  if (method === "POST" && pathname === "/auth/otp/expire") {
    const targetPhone = String((body as any)?.phone || runtime.testPhone);
    const record = otpStore.get(targetPhone);
    if (record) record.expiresAt = Date.now() - 1;
    return sendJson(res, 200, { success: true });
  }

  if (method === "POST" && pathname === "/bookings") {
    const id = `booking-${bookings.size + 1}`;
    const booking: BookingRecord = {
      id,
      serviceType: String((body as any)?.serviceType || "bike"),
      customerId: String((body as any)?.customerId || runtime.customerId),
      driverId: null,
      pickup: String((body as any)?.pickup || "Hitech City"),
      destination: String((body as any)?.destination || "Airport"),
      amount: Number((body as any)?.amount || 275),
      status: "pending",
      paymentStatus: "pending",
      pickupOtp: "7482",
      deliveryOtp: "9154",
      history: [{ status: "pending", at: nowIso() }],
    };
    bookings.set(id, booking);
    return sendJson(res, 201, booking);
  }

  const bookingMatch = pathname.match(/^\/bookings\/([^/]+)(?:\/(.*))?$/);
  if (bookingMatch) {
    const [, bookingId, suffix = ""] = bookingMatch;
    const booking = bookings.get(bookingId);
    if (!booking) return sendJson(res, 404, { message: "Booking not found" });

    if (method === "GET" && !suffix) {
      return sendJson(res, 200, booking);
    }

    if (method === "GET" && suffix === "recovery") {
      return sendJson(res, 200, {
        bookingId: booking.id,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        history: booking.history,
      });
    }

    if (method === "POST" && suffix === "driver/accept") {
      booking.driverId = String((body as any)?.driverId || runtime.driverId);
      booking.status = "accepted";
      booking.history.push({ status: "accepted", at: nowIso() });
      broadcastBooking(booking, "trip:accepted", { acceptedAt: nowIso() });
      return sendJson(res, 200, booking);
    }

    if (method === "POST" && suffix === "driver/reject") {
      booking.driverId = String((body as any)?.driverId || runtime.driverId);
      booking.status = "rejected";
      booking.history.push({ status: "rejected", at: nowIso() });
      broadcastBooking(booking, "trip:rejected", { reason: String((body as any)?.reason || "Rejected") });
      return sendJson(res, 200, booking);
    }

    if (method === "POST" && suffix === "payment/create-order") {
      const amount = Number((body as any)?.amount || booking.amount);
      return sendJson(res, 200, {
        bookingId: booking.id,
        orderId: `order_${booking.id}`,
        amount,
        currency: "INR",
      });
    }

    if (method === "POST" && suffix === "payment/verify") {
      const orderId = String((body as any)?.orderId || "");
      const paymentId = String((body as any)?.paymentId || "");
      const signature = String((body as any)?.signature || "");
      const expected = crypto
        .createHmac("sha256", runtime.razorpaySecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      if (expected !== signature) return sendJson(res, 400, { message: "Invalid payment signature" });

      booking.paymentStatus = "paid";
      booking.status = "paid";
      booking.history.push({ status: "paid", at: nowIso() });
      broadcastBooking(booking, "payment:verified", { paymentId, orderId });
      broadcastBooking(booking, "trip:completed", { paymentId });
      return sendJson(res, 200, { success: true, bookingId: booking.id, paymentId });
    }
  }

  return sendJson(res, 404, { message: "Not found" });
});

httpServer.on("connection", (socket) => {
  connections.add(socket);
  socket.on("close", () => {
    connections.delete(socket);
  });
});

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

function broadcastBooking(booking: BookingRecord, eventName: string, extra: Record<string, unknown> = {}) {
  const payload = {
    bookingId: booking.id,
    serviceType: booking.serviceType,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    driverId: booking.driverId,
    pickupOtp: booking.pickupOtp,
    deliveryOtp: booking.deliveryOtp,
    ...extra,
  };

  let target = io.to(`user:${booking.customerId}`).to(`booking:${booking.id}`);
  if (booking.driverId) {
    target = target.to(`user:${booking.driverId}`);
  }
  target.emit(eventName, payload);
}

io.on("connection", (socket) => {
  const userId = String(socket.handshake.query.userId || "");
  const bookingId = String(socket.handshake.query.bookingId || "");

  if (userId) socket.join(`user:${userId}`);
  if (bookingId) {
    socket.join(`booking:${bookingId}`);
    const booking = bookings.get(bookingId);
    if (booking) {
      socket.emit("booking:snapshot", {
        bookingId: booking.id,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
      });
    }
  }
});

const port = Number(process.env.PW_API_PORT || 4010);
const shutdown = () => {
  io.close();
  httpServer.close(() => process.exit(0));
  for (const socket of connections) {
    socket.destroy();
  }
  setTimeout(() => process.exit(0), 1_000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

httpServer.listen(port, "127.0.0.1", () => {
  console.log(`[playwright-mock-server] listening on ${port}`);
});
