import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Check, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

import type { SmsChallenge } from "@/api/account";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import {
  createGeetestChallenge,
  openGeetestChallenge,
  type CaptchaValidation,
  type GeetestEventDiagnostics,
  type GeetestInstance,
  type GeetestValidationDiagnostics,
} from "@/lib/bilibili-captcha";
import { createLogger } from "@/lib/logger";
import { cn } from "@/lib/utils";

const log = createLogger("Account/Captcha");

interface CaptchaChallengeProps {
  challenge: SmsChallenge;
  onValidation: (validation: CaptchaValidation | null) => void;
  onChallengeInvalid?: () => void;
}

export interface CaptchaChallengeHandle {
  requestValidation: () => Promise<boolean>;
}

interface CaptchaSession {
  challengeId: string;
  startedAt: number;
  instance: GeetestInstance | null;
  pending: Promise<GeetestInstance> | null;
  disposed: boolean;
  validationAccepted: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function geetestErrorType(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 80);
  if (typeof error === "object" && error !== null) {
    if ("error_code" in error) return String(error.error_code).slice(0, 80);
    if ("code" in error) return String(error.code).slice(0, 80);
  }
  return typeof error;
}

function destroyGeetestInstance(instance: GeetestInstance | null): void {
  try {
    instance?.destroy?.();
  } catch (error) {
    log.warn("captcha instance cleanup failed", {
      error: errorMessage(error),
    });
  }
}

const CaptchaChallenge = forwardRef<
  CaptchaChallengeHandle,
  CaptchaChallengeProps
>(function CaptchaChallenge(
  { challenge, onValidation, onChallengeInvalid },
  ref
) {
  const { t } = useI18n();
  const mountRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<CaptchaSession | null>(null);
  const openingRef = useRef<Promise<boolean> | null>(null);
  const disposalTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const onValidationRef = useRef(onValidation);
  const onChallengeInvalidRef = useRef(onChallengeInvalid);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [solved, setSolved] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    onValidationRef.current = onValidation;
  }, [onValidation]);

  useEffect(() => {
    onChallengeInvalidRef.current = onChallengeInvalid;
  }, [onChallengeInvalid]);

  const disposeSession = useCallback((reason: string) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;

    log.info("captcha session disposed", {
      reason,
      instanceReady: Boolean(session.instance),
      validationAccepted: session.validationAccepted,
      challengeAgeMs: Date.now() - session.startedAt,
    });
    session.disposed = true;
    destroyGeetestInstance(session.instance);
  }, []);

  const scheduleDisposal = useCallback(() => {
    if (disposalTimerRef.current !== null) {
      window.clearTimeout(disposalTimerRef.current);
    }
    disposalTimerRef.current = window.setTimeout(() => {
      disposalTimerRef.current = null;
      if (!mountedRef.current) {
        disposeSession("deferred-unmount");
      }
    }, 0);
  }, [disposeSession]);

  // StrictMode replays effects; defer cleanup so a simulated unmount cannot
  // dispose an SDK instance that is still initializing.
  useEffect(() => {
    mountedRef.current = true;
    if (disposalTimerRef.current !== null) {
      window.clearTimeout(disposalTimerRef.current);
      disposalTimerRef.current = null;
      log.debug("captcha deferred disposal cancelled after strict-mode replay");
    }
    return () => {
      mountedRef.current = false;
      scheduleDisposal();
    };
  }, [scheduleDisposal]);

  const ensureSession = useCallback(async (): Promise<GeetestInstance> => {
    const container = mountRef.current;
    if (!container) {
      throw new Error("captcha mount point unavailable");
    }

    let session = sessionRef.current;
    if (session?.challengeId !== challenge.challengeId) {
      disposeSession("challenge-changed");
      session = null;
    }
    if (!session) {
      session = {
        challengeId: challenge.challengeId,
        startedAt: Date.now(),
        instance: null,
        pending: null,
        disposed: false,
        validationAccepted: false,
      };
      sessionRef.current = session;
      log.debug("captcha session created", {
        provider: challenge.provider,
      });
    }
    if (session.instance) return session.instance;
    if (session.pending) return session.pending;

    const activeSession = session;
    const handleValidation = (
      nextSession: CaptchaSession,
      validation: CaptchaValidation | null,
      diagnostics: GeetestValidationDiagnostics,
      event: GeetestEventDiagnostics
    ) => {
      if (!mountedRef.current || nextSession.disposed) return;

      if (!validation) {
        setFailed(event.event === "success");
        setSolved(false);
        setActive(false);
        onValidationRef.current(null);
        log.warn("captcha validation unavailable", {
          provider: challenge.provider,
          source: event.event,
          resultType: diagnostics.resultType,
          resultKeys: diagnostics.keys,
          resultFields: diagnostics.fields,
          hasChallenge: diagnostics.hasChallenge,
          hasValidate: diagnostics.hasValidate,
          hasSeccode: diagnostics.hasSeccode,
          eventSequence: event.sequence,
          callbackKeys: event.callbackKeys,
          callbackShape: event.callbackShape,
          challengeAgeMs: Date.now() - nextSession.startedAt,
        });
        if (event.event === "success") {
          onChallengeInvalidRef.current?.();
        }
        return;
      }

      if (nextSession.validationAccepted) return;
      nextSession.validationAccepted = true;
      setFailed(false);
      setSolved(true);
      setActive(false);
      onValidationRef.current(validation);
      log.info("captcha solved", {
        provider: challenge.provider,
        source: event.event,
        resultType: diagnostics.resultType,
        resultKeys: diagnostics.keys,
        resultFields: diagnostics.fields,
        hasChallenge: diagnostics.hasChallenge,
        hasValidate: diagnostics.hasValidate,
        hasSeccode: diagnostics.hasSeccode,
        eventSequence: event.sequence,
        callbackKeys: event.callbackKeys,
        callbackShape: event.callbackShape,
        challengeAgeMs: Date.now() - nextSession.startedAt,
      });
    };

    const pending = createGeetestChallenge(challenge, {
      onReady: (event) => {
        if (!mountedRef.current || activeSession.disposed) return;
        log.info("captcha challenge ready", {
          provider: challenge.provider,
          eventSequence: event.sequence,
          callbackKeys: event.callbackKeys,
          callbackShape: event.callbackShape,
          challengeAgeMs: Date.now() - activeSession.startedAt,
        });
      },
      onSuccess: (validation, diagnostics, event) =>
        handleValidation(activeSession, validation, diagnostics, event),
      onError: (error, event) => {
        if (!mountedRef.current || activeSession.disposed) return;
        if (activeSession.validationAccepted) {
          log.info("captcha error ignored after accepted validation", {
            provider: challenge.provider,
            eventSequence: event.sequence,
            challengeAgeMs: Date.now() - activeSession.startedAt,
          });
          return;
        }
        setFailed(true);
        setActive(false);
        onValidationRef.current(null);
        log.error("captcha runtime failed", {
          provider: challenge.provider,
          errorType: geetestErrorType(error),
          instanceReady: Boolean(activeSession.instance),
          mountedElements: mountRef.current?.childElementCount ?? 0,
          eventSequence: event.sequence,
          callbackKeys: event.callbackKeys,
          callbackShape: event.callbackShape,
          challengeAgeMs: Date.now() - activeSession.startedAt,
        });
        if (activeSession.instance) {
          disposeSession("runtime-error");
        }
      },
      onClose: (validation, diagnostics, event) => {
        if (!mountedRef.current || activeSession.disposed) return;
        setActive(false);
        if (activeSession.validationAccepted) {
          log.info("captcha close ignored after accepted validation", {
            provider: challenge.provider,
            eventSequence: event.sequence,
            challengeAgeMs: Date.now() - activeSession.startedAt,
          });
          return;
        }
        if (validation) {
          handleValidation(activeSession, validation, diagnostics, event);
          log.info("captcha closed after validation", {
            provider: challenge.provider,
            resultType: diagnostics.resultType,
            resultKeys: diagnostics.keys,
            resultFields: diagnostics.fields,
            hasChallenge: diagnostics.hasChallenge,
            hasValidate: diagnostics.hasValidate,
            hasSeccode: diagnostics.hasSeccode,
            eventSequence: event.sequence,
            callbackKeys: event.callbackKeys,
            callbackShape: event.callbackShape,
            challengeAgeMs: Date.now() - activeSession.startedAt,
          });
          return;
        }
        setSolved(false);
        setFailed(false);
        onValidationRef.current(null);
        log.info("captcha closed without validation", {
          provider: challenge.provider,
          resultType: diagnostics.resultType,
          resultKeys: diagnostics.keys,
          resultFields: diagnostics.fields,
          hasChallenge: diagnostics.hasChallenge,
          hasValidate: diagnostics.hasValidate,
          hasSeccode: diagnostics.hasSeccode,
          eventSequence: event.sequence,
          callbackKeys: event.callbackKeys,
          callbackShape: event.callbackShape,
          challengeAgeMs: Date.now() - activeSession.startedAt,
        });
        if (activeSession.instance) {
          disposeSession("closed-without-validation");
        }
      },
    })
      .then((instance) => {
        if (!mountedRef.current || activeSession.disposed) {
          destroyGeetestInstance(instance);
          throw new Error("captcha session disposed");
        }

        activeSession.instance = instance;
        log.info("captcha instance ready", {
          provider: challenge.provider,
          mountedElements: container.childElementCount,
          callbackRegistration: "success,error,close,ready",
          challengeAgeMs: Date.now() - activeSession.startedAt,
        });
        return instance;
      })
      .finally(() => {
        activeSession.pending = null;
      });

    activeSession.pending = pending;
    return pending;
  }, [challenge, disposeSession]);

  const requestValidation = useCallback(async (): Promise<boolean> => {
    if (openingRef.current) return openingRef.current;
    if (sessionRef.current?.validationAccepted) return true;

    const operation = (async () => {
      setFailed(false);
      setActive(true);
      onValidationRef.current(null);
      if (!sessionRef.current?.instance) {
        setLoading(true);
      }

      try {
        await ensureSession();
        if (!mountedRef.current) return false;

        const session = sessionRef.current;
        const container = mountRef.current;
        setLoading(false);
        const instance = session?.instance;
        if (!container || !instance) {
          throw new Error("captcha instance unavailable after init");
        }
        const displayMode = openGeetestChallenge(instance);
        log.info("captcha requested", {
          provider: challenge.provider,
          instanceReady: true,
          displayMode,
          challengeAgeMs: session ? Date.now() - session.startedAt : undefined,
        });
        return true;
      } catch (error) {
        if (!mountedRef.current) return false;
        const instanceReady = Boolean(sessionRef.current?.instance);
        setLoading(false);
        setFailed(true);
        setActive(false);
        onValidationRef.current(null);
        disposeSession("open-failed");
        log.error("captcha cannot be opened", {
          provider: challenge.provider,
          instanceReady,
          error: errorMessage(error),
        });
        onChallengeInvalidRef.current?.();
        return false;
      }
    })();

    openingRef.current = operation;
    void operation.then(() => {
      if (openingRef.current === operation) {
        openingRef.current = null;
      }
    });
    return operation;
  }, [challenge.provider, disposeSession, ensureSession]);

  useImperativeHandle(
    ref,
    () => ({
      requestValidation,
    }),
    [requestValidation]
  );

  return (
    <div className="flex w-full flex-col gap-2">
      {loading ? (
        <div className="flex min-h-9 items-center">
          <div className="text-muted-sm flex items-center gap-2">
            <Loader2 className="icon-md animate-spin" />
            <span>{t("Account.captcha.loading")}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {failed ? (
            <div className="text-destructive flex items-center gap-2 text-sm">
              <ShieldAlert className="icon-md" />
              <span>{t("Account.captcha.failed")}</span>
            </div>
          ) : null}
          <Button
            type="button"
            variant={solved ? "secondary" : "outline"}
            className="h-9 w-full justify-start"
            disabled={solved}
            onClick={() => void requestValidation()}
          >
            {solved ? <Check /> : <ShieldCheck />}
            {t(solved ? "Account.captcha.solved" : "Account.captcha.start")}
          </Button>
        </div>
      )}
      <div
        ref={mountRef}
        className={cn(
          "pointer-events-auto relative z-20 w-full overflow-visible",
          active ? "min-h-12" : "h-0"
        )}
      />
    </div>
  );
});

export default CaptchaChallenge;
