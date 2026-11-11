import { useCallback, useEffect } from "react";
import { Loader2, QrCode, ShieldAlert, Smartphone } from "lucide-react";

import type { PlatformDescriptor } from "@/api/platforms";
import QrLoginPanel from "@/components/account/QrLoginPanel";
import SmsLoginPanel from "@/components/account/SmsLoginPanel";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/composables";
import { useAccount } from "@/contexts/account-context";

export default function BilibiliLoginDialog({
  platform,
}: {
  platform: PlatformDescriptor;
}) {
  const { t } = useI18n();
  const { loginMethod, capabilities, setLoginMethod, acceptAccount } =
    useAccount();
  const handleSuccess = useCallback(
    (account: Parameters<typeof acceptAccount>[0]) => {
      acceptAccount(account, platform.id);
    },
    [acceptAccount, platform.id]
  );

  useEffect(() => {
    if (!capabilities) return;
    if (!capabilities.qrAvailable && !capabilities.smsAvailable) return;
    if (loginMethod === "qr" && !capabilities.qrAvailable) {
      setLoginMethod("sms");
    }
    if (loginMethod === "sms" && !capabilities.smsAvailable) {
      setLoginMethod("qr");
    }
  }, [capabilities, loginMethod, setLoginMethod]);

  return (
    <DialogContent
      className="z-[60] sm:max-w-lg"
      onFocusOutside={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => event.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>
          {t("Account.login.titleWithPlatform").replace(
            "{platform}",
            platform.displayName
          )}
        </DialogTitle>
        <DialogDescription>{t("Account.login.description")}</DialogDescription>
      </DialogHeader>

      {!capabilities ? (
        <div className="text-muted-sm flex h-40 items-center justify-center gap-2">
          <Loader2 className="icon-md animate-spin" />
          {t("Account.login.capabilitiesLoading")}
        </div>
      ) : !capabilities.qrAvailable && !capabilities.smsAvailable ? (
        <div className="text-muted-sm flex min-h-40 items-center justify-center gap-2 text-center">
          <ShieldAlert className="icon-md shrink-0" />
          {t("Account.login.unavailable")}
        </div>
      ) : (
        <Tabs
          value={loginMethod}
          onValueChange={(value) =>
            setLoginMethod(value === "sms" ? "sms" : "qr")
          }
        >
          {capabilities.qrAvailable && capabilities.smsAvailable ? (
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="qr" className="gap-2">
                <QrCode className="icon-md" />
                {t("Account.login.qrTab")}
              </TabsTrigger>
              <TabsTrigger value="sms" className="gap-2">
                <Smartphone className="icon-md" />
                {t("Account.login.smsTab")}
              </TabsTrigger>
            </TabsList>
          ) : null}

          {capabilities.qrAvailable ? (
            <TabsContent value="qr" className="mt-4">
              <QrLoginPanel onSuccess={handleSuccess} />
            </TabsContent>
          ) : null}
          {capabilities.smsAvailable ? (
            <TabsContent value="sms" className="mt-4">
              <SmsLoginPanel onSuccess={handleSuccess} />
            </TabsContent>
          ) : null}
        </Tabs>
      )}
    </DialogContent>
  );
}
