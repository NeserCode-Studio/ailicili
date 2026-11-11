import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  asCommandError,
  getAccountCenterSnapshot,
  getBilibiliAccount,
  getBilibiliLoginCapabilities,
  logoutBilibili,
  logoutPlatformAccount,
  refreshBilibiliAccount,
  refreshPlatformAccount,
  type AccountCenterSnapshot,
  type BilibiliAccount,
  type CommandError,
  type LoginCapabilities,
  type PlatformAccountEntry,
} from "@/api/account";
import { getPlatformCatalog } from "@/api/platforms";
import { resolveDeviceIdentityReset } from "@/api/platform-account-actions";
import type {
  LoginMethod,
  PlatformDescriptor,
  PlatformId,
} from "@/api/platforms";
import { AccountContext } from "@/contexts/account-context";
import { useSettingsDialog } from "@/contexts/settings";
import { createLogger } from "@/lib/logger";

const log = createLogger("Account");

function toBilibiliAccount(
  entry: PlatformAccountEntry | undefined
): BilibiliAccount | null {
  if (!entry) return null;
  return {
    status: entry.status,
    profile: entry.profile,
    messageCode: entry.messageCode,
  };
}

function accountRecord(
  snapshot: AccountCenterSnapshot | null
): Record<PlatformId, PlatformAccountEntry> {
  return Object.fromEntries(
    snapshot?.platforms.map((entry) => [entry.platform.id, entry]) ?? []
  );
}

function methodForDescriptor(
  descriptor: PlatformDescriptor,
  requested?: LoginMethod
): LoginMethod | undefined {
  if (
    requested &&
    descriptor.accountCapability.loginMethods.includes(requested)
  ) {
    return requested;
  }
  return descriptor.accountCapability.loginMethods[0];
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { openSettings } = useSettingsDialog();
  const [snapshot, setSnapshot] = useState<AccountCenterSnapshot | null>(null);
  const [platformCatalog, setPlatformCatalog] = useState<PlatformDescriptor[]>(
    []
  );
  const [capabilities, setCapabilities] = useState<LoginCapabilities | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CommandError | null>(null);
  const [pendingPlatforms, setPendingPlatforms] = useState<Set<PlatformId>>(
    new Set()
  );
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginPlatformId, setLoginPlatformId] = useState<PlatformId | null>(
    null
  );
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("qr");

  const applySnapshot = useCallback((next: AccountCenterSnapshot) => {
    setSnapshot(next);
    setPlatformCatalog(next.platforms.map((entry) => entry.platform));
    setError(null);
  }, []);

  const loadSnapshot = useCallback(
    async (silent = false): Promise<AccountCenterSnapshot> => {
      if (!silent) setLoading(true);
      try {
        const next = await getAccountCenterSnapshot();
        applySnapshot(next);
        log.info("account center loaded", {
          platformCount: next.platforms.length,
          authenticatedCount: next.platforms.filter(
            (entry) => entry.status === "authenticated"
          ).length,
        });
        return next;
      } catch (reason) {
        const normalized = asCommandError(reason);
        setError(normalized);
        log.error("account center failed", { code: normalized.code });
        throw normalized;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [applySnapshot]
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [
        catalogResult,
        snapshotResult,
        capabilityResult,
        accountRefreshResult,
      ] = await Promise.allSettled([
        getPlatformCatalog(),
        getAccountCenterSnapshot(),
        getBilibiliLoginCapabilities(),
        getBilibiliAccount(),
      ]);
      if (cancelled) return;

      if (catalogResult.status === "fulfilled") {
        setPlatformCatalog(catalogResult.value);
      } else {
        const normalized = asCommandError(catalogResult.reason);
        setError(normalized);
        log.error("platform catalog failed", { code: normalized.code });
      }

      if (snapshotResult.status === "fulfilled") {
        let nextSnapshot = snapshotResult.value;
        if (accountRefreshResult.status === "fulfilled") {
          const videoAccount = nextSnapshot.platforms.find(
            (entry) =>
              entry.platform.contentKinds.includes("video") &&
              entry.platform.accountCapability.mode !== "none"
          );
          if (videoAccount) {
            const refreshed = accountRefreshResult.value;
            nextSnapshot = {
              ...nextSnapshot,
              platforms: nextSnapshot.platforms.map((entry) =>
                entry.platform.id === videoAccount.platform.id
                  ? {
                      ...entry,
                      status: refreshed.status,
                      profile: refreshed.profile,
                      messageCode: refreshed.messageCode,
                      revision:
                        entry.status !== refreshed.status
                          ? entry.revision + 1
                          : entry.revision,
                    }
                  : entry
              ),
            };
          }
        } else {
          const normalized = asCommandError(accountRefreshResult.reason);
          setError(normalized);
          log.error("video account refresh failed", {
            code: normalized.code,
          });
        }
        applySnapshot(nextSnapshot);
        log.info("account snapshot loaded", {
          platformCount: nextSnapshot.platforms.length,
          authenticatedCount: nextSnapshot.platforms.filter(
            (entry) => entry.status === "authenticated"
          ).length,
        });
      } else {
        const normalized = asCommandError(snapshotResult.reason);
        setError(normalized);
        log.error("account snapshot failed", { code: normalized.code });
      }

      if (capabilityResult.status === "fulfilled") {
        setCapabilities(capabilityResult.value);
        if (!capabilityResult.value.qrAvailable) setLoginMethod("sms");
      } else {
        const normalized = asCommandError(capabilityResult.reason);
        setError(normalized);
        log.error("login capabilities failed", { code: normalized.code });
      }
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot]);

  const accountsByPlatform = useMemo(() => accountRecord(snapshot), [snapshot]);
  const accountRevisions = useMemo(
    () =>
      Object.fromEntries(
        snapshot?.platforms.map((entry) => [
          entry.platform.id,
          entry.revision,
        ]) ?? []
      ),
    [snapshot]
  );
  const account = useMemo(() => {
    const videoAccount = snapshot?.platforms.find(
      (entry) =>
        entry.platform.contentKinds.includes("video") &&
        entry.platform.accountCapability.mode !== "none"
    );
    return toBilibiliAccount(videoAccount);
  }, [snapshot]);

  const openLogin = useCallback(
    (platformId?: PlatformId, requestedMethod?: LoginMethod) => {
      const descriptor = platformId
        ? platformCatalog.find((platform) => platform.id === platformId)
        : platformCatalog.find(
            (platform) =>
              platform.availability === "available" &&
              platform.accountCapability.mode !== "none" &&
              platform.accountCapability.loginMethods.length > 0
          );
      if (!descriptor) {
        log.warn("login requested without an account-capable platform");
        return;
      }
      const method = methodForDescriptor(descriptor, requestedMethod);
      if (!method) return;
      setLoginPlatformId(descriptor.id);
      setLoginMethod(method);
      setLoginOpen(true);
      log.info("login dialog opened", {
        platform: descriptor.id,
        method,
      });
    },
    [platformCatalog]
  );

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    setLoginPlatformId(null);
    log.debug("login dialog closed");
  }, []);

  const acceptAccount = useCallback(
    (next: BilibiliAccount, platformId?: PlatformId) => {
      const targetPlatformId =
        platformId ??
        loginPlatformId ??
        platformCatalog.find(
          (platform) =>
            platform.availability === "available" &&
            platform.accountCapability.mode !== "none"
        )?.id;
      if (!targetPlatformId) return;

      setSnapshot((current) => {
        if (!current) return current;
        let found = false;
        const platforms = current.platforms.map((entry) => {
          if (entry.platform.id !== targetPlatformId) return entry;
          found = true;
          return {
            ...entry,
            status: next.status,
            profile: next.profile,
            messageCode: next.messageCode,
            revision: entry.revision + 1,
          };
        });
        return found ? { ...current, platforms } : current;
      });
      setError(null);
      setLoginOpen(false);
      setLoginPlatformId(null);
      log.info("account state accepted", {
        platform: targetPlatformId,
        status: next.status,
        hasProfile: Boolean(next.profile),
      });
      void loadSnapshot(true).catch(() => undefined);
    },
    [loadSnapshot, loginPlatformId, platformCatalog]
  );

  const setPlatformPending = useCallback(
    (platformId: PlatformId, pending: boolean) => {
      setPendingPlatforms((current) => {
        const next = new Set(current);
        if (pending) next.add(platformId);
        else next.delete(platformId);
        return next;
      });
    },
    []
  );

  const refreshPlatform = useCallback(
    async (platformId: PlatformId) => {
      setPlatformPending(platformId, true);
      try {
        const next = await refreshPlatformAccount(platformId);
        applySnapshot(next);
        log.info("platform account refreshed", { platform: platformId });
        return next;
      } catch (reason) {
        const normalized = asCommandError(reason);
        setError(normalized);
        log.error("platform account refresh failed", {
          platform: platformId,
          code: normalized.code,
        });
        throw normalized;
      } finally {
        setPlatformPending(platformId, false);
      }
    },
    [applySnapshot, setPlatformPending]
  );

  const logoutPlatform = useCallback(
    async (platformId: PlatformId) => {
      setPlatformPending(platformId, true);
      try {
        const next = await logoutPlatformAccount(platformId);
        applySnapshot(next);
        log.info("platform logout completed", { platform: platformId });
        return next;
      } catch (reason) {
        const normalized = asCommandError(reason);
        setError(normalized);
        log.error("platform logout failed", {
          platform: platformId,
          code: normalized.code,
        });
        throw normalized;
      } finally {
        setPlatformPending(platformId, false);
      }
    },
    [applySnapshot, setPlatformPending]
  );

  const resetPlatformDeviceIdentity = useCallback(
    async (platformId: PlatformId) => {
      const reset = resolveDeviceIdentityReset(platformId);
      if (!reset) {
        throw {
          code: "accountUnavailable",
          message: "Device identity reset is unavailable for this platform.",
        } satisfies CommandError;
      }
      await reset();
      setError(null);
      log.info("platform device identity reset", { platform: platformId });
    },
    []
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await refreshBilibiliAccount();
      setError(null);
      void loadSnapshot(true).catch(() => undefined);
      log.info("account refreshed", {
        status: next.status,
        hasAvatar: Boolean(next.profile?.avatarUrl),
      });
      return next;
    } catch (reason) {
      const normalized = asCommandError(reason);
      setError(normalized);
      log.error("account refresh failed", { code: normalized.code });
      throw normalized;
    } finally {
      setLoading(false);
    }
  }, [loadSnapshot]);

  const logout = useCallback(async () => {
    try {
      const next = await logoutBilibili();
      setError(null);
      void loadSnapshot(true).catch(() => undefined);
      log.info("logout completed");
      return next;
    } catch (reason) {
      const normalized = asCommandError(reason);
      setError(normalized);
      log.error("logout failed", { code: normalized.code });
      throw normalized;
    }
  }, [loadSnapshot]);

  const resetDeviceIdentity = useCallback(async () => {
    const descriptor = platformCatalog.find(
      (platform) =>
        platform.accountCapability.supportsDeviceReset &&
        platform.availability === "available"
    );
    if (!descriptor) {
      throw {
        code: "accountUnavailable",
        message: "Device identity reset is unavailable.",
      } satisfies CommandError;
    }
    await resetPlatformDeviceIdentity(descriptor.id);
  }, [platformCatalog, resetPlatformDeviceIdentity]);

  const reload = useCallback(async () => {
    try {
      return await loadSnapshot(false);
    } catch {
      return null;
    }
  }, [loadSnapshot]);

  const openAccountCenter = useCallback(() => {
    openSettings("account");
  }, [openSettings]);

  const value = useMemo(
    () => ({
      account,
      capabilities,
      platformCatalog,
      snapshot,
      accountsByPlatform,
      accountRevisions,
      pendingPlatforms,
      loading,
      error,
      loginOpen,
      loginPlatformId,
      loginMethod,
      openLogin,
      closeLogin,
      setLoginMethod,
      acceptAccount,
      reload,
      refreshPlatform,
      logoutPlatform,
      resetPlatformDeviceIdentity,
      refresh,
      logout,
      resetDeviceIdentity,
      openAccountCenter,
    }),
    [
      account,
      capabilities,
      platformCatalog,
      snapshot,
      accountsByPlatform,
      accountRevisions,
      pendingPlatforms,
      loading,
      error,
      loginOpen,
      loginPlatformId,
      loginMethod,
      openLogin,
      closeLogin,
      acceptAccount,
      reload,
      refreshPlatform,
      logoutPlatform,
      resetPlatformDeviceIdentity,
      refresh,
      logout,
      resetDeviceIdentity,
      openAccountCenter,
    ]
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}
