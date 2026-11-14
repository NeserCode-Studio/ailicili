import {
  History,
  House,
  Info,
  Radio,
  Star,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useLocation } from "react-router";

import AccountAvatar from "@/components/account/AccountAvatar";
import { useI18n } from "@/composables";
import { useAccount } from "@/contexts/account-context";
import { useNavigatorContext } from "@/contexts/navigator";
import { cn } from "@/lib/utils";

interface SidebarItem {
  path: string;
  labelKey: string;
  icon: LucideIcon;
}

const PRIMARY_ITEMS: readonly SidebarItem[] = [
  {
    path: "/",
    labelKey: "Titlebar.menu.turnto.home",
    icon: House,
  },
  {
    path: "/live",
    labelKey: "Titlebar.menu.turnto.live",
    icon: Radio,
  },
  {
    path: "/favorites",
    labelKey: "Titlebar.menu.turnto.favorites",
    icon: Star,
  },
  {
    path: "/history",
    labelKey: "Titlebar.menu.turnto.history",
    icon: History,
  },
];

const SIDEBAR_ITEM_CLASS =
  "group relative flex h-14 w-full flex-col items-center justify-center gap-1.5 rounded-md px-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function itemIsActive(pathname: string, path: string) {
  if (path === "/") {
    return pathname === "/" || pathname.startsWith("/video/");
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function AppSidebar() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { navigator } = useNavigatorContext();
  const { snapshot, openAccountCenter } = useAccount();
  const authenticatedAccounts =
    snapshot?.platforms.filter((entry) => entry.status === "authenticated") ??
    [];
  const soleAccount =
    authenticatedAccounts.length === 1 ? authenticatedAccounts[0] : null;
  const accountLabel = soleAccount
    ? (soleAccount.profile?.name ?? t("Account.titlebar.authenticated"))
    : authenticatedAccounts.length > 1
      ? t("Account.titlebar.multiple")
      : t("Account.titlebar.login");

  return (
    <aside
      className="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full w-16 shrink-0 flex-col border-r select-none"
      aria-label={t("AppSidebar.label")}
    >
      <nav
        className="flex flex-col gap-1 p-1.5"
        aria-label={t("AppSidebar.primary")}
      >
        {PRIMARY_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = itemIsActive(pathname, item.path);
          const label = t(item.labelKey);

          return (
            <button
              key={item.path}
              type="button"
              className={cn(
                SIDEBAR_ITEM_CLASS,
                active && "bg-accent/80 text-foreground"
              )}
              aria-current={active ? "page" : undefined}
              title={label}
              onClick={() => navigator(item.path)}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 left-0 h-6 w-0.5 -translate-y-1/2 rounded-r-full bg-[var(--player-accent)]"
                />
              ) : null}
              <Icon className="size-[18px]" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-sidebar-border mt-auto flex flex-col gap-1 border-t p-1.5">
        <button
          type="button"
          className={cn(
            SIDEBAR_ITEM_CLASS,
            "hover:text-muted-foreground cursor-default opacity-45 hover:bg-transparent"
          )}
          aria-disabled="true"
          title={`${t("AppSidebar.info")} (${t("AppSidebar.placeholder")})`}
        >
          <Info className="size-[18px]" aria-hidden="true" />
          <span>{t("AppSidebar.info")}</span>
        </button>
        <button
          type="button"
          className={SIDEBAR_ITEM_CLASS}
          title={accountLabel}
          onClick={openAccountCenter}
        >
          <AccountAvatar
            src={soleAccount?.profile?.avatarUrl}
            className="size-[18px]"
            fallback={<UserRound className="size-[18px]" aria-hidden="true" />}
          />
          <span>{t("AppSidebar.user")}</span>
        </button>
      </div>
    </aside>
  );
}
