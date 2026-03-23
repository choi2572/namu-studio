/**
 * Browser connects WebSocket directly to middleware (not proxied by namu backend).
 * Override with NEXT_PUBLIC_MIDDLEWARE_BASE_URL (e.g. http://localhost:8000).
 */
export function getMiddlewareHttpBaseForBrowser(): string {
  const raw = process.env.NEXT_PUBLIC_MIDDLEWARE_BASE_URL?.trim();
  if (raw) {
    return raw.replace(/\/$/, "");
  }
  return "http://localhost:8000";
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
