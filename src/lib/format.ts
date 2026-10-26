const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / HOUR);
  const minutes = Math.floor((seconds % HOUR) / MINUTE);
  const remainder = seconds % MINUTE;

  if (hours > 0) {
    return [hours, minutes, remainder]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }

  return [minutes, remainder]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function formatCompactCount(value: number, lang: string): string {
  if (!Number.isFinite(value) || value <= 0) return "0";

  const locale = lang.startsWith("zh") ? "zh-CN" : "en-US";
  const useChineseUnits = locale === "zh-CN";
  const units = useChineseUnits
    ? [
        { threshold: 100_000_000, divisor: 100_000_000, suffix: "亿" },
        { threshold: 10_000, divisor: 10_000, suffix: "万" },
      ]
    : [
        { threshold: 1_000_000_000, divisor: 1_000_000_000, suffix: "B" },
        { threshold: 1_000_000, divisor: 1_000_000, suffix: "M" },
        { threshold: 1_000, divisor: 1_000, suffix: "K" },
      ];

  const unit = units.find((candidate) => value >= candidate.threshold);
  if (!unit) {
    return new Intl.NumberFormat(locale).format(value);
  }

  const scaled = value / unit.divisor;
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: scaled < 10 ? 1 : 0,
  }).format(scaled);
  return `${formatted}${unit.suffix}`;
}

export function formatPublishedAt(
  epochSeconds: number,
  lang: string,
  now = Date.now()
): string {
  const publishedMs = epochSeconds * 1000;
  const elapsedSeconds = Math.max(0, Math.floor((now - publishedMs) / 1000));
  const locale = lang.startsWith("zh") ? "zh-CN" : "en-US";
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (elapsedSeconds < MINUTE) return relative.format(0, "second");
  if (elapsedSeconds < HOUR) {
    return relative.format(-Math.floor(elapsedSeconds / MINUTE), "minute");
  }
  if (elapsedSeconds < DAY) {
    return relative.format(-Math.floor(elapsedSeconds / HOUR), "hour");
  }
  if (elapsedSeconds < MONTH) {
    return relative.format(-Math.floor(elapsedSeconds / DAY), "day");
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(publishedMs));
}

export function formatClock(timestamp: number, lang: string): string {
  return new Intl.DateTimeFormat(lang.startsWith("zh") ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function formatByteSize(value: number, lang = "en-US"): string {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (bytes < 1024) {
    return `${new Intl.NumberFormat(lang.startsWith("zh") ? "zh-CN" : lang, {
      maximumFractionDigits: 0,
    }).format(bytes)} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let scaled = bytes;
  let unitIndex = -1;
  do {
    scaled /= 1024;
    unitIndex += 1;
  } while (scaled >= 1024 && unitIndex < units.length - 1);

  const formatted = new Intl.NumberFormat(
    lang.startsWith("zh") ? "zh-CN" : lang,
    { maximumFractionDigits: scaled < 10 ? 1 : 0 }
  ).format(scaled);
  return `${formatted} ${units[unitIndex]}`;
}
