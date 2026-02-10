/**
 * Feature flags for VLM / dynamic workflow (all OFF by default).
 * See docs/vlm_monitoring.md.
 */

function boolEnv(key: string, defaultValue: boolean): boolean {
  if (typeof process === "undefined" || process.env == null) return defaultValue;
  const v = process.env[key];
  if (v === undefined || v === "") return defaultValue;
  return v.toLowerCase() === "true" || v === "1";
}

/** Apply graph_patch events in Run Monitor (dynamic nodes in VLM container). Default: OFF */
export const ENABLE_DYNAMIC_GRAPH_PATCH = boolEnv(
  "NEXT_PUBLIC_ENABLE_DYNAMIC_GRAPH_PATCH",
  false
);

/** Show VLM node in editor palette (future). Default: OFF */
export const ENABLE_VLM_NODES = boolEnv(
  "NEXT_PUBLIC_ENABLE_VLM_NODES",
  false
);
