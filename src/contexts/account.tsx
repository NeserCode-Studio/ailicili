import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  asCommandError,
  getBilibiliAccount,
  getBilibiliLoginCapabilities,
  logoutBilibili,
  refreshBilibiliAccount,
  resetBilibiliDeviceIdentity,
  type BilibiliAccount,
  type CommandError,
  type LoginCapabilities,
} from "@/api/account";
import { AccountContext, type LoginMethod } from "@/contexts/account-context";
import { createLogger } from "@/lib/logger";

const log = createLogger("Account");

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<BilibiliAccount | null>(null);
  const [capabilities, setCapabilities] = useState<LoginCapabilities | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CommandError | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("qr");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [capabilityResult, accountResult] = await Promise.allSettled([
        getBilibiliLoginCapabilities(),
        getBilibiliAccount(),
      ]);
      if (cancelled) return;

      if (capabilityResult.status === "fulfilled") {
        setCapabilities(capabilityResult.value);
        if (!capabilityResult.value.qrAvailable) setLoginMethod("sms");
      } else {
        const normalized = asCommandError(capabilityResult.reason);
        log.error("login capabilities failed", { code: normalized.code });
        setError(normalized);
      }

      if (accountResult.status === "fulfilled") {
        setAccount(accountResult.value);
        log.info("account loaded", {
          status: accountResult.value.status,
          hasProfile: Boolean(accountResult.value.profile),
          hasAvatar: Boolean(accountResult.value.profile?.avatarUrl),
        });
      } else {
        const normalized = asCommandError(accountResult.reason);
        log.error("account summary failed", { code: normalized.code });
        setError(normalized);
      }
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const openLogin = useCallback(
    (method?: LoginMethod) => {
      const preferred =
        method ?? (capabilities?.qrAvailable === false ? "sms" : loginMethod);
      setLoginMethod(preferred);
      setLoginOpen(true);
      log.info("login dialog opened", { method: preferred });
    },
    [capabilities, loginMethod]
  );

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    log.debug("login dialog closed");
  }, []);

  const acceptAccount = useCallback((next: BilibiliAccount) => {
    setAccount(next);
    setError(null);
    setLoginOpen(false);
    log.info("account state accepted", {
      status: next.status,
      hasProfile: Boolean(next.profile),
      hasAvatar: Boolean(next.profile?.avatarUrl),
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await refreshBilibiliAccount();
      setAccount(next);
      setError(null);
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
  }, []);

  const logout = useCallback(async () => {
    try {
      const next = await logoutBilibili();
      setAccount(next);
      setError(null);
      log.info("logout completed");
      return next;
    } catch (reason) {
      const normalized = asCommandError(reason);
      setError(normalized);
      log.error("logout failed", { code: normalized.code });
      throw normalized;
    }
  }, []);

  const resetDeviceIdentity = useCallback(async () => {
    try {
      await resetBilibiliDeviceIdentity();
      setError(null);
      log.info("device identity reset completed");
    } catch (reason) {
      const normalized = asCommandError(reason);
      setError(normalized);
      log.error("device identity reset failed", { code: normalized.code });
      throw normalized;
    }
  }, []);

  const value = useMemo(
    () => ({
      account,
      capabilities,
      loading,
      error,
      loginOpen,
      loginMethod,
      openLogin,
      closeLogin,
      setLoginMethod,
      acceptAccount,
      refresh,
      logout,
      resetDeviceIdentity,
    }),
    [
      account,
      capabilities,
      loading,
      error,
      loginOpen,
      loginMethod,
      openLogin,
      closeLogin,
      acceptAccount,
      refresh,
      logout,
      resetDeviceIdentity,
    ]
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}
