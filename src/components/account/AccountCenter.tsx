import { RefreshCw, ShieldAlert, UserRound } from "lucide-react";

import AccountPlatformRow from "@/components/account/AccountPlatformRow";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/composables";
import { useAccount } from "@/contexts/account-context";
import { commandErrorKey } from "@/lib/command-error";

export default function AccountCenter() {
  const { t } = useI18n();
  const { snapshot, loading, error, reload } = useAccount();

  if (loading && !snapshot) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-sm">{t("Account.center.description")}</p>
        <div className="divide-y rounded-lg border">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-sm">{t("Account.center.description")}</p>
        <div className="border-destructive/30 bg-destructive/5 flex flex-col items-center gap-3 rounded-lg border px-4 py-8 text-center">
          <ShieldAlert className="text-destructive size-5" />
          <p className="text-destructive text-sm">
            {t(commandErrorKey(error))}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void reload()}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {t("Account.center.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (!snapshot?.platforms.length) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-sm">{t("Account.center.description")}</p>
        <div className="text-muted-sm flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
          <UserRound className="text-muted-foreground size-5" />
          {t("Account.center.empty")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-sm">{t("Account.center.description")}</p>
      <section
        className="divide-y overflow-hidden rounded-lg border"
        aria-label={t("Account.center.listLabel")}
      >
        {snapshot.platforms.map((entry) => (
          <AccountPlatformRow key={entry.platform.id} entry={entry} />
        ))}
      </section>
    </div>
  );
}
