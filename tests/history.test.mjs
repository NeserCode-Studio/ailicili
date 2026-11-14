import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORY_COMPLETION_RATIO,
  historyDisplayProgressSeconds,
  historyResumeSeconds,
  isHistoryProgressComplete,
  resolveHistoryDurationSeconds,
} from "../src/lib/history.ts";

function historyEntry(progressSeconds, durationSeconds, cardDuration) {
  return {
    progressSeconds,
    durationSeconds,
    card: { duration: cardDuration },
  };
}

test("treats records near the end as completed", () => {
  assert.equal(HISTORY_COMPLETION_RATIO, 0.95);
  assert.equal(isHistoryProgressComplete(110, 114), true);
  assert.equal(isHistoryProgressComplete(30, 32), true);
  assert.equal(isHistoryProgressComplete(95, 100), true);
  assert.equal(isHistoryProgressComplete(94, 100), false);
});

test("keeps deliberately abandoned progress resumable", () => {
  assert.equal(isHistoryProgressComplete(90, 100), false);
  assert.equal(isHistoryProgressComplete(60, 60 * 60), false);
});

test("rejects incomplete duration contracts", () => {
  assert.equal(isHistoryProgressComplete(0, 3), false);
  assert.equal(isHistoryProgressComplete(1, 2), false);
  assert.equal(isHistoryProgressComplete(10, 0), false);
  assert.equal(isHistoryProgressComplete(Number.NaN, 100), false);
  assert.equal(isHistoryProgressComplete(10, Number.POSITIVE_INFINITY), false);
});

test("restarts completed history and keeps partial history resumable", () => {
  const completed = historyEntry(110, 114);
  const partial = historyEntry(42, 100);

  assert.equal(historyResumeSeconds(completed), 0);
  assert.equal(historyDisplayProgressSeconds(completed), 114);
  assert.equal(historyResumeSeconds(partial), 42);
  assert.equal(historyDisplayProgressSeconds(partial), 42);
});

test("prefers recorded duration and keeps the card fallback", () => {
  assert.equal(resolveHistoryDurationSeconds(historyEntry(30, 32, 40)), 32);
  assert.equal(resolveHistoryDurationSeconds(historyEntry(30, 32, 0)), 32);
  assert.equal(resolveHistoryDurationSeconds(historyEntry(30, 0, 32)), 32);
});
