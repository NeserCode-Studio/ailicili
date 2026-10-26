import { useContext, useEffect, useCallback, useRef } from "react";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";

import { useI18n } from "@/composables";
import { ThemeContext } from "@/contexts/theme";
import { WindowUtils } from "@/lib/window.utils";

import { Download, Info, Settings, LogOut } from "lucide-react";

type MenuAction = "downloads" | "about" | "settings" | "quit";

const menuItems: { action: MenuAction; icon: typeof Info; labelKey: string }[] = [
  { action: "downloads", icon: Download, labelKey: "Tray.menu.downloads" },
  { action: "about", icon: Info, labelKey: "Tray.menu.about" },
  { action: "settings", icon: Settings, labelKey: "Tray.menu.settings" },
  { action: "quit", icon: LogOut, labelKey: "Tray.menu.quit" },
];

export default function TrayMenu() {
  const { t } = useI18n();
  const { theme } = useContext(ThemeContext);
  const trayWin = useRef(getCurrentWindow());
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const win = trayWin.current;
    win.hide();

    if (menuRef.current) {
      const h = menuRef.current.scrollHeight;
      if (h > 0) win.setSize(new PhysicalSize(220, h));
    }

    const onBlur = () => { win.hide(); };
    window.addEventListener("blur", onBlur);

    const unlisten = win.onFocusChanged((focused) => {
      if (!focused) onBlur();
    });
    return () => {
      window.removeEventListener("blur", onBlur);
      unlisten.then((fn) => fn?.());
    };
  }, []);

  const handleAction = useCallback(async (action: MenuAction) => {
    const win = trayWin.current;
    switch (action) {
      case "downloads": {
        const mainWin = await WindowUtils.getWindowByLabel("main");
        if (mainWin) await mainWin.emit("navigate", "/downloads");
        await WindowUtils.showAndFocus("main");
        break;
      }
      case "about": {
        const mainWin = await WindowUtils.getWindowByLabel("main");
        if (mainWin) await mainWin.emit("navigate", "/about");
        await WindowUtils.showAndFocus("main");
        break;
      }
      case "settings": {
        const mainWin = await WindowUtils.getWindowByLabel("main");
        if (mainWin) await mainWin.emit("navigate", "/settings");
        await WindowUtils.showAndFocus("main");
        break;
      }
      case "quit": {
        await WindowUtils.windowsQuit();
        break;
      }
    }
    await win.hide();
  }, []);

  return (
    <div
      ref={menuRef}
      className={`w-full select-none ${
        theme === "dark" ? "bg-[#1e1e1e] text-[#cccccc]" : "bg-white text-[#333333]"
      }`}
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
    >
      <div className="py-1">
        {menuItems.map((item, index) => {
          const Icon = item.icon;
          const isLast = index === menuItems.length - 1;
          return (
            <div key={item.action}>
              <button
                onClick={() => handleAction(item.action)}
                className={`flex items-center gap-3 w-full px-3 py-2 text-sm transition-colors ${
                  theme === "dark"
                    ? "hover:bg-[#264f78] hover:text-white"
                    : "hover:bg-[#e8f0fe] hover:text-[#1a73e8]"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{t(item.labelKey)}</span>
              </button>
              {index === 0 && !isLast && (
                <div
                  className={`mx-3 my-1 h-px ${
                    theme === "dark" ? "bg-[#333333]" : "bg-[#e0e0e0]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
