/**
 * Qikink HTTP client — the three calls Qikink's API offers:
 *   POST /api/token          (form-urlencoded: ClientId, client_secret) → { Accesstoken, expires_in }
 *   POST /api/order/create   (JSON, headers ClientId + Accesstoken)
 *   GET  /api/order          (?id=<qikink order id> | ?page_no=<n>, 10 orders per page, newest first)
 *
 * Qikink has no product, availability, design-upload, cancel or webhook API.
 * Designs travel with each order (design_link / mockup_link / placement_sku).
 *
 * Env:
 *   QIKINK_CLIENT_ID, QIKINK_CLIENT_SECRET   merchant credentials (Qikink dashboard → API)
 *   QIKINK_ENV = "sandbox" | "live"         defaults to sandbox
 */

export const QIKINK_SANDBOX_URL = "https://sandbox.qikink.com";
export const QIKINK_LIVE_URL = "https://api.qikink.com";

/** Tokens live 3600 s; renew early so a request never carries one that expires mid-flight. */
const TOKEN_TTL_MS = 3_400_000;
const REQUEST_TIMEOUT_MS = 25_000;

export type QikinkEnv = "sandbox" | "live";

export type QikinkConfig = {
  clientId: string;
  clientSecret: string;
  env: QikinkEnv;
  baseUrl: string;
};

export class QikinkApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly body: unknown,
    /** True when we cannot know whether Qikink acted on the request. */
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = "QikinkApiError";
  }
}

export function getQikinkConfig(): QikinkConfig | null {
  const clientId = process.env.QIKINK_CLIENT_ID?.trim();
  const clientSecret = process.env.QIKINK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const env: QikinkEnv = process.env.QIKINK_ENV?.trim().toLowerCase() === "live" ? "live" : "sandbox";
  return { clientId, clientSecret, env, baseUrl: env === "live" ? QIKINK_LIVE_URL : QIKINK_SANDBOX_URL };
}

type CachedToken = { token: string; expiresAt: number; key: string };
let cachedToken: CachedToken | null = null;

/** Qikink can answer HTTP 200 with an error body, so the body decides as much as the status. */
export function extractQikinkError(status: number, body: unknown): string | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    const errorField = b.error;
    const failed = b.success === false || b.status === false || errorField === true;
    const message =
      (typeof b.message === "string" && b.message) ||
      (typeof b.msg === "string" && b.msg) ||
      (typeof errorField === "string" && errorField) ||
      "";
    const code = Number(b.status_code ?? b.statusCode ?? 0);
    if ((typeof errorField === "string" && errorField) || failed || code >= 400 || status >= 400) {
      return message || JSON.stringify(b).slice(0, 400);
    }
    return null;
  }
  if (Array.isArray(body) && status < 400) return null;
  if (status >= 400) return String(body ?? `HTTP ${status}`).slice(0, 400) || `HTTP ${status}`;
  return null;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isTokenError(status: number, message: string): boolean {
  return status === 401 || /token|unauthori[sz]ed|expired/i.test(message);
}

export class QikinkClient {
  constructor(private readonly config: QikinkConfig) {}

  get env(): QikinkEnv {
    return this.config.env;
  }

  private tokenKey(): string {
    return `${this.config.baseUrl}|${this.config.clientId}`;
  }

  async getToken(force = false): Promise<string> {
    if (!force && cachedToken && cachedToken.key === this.tokenKey() && cachedToken.expiresAt > Date.now()) {
      return cachedToken.token;
    }
    const res = await fetch(`${this.config.baseUrl}/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ClientId: this.config.clientId, client_secret: this.config.clientSecret }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    const body = await readBody(res);
    const err = extractQikinkError(res.status, body);
    const token =
      body && typeof body === "object" ? (body as Record<string, unknown>).Accesstoken : undefined;
    if (err || typeof token !== "string" || !token) {
      throw new QikinkApiError(`Qikink did not issue an access token: ${err ?? "no token in response"}`, res.status, body);
    }
    const expiresIn = Number((body as Record<string, unknown>).expires_in ?? 0);
    const ttl = expiresIn > 120 ? Math.min(TOKEN_TTL_MS, (expiresIn - 100) * 1000) : TOKEN_TTL_MS;
    cachedToken = { token, expiresAt: Date.now() + ttl, key: this.tokenKey() };
    return token;
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, string>; json?: unknown },
    token: string,
  ): Promise<{ status: number; body: unknown }> {
    const url = new URL(this.config.baseUrl + path);
    Object.entries(opts.query ?? {}).forEach(([k, v]) => url.searchParams.set(k, v));
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ClientId: this.config.clientId,
          Accesstoken: token,
          ...(opts.json !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      // Network failure or timeout — for a create, Qikink may already hold the order.
      throw new QikinkApiError(
        `Could not reach Qikink: ${e instanceof Error ? e.message : String(e)}`,
        0,
        null,
        true,
      );
    }
    let body: unknown;
    try {
      body = await readBody(res);
    } catch (e) {
      throw new QikinkApiError(`Unreadable reply from Qikink: ${String(e)}`, res.status, null, true);
    }
    return { status: res.status, body };
  }

  /** Sends a request, re-minting the token once if Qikink rejects it. */
  async request(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, string>; json?: unknown } = {},
  ): Promise<unknown> {
    let token = await this.getToken();
    let { status, body } = await this.send(method, path, opts, token);
    let err = extractQikinkError(status, body);
    if (err && isTokenError(status, err)) {
      token = await this.getToken(true);
      ({ status, body } = await this.send(method, path, opts, token));
      err = extractQikinkError(status, body);
    }
    if (err) {
      throw new QikinkApiError(`Qikink: ${err}`, status, body, status >= 500);
    }
    return body;
  }

  createOrder(payload: QikinkOrderPayload): Promise<unknown> {
    return this.request("POST", "/api/order/create", { json: payload });
  }

  getOrderById(id: string): Promise<unknown> {
    return this.request("GET", "/api/order", { query: { id } });
  }

  listOrders(pageNo: number): Promise<unknown> {
    return this.request("GET", "/api/order", { query: { page_no: String(pageNo) } });
  }

  /** Neither endpoint filters by order number, so page through recent orders. */
  async findOrderByNumber(orderNumber: string, maxPages = 10): Promise<Record<string, unknown> | null> {
    for (let page = 1; page <= maxPages; page++) {
      const body = await this.listOrders(page);
      const list = toOrderList(body);
      if (list.length === 0) return null;
      const hit = list.find((o) => qikinkOrderNumber(o) === orderNumber);
      if (hit) return hit;
    }
    return null;
  }
}

/* ───────────────────────── Payload + parsing helpers ───────────────────────── */

export type QikinkDesign = {
  design_code: string;
  width_inches: string;
  height_inches: string;
  placement_sku: string;
  design_link: string;
  mockup_link: string;
};

export type QikinkLineItem = {
  search_from_my_products: number;
  sku: string;
  quantity: string;
  price: string;
  print_type_id?: number;
  designs?: QikinkDesign[];
};

export type QikinkOrderPayload = {
  order_number: string;
  qikink_shipping: string;
  gateway: "COD" | "Prepaid";
  total_order_value: string;
  line_items: QikinkLineItem[];
  shipping_address: {
    first_name: string;
    last_name: string;
    address1: string;
    address2: string;
    phone: string;
    email: string;
    city: string;
    zip: string;
    province: string;
    country_code: string;
  };
};

/** Qikink order numbers: at most 15 characters of letters, digits and underscore. */
export function toQikinkOrderNumber(orderId: string): string {
  const cleaned = orderId.replace(/[^A-Za-z0-9]/g, "");
  return cleaned.length <= 15 ? cleaned : cleaned.slice(-15);
}

/** Qikink prefixes the number we sent with its account number: "654367_AT20261016X4PD". */
export function qikinkOrderNumber(order: Record<string, unknown>): string {
  const raw = String(order.number ?? order.order_number ?? order.name ?? "");
  return raw.includes("_") ? raw.split("_").slice(1).join("_") : raw;
}

export function toOrderList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const key of ["orders", "data", "order", "result"]) {
      const v = b[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
      if (v && typeof v === "object") return [v as Record<string, unknown>];
    }
    if (b.id || b.number) return [b];
  }
  return [];
}

/** Pulls Qikink's order id out of a create/lookup reply, whatever its exact shape. */
export function extractQikinkOrderId(body: unknown): string | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "number" || typeof body === "string") return String(body) || undefined;
  if (Array.isArray(body)) return body.length ? extractQikinkOrderId(body[0]) : undefined;
  const b = body as Record<string, unknown>;
  for (const key of ["order_id", "orderId", "qikink_order_id", "id"]) {
    const v = b[key];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  for (const key of ["data", "order", "result"]) {
    const nested = extractQikinkOrderId(b[key]);
    if (nested) return nested;
  }
  return undefined;
}

function pick(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

export function extractShipment(order: Record<string, unknown>): {
  status?: string;
  awb?: string;
  courier?: string;
  trackingUrl?: string;
} {
  const shipping = [order.shipping, order.shipment, order.fulfillment, order.tracking]
    .find((v) => v && typeof v === "object") as Record<string, unknown> | undefined;
  const scopes = shipping ? [order, shipping] : [order];
  const find = (keys: string[]) => scopes.map((s) => pick(s, keys)).find(Boolean);
  return {
    status: find(["status", "order_status", "fulfillment_status", "shipment_status", "current_status"]),
    awb: find(["awb", "awb_no", "awb_number", "awbno", "tracking_number", "tracking_no"]),
    courier: find(["courier", "courier_name", "courier_partner", "shipping_partner"]),
    trackingUrl: find(["tracking_url", "tracking_link", "track_url"]),
  };
}
