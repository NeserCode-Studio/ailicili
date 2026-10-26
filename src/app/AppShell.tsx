import type { PropsWithChildren } from "react";
import { NavLink } from "react-router";
import {
  Activity,
  Clapperboard,
  Compass,
  Download,
  Frame,
  Library,
  MonitorPlay,
  RadioTower,
  Search,
  Settings2,
} from "lucide-react";

import CommandDialog from "@/components/framework/CommandDialog";
import Titlebar from "@/components/framework/Titlebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n, useToast } from "@/composables";
import { useSettingsDialog } from "@/contexts/settings";
import AccountMenu from "@/features/auth/AccountMenu";
import { openLastPlayerWindow } from "@/lib/bili";
import { cn } from "@/lib/utils";
import {
  useDownloadProgressEvents,
  useDownloadSnapshot,
} from "@/features/downloads/useDownloads";

interface SidebarItemProps {
  to: string;
  icon: typeof Compass;
  label: string;
  badge?: number;
}

function SidebarItem({ to, icon: Icon, label, badge = 0 }: SidebarItemProps) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        cn(
          "group text-muted-foreground hover:bg-muted hover:text-foreground relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
          isActive && "bg-muted text-foreground"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "bg-primary absolute left-0 h-5 w-0.5 rounded-full opacity-0 transition-opacity",
              isActive && "opacity-100"
            )}
          />
          <Icon className="size-4 shrink-0" />
          <span className="app-sidebar-label truncate">{label}</span>
          {badge > 0 && (
            <span className="bg-primary/10 text-primary ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export default function AppShell({ children }: PropsWithChildren) {
  const { t } = useI18n();
  const { error: toastError } = useToast();
  const { openSettings } = useSettingsDialog();
  const downloadsQuery = useDownloadSnapshot();
  useDownloadProgressEvents();
  const pendingDownloads =
    (downloadsQuery.data?.activeCount ?? 0) +
    (downloadsQuery.data?.queuedCount ?? 0);

  const openPlayer = async () => {
    try {
      if (await openLastPlayerWindow()) return;
      toastError("Player.noRecent");
    } catch {
      toastError("Player.openError");
    }
  };

  return (
    <main id="app-main" className="app-shell">
      <Titlebar />
      <CommandDialog />

      <div id="container" className="app-body">
        <aside className="app-sidebar" aria-label={t("Nav.primary")}>
          <div className="flex h-16 items-center gap-2.5 px-4">
            <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md text-base font-bold">
              A
            </span>
            <span className="app-sidebar-label truncate text-base font-semibold tracking-tight">
              Ailicili
            </span>
          </div>

          <nav className="flex flex-1 flex-col gap-1 px-2 pt-2">
            <SidebarItem to="/" icon={Compass} label={t("Nav.discover")} />
            <SidebarItem to="/search" icon={Search} label={t("Nav.search")} />
            <SidebarItem to="/pgc" icon={Clapperboard} label={t("Nav.pgc")} />
            <SidebarItem to="/live" icon={RadioTower} label={t("Nav.live")} />
            <SidebarItem
              to="/downloads"
              icon={Download}
              label={t("Nav.downloads")}
              badge={pendingDownloads}
            />
            <SidebarItem
              to="/dynamics"
              icon={Activity}
              label={t("Nav.dynamics")}
            />
            <SidebarItem
              to="/library"
              icon={Library}
              label={t("Nav.library")}
            />
            <SidebarItem
              to="/framework"
              icon={Frame}
              label={t("Nav.framework")}
            />
          </nav>

          <div className="border-border/70 flex flex-col gap-2 border-t p-2">
            <AccountMenu />
            <button
              type="button"
              onClick={() => void openPlayer()}
              aria-label={t("Nav.player")}
              title={t("Nav.player")}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors"
            >
              <MonitorPlay className="size-4 shrink-0" />
              <span className="app-sidebar-label truncate">
                {t("Nav.player")}
              </span>
            </button>
            <button
              type="button"
              onClick={openSettings}
              aria-label={t("Nav.settings")}
              title={t("Nav.settings")}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors"
            >
              <Settings2 className="size-4 shrink-0" />
              <span className="app-sidebar-label truncate">
                {t("Nav.settings")}
              </span>
            </button>
          </div>
        </aside>

        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <div className="min-h-full w-full">{children}</div>
        </ScrollArea>
      </div>
    </main>
  );
}
