import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Crown,
  LoaderCircle,
  LogOut,
  QrCode,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { Link } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, useToast } from "@/composables";
import { useAuthStatus } from "@/features/auth/useAuthStatus";
import {
  biliKeys,
  logoutBili,
  normalizeBiliError,
  pollQrLogin,
  startQrLogin,
} from "@/lib/bili";
import { cn } from "@/lib/utils";
import type {
  AccountProfile,
  AuthStatus,
  QrLoginState,
} from "@/shared/bili.types";

function AccountPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 sm:px-8">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-9 w-56" />
      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
    </div>
  );
}

function AuthenticatedAccount({ profile }: { profile: AccountProfile }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { error: showError } = useToast();
  const authQuery = useAuthStatus();
  const logoutMutation = useMutation({
    mutationFn: logoutBili,
    onSuccess: () => {
      queryClient.setQueryData<AuthStatus>(biliKeys.auth(), {
        authenticated: false,
        storageAvailable: authQuery.data?.storageAvailable ?? true,
        profile: null,
      });
    },
    onError: () => showError("Auth.logout.error"),
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("Auth.accountTitle")}
      </h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {t("Auth.accountDescription")}
      </p>

      <section className="border-border mt-8 grid gap-8 rounded-lg border p-6 md:grid-cols-[auto_1fr] md:p-8">
        <Avatar className="size-24 border">
          <AvatarImage
            src={profile.avatarUrl}
            alt={profile.name}
            referrerPolicy="no-referrer"
          />
          <AvatarFallback className="text-2xl">
            {profile.name.trim().charAt(0) || "U"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="truncate text-xl font-semibold">{profile.name}</h2>
            <span className="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs font-medium">
              LV{profile.level}
            </span>
            {profile.vipStatus && (
              <span className="text-primary flex items-center gap-1 text-xs font-medium">
                <Crown className="size-3.5" />
                {profile.vipLabel || t("Auth.vip")}
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            UID {profile.mid}
          </p>
          <div className="mt-7 grid gap-3 text-sm sm:grid-cols-2">
            <div className="border-border flex items-center gap-3 border-t pt-3">
              <ShieldCheck className="text-brand-blue size-4" />
              <span>{t("Auth.sessionStored")}</span>
            </div>
            <div className="border-border flex items-center gap-3 border-t pt-3">
              <UserRound className="text-brand-blue size-4" />
              <span>{t("Auth.personalData")}</span>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/">{t("Auth.continueWatching")}</Link>
            </Button>
            <Button
              variant="outline"
              disabled={logoutMutation.isPending}
              onClick={() => logoutMutation.mutate()}
            >
              {logoutMutation.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
              {t("Auth.signOut")}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function QrState({ state }: { state: QrLoginState }) {
  const { t } = useI18n();
  const content = {
    waiting: {
      icon: QrCode,
      title: t("Auth.qr.waiting"),
      description: t("Auth.qr.waitingDescription"),
    },
    scanned: {
      icon: CheckCircle2,
      title: t("Auth.qr.scanned"),
      description: t("Auth.qr.scannedDescription"),
    },
    confirmed: {
      icon: CheckCircle2,
      title: t("Auth.qr.confirmed"),
      description: t("Auth.qr.confirmedDescription"),
    },
    expired: {
      icon: TriangleAlert,
      title: t("Auth.qr.expired"),
      description: t("Auth.qr.expiredDescription"),
    },
  }[state];
  const Icon = content.icon;

  return (
    <div aria-live="polite" className="mt-5 flex items-start gap-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          state === "scanned" || state === "confirmed"
            ? "bg-brand-blue/12 text-brand-blue"
            : "bg-muted text-muted-foreground",
          state === "expired" && "bg-destructive/10 text-destructive"
        )}
      >
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-sm font-medium">{content.title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {content.description}
        </p>
      </div>
    </div>
  );
}

function GuestLoginPanel({ storageAvailable }: { storageAvailable: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { success } = useToast();
  const [generation, setGeneration] = useState(0);
  const handledAttempt = useRef<string | null>(null);

  const qrQuery = useQuery({
    queryKey: biliKeys.qrLogin(generation),
    queryFn: startQrLogin,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: 1,
  });
  const pollQuery = useQuery({
    queryKey: biliKeys.qrLoginPoll(qrQuery.data?.attemptId ?? "pending"),
    queryFn: () => pollQrLogin(qrQuery.data!.attemptId),
    enabled: Boolean(qrQuery.data?.attemptId),
    retry: 2,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "waiting" || state === "scanned" ? 2000 : false;
    },
  });

  const state = pollQuery.data?.state ?? "waiting";
  const qrSource = useMemo(
    () =>
      qrQuery.data
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrQuery.data.qrSvg)}`
        : "",
    [qrQuery.data]
  );

  useEffect(() => {
    const attemptId = qrQuery.data?.attemptId;
    const result = pollQuery.data;
    if (
      !attemptId ||
      result?.state !== "confirmed" ||
      handledAttempt.current === attemptId
    ) {
      return;
    }

    handledAttempt.current = attemptId;
    if (result.profile) {
      queryClient.setQueryData<AuthStatus>(biliKeys.auth(), {
        authenticated: true,
        storageAvailable,
        profile: result.profile,
      });
    } else {
      void queryClient.invalidateQueries({ queryKey: biliKeys.auth() });
    }
    success("Auth.login.success");
  }, [
    pollQuery.data,
    qrQuery.data?.attemptId,
    queryClient,
    storageAvailable,
    success,
  ]);

  const error = qrQuery.error ?? pollQuery.error;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("Auth.title")}
      </h1>
      <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
        {t("Auth.description")}
      </p>

      <div className="mt-9 grid items-stretch gap-10 lg:grid-cols-[1fr_26rem]">
        <section className="border-border flex flex-col justify-between border-y py-7">
          <div>
            <div className="text-muted-foreground flex items-center gap-3">
              <span className="bg-brand-blue flex size-9 items-center justify-center rounded-md text-white">
                <QrCode className="size-5" />
              </span>
              <span className="text-sm font-medium">
                {t("Auth.scanMethod")}
              </span>
            </div>
            <ol className="mt-8 space-y-5">
              {(["openApp", "scan", "confirm"] as const).map((step, index) => (
                <li key={step} className="flex gap-4">
                  <span className="border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      {t(`Auth.steps.${step}.title`)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs leading-5">
                      {t(`Auth.steps.${step}.description`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="text-muted-foreground mt-10 flex items-start gap-2 border-t pt-4 text-xs leading-5">
            <ShieldCheck className="text-brand-blue mt-0.5 size-4 shrink-0" />
            <span>
              {storageAvailable
                ? t("Auth.securityNote")
                : t("Auth.storageUnavailable")}
            </span>
          </div>
        </section>

        <section className="border-border flex min-h-[29rem] flex-col items-center rounded-lg border p-6">
          <div className="flex w-full items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">{t("Auth.qr.title")}</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                {t("Auth.qr.validFor", {
                  seconds: qrQuery.data?.expiresInSeconds ?? 180,
                })}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("Auth.qr.refresh")}
              title={t("Auth.qr.refresh")}
              disabled={qrQuery.isFetching}
              onClick={() => setGeneration((value) => value + 1)}
            >
              <RefreshCw
                className={cn("size-4", qrQuery.isFetching && "animate-spin")}
              />
            </Button>
          </div>

          <div className="relative mt-6 flex size-64 items-center justify-center bg-white p-3">
            {error ? (
              <div className="text-muted-foreground flex flex-col items-center gap-3 px-6 text-center">
                <TriangleAlert className="text-destructive size-6" />
                <p className="text-xs leading-5">
                  {normalizeBiliError(error).code === "credential_store"
                    ? t("Auth.storageUnavailable")
                    : t("Auth.qr.error")}
                </p>
              </div>
            ) : qrQuery.isPending ? (
              <LoaderCircle className="text-muted-foreground size-6 animate-spin" />
            ) : (
              <>
                <img
                  src={qrSource}
                  alt={t("Auth.qr.alt")}
                  className={cn(
                    "size-full transition-opacity",
                    (state === "expired" || pollQuery.isError) && "opacity-15"
                  )}
                />
                {state === "expired" && (
                  <button
                    type="button"
                    onClick={() => setGeneration((value) => value + 1)}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-neutral-900"
                  >
                    <RefreshCw className="size-6" />
                    <span className="text-sm font-medium">
                      {t("Auth.qr.refresh")}
                    </span>
                  </button>
                )}
              </>
            )}
          </div>

          {error ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-5"
              onClick={() => {
                if (qrQuery.error) {
                  void qrQuery.refetch();
                } else {
                  void pollQuery.refetch();
                }
              }}
            >
              <RefreshCw className="size-3.5" />
              {t("Auth.retry")}
            </Button>
          ) : (
            <QrState state={state} />
          )}
        </section>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { t } = useI18n();
  const authQuery = useAuthStatus();

  if (authQuery.isPending) {
    return <AccountPageSkeleton />;
  }

  if (authQuery.error) {
    const error = normalizeBiliError(authQuery.error);
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8 sm:px-8">
        <AsyncErrorState
          title={t("Auth.statusError.title")}
          description={t("Auth.statusError.description")}
          code={error.code}
          retryLabel={t("Auth.retry")}
          onRetry={() => void authQuery.refetch()}
        />
      </div>
    );
  }

  if (authQuery.data?.profile) {
    return <AuthenticatedAccount profile={authQuery.data.profile} />;
  }

  return (
    <GuestLoginPanel
      storageAvailable={authQuery.data?.storageAvailable ?? true}
    />
  );
}
