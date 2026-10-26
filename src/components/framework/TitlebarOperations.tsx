import { Tooltip } from "./Tooltip";

import { Minus, X, Sun, Moon, Paperclip, Square, Copy } from "lucide-react";
import { ThemeContext } from "@/contexts/theme";
import { Separator } from "../ui/separator";
import { useContext, useEffect, useState } from "react";
import { useLocalStorageState } from "ahooks";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useI18n } from "@/composables";
import { usePageTitlebar } from "@/contexts/pageTitlebar";
import { WindowUtils } from "@/lib/window.utils";
import { createLogger } from "@/lib/logger";

const log = createLogger("Titlebar");

const currentWindow = getCurrentWindow();

export function ThemeIcon() {
  const { theme } = useContext(ThemeContext);

  if (theme === "dark") {
    return <Sun className="titlebar-op-icon" />;
  } else {
    return <Moon className="titlebar-op-icon" />;
  }
}

/** 最大化状态变化时的图标 */
export function MaximizeIcon({ maximized }: { maximized: boolean }) {
  return maximized ? (
    <Copy className="titlebar-op-icon" />
  ) : (
    <Square className="titlebar-op-icon" />
  );
}

async function handleOperation(operation: "minimize" | "close") {
  switch (operation) {
    case "minimize":
      await currentWindow.minimize();
      break;
    case "close":
      if (currentWindow.label === "player") {
        await currentWindow.close();
      } else {
        await WindowUtils.windowsQuit();
      }
      break;
  }
}

/** 切换最大化；返回切换后的状态 */
async function toggleMaximize(): Promise<boolean> {
  const maximized = await currentWindow.isMaximized().catch(() => false);
  if (maximized) {
    await currentWindow.unmaximize();
  } else {
    await currentWindow.maximize();
  }
  const next = await currentWindow.isMaximized().catch(() => false);
  log.debug("toggleMaximize ->", next ? "maximized" : "restored");
  return next;
}

export default function TitlebarOperations() {
  const { t } = useI18n();
  const { theme, setThemeMode } = useContext(ThemeContext);
  const { setActionsTarget } = usePageTitlebar();
  const [alwaysOnTop, setAlwaysOnTop] = useLocalStorageState(
    "app-always-on-top",
    {
      defaultValue: false,
    }
  );
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    currentWindow.setAlwaysOnTop(alwaysOnTop ?? false);
  }, [alwaysOnTop]);

  /* 同步最大化状态：覆盖双击标题栏、系统快捷键、外部 resize 等场景 */
  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      const value = await currentWindow.isMaximized().catch(() => false);
      if (!cancelled) setMaximized(value);
    };

    void sync();
    const unlisten = currentWindow.onResized(() => {
      void sync();
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <>
      <div className="inline-flex h-full w-fit flex-row items-center justify-center">
        <div
          ref={setActionsTarget}
          data-testid="titlebar-page-actions"
          className="flex h-full items-center"
        />
        <Separator
          orientation="vertical"
          className="bg-border mx-0.5 h-1/2 rounded transition-colors duration-100 ease-in-out"
        />
        <Tooltip content={t("Titlebar.operations.always-on-top.tooltip")}>
          <span
            className={alwaysOnTop ? "titlebar-op is-pinned" : "titlebar-op"}
            onMouseUp={() => {
              const next = !alwaysOnTop;
              setAlwaysOnTop(next);
              void currentWindow.setAlwaysOnTop(next);
            }}
          >
            <Paperclip className="titlebar-op-icon" />
          </span>
        </Tooltip>
        <Tooltip content={t("Titlebar.operations.theme.tooltip")}>
          <span
            className="titlebar-op"
            onMouseUp={() => {
              setThemeMode(theme === "dark" ? "light" : "dark");
            }}
          >
            <ThemeIcon />
          </span>
        </Tooltip>
        <Tooltip content={t("Titlebar.operations.minimize.tooltip")}>
          <span
            className="titlebar-op"
            onMouseUp={() => {
              handleOperation("minimize");
            }}
          >
            <Minus className="titlebar-op-icon" />
          </span>
        </Tooltip>
        <Tooltip
          content={t(
            maximized
              ? "Titlebar.operations.restore.tooltip"
              : "Titlebar.operations.maximize.tooltip"
          )}
        >
          <span
            className="titlebar-op"
            onMouseUp={() => {
              void toggleMaximize().then(setMaximized);
            }}
          >
            <MaximizeIcon maximized={maximized} />
          </span>
        </Tooltip>
        <Tooltip content={t("Titlebar.operations.close.tooltip")}>
          <span
            className="titlebar-op titlebar-op-close"
            onMouseUp={() => {
              handleOperation("close");
            }}
          >
            <X className="titlebar-op-icon" />
          </span>
        </Tooltip>
      </div>
    </>
  );
}
