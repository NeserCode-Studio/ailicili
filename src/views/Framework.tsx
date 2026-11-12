import { useContext, type MouseEvent } from "react";
import { useI18n, useToast } from "@/composables";
import { NavigatorContext } from "@/contexts/navigator";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

const TECH_KEYS = [
  "vite",
  "react",
  "typescript",
  "tailwind",
  "tauri",
  "radix",
  "react-router",
  "zod",
  "ahooks",
] as const;

export default function Framework() {
  const { t } = useI18n();
  const { error: toastError } = useToast();
  const { navigator } = useContext(NavigatorContext);

  const openExternalLink = (
    event: MouseEvent<HTMLAnchorElement>,
    url: string
  ) => {
    event.preventDefault();
    void openUrl(url).catch(() => toastError("ExternalLink.openFailed"));
  };

  return (
    <div className="view-framework">
      <div className="mb-6 flex flex-row items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-foreground mb-2 text-2xl font-bold">
            {t("Framework.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("Framework.intro")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => navigator("/")}
        >
          <ArrowLeft className="icon-md" />
          {t("Command.turnto.home")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TECH_KEYS.map((key) => {
          const url = t(`Framework.card.${key}.url`);

          return (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => openExternalLink(event, url)}
              className="border-border bg-card text-card-foreground hover:border-primary/50 flex flex-row items-center gap-3 rounded-lg border p-4 no-underline transition-all duration-150 ease-in-out hover:shadow-md"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-card-foreground flex items-center gap-1 text-sm font-semibold">
                  {t(`Framework.card.${key}.name`)}
                  <ExternalLink className="text-muted-foreground h-3 w-3" />
                </span>
                <span className="text-muted-foreground text-xs leading-snug">
                  {t(`Framework.card.${key}.description`)}
                </span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
