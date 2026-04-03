function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function dslJsonHasOnFailureKey(dslJson: unknown): boolean {
  return (
    dslJson !== null &&
    typeof dslJson === "object" &&
    Object.prototype.hasOwnProperty.call(dslJson as Record<string, unknown>, "OnFailure")
  );
}

/** 로드/저장 시 `dsl_json.OnFailure` 블록을 잃지 않도록 복제한다. */
export function cloneDslOnFailureBlock(dslJson: unknown): Record<string, unknown> | null {
  if (!isRecord(dslJson)) return null;
  const onFailure = dslJson.OnFailure;
  if (!onFailure || !isRecord(onFailure)) return null;
  try {
    return structuredClone(onFailure) as Record<string, unknown>;
  } catch {
    return JSON.parse(JSON.stringify(onFailure)) as Record<string, unknown>;
  }
}

/** 서버가 PUT 응답에서 `OnFailure`를 누락한 경우, 전송한 DSL에서 되살린다. */
export function mergeDslOnFailureIfServerDropped(
  savedDsl: Record<string, unknown>,
  sentDsl: Record<string, unknown>
): Record<string, unknown> {
  if (dslJsonHasOnFailureKey(savedDsl)) return savedDsl;
  const block = cloneDslOnFailureBlock(sentDsl);
  return block ? { ...savedDsl, OnFailure: block } : savedDsl;
}
