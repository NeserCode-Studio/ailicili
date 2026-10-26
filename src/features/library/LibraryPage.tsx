import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Bookmark,
  Clock3,
  FolderHeart,
  History,
  Inbox,
  LoaderCircle,
  LogIn,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Link } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n, useToast } from "@/composables";
import { useAuthStatus } from "@/features/auth/useAuthStatus";
import LibraryVideoCard from "@/features/library/LibraryVideoCard";
import {
  biliKeys,
  clearHistory,
  deleteHistory,
  fetchFavoriteFolders,
  fetchFavoriteResources,
  fetchHistory,
  fetchWatchLater,
  normalizeBiliError,
  removeWatchLater,
} from "@/lib/bili";
import type {
  FavoriteFolder,
  HistoryPage,
  LibraryVideo,
} from "@/shared/bili.types";
import { cn } from "@/lib/utils";

type LibraryTab = "history" | "watch-later" | "favorites";

interface HistoryCursor {
  max: number;
  viewAt: number;
}

function uniqueVideos(pages: Array<{ videos: LibraryVideo[] }>) {
  const seen = new Set<string>();
  return pages
    .flatMap((page) => page.videos)
    .filter((video) => {
      const key = `${video.bvid}:${video.cid}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function LibrarySkeleton() {
  return (
    <div className="divide-border/70 divide-y" data-testid="library-loading">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex gap-3 py-4">
          <Skeleton className="aspect-video w-36 shrink-0 sm:w-48" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Inbox;
  title: string;
  description: string;
}) {
  return (
    <div className="border-border flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center">
      <Icon className="text-muted-foreground size-6" />
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
    </div>
  );
}

function QueryFailure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const normalized = normalizeBiliError(error);
  return (
    <AsyncErrorState
      title={t("Library.error.title")}
      description={t("Library.error.description")}
      code={normalized.code}
      retryLabel={t("Library.retry")}
      onRetry={onRetry}
    />
  );
}

function LoadMore({
  hasMore,
  fetching,
  onClick,
}: {
  hasMore: boolean;
  fetching: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  if (!hasMore) return null;
  return (
    <div className="mt-5 flex justify-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fetching}
        onClick={onClick}
      >
        {fetching ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        {t("Common.loadMore")}
      </Button>
    </div>
  );
}

function HistoryTab() {
  const { t } = useI18n();
  const { error: toastError, success } = useToast();
  const queryClient = useQueryClient();
  const historyQuery = useInfiniteQuery({
    queryKey: [...biliKeys.history(), "feed"],
    queryFn: ({ pageParam }) => fetchHistory(pageParam.max, pageParam.viewAt),
    initialPageParam: { max: 0, viewAt: 0 } satisfies HistoryCursor,
    getNextPageParam: (last: HistoryPage) =>
      last.hasMore && (last.cursorMax !== 0 || last.cursorViewAt !== 0)
        ? { max: last.cursorMax, viewAt: last.cursorViewAt }
        : undefined,
  });

  const removeMutation = useMutation({
    mutationFn: deleteHistory,
    onSuccess: () => {
      success("Library.history.removed");
      void queryClient.invalidateQueries({ queryKey: biliKeys.history() });
    },
    onError: () => toastError("Library.actionError"),
  });
  const clearMutation = useMutation({
    mutationFn: clearHistory,
    onSuccess: () => {
      success("Library.history.cleared");
      void queryClient.invalidateQueries({ queryKey: biliKeys.history() });
    },
    onError: () => toastError("Library.actionError"),
  });

  const videos = uniqueVideos(historyQuery.data?.pages ?? []);

  if (historyQuery.isPending) return <LibrarySkeleton />;
  if (historyQuery.error) {
    return (
      <QueryFailure
        error={historyQuery.error}
        onRetry={() => void historyQuery.refetch()}
      />
    );
  }
  if (videos.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={t("Library.history.emptyTitle")}
        description={t("Library.history.emptyDescription")}
      />
    );
  }

  return (
    <>
      <div className="mb-2 flex justify-end">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={clearMutation.isPending}
            >
              <Trash2 />
              {t("Library.history.clear")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("Library.history.clearConfirm.title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("Library.history.clearConfirm.description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90 text-white"
                onClick={() => clearMutation.mutate()}
              >
                {t("Library.history.clear")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="divide-border/70 divide-y">
        {videos.map((video) => (
          <LibraryVideoCard
            key={`${video.bvid}:${video.cid}`}
            video={video}
            removing={
              removeMutation.isPending && removeMutation.variables === video.aid
            }
            onRemove={() => removeMutation.mutate(video.aid)}
          />
        ))}
      </div>
      <LoadMore
        hasMore={historyQuery.hasNextPage}
        fetching={historyQuery.isFetchingNextPage}
        onClick={() => void historyQuery.fetchNextPage()}
      />
    </>
  );
}

function WatchLaterTab() {
  const { t } = useI18n();
  const { error: toastError, success } = useToast();
  const queryClient = useQueryClient();
  const watchLaterQuery = useQuery({
    queryKey: biliKeys.watchLater(),
    queryFn: fetchWatchLater,
  });
  const removeMutation = useMutation({
    mutationFn: removeWatchLater,
    onSuccess: () => {
      success("Library.watchLater.removed");
      void queryClient.invalidateQueries({ queryKey: biliKeys.watchLater() });
    },
    onError: () => toastError("Library.actionError"),
  });

  if (watchLaterQuery.isPending) return <LibrarySkeleton />;
  if (watchLaterQuery.error) {
    return (
      <QueryFailure
        error={watchLaterQuery.error}
        onRetry={() => void watchLaterQuery.refetch()}
      />
    );
  }
  if (!watchLaterQuery.data?.videos.length) {
    return (
      <EmptyState
        icon={Clock3}
        title={t("Library.watchLater.emptyTitle")}
        description={t("Library.watchLater.emptyDescription")}
      />
    );
  }

  return (
    <div className="divide-border/70 divide-y">
      {watchLaterQuery.data.videos.map((video) => (
        <LibraryVideoCard
          key={`${video.bvid}:${video.cid}`}
          video={video}
          removing={
            removeMutation.isPending && removeMutation.variables === video.aid
          }
          onRemove={() => removeMutation.mutate(video.aid)}
        />
      ))}
    </div>
  );
}

function FavoritesTab() {
  const { t } = useI18n();
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const foldersQuery = useQuery({
    queryKey: biliKeys.favoriteFolders(),
    queryFn: fetchFavoriteFolders,
  });
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);

  useEffect(() => {
    if (
      folders.length > 0 &&
      !folders.some((folder) => folder.id === selectedFolderId)
    ) {
      setSelectedFolderId(folders[0].id);
    }
  }, [folders, selectedFolderId]);

  const resourcesQuery = useInfiniteQuery({
    queryKey: [...biliKeys.favoriteResources(selectedFolderId, 0), "feed"],
    queryFn: ({ pageParam }) =>
      fetchFavoriteResources(selectedFolderId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: selectedFolderId.length > 0,
  });

  if (foldersQuery.isPending) return <LibrarySkeleton />;
  if (foldersQuery.error) {
    return (
      <QueryFailure
        error={foldersQuery.error}
        onRetry={() => void foldersQuery.refetch()}
      />
    );
  }
  if (folders.length === 0) {
    return (
      <EmptyState
        icon={FolderHeart}
        title={t("Library.favorites.emptyTitle")}
        description={t("Library.favorites.emptyDescription")}
      />
    );
  }

  const videos = uniqueVideos(resourcesQuery.data?.pages ?? []);
  const activeFolder = folders.find((folder) => folder.id === selectedFolderId);

  return (
    <>
      <div
        className="mb-3 flex min-w-0 gap-2 overflow-x-auto pb-1"
        aria-label={t("Library.favorites.folders")}
      >
        {folders.map((folder: FavoriteFolder) => (
          <button
            key={folder.id}
            type="button"
            aria-pressed={folder.id === selectedFolderId}
            onClick={() => setSelectedFolderId(folder.id)}
            className={cn(
              "border-border text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors",
              folder.id === selectedFolderId &&
                "bg-muted text-foreground border-transparent"
            )}
          >
            <Bookmark className="size-3.5" />
            <span className="max-w-48 truncate">{folder.title}</span>
            <span className="tabular-nums opacity-60">{folder.mediaCount}</span>
          </button>
        ))}
      </div>

      {resourcesQuery.isPending ? (
        <LibrarySkeleton />
      ) : resourcesQuery.error ? (
        <QueryFailure
          error={resourcesQuery.error}
          onRetry={() => void resourcesQuery.refetch()}
        />
      ) : videos.length === 0 ? (
        <EmptyState
          icon={FolderHeart}
          title={t("Library.favorites.folderEmptyTitle", {
            title: activeFolder?.title ?? "",
          })}
          description={t("Library.favorites.folderEmptyDescription")}
        />
      ) : (
        <>
          <div className="divide-border/70 divide-y">
            {videos.map((video) => (
              <LibraryVideoCard
                key={`${video.bvid}:${video.cid}`}
                video={video}
              />
            ))}
          </div>
          <LoadMore
            hasMore={resourcesQuery.hasNextPage}
            fetching={resourcesQuery.isFetchingNextPage}
            onClick={() => void resourcesQuery.fetchNextPage()}
          />
        </>
      )}
    </>
  );
}

function LoginRequired() {
  const { t } = useI18n();
  return (
    <div className="border-border flex min-h-80 flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 text-center">
      <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full">
        <LogIn className="size-5" />
      </span>
      <div>
        <h2 className="text-base font-semibold">{t("Library.login.title")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("Library.login.description")}
        </p>
      </div>
      <Button asChild>
        <Link to="/login">
          <LogIn />
          {t("Auth.signIn")}
        </Link>
      </Button>
    </div>
  );
}

export default function LibraryPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<LibraryTab>("history");
  const authQuery = useAuthStatus();
  const authenticated = Boolean(authQuery.data?.authenticated);
  const tabs = useMemo(
    () =>
      [
        ["history", History, "Library.history"],
        ["watch-later", Clock3, "Library.watchLater"],
        ["favorites", FolderHeart, "Library.favorites"],
      ] as const,
    []
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-7 lg:px-8">
      <header className="mb-6">
        <div className="text-primary mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] uppercase">
          <span className="bg-primary h-px w-5" />
          Bilibili
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Library.title")}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("Library.description")}
        </p>
      </header>

      {authQuery.isPending ? (
        <LibrarySkeleton />
      ) : !authenticated ? (
        <LoginRequired />
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as LibraryTab)}
        >
          <TabsList className="mb-4 grid h-auto w-full grid-cols-3 sm:w-fit">
            {tabs.map(([value, Icon, label]) => (
              <TabsTrigger key={value} value={value} className="gap-2 px-4">
                <Icon className="size-4" />
                {t(label)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="history">
            {tab === "history" && <HistoryTab />}
          </TabsContent>
          <TabsContent value="watch-later">
            {tab === "watch-later" && <WatchLaterTab />}
          </TabsContent>
          <TabsContent value="favorites">
            {tab === "favorites" && <FavoritesTab />}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
