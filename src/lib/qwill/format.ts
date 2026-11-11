const day = 86_400_000;

export function formatWhen(ms: number): string {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric" }).format(ms);
}

export function formatRemain(ms: number): string {
  if (ms <= 0) return "now";
  const days = Math.floor(ms / day);
  const hours = Math.floor((ms % day) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (days >= 2) return `${days} days`;
  if (days === 1) return hours > 0 ? `1 day ${hours} hours` : "1 day";
  if (hours >= 1) return mins > 0 ? `${hours} hours ${mins} min` : `${hours} hours`;
  if (mins >= 1) return `${mins} min`;
  return "less than a minute";
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export async function readFile(file: File) {
  return await file.text();
}
