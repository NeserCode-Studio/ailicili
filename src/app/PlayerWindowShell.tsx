import type { PropsWithChildren } from "react";

import TitlebarOperations from "@/components/framework/TitlebarOperations";
import { useI18n } from "@/composables";

export default function PlayerWindowShell({ children }: PropsWithChildren) {
  const { t } = useI18n();

  return (
    <main className="bg-background flex h-screen min-h-0 flex-col overflow-hidden">
      <header
        data-tauri-drag-region
        className="border-border bg-background flex h-8 shrink-0 items-center justify-between border-b pr-1 pl-3"
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
        <span className="text-muted-foreground pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs">
          {t("Player.title")}
        </span>
        <TitlebarOperations />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </main>
  );
}
