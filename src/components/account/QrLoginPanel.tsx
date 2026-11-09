import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import {
  asCommandError,
  cancelBilibiliQrLogin,
  pollBilibiliQrLogin,
  startBilibiliQrLogin,
  type BilibiliAccount,
  type CommandError,
  type QrLoginStart,
  type QrLoginStatus,
} from "@/api/account";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import { commandErrorMessage } from "@/lib/command-error";
import { createLogger } from "@/lib/logger";

const log = createLogger("Account/QR");
const POLL_INTERVAL_MS = 1500;

export default function QrLoginPanel({
  onSuccess,
}: {
  onSuccess: (account: BilibiliAccount) => void;
}) {
  const { t } = useI18n();
  const [start, setStart] = useState<QrLoginStart | null>(null);
  const [status, setStatus] = useState<QrLoginStatus>("pending");
  const [error, setError] = useState<CommandError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const timerRef = useRef<number | null>(null);
  const loginIdRef = useRef<string | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const poll = async (loginId: string) => {
      try {
        const result = await pollBilibiliQrLogin(loginId);
        if (cancelled) return;
        setStatus(result.status);
        log.debug("qr poll state", { status: result.status });
        if (
          result.status === "pending" ||
          result.status === "scanned" ||
          result.status === "expired" ||
          result.status === "failed"
        ) {
          if (result.status === "pending" || result.status === "scanned") {
            timerRef.current = window.setTimeout(
              () => void poll(loginId),
              POLL_INTERVAL_MS
            );
          }
          return;
        }
        if (result.status === "succeeded" && result.account) {
          loginIdRef.current = undefined;
          log.info("qr login succeeded");
          onSuccess(result.account);
        }
      } catch (reason) {
        if (cancelled) return;
        const normalized = asCommandError(reason);
        setStatus("failed");
        setError(normalized);
        log.error("qr poll failed", { code: normalized.code });
      }
    };

    const begin = async () => {
      clearTimer();
      loginIdRef.current = undefined;
      setStart(null);
      setStatus("pending");
      setError(null);
      try {
        const next = await startBilibiliQrLogin();
        if (cancelled) {
          void cancelBilibiliQrLogin(next.loginId).catch(() => undefined);
          return;
        }
        loginIdRef.current = next.loginId;
        setStart(next);
        log.info("qr login ready", {
          expiresInSeconds: next.expiresInSeconds,
        });
        timerRef.current = window.setTimeout(
          () => void poll(next.loginId),
          POLL_INTERVAL_MS
        );
      } catch (reason) {
        if (cancelled) return;
        const normalized = asCommandError(reason);
        setStatus("failed");
        setError(normalized);
        log.error("qr login start failed", { code: normalized.code });
      }
    };

    void begin();
    return () => {
      cancelled = true;
      clearTimer();
      if (loginIdRef.current) {
        void cancelBilibiliQrLogin(loginIdRef.current).catch(() => undefined);
        loginIdRef.current = undefined;
      }
    };
  }, [clearTimer, onSuccess, reloadKey]);

  const statusText = error
    ? commandErrorMessage(error, t)
    : t(`Account.qr.status.${status}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-muted/30 flex min-h-60 items-center justify-center rounded-lg border p-4">
        {start ? (
          <img
            src={start.imageDataUrl}
            alt={t("Account.qr.imageAlt")}
            className="size-52 rounded-md bg-white p-2"
          />
        ) : (
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        )}
      </div>
      <p className="text-muted-foreground text-center text-sm" role="status">
        {statusText}
      </p>
      {status === "expired" || status === "failed" ? (
        <Button
          type="button"
          variant="outline"
          className="self-center"
          onClick={() => setReloadKey((value) => value + 1)}
        >
          <RefreshCw />
          {t("Account.qr.refresh")}
        </Button>
      ) : null}
    </div>
  );
}
