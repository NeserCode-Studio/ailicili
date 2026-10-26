import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Crown,
  Library,
  LoaderCircle,
  LogOut,
  UserRound,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n, useToast } from "@/composables";
import { clearAccountScopedQueries } from "@/features/auth/accountQueries";
import { useAuthStatus } from "@/features/auth/useAuthStatus";
import { biliKeys, logoutBili } from "@/lib/bili";
import type { AuthStatus } from "@/shared/bili.types";

export default function AccountMenu() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authQuery = useAuthStatus();
  const { error: showError } = useToast();
  const logoutMutation = useMutation({
    mutationFn: logoutBili,
    onSuccess: () => {
      clearAccountScopedQueries(queryClient);
      queryClient.setQueryData<AuthStatus>(biliKeys.auth(), {
        authenticated: false,
        storageAvailable: authQuery.data?.storageAvailable ?? true,
        profile: null,
      });
    },
    onError: () => showError("Auth.logout.error"),
  });

  if (authQuery.isPending) {
    return (
      <div className="text-muted-foreground flex h-10 items-center gap-3 px-3">
        <LoaderCircle className="size-4 animate-spin" />
        <span className="app-sidebar-label text-sm">{t("Auth.loading")}</span>
      </div>
    );
  }

  const profile = authQuery.data?.profile;
  if (!profile) {
    return (
      <NavLink
        to="/login"
        aria-label={t("Auth.signIn")}
        title={t("Auth.signIn")}
        className={({ isActive }) =>
          [
            "text-muted-foreground hover:bg-muted hover:text-foreground flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
            isActive && "bg-muted text-foreground",
          ]
            .filter(Boolean)
            .join(" ")
        }
      >
        <UserRound className="size-4 shrink-0" />
        <span className="app-sidebar-label truncate">{t("Auth.signIn")}</span>
      </NavLink>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("Auth.accountMenu")}
          title={profile.name}
          className="hover:bg-muted flex h-11 w-full items-center gap-3 rounded-md px-2 text-left transition-colors"
        >
          <Avatar className="size-7 border">
            <AvatarImage
              src={profile.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
            <AvatarFallback>
              {profile.name.trim().charAt(0) || "U"}
            </AvatarFallback>
          </Avatar>
          <span className="app-sidebar-label min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {profile.name}
            </span>
            <span className="text-muted-foreground block truncate text-[11px] tabular-nums">
              UID {profile.mid}
            </span>
          </span>
          <ChevronRight className="app-sidebar-label text-muted-foreground size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          <Avatar className="size-9 border">
            <AvatarImage
              src={profile.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
            <AvatarFallback>
              {profile.name.trim().charAt(0) || "U"}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{profile.name}</span>
            <span className="text-muted-foreground flex items-center gap-1 text-xs font-normal">
              LV{profile.level}
              {profile.vipStatus && (
                <>
                  <Crown className="size-3" />
                  {profile.vipLabel || t("Auth.vip")}
                </>
              )}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/library")}>
          <Library />
          {t("Nav.library")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/dynamics")}>
          <UserRound />
          {t("Nav.dynamics")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(`/space/${profile.mid}`)}>
          <UserRound />
          {t("Auth.openProfile")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={logoutMutation.isPending}
          onSelect={() => logoutMutation.mutate()}
        >
          {logoutMutation.isPending ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <LogOut />
          )}
          {t("Auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
