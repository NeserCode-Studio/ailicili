import { useState } from "react";
import {
  AlertTriangle,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldOff,
  UserRound,
} from "lucide-react";

import { asCommandError, type PlatformAccountEntry } from "@/api/account";
import AccountAvatar from "@/components/account/AccountAvatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/framework/Tooltip";
import { useI18n } from "@/composables";
import { useAccount } from "@/contexts/account-context";
import { commandErrorKey } from "@/lib/command-error";

export default function AccountPlatformRow({
  entry,
}: {
  entry: PlatformAccountEntry;
}) {
  const { t } = useI18n();
  const {
    pendingPlatforms,
    openLogin,
    refreshPlatform,
    logoutPlatform,
    resetPlatformDeviceIdentity,
  } = useAccount();
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const platform = entry.platform;
  const pending = pendingPlatforms.has(platform.id);
  const available = platform.availability === "available";
  const hasOptionalAccount = platform.accountCapability.mode !== "none";
  const canLogin =
    available &&
    hasOptionalAccount &&
    platform.accountCapability.loginMethods.length > 0 &&
    entry.status !== "locked";
  const authenticated = entry.status === "authenticated";

  const runAction = (action: () => Promise<unknown>) => {
    setActionError(null);
    void action().catch((reason) => {
      const normalized = asCommandError(reason);
      setActionError(commandErrorKey(normalized));
    });
  };

  const stateMessage = !available
    ? t("Account.center.unavailable")
    : platform.accountCapability.mode === "none"
      ? t("Account.center.anonymousAccess")
      : pending
        ? t("Account.center.checking")
        : entry.messageCode
          ? t(`Account.message.${entry.messageCode}`)
          : authenticated
            ? t("Account.center.sessionStored")
            : t("Account.center.noAccount");

  return (
    <div
      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
      data-platform-id={platform.id}
      data-account-revision={entry.revision}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <AccountAvatar
          src={entry.profile?.avatarUrl}
          className="size-10"
          fallback={
            entry.status === "expired" || entry.status === "locked" ? (
              <AlertTriangle className="size-5 text-amber-500" />
            ) : (
              <UserRound className="text-muted-foreground size-5" />
            )
          }
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">
              {platform.displayName}
            </p>
            <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-[11px]">
              {available
                ? t(`Account.status.${entry.status}`)
                : t("Account.center.unavailableBadge")}
            </span>
          </div>
          <div className="text-muted-foreground mt-1 flex min-w-0 flex-wrap gap-x-2 text-xs">
            {entry.profile?.name ? (
              <span className="max-w-full truncate">{entry.profile.name}</span>
            ) : null}
            <span className="min-w-0 truncate">{stateMessage}</span>
          </div>
          {authenticated && canLogin ? (
            <p className="text-muted-xs mt-1">
              {t("Account.center.replaceHint")}
            </p>
          ) : null}
          {actionError ? (
            <p className="text-destructive mt-1 text-xs" role="alert">
              {t(actionError)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
        {pending ? <Loader2 className="icon-md animate-spin" /> : null}

        {canLogin ? (
          <Tooltip
            content={
              authenticated
                ? t("Account.center.relogin")
                : t("Account.settings.login")
            }
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              disabled={pending}
              aria-label={
                authenticated
                  ? t("Account.center.relogin")
                  : t("Account.settings.login")
              }
              onClick={() => openLogin(platform.id)}
            >
              <LogIn />
            </Button>
          </Tooltip>
        ) : null}

        {authenticated && platform.accountCapability.supportsRefresh ? (
          <Tooltip content={t("Account.settings.refresh")}>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              disabled={pending}
              aria-label={t("Account.settings.refresh")}
              onClick={() => runAction(() => refreshPlatform(platform.id))}
            >
              <RefreshCw />
            </Button>
          </Tooltip>
        ) : null}

        {authenticated && platform.accountCapability.supportsLogout ? (
          <Tooltip content={t("Account.settings.logout")}>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              disabled={pending}
              aria-label={t("Account.settings.logout")}
              onClick={() => runAction(() => logoutPlatform(platform.id))}
            >
              <LogOut />
            </Button>
          </Tooltip>
        ) : null}

        {available && platform.accountCapability.supportsDeviceReset ? (
          <>
            <Tooltip content={t("Account.settings.resetDevice")}>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive size-8"
                disabled={pending}
                aria-label={t("Account.settings.resetDevice")}
                onClick={() => setResetOpen(true)}
              >
                <ShieldOff />
              </Button>
            </Tooltip>
            <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("Account.settings.resetDeviceTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("Account.settings.resetDeviceDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t("Account.settings.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      runAction(() => resetPlatformDeviceIdentity(platform.id))
                    }
                  >
                    {t("Account.settings.confirmReset")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}

        {!available && platform.accountCapability.mode !== "none" ? (
          <ShieldAlert className="text-muted-foreground icon-md" />
        ) : null}
      </div>
    </div>
  );
}
