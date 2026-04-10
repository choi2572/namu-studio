/** 알려진 workflow-agent 모델 id → 짧은 표시 이름 (없으면 경로/확장자 정리 후 축약). */
const KNOWN_LABELS: Record<string, string> = {
  qwen: "Qwen",
  gemma: "Gemma",
  llama: "Llama",
  mistral: "Mistral",
  phi: "Phi"
};

/**
 * `<select>` 옵션/폭 절약용 표시 문자열. 실제 API 값은 항상 원본 id를 씁니다.
 */
export function workflowAgentModelOptionLabel(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return modelId;

  const simple = trimmed.split(/[/\\]/).pop() ?? trimmed;
  const noExt = simple.replace(/\.(gguf|bin|safetensors)$/i, "");
  const key = noExt
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const head = key.split("-")[0] ?? key;
  const known = KNOWN_LABELS[head] ?? KNOWN_LABELS[key];
  if (known) return known;

  const display = noExt.length > 0 ? noExt : simple;
  if (display.length <= 20) return display;
  return `${display.slice(0, 10)}…${display.slice(-6)}`;
}
