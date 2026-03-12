/**
 * Feature flags for VLM / dynamic workflow (all OFF by default).
 * See docs/vlm_monitoring.md.
 *
 * Next.js: NEXT_PUBLIC_* is inlined only for static process.env.NEXT_PUBLIC_* references.
 * Set in .env / .env.local and restart dev server. When env is not set, localStorage is used.
 */
declare const process: { env: Record<string, string | undefined> };

<<<<<<< HEAD
function parseBool(value: string | undefined): boolean | null {
  if (value === undefined || value === "") return null;
  const lower = value.toLowerCase();
  if (lower === "true" || value === "1") return true;
  if (lower === "false" || value === "0") return false;
  return null;
=======
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
  // .env (NEXT_PUBLIC_*)가 명시되어 있으면 그 값을 우선 (localStorage보다 우선)
  if (typeof process !== "undefined" && process.env != null) {
    const v = process.env[envKey];
    if (v !== undefined && v !== "") return boolEnv(envKey, defaultValue);
  }
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(localStorageKey);
    if (stored !== null) return stored.toLowerCase() === "true" || stored === "1";
  }
  return defaultValue;
>>>>>>> 666e4c6d9dca7bb453e43ddb62f88e9a47fa7522
}

/** Apply graph_patch events in Run Monitor (dynamic nodes in VLM container). Default: OFF */
export const ENABLE_DYNAMIC_GRAPH_PATCH = ((): boolean => {
  // Static reference so Next.js inlines at build time
  const envVal = process.env.NEXT_PUBLIC_ENABLE_DYNAMIC_GRAPH_PATCH;
  const fromEnv = parseBool(envVal);
  if (fromEnv !== null) return fromEnv;
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    const stored = localStorage.getItem("ENABLE_DYNAMIC_GRAPH_PATCH");
    if (stored !== null) return parseBool(stored) ?? false;
  }
  return false;
})();

/** Show VLM node in editor palette. Default: OFF. Set in .env or localStorage ENABLE_VLM_NODES=true to test. */
export const ENABLE_VLM_NODES = ((): boolean => {
  // Static reference so Next.js inlines at build time
  const envVal = process.env.NEXT_PUBLIC_ENABLE_VLM_NODES;
  const fromEnv = parseBool(envVal);
  if (fromEnv !== null) return fromEnv;
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    const stored = localStorage.getItem("ENABLE_VLM_NODES");
    if (stored !== null) return parseBool(stored) ?? false;
  }
  return false;
})();
