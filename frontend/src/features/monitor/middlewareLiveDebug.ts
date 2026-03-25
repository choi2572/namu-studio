import type { MonitorGraph } from "@/features/monitor/monitorGraph";

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj);
}

/** node_status_change 의 node_name 을 monitorGraph 의 apiStateName 키로 맞춤 */
export function resolveMiddlewareDebugStateKey(
  nodeName: string,
  monitorGraph: MonitorGraph | null
): string {
  if (!monitorGraph) return nodeName;
  const mn = monitorGraph.nodes.find((x) => x.apiStateName === nodeName || x.stateName === nodeName);
  return mn?.apiStateName ?? nodeName;
}

export function pickInputOutputFromMiddlewareMessage(msg: Record<string, unknown>): {
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
} {
  const patch: { input?: Record<string, unknown> | null; output?: Record<string, unknown> | null } = {};
  if ("input" in msg) {
    patch.input = isRecord(msg.input) ? (msg.input as Record<string, unknown>) : null;
  }
  if ("output" in msg) {
    patch.output = isRecord(msg.output) ? (msg.output as Record<string, unknown>) : null;
  }
  return patch;
}
