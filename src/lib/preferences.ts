import { useSyncExternalStore } from "react";

export type RecommendationPriority = "anonymous" | "personalized";

export const RECOMMENDATION_PRIORITY_KEY = "recommendation-priority";
export const DEFAULT_RECOMMENDATION_PRIORITY: RecommendationPriority =
  "anonymous";

const listeners = new Set<() => void>();

function readStoredPriority(): RecommendationPriority {
  if (typeof window === "undefined") return DEFAULT_RECOMMENDATION_PRIORITY;
  return localStorage.getItem(RECOMMENDATION_PRIORITY_KEY) === "personalized"
    ? "personalized"
    : DEFAULT_RECOMMENDATION_PRIORITY;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === RECOMMENDATION_PRIORITY_KEY) listener();
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function getRecommendationPriority(): RecommendationPriority {
  return readStoredPriority();
}

export function setRecommendationPriority(priority: RecommendationPriority) {
  if (readStoredPriority() === priority) return;
  localStorage.setItem(RECOMMENDATION_PRIORITY_KEY, priority);
  notify();
}

export function useRecommendationPriority(): RecommendationPriority {
  return useSyncExternalStore(
    subscribe,
    getRecommendationPriority,
    () => DEFAULT_RECOMMENDATION_PRIORITY
  );
}
