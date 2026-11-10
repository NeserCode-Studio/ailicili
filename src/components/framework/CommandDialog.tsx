import * as React from "react";
import {
  History,
  Home,
  RefreshCcw,
  Settings,
  Sparkles,
  Star,
} from "lucide-react";
import { useMemoizedFn } from "ahooks";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

import { NavigatorContext } from "@/contexts/navigator";
import { useI18n, useSuperCommand } from "@/composables";
import { I18nContext } from "@/contexts/i18n";
import { ThemeContext } from "@/contexts/theme";
import { useSettingsDialog } from "@/contexts/settings";

const SUPER_PREFIX = "@super";
const SUPER_CMD = "super";

interface CommonItem {
  value: string;
  icon: React.ElementType;
  label: string;
  shortcut?: string;
  keywords: string[];
}

export default function CommandMenu() {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const { navigator } = React.useContext(NavigatorContext);
  const { openSettings } = useSettingsDialog();
  const i18nCtx = React.useContext(I18nContext);
  const setLang = i18nCtx?.setLang ?? (() => {});
  const { setThemeMode } = React.useContext(ThemeContext) ?? {};
  const setTheme = setThemeMode ?? (() => {});

  // cmdk 搜索值
  const [cmdkSearch, setCmdkSearch] = React.useState("");

  const superCmd = useSuperCommand({
    navigate: navigator,
    setLang,
    setTheme,
    openSettings,
  });

  // ── Super 模式判定 ────────────────────────────────────────
  const isSuperMode = cmdkSearch.startsWith(SUPER_PREFIX + " ");
  const superQuery = isSuperMode
    ? cmdkSearch
        .slice(SUPER_PREFIX.length + 1)
        .trim()
        .toLowerCase()
    : "";
  const superResults = isSuperMode
    ? superQuery
      ? superCmd.commands.filter(
          (cmd) =>
            cmd.id.toLowerCase().includes(superQuery) ||
            cmd.keywords.some((k) => k.toLowerCase().includes(superQuery))
        )
      : superCmd.commands
    : [];

  // ── 普通命令 ──────────────────────────────────────────────
  const commonItems: CommonItem[] = [
    {
      value: "navigate::/",
      icon: Home,
      label: t("Command.turnto.home"),
      shortcut: "⌘H",
      keywords: ["home", "index", "首页", "主页"],
    },
    {
      value: "settings::open",
      icon: Settings,
      label: t("Command.turnto.settings"),
      shortcut: "⌘S",
      keywords: ["settings", "设置", "配置", "选项", "preferences"],
    },
    {
      value: "navigate::/favorites",
      icon: Star,
      label: t("Command.turnto.favorites"),
      keywords: ["favorites", "收藏", "saved"],
    },
    {
      value: "navigate::/history",
      icon: History,
      label: t("Command.turnto.history"),
      keywords: ["history", "历史", "recent", "continue"],
    },
    {
      value: "reload",
      icon: RefreshCcw,
      label: t("Command.suggestions.reload"),
      keywords: ["reload", "refresh", "重新加载", "刷新"],
    },
  ];

  // ── 命令选择 ──────────────────────────────────────────────
  function handleSelect(command: string) {
    if (isSuperMode) {
      // Super 模式：根据 superQuery 匹配执行，不依赖 command 参数
      if (superResults.length === 1) {
        superCmd.execute(superResults[0].id);
      }
      // 0 或多条匹配：不执行（秘密命令，无提示）
      setOpen(false);
      setCmdkSearch("");
      return;
    }

    const [symbol, value] = command.split("::");

    if (symbol === "navigate") {
      navigator(value);
    } else if (symbol === "settings") {
      openSettings();
    } else if (symbol === "reload") {
      navigator("/");
      window.location.reload();
    } else if (symbol === SUPER_CMD) {
      const item = superCmd.commands.find((c) => c.id === value);
      if (!item) return;
      superCmd.execute(item.id);
    }

    setOpen(false);
    setCmdkSearch("");
  }

  const handleInputChange = useMemoizedFn((val: string) => setCmdkSearch(val));

  const openShortcut = useMemoizedFn((e: KeyboardEvent) => {
    if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setOpen((prev) => !prev);
      setCmdkSearch("");
    }
  });

  React.useEffect(() => {
    document.addEventListener("keydown", openShortcut);
    return () => document.removeEventListener("keydown", openShortcut);
  }, [openShortcut]);

  /* 标题栏「编辑 > 查找」通过自定义事件打开命令面板 */
  React.useEffect(() => {
    const handler = () => {
      setOpen(true);
      setCmdkSearch("");
    };
    window.addEventListener("app:open-command-palette", handler);
    return () =>
      window.removeEventListener("app:open-command-palette", handler);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        value={cmdkSearch}
        onValueChange={handleInputChange}
        placeholder={t("Command.placeholder")}
      />
      <CommandList>
        {isSuperMode ? (
          // ── Super 模式：只显示一条占位符，不暴露具体命令 ──
          <>
            <CommandEmpty>{t("Command.super.empty")}</CommandEmpty>
            <CommandGroup heading={t("Command.super.heading")}>
              <CommandItem
                // value 设为 cmdkSearch，确保 cmdk 默认 filter 永远匹配
                value={cmdkSearch}
                onSelect={handleSelect}
              >
                <Sparkles className="icon-md mr-2" />
                <span>{SUPER_PREFIX}</span>
              </CommandItem>
            </CommandGroup>
          </>
        ) : (
          // ── 普通模式：正常展示 ──────────────────────────────
          <>
            <CommandEmpty>{t("Command.notFound")}</CommandEmpty>
            <CommandGroup heading={t("Command.suggestions")}>
              {commonItems.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.value}
                  onSelect={handleSelect}
                  keywords={item.keywords}
                >
                  <item.icon className="icon-md mr-2" />
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <CommandShortcut>{item.shortcut}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
