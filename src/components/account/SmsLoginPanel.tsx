import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Send } from "lucide-react";

import {
  asCommandError,
  cancelBilibiliSmsLogin,
  createBilibiliSmsChallenge,
  loginBilibiliWithSms,
  sendBilibiliSmsCode,
  type BilibiliAccount,
  type CommandError,
  type SmsChallenge,
  type SmsCodeSent,
} from "@/api/account";
import CaptchaChallenge, {
  type CaptchaChallengeHandle,
} from "@/components/account/CaptchaChallenge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/composables";
import type { CaptchaValidation } from "@/lib/bilibili-captcha";
import { commandErrorMessage } from "@/lib/command-error";
import { createLogger } from "@/lib/logger";

const log = createLogger("Account/SMS");

export default function SmsLoginPanel({
  onSuccess,
}: {
  onSuccess: (account: BilibiliAccount) => void;
}) {
  const { t } = useI18n();
  const [challenge, setChallenge] = useState<SmsChallenge | null>(null);
  const [validation, setValidation] = useState<CaptchaValidation | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [challengeError, setChallengeError] = useState<CommandError | null>(
    null
  );
  const [countryCode, setCountryCode] = useState("86");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [smsFlow, setSmsFlow] = useState<SmsCodeSent | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [operationError, setOperationError] = useState<CommandError | null>(
    null
  );
  const challengeRequestRef = useRef<Promise<SmsChallenge | null> | null>(null);
  const challengeIdRef = useRef<string | undefined>(undefined);
  const challengeLoadedAtRef = useRef(0);
  const smsFlowIdRef = useRef<string | undefined>(undefined);
  const captchaRef = useRef<CaptchaChallengeHandle>(null);
  const invalidatingChallengeRef = useRef(false);
  const sendAfterValidationRef = useRef(false);
  const mountedRef = useRef(true);
  const initialChallengeRequestedRef = useRef(false);
  const disposalTimerRef = useRef<number | null>(null);
  const phoneValid = /^\d{6,15}$/.test(phone);

  const loadChallenge = useCallback(async (): Promise<SmsChallenge | null> => {
    const inFlight = challengeRequestRef.current;
    if (inFlight) return inFlight;

    setChallengeLoading(true);
    setChallengeError(null);
    setOperationError(null);
    setValidation(null);
    challengeLoadedAtRef.current = 0;

    const request = (async () => {
      try {
        const previousChallengeId = challengeIdRef.current;
        if (previousChallengeId) {
          challengeIdRef.current = undefined;
          setChallenge(null);
          await cancelBilibiliSmsLogin(previousChallengeId).catch(
            () => undefined
          );
        }
        log.info("sms challenge request started");
        const next = await createBilibiliSmsChallenge();
        if (!mountedRef.current) {
          void cancelBilibiliSmsLogin(next.challengeId).catch(() => undefined);
          return null;
        }
        setChallenge(next);
        challengeIdRef.current = next.challengeId;
        challengeLoadedAtRef.current = Date.now();
        log.info("sms challenge loaded", {
          provider: next.provider,
          gtPresent: Boolean(next.gt),
          challengePresent: Boolean(next.challenge),
          tencentAppIdPresent: Boolean(next.tencentAppId),
          expiresInSeconds: next.expiresInSeconds,
          challengeIdLength: next.challengeId.length,
          gtLength: next.gt?.length ?? 0,
          challengeLength: next.challenge?.length ?? 0,
        });
        return next;
      } catch (reason) {
        if (!mountedRef.current) return null;
        const normalized = asCommandError(reason);
        setChallengeError(normalized);
        log.error("sms challenge failed", { code: normalized.code });
        return null;
      } finally {
        if (mountedRef.current) {
          setChallengeLoading(false);
        }
      }
    })();

    challengeRequestRef.current = request;
    void request.then(() => {
      if (challengeRequestRef.current === request) {
        challengeRequestRef.current = null;
      }
    });
    return request;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (disposalTimerRef.current !== null) {
      window.clearTimeout(disposalTimerRef.current);
      disposalTimerRef.current = null;
      log.debug(
        "sms panel deferred cleanup cancelled after strict-mode replay"
      );
    }
    if (!initialChallengeRequestedRef.current) {
      initialChallengeRequestedRef.current = true;
      void loadChallenge();
    }
    return () => {
      mountedRef.current = false;
      sendAfterValidationRef.current = false;
      if (disposalTimerRef.current !== null) {
        window.clearTimeout(disposalTimerRef.current);
      }
      disposalTimerRef.current = window.setTimeout(() => {
        disposalTimerRef.current = null;
        if (mountedRef.current) return;
        const challengeId = challengeIdRef.current;
        const smsFlowId = smsFlowIdRef.current;
        challengeIdRef.current = undefined;
        smsFlowIdRef.current = undefined;
        log.info("sms panel unmounted", {
          challengePresent: Boolean(challengeId),
          smsFlowPresent: Boolean(smsFlowId),
        });
        void cancelBilibiliSmsLogin(challengeId, smsFlowId).catch(
          () => undefined
        );
      }, 0);
    };
  }, [loadChallenge]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const sendCode = async (captchaValidation: CaptchaValidation) => {
    if (!challenge || sending) return;
    setSending(true);
    setOperationError(null);
    log.info("sms code request started", {
      countryCodeLength: countryCode.length,
      phoneLength: phone.length,
      challengeLength: captchaValidation.challenge.length,
      validateLength: captchaValidation.validate.length,
      seccodeLength: captchaValidation.seccode.length,
    });
    try {
      const result = await sendBilibiliSmsCode(
        challenge.challengeId,
        countryCode,
        phone,
        captchaValidation.challenge,
        captchaValidation.validate,
        captchaValidation.seccode
      );
      if (!mountedRef.current) {
        void cancelBilibiliSmsLogin(undefined, result.smsFlowId).catch(
          () => undefined
        );
        return;
      }
      setSmsFlow(result);
      smsFlowIdRef.current = result.smsFlowId;
      setCooldown(result.retryAfterSeconds);
      setChallenge(null);
      challengeIdRef.current = undefined;
      challengeLoadedAtRef.current = 0;
      setValidation(null);
      setCode("");
      log.info("sms code requested", {
        retryAfterSeconds: result.retryAfterSeconds,
        expiresInSeconds: result.expiresInSeconds,
      });
    } catch (reason) {
      const normalized = asCommandError(reason);
      setOperationError(normalized);
      setChallenge(null);
      challengeIdRef.current = undefined;
      challengeLoadedAtRef.current = 0;
      setValidation(null);
      log.error("sms code request failed", {
        code: normalized.code,
        action: normalized.action,
        phoneLength: phone.length,
        challengeRetryRequired: true,
      });
    } finally {
      sendAfterValidationRef.current = false;
      setSending(false);
    }
  };

  const requestCaptcha = useCallback(async (autoSend: boolean) => {
    if (autoSend) {
      sendAfterValidationRef.current = true;
    }
    const opened = (await captchaRef.current?.requestValidation()) ?? false;
    if (!opened && autoSend) {
      sendAfterValidationRef.current = false;
      setOperationError({
        code: "captchaUnavailable",
        message: "Security challenge could not be opened.",
      });
      log.warn("sms captcha validation could not be opened", {
        autoSend,
        challengePresent: Boolean(challengeIdRef.current),
      });
    }
  }, []);

  const handleCaptchaInvalid = () => {
    if (invalidatingChallengeRef.current) return;
    invalidatingChallengeRef.current = true;
    sendAfterValidationRef.current = false;
    const challengeId = challengeIdRef.current;
    challengeIdRef.current = undefined;
    challengeLoadedAtRef.current = 0;
    setChallenge(null);
    setValidation(null);
    log.warn("sms challenge invalidated; next send will request a fresh one", {
      provider: challenge?.provider,
      challengePresent: Boolean(challengeId),
    });
    void cancelBilibiliSmsLogin(challengeId)
      .catch(() => undefined)
      .finally(() => {
        invalidatingChallengeRef.current = false;
      });
  };

  const handleSendCode = () => {
    if (!phoneValid || sending) return;
    if (validation) {
      void sendCode(validation);
      return;
    }
    setOperationError(null);

    if (!challenge) {
      if (challengeLoading) return;
      void loadChallenge();
      return;
    }

    const challengeAgeMs = Date.now() - challengeLoadedAtRef.current;
    const challengeLifetimeMs = challenge.expiresInSeconds * 1000;
    if (
      challengeLoadedAtRef.current === 0 ||
      challengeAgeMs >= Math.max(0, challengeLifetimeMs - 5000)
    ) {
      sendAfterValidationRef.current = true;
      log.warn("sms challenge expired before use; refreshing", {
        challengeAgeMs,
      });
      void loadChallenge();
      return;
    }

    void requestCaptcha(true);
  };

  const handleLogin = async () => {
    if (!smsFlow || verifying) return;
    setVerifying(true);
    setOperationError(null);
    try {
      const account = await loginBilibiliWithSms(smsFlow.smsFlowId, code);
      smsFlowIdRef.current = undefined;
      log.info("sms login succeeded", { codeLength: code.length });
      onSuccess(account);
    } catch (reason) {
      const normalized = asCommandError(reason);
      setOperationError(normalized);
      log.error("sms login failed", {
        code: normalized.code,
        action: normalized.action,
        codeLength: code.length,
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = () => {
    if (cooldown > 0) return;
    const currentFlowId = smsFlowIdRef.current;
    void (async () => {
      if (currentFlowId) {
        await cancelBilibiliSmsLogin(undefined, currentFlowId).catch(
          () => undefined
        );
      }
      if (!mountedRef.current) return;
      setSmsFlow(null);
      smsFlowIdRef.current = undefined;
      setCode("");
      sendAfterValidationRef.current = true;
      setOperationError(null);
      const nextChallenge = await loadChallenge();
      if (!nextChallenge) {
        sendAfterValidationRef.current = false;
      }
    })();
  };

  const error = operationError ?? challengeError;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <div className="stack-1">
          <Label htmlFor="sms-country-code">
            {t("Account.sms.countryCode")}
          </Label>
          <Input
            id="sms-country-code"
            inputMode="numeric"
            autoComplete="tel-country-code"
            value={countryCode}
            onChange={(event) =>
              setCountryCode(event.target.value.replace(/\D/g, "").slice(0, 4))
            }
            disabled={Boolean(smsFlow) || sending}
          />
        </div>
        <div className="stack-1">
          <Label htmlFor="sms-phone">{t("Account.sms.phone")}</Label>
          <Input
            id="sms-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={phone}
            onChange={(event) =>
              setPhone(event.target.value.replace(/[\s-]/g, "").slice(0, 15))
            }
            placeholder={t("Account.sms.phonePlaceholder")}
            disabled={Boolean(smsFlow) || sending}
          />
        </div>
      </div>

      {challengeLoading ? (
        <div className="text-muted-sm flex h-12 items-center gap-2">
          <Loader2 className="icon-md animate-spin" />
          {t("Account.sms.challengeLoading")}
        </div>
      ) : null}
      {challenge && !smsFlow ? (
        <CaptchaChallenge
          key={challenge.challengeId}
          ref={captchaRef}
          challenge={challenge}
          onChallengeInvalid={handleCaptchaInvalid}
          onValidation={(nextValidation) => {
            setValidation(nextValidation);
            log.info("sms captcha validation changed", {
              accepted: Boolean(nextValidation),
              autoSendPending: sendAfterValidationRef.current,
              sending,
            });
            if (nextValidation && sendAfterValidationRef.current && !sending) {
              sendAfterValidationRef.current = false;
              void sendCode(nextValidation);
            }
          }}
        />
      ) : null}
      {!smsFlow && !challengeLoading && !challenge ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => {
            void loadChallenge();
          }}
        >
          <RefreshCw />
          {t("Account.sms.retryChallenge")}
        </Button>
      ) : null}

      {!smsFlow ? (
        <Button
          type="button"
          onClick={handleSendCode}
          disabled={!phoneValid || sending || challengeLoading}
        >
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
          {t("Account.sms.sendCode")}
        </Button>
      ) : null}

      {smsFlow ? (
        <div className="flex flex-col gap-3">
          <div className="stack-1">
            <Label htmlFor="sms-code">{t("Account.sms.code")}</Label>
            <InputOTP
              id="sms-code"
              maxLength={6}
              value={code}
              onChange={(value) => setCode(value.replace(/\D/g, ""))}
              disabled={verifying}
            >
              <InputOTPGroup>
                {Array.from({ length: 6 }, (_, index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button
            type="button"
            onClick={() => void handleLogin()}
            disabled={code.length !== 6 || verifying}
          >
            {verifying ? <Loader2 className="animate-spin" /> : null}
            {t("Account.sms.login")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleResend}
            disabled={cooldown > 0}
          >
            <RefreshCw />
            {cooldown > 0
              ? t("Account.sms.retryAfter").replace("{seconds}", `${cooldown}`)
              : t("Account.sms.resend")}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {commandErrorMessage(error, t)}
        </p>
      ) : null}
    </div>
  );
}
