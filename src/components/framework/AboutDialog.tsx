import { useEffect, useState } from "react";
import {
  getIdentifier,
  getName,
  getTauriVersion,
  getVersion,
} from "@tauri-apps/api/app";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import { useNavigatorContext } from "@/contexts/navigator";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Info } from "lucide-react";

export interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AboutMeta {
  name: string;
  version: string;
  tauriVersion: string;
  identifier: string;
}

export default function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const { t } = useI18n();
  const { navigator } = useNavigatorContext();
  const [meta, setMeta] = useState<AboutMeta | null>(null);

  /* 弹窗打开时拉取应用元信息；失败时降级为「未知」而非报错 */
  useEffect(() => {
    if (!open || meta) return;

    let cancelled = false;

    (async () => {
      const [name, version, tauriVersion, identifier] = await Promise.all([
        getName().catch(() => "—"),
        getVersion().catch(() => "—"),
        getTauriVersion().catch(() => "—"),
        getIdentifier().catch(() => "—"),
      ]);

      if (cancelled) return;
      setMeta({ name, version, tauriVersion, identifier });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, meta]);

  const appName = meta?.name ?? "Ailicili";
  const title = t("About.title").replace("{name}", appName);

  const rows: { label: string; value: string }[] = [
    { label: t("About.version"), value: meta?.version ?? "—" },
    { label: t("About.tauri"), value: meta?.tauriVersion ?? "—" },
    { label: t("About.identifier"), value: meta?.identifier ?? "—" },
  ];

  const openWebsite = async () => {
    await openUrl("https://www.bilibili.com/").catch(() => {});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <div className="flex flex-col items-center gap-1 pt-2 text-center">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <p className="text-muted-xs">{t("About.tagline")}</p>
        </div>

        <dl className="divide-border border-border/60 mt-2 divide-y overflow-hidden rounded-lg border">
          {rows.map((row) => (
            <div
              key={row.label}
              className="bg-muted/30 flex items-baseline gap-4 px-3 py-2"
            >
              <dt className="text-muted-xs w-24 shrink-0">{row.label}</dt>
              <dd className="min-w-0 flex-1 truncate font-mono text-xs">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-muted-xs text-center">{t("About.copyright")}</p>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              onOpenChange(false);
              navigator("/framework");
            }}
          >
            <Info className="icon-md" />
            {t("Titlebar.menu.about.framework")}
          </Button>
          <Button variant="outline" size="sm" onClick={openWebsite}>
            {t("About.website")}
            <ExternalLink className="icon-md" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
