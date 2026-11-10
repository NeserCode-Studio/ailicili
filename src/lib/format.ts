export function formatDuration(seconds?: number): string {
  if (!seconds || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatCount(value?: number): string {
  if (!value || value < 10000) return String(value ?? 0);
  if (value < 100000000) return `${(value / 10000).toFixed(1)}万`;
  return `${(value / 100000000).toFixed(1)}亿`;
}

export function formatTimestamp(timestamp?: number, locale = "zh-CN"): string {
  if (!timestamp || timestamp <= 0) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp * 1000));
}
