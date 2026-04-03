export function downloadJsonFile(fileName: string, data: Record<string, unknown>) {
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function sanitizeDownloadFileBaseName(name: string): string {
  const trimmed = name.trim().replace(/[/\\?%*:|"<>]/g, "_");
  return trimmed.length > 0 ? trimmed : "workflow";
}
