/**
 * Browser connects WebSocket directly to middleware (not proxied by namu backend).
 * Override with NEXT_PUBLIC_MIDDLEWARE_BASE_URL (e.g. http://localhost:8000).
 */
export function getMiddlewareHttpBaseForBrowser(): string {
  const raw = process.env.NEXT_PUBLIC_MIDDLEWARE_BASE_URL?.trim();
  if (raw) {
    const cleaned = raw.replace(/\/$/, "");
    // Some browsers (e.g. Firefox) may prefer IPv6 for `localhost` (::1).
    // The mock middleware binds to IPv4 by default, so force IPv4.
    return cleaned.replace("://localhost", "://127.0.0.1");
  }
  return "http://127.0.0.1:8000";
}

function httpToWebSocketBase(httpBase: string): string {
  if (httpBase.startsWith("https://")) {
    return `wss://${httpBase.slice("https://".length)}`;
  }
  if (httpBase.startsWith("http://")) {
    return `ws://${httpBase.slice("http://".length)}`;
  }
  return httpBase;
}

/** WS /api/v1/workflows/monitor */
export function getMonitorWebSocketUrl(): string {
  const base = httpToWebSocketBase(getMiddlewareHttpBaseForBrowser());
  return `${base}/api/v1/workflows/monitor`;
}
