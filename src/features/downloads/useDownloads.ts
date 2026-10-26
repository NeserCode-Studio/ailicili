import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";

import { biliKeys, fetchDownloadSnapshot } from "@/lib/bili";
import type {
  DownloadSnapshot,
  DownloadTask,
} from "@/shared/bili.types";

export const DOWNLOAD_PROGRESS_EVENT = "download-progress";

function snapshotFromTasks(
  snapshot: DownloadSnapshot,
  task: DownloadTask
): DownloadSnapshot {
  const tasks = [
    task,
    ...snapshot.tasks.filter((candidate) => candidate.id !== task.id),
  ];
  return {
    tasks,
    activeCount: tasks.filter(
      (candidate) =>
        candidate.status === "downloading" || candidate.status === "muxing"
    ).length,
    queuedCount: tasks.filter((candidate) => candidate.status === "queued")
      .length,
    completedCount: tasks.filter(
      (candidate) => candidate.status === "completed"
    ).length,
  };
}

export function mergeDownloadProgress(
  snapshot: DownloadSnapshot,
  task: DownloadTask
): DownloadSnapshot {
  return snapshotFromTasks(snapshot, task);
}

export function useDownloadSnapshot() {
  return useQuery({
    queryKey: biliKeys.downloads(),
    queryFn: fetchDownloadSnapshot,
    enabled: "__TAURI_INTERNALS__" in window,
    staleTime: 15_000,
  });
}

export function useDownloadProgressEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    const unlisten = listen<{ task: DownloadTask }>(
      DOWNLOAD_PROGRESS_EVENT,
      (event) => {
        const task = event.payload.task;
        const snapshot = queryClient.getQueryData<DownloadSnapshot>(
          biliKeys.downloads()
        );
        if (snapshot) {
          queryClient.setQueryData(
            biliKeys.downloads(),
            mergeDownloadProgress(snapshot, task)
          );
        } else {
          void queryClient.invalidateQueries({
            queryKey: biliKeys.downloads(),
          });
        }
        if (task.status === "completed") {
          void queryClient.invalidateQueries({
            queryKey: biliKeys.offlineLibrary(),
          });
        }
      }
    );

    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [queryClient]);
}

export function downloadDisplayName(task: DownloadTask): string {
  if (!task.partTitle.trim() || task.partTitle.trim() === task.title.trim()) {
    return task.title;
  }
  return `${task.title} · ${task.partTitle}`;
}
