import type { NodeParamField } from "./editorTypes";

/** 리터럴 숫자만 구간 검사. `$` 참조·빈 문자열·비숫자 타입은 메시지 없음. */
export function skillParamRangeMessage(field: NodeParamField, raw: string): string | null {
  const range = field.range;
  if (!range || (range.min === undefined && range.max === undefined)) return null;

  const t = (field.valueType ?? "").toLowerCase();
  const numeric =
    t === "int" || t === "integer" || t === "double" || t === "float" || t === "number";
  if (!numeric) return null;

  const trimmed = (raw ?? "").trim();
  if (trimmed === "" || trimmed.startsWith("$")) return null;

  let n: number;
  if (t === "int" || t === "integer") {
    if (!/^-?\d+$/.test(trimmed)) return null;
    n = Number.parseInt(trimmed, 10);
  } else {
    n = Number(trimmed);
  }
  if (!Number.isFinite(n)) return null;

  if (range.min !== undefined && n < range.min) {
    return `Value must be ≥ ${range.min}`;
  }
  if (range.max !== undefined && n > range.max) {
    return `Value must be ≤ ${range.max}`;
  }
  return null;
}
