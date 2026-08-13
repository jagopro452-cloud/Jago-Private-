import { QueryClient, QueryFunction } from "@tanstack/react-query";

export type AdminUser = {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  isActive?: boolean;
};

export type AdminSession = AdminUser & {
  token?: string | null;
  refreshToken?: string | null;
  expiresAt?: string | null;
};

export class AdminApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.body = body;
  }
}

export function getSavedAdminSession(): AdminSession {
  try {
    return JSON.parse(localStorage.getItem("jago-admin") || "{}");
  } catch {
    return {};
  }
}

function getAdminToken(): string | null {
  return getSavedAdminSession()?.token || null;
}

function getAdminRefreshToken(): string | null {
  return getSavedAdminSession()?.refreshToken || null;
}

export function getAdminDeviceId(): string {
  try {
    const storageKey = "jago-admin-device-id";
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const created = `admin-web-${crypto.randomUUID()}`;
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return "admin-web-fallback";
  }
}

export function saveAdminSession(update: Partial<AdminSession>) {
  const current = getSavedAdminSession();
  localStorage.setItem("jago-admin", JSON.stringify({
    ...current,
    ...update,
    token: update.token ?? current.token ?? null,
    refreshToken: update.refreshToken ?? current.refreshToken ?? null,
    expiresAt: update.expiresAt ?? current.expiresAt ?? null,
  }));
}

export function clearAdminSession(reason = "unauthorized") {
  localStorage.removeItem("jago-admin");
  window.dispatchEvent(new CustomEvent("jago-admin-auth-cleared", { detail: { reason } }));
}

function redirectToAdminLogin(reason = "unauthorized") {
  clearAdminSession(reason);
  if (!window.location.pathname.includes("/admin/login")) {
    const suffix = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    window.location.href = `/admin/login${suffix}`;
  }
}

export function buildAdminHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {};
  if (extra) {
    new Headers(extra).forEach((value, key) => {
      headers[key] = value;
    });
  }

  const token = getAdminToken();
  if (token && !headers.authorization && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (!headers["X-Device-Id"] && !headers["x-device-id"]) {
    headers["X-Device-Id"] = getAdminDeviceId();
  }
  return headers;
}

let refreshPromise: Promise<boolean> | null = null;

export async function refreshAdminSession(): Promise<boolean> {
  const refreshToken = getAdminRefreshToken();
  if (!refreshToken) return false;

  if (!refreshPromise) {
    refreshPromise = window.fetch("/api/admin/auth/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": getAdminDeviceId(),
      },
      body: JSON.stringify({
        refreshToken,
        deviceId: getAdminDeviceId(),
      }),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = await res.json();
        if (!data?.token) return false;
        saveAdminSession({
          token: data.token,
          refreshToken: data.refreshToken,
          expiresAt: data.expiresAt,
        });
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

type AdminFetchOptions = RequestInit & {
  skipRefresh?: boolean;
  redirectOnUnauthorized?: boolean;
};

export async function adminFetch(input: RequestInfo | URL, init: AdminFetchOptions = {}): Promise<Response> {
  const { skipRefresh, redirectOnUnauthorized = true, ...requestInit } = init;
  const makeRequest = () => window.fetch(input, {
    ...requestInit,
    credentials: requestInit.credentials ?? "include",
    headers: buildAdminHeaders(requestInit.headers),
  });

  let response = await makeRequest();
  if (response.status === 401 && !skipRefresh) {
    const refreshed = await refreshAdminSession();
    if (refreshed) {
      response = await makeRequest();
    }
  }

  if (response.status === 401) {
    if (redirectOnUnauthorized) redirectToAdminLogin("unauthorized");
    else clearAdminSession("unauthorized");
  }

  return response;
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const body = await parseResponseBody(res);
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as any).message)
        : typeof body === "string"
          ? body
          : res.statusText;
    throw new AdminApiError(res.status, `${res.status}: ${message}`, body);
  }
}

export async function adminJson<T>(url: string, init?: AdminFetchOptions): Promise<T> {
  const response = await adminFetch(url, init);
  await throwIfResNotOk(response);
  return (await response.json()) as T;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await adminFetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

export async function verifyAdminSession(): Promise<AdminSession> {
  if (!getAdminToken()) {
    const refreshed = await refreshAdminSession();
    if (!refreshed) {
      clearAdminSession("missing-session");
      throw new AdminApiError(401, "401: Admin session missing");
    }
  }

  const payload = await adminJson<{ admin?: AdminUser; session?: { expiresAt?: string | null } }>("/api/admin/me", {
    redirectOnUnauthorized: false,
  });
  const admin = payload.admin || {};
  const expiresAt = payload.session?.expiresAt ?? getSavedAdminSession().expiresAt ?? null;
  const nextSession = { ...getSavedAdminSession(), ...admin, expiresAt };
  saveAdminSession(nextSession);
  return nextSession;
}

export async function logoutAdminSession() {
  const session = getSavedAdminSession();
  try {
    await window.fetch("/api/admin/logout", {
      method: "POST",
      headers: session.token ? {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
        "X-Device-Id": getAdminDeviceId(),
      } : {
        "Content-Type": "application/json",
        "X-Device-Id": getAdminDeviceId(),
      },
      body: session.refreshToken ? JSON.stringify({ refreshToken: session.refreshToken }) : undefined,
    });
  } finally {
    clearAdminSession("logout");
  }
}

function queryKeyToUrl(queryKey: readonly unknown[]): string {
  const [base, params] = queryKey;
  if (typeof base !== "string") {
    throw new Error("Admin query key must start with a URL string");
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) return base;

  const url = new URL(base, window.location.origin);
  Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "" || value === "all") return;
    url.searchParams.set(key, String(value));
  });
  return `${url.pathname}${url.search}`;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export function getQueryFn<T>(options: {
  on401: UnauthorizedBehavior;
}): QueryFunction<T> {
  const { on401: unauthorizedBehavior } = options;
  return async ({ queryKey }) => {
    const res = await adminFetch(queryKeyToUrl(queryKey), { redirectOnUnauthorized: unauthorizedBehavior !== "returnNull" });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null as T;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error: any) => {
        if (error?.status && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
