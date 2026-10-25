/** Readable duration is the stored value; seconds are derived, never persisted. */
export function parseDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d+:[0-5]\d$/.test(text) && !/^\d+:[0-5]\d:[0-5]\d$/.test(text)) return null;
  const parts = text.split(":").map(Number);
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
}
export function formatDuration(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const seconds = Math.floor(value);
  if (!Number.isSafeInteger(seconds)) return null;
  const pad = (number: number) => String(number).padStart(2, "0");
  const tail = pad(Math.floor(seconds / 60) % 60) + ":" + pad(seconds % 60);
  return seconds < 3600 ? pad(Math.floor(seconds / 60)) + ":" + pad(seconds % 60) : pad(Math.floor(seconds / 3600)) + ":" + tail;
}
