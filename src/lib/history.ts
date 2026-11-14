export const HISTORY_COMPLETION_RATIO = 0.95;
export const HISTORY_COMPLETION_REMAINING_SECONDS = 3;

export interface HistoryProgressLike {
  progressSeconds: number;
  durationSeconds: number;
  card: {
    duration?: number;
  };
}

export function isHistoryProgressComplete(
  progressSeconds: number,
  durationSeconds: number
) {
  if (
    !Number.isFinite(progressSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return false;
  }

  const normalizedProgress = Math.max(0, progressSeconds);
  const progressRatio = normalizedProgress / durationSeconds;
  return (
    progressRatio >= HISTORY_COMPLETION_RATIO ||
    (progressRatio >= 0.85 &&
      durationSeconds - normalizedProgress <=
        HISTORY_COMPLETION_REMAINING_SECONDS)
  );
}

export function resolveHistoryDurationSeconds(entry: HistoryProgressLike) {
  const recordedDuration =
    Number.isFinite(entry.durationSeconds) && entry.durationSeconds > 0
      ? entry.durationSeconds
      : 0;
  if (recordedDuration > 0) return recordedDuration;

  const cardDuration =
    Number.isFinite(entry.card.duration) && (entry.card.duration ?? 0) > 0
      ? (entry.card.duration ?? 0)
      : 0;
  return cardDuration;
}

export function isHistoryEntryComplete(entry: HistoryProgressLike) {
  return isHistoryProgressComplete(
    entry.progressSeconds,
    resolveHistoryDurationSeconds(entry)
  );
}

export function historyResumeSeconds(entry: HistoryProgressLike) {
  if (isHistoryEntryComplete(entry)) return 0;
  return Math.max(
    0,
    Number.isFinite(entry.progressSeconds)
      ? Math.floor(entry.progressSeconds)
      : 0
  );
}

export function historyDisplayProgressSeconds(entry: HistoryProgressLike) {
  const duration = resolveHistoryDurationSeconds(entry);
  if (isHistoryEntryComplete(entry)) return duration;
  return Math.min(
    duration,
    Math.max(
      0,
      Number.isFinite(entry.progressSeconds) ? entry.progressSeconds : 0
    )
  );
}
