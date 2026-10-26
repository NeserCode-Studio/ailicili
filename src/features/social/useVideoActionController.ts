import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/composables";
import {
  biliKeys,
  coinVideo,
  fetchAuthStatus,
  fetchFavoriteFolders,
  fetchVideoActions,
  followUser,
  likeVideo,
  setVideoFavorite,
  tripleVideo,
} from "@/lib/bili";
import type {
  FavoriteFolder,
  VideoActionState,
  VideoDetail,
} from "@/shared/bili.types";

interface ActionSnapshot {
  previous: VideoActionState | undefined;
}

interface FavoriteMutationInput {
  addMediaIds: string[];
  removeMediaIds: string[];
  favorited: boolean;
}

interface VideoActionControllerOptions {
  onAuthenticationRequired?: () => void;
}

export interface VideoActionController {
  actions: VideoActionState | undefined;
  actionsPending: boolean;
  authenticated: boolean;
  coinPending: boolean;
  favoriteFolders: FavoriteFolder[];
  favoriteFoldersPending: boolean;
  favoritePending: boolean;
  pending: boolean;
  triplePending: boolean;
  addCoin: (multiply: number, withLike: boolean) => Promise<boolean>;
  requestFavoriteFolders: () => void;
  requireAuthentication: () => boolean;
  saveFavorite: (folderIds: string[]) => Promise<boolean>;
  setFollowed: (follow: boolean) => Promise<boolean>;
  setLiked: (liked: boolean) => Promise<boolean>;
  toggleFavoriteToDefaultFolder: () => Promise<boolean>;
  triple: () => Promise<boolean>;
}

export function useVideoActionController(
  detail: VideoDetail,
  options: VideoActionControllerOptions = {}
): VideoActionController {
  const { bvid, aid, author } = detail.video;
  const { onAuthenticationRequired } = options;
  const queryClient = useQueryClient();
  const { error: toastError, success } = useToast();
  const [favoriteFoldersRequested, setFavoriteFoldersRequested] =
    useState(false);

  const authQuery = useQuery({
    queryKey: biliKeys.auth(),
    queryFn: fetchAuthStatus,
    staleTime: 30_000,
  });
  const actionsQuery = useQuery({
    queryKey: biliKeys.actions(bvid),
    queryFn: () => fetchVideoActions(bvid, author.mid),
    staleTime: 30_000,
  });
  const favoriteFoldersQuery = useQuery({
    queryKey: biliKeys.favoriteFolders(),
    queryFn: fetchFavoriteFolders,
    enabled: favoriteFoldersRequested && Boolean(authQuery.data?.authenticated),
    staleTime: 30_000,
  });

  const requireAuthentication = useCallback(() => {
    if (authQuery.data?.authenticated) return true;
    onAuthenticationRequired?.();
    return false;
  }, [authQuery.data?.authenticated, onAuthenticationRequired]);

  const updateActions = useCallback(
    (update: (current: VideoActionState) => VideoActionState) => {
      queryClient.setQueryData<VideoActionState>(
        biliKeys.actions(bvid),
        (current) =>
          current
            ? update(current)
            : {
                liked: false,
                coined: 0,
                favorited: false,
                followed: false,
              }
      );
    },
    [bvid, queryClient]
  );

  const snapshotActions = useCallback(
    (): ActionSnapshot => ({
      previous: queryClient.getQueryData<VideoActionState>(
        biliKeys.actions(bvid)
      ),
    }),
    [bvid, queryClient]
  );

  const rollbackActions = useCallback(
    (snapshot: ActionSnapshot | undefined) => {
      if (snapshot?.previous) {
        queryClient.setQueryData(biliKeys.actions(bvid), snapshot.previous);
      } else {
        queryClient.removeQueries({
          queryKey: biliKeys.actions(bvid),
          exact: true,
        });
      }
    },
    [bvid, queryClient]
  );

  const invalidateActions = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: biliKeys.actions(bvid),
    });
  }, [bvid, queryClient]);

  const likeMutation = useMutation({
    mutationFn: (liked: boolean) => likeVideo(bvid, liked),
    onMutate: (liked) => {
      const snapshot = snapshotActions();
      updateActions((current) => ({ ...current, liked }));
      return snapshot;
    },
    onSuccess: invalidateActions,
    onError: (_error, _liked, snapshot) => {
      rollbackActions(snapshot);
      toastError("Actions.error");
    },
  });

  const followMutation = useMutation({
    mutationFn: (follow: boolean) => followUser(author.mid, follow),
    onMutate: (follow) => {
      const snapshot = snapshotActions();
      updateActions((current) => ({ ...current, followed: follow }));
      return snapshot;
    },
    onSuccess: invalidateActions,
    onError: (_error, _follow, snapshot) => {
      rollbackActions(snapshot);
      toastError("Actions.error");
    },
  });

  const coinMutation = useMutation({
    mutationFn: ({
      multiply,
      withLike,
    }: {
      multiply: number;
      withLike: boolean;
    }) => coinVideo(bvid, multiply, withLike),
    onMutate: ({ multiply, withLike }) => {
      const snapshot = snapshotActions();
      updateActions((current) => ({
        ...current,
        coined: Math.min(2, current.coined + multiply),
        liked: current.liked || withLike,
      }));
      return snapshot;
    },
    onSuccess: () => {
      success("Actions.coinSuccess");
      invalidateActions();
    },
    onError: (_error, _variables, snapshot) => {
      rollbackActions(snapshot);
      toastError("Actions.error");
    },
  });

  const tripleMutation = useMutation({
    mutationFn: () => tripleVideo(bvid),
    onMutate: () => {
      const snapshot = snapshotActions();
      updateActions((current) => ({
        ...current,
        liked: true,
        coined: Math.max(current.coined, 1),
        favorited: true,
      }));
      return snapshot;
    },
    onSuccess: (result) => {
      updateActions((current) => ({
        ...current,
        liked: current.liked || result.liked,
        coined: result.coined ? Math.max(1, current.coined) : current.coined,
        favorited: current.favorited || result.favorited,
      }));
      success("Actions.tripleSuccess");
      invalidateActions();
    },
    onError: (_error, _variables, snapshot) => {
      rollbackActions(snapshot);
      toastError("Actions.error");
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: (input: FavoriteMutationInput) =>
      setVideoFavorite({
        aid,
        addMediaIds: input.addMediaIds,
        removeMediaIds: input.removeMediaIds,
      }),
    onMutate: (input) => {
      const snapshot = snapshotActions();
      updateActions((current) => ({
        ...current,
        favorited: input.favorited,
      }));
      return snapshot;
    },
    onSuccess: () => {
      success("Actions.favoriteSuccess");
      invalidateActions();
    },
    onError: (_error, _input, snapshot) => {
      rollbackActions(snapshot);
      toastError("Actions.error");
    },
  });

  const loadFavoriteFolders = useCallback(async () => {
    setFavoriteFoldersRequested(true);
    try {
      return await queryClient.fetchQuery({
        queryKey: biliKeys.favoriteFolders(),
        queryFn: fetchFavoriteFolders,
        staleTime: 30_000,
      });
    } catch {
      toastError("Actions.error");
      return [];
    }
  }, [queryClient, toastError]);

  const setLiked = useCallback(
    async (liked: boolean) => {
      if (!requireAuthentication()) return false;
      try {
        await likeMutation.mutateAsync(liked);
        return true;
      } catch {
        return false;
      }
    },
    [likeMutation, requireAuthentication]
  );

  const addCoin = useCallback(
    async (multiply: number, withLike: boolean) => {
      if (!requireAuthentication()) return false;
      try {
        await coinMutation.mutateAsync({ multiply, withLike });
        return true;
      } catch {
        return false;
      }
    },
    [coinMutation, requireAuthentication]
  );

  const setFollowed = useCallback(
    async (follow: boolean) => {
      if (author.mid === 0 || !requireAuthentication()) return false;
      try {
        await followMutation.mutateAsync(follow);
        return true;
      } catch {
        return false;
      }
    },
    [author.mid, followMutation, requireAuthentication]
  );

  const triple = useCallback(async () => {
    if (!requireAuthentication()) return false;
    try {
      await tripleMutation.mutateAsync();
      return true;
    } catch {
      return false;
    }
  }, [requireAuthentication, tripleMutation]);

  const saveFavorite = useCallback(
    async (folderIds: string[]) => {
      if (!requireAuthentication()) return false;
      const current = queryClient.getQueryData<VideoActionState>(
        biliKeys.actions(bvid)
      );
      let removeMediaIds: string[] = [];
      if (current?.favorited && folderIds.length === 0) {
        const folders =
          favoriteFoldersQuery.data ?? (await loadFavoriteFolders());
        removeMediaIds = folders.map((folder) => folder.id);
        if (removeMediaIds.length === 0) {
          toastError("Actions.noFolders");
          return false;
        }
      }
      try {
        await favoriteMutation.mutateAsync({
          addMediaIds: folderIds,
          removeMediaIds,
          favorited: folderIds.length > 0,
        });
        return true;
      } catch {
        return false;
      }
    },
    [
      bvid,
      favoriteFoldersQuery.data,
      favoriteMutation,
      loadFavoriteFolders,
      queryClient,
      requireAuthentication,
      toastError,
    ]
  );

  const toggleFavoriteToDefaultFolder = useCallback(async () => {
    if (!requireAuthentication()) return false;
    const folders = favoriteFoldersQuery.data ?? (await loadFavoriteFolders());
    const current = queryClient.getQueryData<VideoActionState>(
      biliKeys.actions(bvid)
    );
    try {
      if (current?.favorited) {
        if (folders.length === 0) {
          toastError("Actions.noFolders");
          return false;
        }
        await favoriteMutation.mutateAsync({
          addMediaIds: [],
          removeMediaIds: folders.map((folder) => folder.id),
          favorited: false,
        });
        return true;
      }
      const defaultFolder = folders[0];
      if (!defaultFolder) {
        toastError("Actions.noFolders");
        return false;
      }
      await favoriteMutation.mutateAsync({
        addMediaIds: [defaultFolder.id],
        removeMediaIds: [],
        favorited: true,
      });
      return true;
    } catch {
      return false;
    }
  }, [
    bvid,
    favoriteFoldersQuery.data,
    favoriteMutation,
    loadFavoriteFolders,
    queryClient,
    requireAuthentication,
    toastError,
  ]);

  const pending =
    likeMutation.isPending ||
    followMutation.isPending ||
    coinMutation.isPending ||
    tripleMutation.isPending ||
    favoriteMutation.isPending;
  const requestFavoriteFolders = useCallback(
    () => setFavoriteFoldersRequested(true),
    []
  );

  return {
    actions: actionsQuery.data,
    actionsPending: actionsQuery.isPending,
    authenticated: Boolean(authQuery.data?.authenticated),
    coinPending: coinMutation.isPending,
    favoriteFolders: favoriteFoldersQuery.data ?? [],
    favoriteFoldersPending:
      favoriteFoldersRequested && favoriteFoldersQuery.isPending,
    favoritePending: favoriteMutation.isPending,
    pending,
    triplePending: tripleMutation.isPending,
    addCoin,
    requestFavoriteFolders,
    requireAuthentication,
    saveFavorite,
    setFollowed,
    setLiked,
    toggleFavoriteToDefaultFolder,
    triple,
  };
}
