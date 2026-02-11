/**
 * Feature flags for VLM / dynamic workflow (all OFF by default).
 * See docs/vlm_monitoring.md.
 *
 * Next.js: NEXT_PUBLIC_* is inlined at build time — set in .env.local and restart dev server.
 * Or at runtime: localStorage.setItem("ENABLE_VLM_NODES", "true") then refresh (no restart).
 */

function boolEnv(key: string, defaultValue: boolean): boolean {
  if (typeof process !== "undefined" && process.env != null) {
    const v = process.env[key];
    if (v !== undefined && v !== "" && (v.toLowerCase() === "true" || v === "1")) {
      return true;
    }
    if (v !== undefined && v !== "" && (v.toLowerCase() === "false" || v === "0")) {
      return false;
    }
  }
  return defaultValue;
}

function boolRuntime(
  envKey: string,
  localStorageKey: string,
  defaultValue: boolean
): boolean {
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(localStorageKey);
    if (stored !== null) return stored.toLowerCase() === "true" || stored === "1";
  }
  return boolEnv(envKey, defaultValue);
}

/** Apply graph_patch events in Run Monitor (dynamic nodes in VLM container). Default: OFF */
export const ENABLE_DYNAMIC_GRAPH_PATCH = boolRuntime(
  "NEXT_PUBLIC_ENABLE_DYNAMIC_GRAPH_PATCH",
  "ENABLE_DYNAMIC_GRAPH_PATCH",
  false
);

/** Show VLM node in editor palette. Default: OFF. Set localStorage ENABLE_VLM_NODES=true + refresh to test. */
export const ENABLE_VLM_NODES = boolRuntime(
  "NEXT_PUBLIC_ENABLE_VLM_NODES",
  "ENABLE_VLM_NODES",
  false
);
