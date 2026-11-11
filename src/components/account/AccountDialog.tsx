import { Loader2, ShieldAlert } from "lucide-react";

import { resolveLoginDialog } from "@/components/account/login-registry";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/composables";
import { useAccount } from "@/contexts/account-context";

export default function AccountDialog() {
  const { t } = useI18n();
  const { loginOpen, loginPlatformId, platformCatalog, closeLogin } =
    useAccount();
  const platform = platformCatalog.find(
    (entry) => entry.id === loginPlatformId
  );
  const LoginDialog = loginPlatformId
    ? resolveLoginDialog(loginPlatformId)
    : undefined;

  return (
    <Dialog
      modal={false}
      open={loginOpen}
      onOpenChange={(open) => !open && closeLogin()}
    >
      {loginOpen ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[55] bg-black/50"
          onClick={closeLogin}
        />
      ) : null}
      {LoginDialog && platform ? (
        <LoginDialog platform={platform} />
      ) : (
        <DialogContent className="z-[60] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Account.login.title")}</DialogTitle>
          </DialogHeader>
          <div className="text-muted-sm flex min-h-40 items-center justify-center gap-2 text-center">
            {loginOpen && !platform ? (
              <Loader2 className="icon-md animate-spin" />
            ) : (
              <ShieldAlert className="icon-md shrink-0" />
            )}
            {t("Account.login.unavailable")}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
