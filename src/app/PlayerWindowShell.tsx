import type { PropsWithChildren } from "react";

import TitlebarOperations from "@/components/framework/TitlebarOperations";
import { useI18n } from "@/composables";
import { usePageTitlebar } from "@/contexts/pageTitlebar";

export default function PlayerWindowShell({ children }: PropsWithChildren) {
  const { t } = useI18n();
  const { pageTitle } = usePageTitlebar();
  const title = pageTitle ?? t("Player.title");

  return (
    <main className="bg-background flex h-screen min-h-0 flex-col overflow-hidden">
      <header
        data-tauri-drag-region
        className="border-border bg-background grid h-8 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b pr-1 pl-3"
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 text-xs font-medium"
        >
          <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-sm text-[11px] font-bold">
            A
          </span>
          <span>Ailicili</span>
        </div>
        <span
          data-tauri-drag-region
          title={title}
          className="text-muted-foreground pointer-events-none min-w-0 truncate px-2 text-center text-xs font-medium"
        >
          {title}
        </span>
        <TitlebarOperations />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </main>
  );
}
