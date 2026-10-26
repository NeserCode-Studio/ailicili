import "./App.css";

import { Toaster } from "@/components/ui/sonner";
import { useNavigate } from "react-router";

import { useTheme, useI18nLogic } from "@/composables";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { useLocalStorageState } from "ahooks";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { WindowUtils } from "@/lib/window.utils";

import { ThemeContext } from "@/contexts/theme";
import { NavigatorContext } from "@/contexts/navigator";
import { TitleContext } from "@/contexts/title";
import { I18nContext } from "@/contexts/i18n";
import { lifecycle } from "@/lifecycle";
import SettingsDialog from "@/components/framework/SettingsDialog";
import AboutDialog from "@/components/framework/AboutDialog";
import PageTitlebarProvider from "@/components/framework/PageTitlebarProvider";
import { SettingsDialogContext } from "@/contexts/settings";
import { createLogger } from "@/lib/logger";
import AppShell from "@/app/AppShell";
import AppRoutes from "@/app/AppRoutes";
import PlayerWindowShell from "@/app/PlayerWindowShell";

const log = createLogger("App");

const TrayMenu = lazy(() => import("@/views/TrayMenu"));

/**
 * 应用就绪钩子：主窗口显示并聚焦。
 *
 * 注册在模块作用域而非 useEffect —— effect 的清理函数会在 fire 完成前
 * 被 React 调用（async 函数体在第一个 await 前是同步的），导致钩子被提前
 * 卸载、从未执行。托盘窗口跳过逻辑放在 run 内部。
 */
const $windowMain = new WindowUtils("main");
lifecycle.register({
  id: "window.render-focus",
  stage: "ready",
  once: true,
  run: () => {
    if (["tray", "player"].includes(getCurrentWindow().label)) return;
    return $windowMain.renderFocus();
  },
});

function App() {
  /* I18n */
  const { lang, t, setLanguage } = useI18nLogic();
  /* Navigator */
  const navigate = useNavigate();
  /* Theme */
  const [theme, setThemeMode] = useTheme({
    localStorageKey: "theme-mode",
  });
  /* Title */
  const [title, setTitle] = useLocalStorageState("ailicili:app-title", {
    defaultValue: t("Titlebar.default.title"),
  });

  /* Detect current window */
  const currentLabel = getCurrentWindow().label;

  /* 弹窗状态 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const [aboutOpen, setAboutOpen] = useState(false);
  const openAbout = useCallback(() => setAboutOpen(true), []);

  /* 生命周期阶段只触发一次（StrictMode 下 effect 会 double-invoke）
     注册在模块作用域，此处只负责按序触发。 */
  const firedRef = useRef(false);

  /* 挂载完成后依次触发 mount → ready
     两者放在同一个 effect 内按序 fire，保证阶段顺序；
     ready 触发的窗口聚焦等动作此时 React 已挂载完成。 */
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    void lifecycle.fire("mount").then(() => lifecycle.fire("ready"));
  }, []);

  useEffect(() => {
    if (currentLabel !== "main") return;

    const unlistenPopup = listen<{ x: number; y: number }>(
      "tray-popup",
      async (event) => {
        const trayWindow = await WindowUtils.getWindowByLabel("tray");
        if (!trayWindow) {
          log.warn("tray-popup: tray window not found");
          return;
        }
        const size = await trayWindow.outerSize();
        const x = Math.round(event.payload.x - size.width / 2);
        const y = Math.max(0, Math.round(event.payload.y - size.height));
        await trayWindow.setPosition(new PhysicalPosition(x, y));
        await trayWindow.show();
        await trayWindow.setFocus();
        log.info("tray menu popped", { x, y });
      }
    );

    const unlistenNavigate = listen<string>("navigate", (event) => {
      const target = event.payload;
      log.info("navigate event", target);
      if (target === "/settings") {
        openSettings();
      } else if (target === "/about") {
        openAbout();
      } else {
        navigate(target);
      }
    });

    return () => {
      void unlistenPopup.then((fn) => fn());
      void unlistenNavigate.then((fn) => fn());
    };
  }, [navigate, currentLabel, openSettings, openAbout]);

  useEffect(() => {
    if (currentLabel !== "player") return;
    const unlisten = listen<string>("player-navigate", (event) => {
      navigate(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [navigate, currentLabel]);

  /* 固定 Context value 引用，避免任意状态变化导致所有消费者全量重渲染 */
  const i18nValue = useMemo(
    () => ({ lang, t, setLang: setLanguage }),
    [lang, t, setLanguage]
  );
  const themeValue = useMemo(
    () => ({ theme, setThemeMode }),
    [theme, setThemeMode]
  );
  const titleValue = useMemo(() => ({ title, setTitle }), [title, setTitle]);
  const navigatorValue = useMemo(() => ({ navigator: navigate }), [navigate]);
  const settingsValue = useMemo(
    () => ({ openSettings, openAbout }),
    [openSettings, openAbout]
  );

  if (currentLabel === "tray") {
    return (
      <I18nContext.Provider value={i18nValue}>
        <ThemeContext.Provider value={themeValue}>
          <Suspense fallback={null}>
            <TrayMenu />
          </Suspense>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    );
  }

  if (currentLabel === "player") {
    return (
      <I18nContext.Provider value={i18nValue}>
        <ThemeContext.Provider value={themeValue}>
          <PageTitlebarProvider>
            <PlayerWindowShell>
              <AppRoutes />
            </PlayerWindowShell>
          </PageTitlebarProvider>
          <Toaster richColors theme={theme} position="bottom-right" />
        </ThemeContext.Provider>
      </I18nContext.Provider>
    );
  }

  return (
    <>
      <SettingsDialogContext.Provider value={settingsValue}>
        <I18nContext.Provider value={i18nValue}>
          <ThemeContext.Provider value={themeValue}>
            <TitleContext.Provider value={titleValue}>
              <NavigatorContext.Provider value={navigatorValue}>
                <PageTitlebarProvider>
                  <AppShell>
                    <AppRoutes />
                  </AppShell>
                  <SettingsDialog
                    open={settingsOpen}
                    onOpenChange={setSettingsOpen}
                  />
                  <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
                  <Toaster richColors theme={theme} position="bottom-right" />
                </PageTitlebarProvider>
              </NavigatorContext.Provider>
            </TitleContext.Provider>
          </ThemeContext.Provider>
        </I18nContext.Provider>
      </SettingsDialogContext.Provider>
    </>
  );
}

export { App };
