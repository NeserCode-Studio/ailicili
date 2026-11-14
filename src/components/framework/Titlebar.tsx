import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";

import TitlebarOperations, {
  ThemeIcon,
} from "@/components/framework/TitlebarOperations";
import { useContext } from "react";
import { ThemeContext } from "@/contexts/theme";
import { NavigatorContext } from "@/contexts/navigator";
import TitlebarTitle from "./TitlebarTitle";
import { useI18n } from "@/composables";
import { useSettingsDialog } from "@/contexts/settings";
import * as editorActions from "@/lib/editor.actions";

export default function Titlebar() {
  /* I18n */
  const { t } = useI18n();
  /* Theme */
  const { theme, setThemeMode } = useContext(ThemeContext);
  /* Navigator */
  const { navigator } = useContext(NavigatorContext);
  const { openSettings, openAbout } = useSettingsDialog();

  function toggleTheme() {
    if (theme === "dark") {
      setThemeMode("light");
    } else {
      setThemeMode("dark");
    }
  }

  return (
    <div
      className="fixed top-0 z-50 grid h-8 w-screen grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-neutral-400 bg-white pl-2 shadow-sm transition-colors duration-100 ease-in-out dark:border-neutral-600 dark:bg-black"
      data-tauri-drag-region
    >
      <Menubar className="h-6 w-fit gap-1 rounded-none border-0 bg-transparent p-0 text-neutral-600 shadow-none transition-colors duration-100 ease-in-out dark:text-neutral-200">
        <MenubarMenu>
          <MenubarTrigger className="h-full w-fit px-2 text-sm">
            {t("Titlebar.menu.turnto")}
          </MenubarTrigger>
          <MenubarContent className="w-fit transition-all duration-100 ease-in-out">
            <MenubarItem
              onSelect={() => {
                navigator("/");
              }}
            >
              {t("Titlebar.menu.turnto.home")}
            </MenubarItem>
            <MenubarItem
              onSelect={() => {
                navigator("/live");
              }}
            >
              {t("Titlebar.menu.turnto.live")}
            </MenubarItem>
            <MenubarItem
              onSelect={() => {
                navigator("/favorites");
              }}
            >
              {t("Titlebar.menu.turnto.favorites")}
            </MenubarItem>
            <MenubarItem
              onSelect={() => {
                navigator("/history");
              }}
            >
              {t("Titlebar.menu.turnto.history")}
            </MenubarItem>
            <MenubarItem
              onSelect={() => {
                openSettings();
              }}
            >
              {t("Titlebar.menu.turnto.settings")}
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={toggleTheme}>
              {t("Titlebar.menu.turnto.theme")}
              <ThemeIcon />
            </MenubarItem>
            <MenubarItem>{t("Titlebar.menu.turnto.exit")}</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="h-full w-fit px-2 text-sm">
            {t("Titlebar.menu.edit")}
          </MenubarTrigger>
          <MenubarContent className="w-fit transition-all duration-100 ease-in-out">
            <MenubarItem onSelect={editorActions.undo}>
              {t("Titlebar.menu.edit.undo")}
              <MenubarShortcut>Ctrl+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={editorActions.redo}>
              {t("Titlebar.menu.edit.redo")}
              <MenubarShortcut>Ctrl+Shift+Z</MenubarShortcut>
            </MenubarItem>

            <MenubarSeparator />

            <MenubarItem onSelect={editorActions.cut}>
              {t("Titlebar.menu.edit.cut")}
              <MenubarShortcut>Ctrl+X</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={editorActions.copy}>
              {t("Titlebar.menu.edit.copy")}
              <MenubarShortcut>Ctrl+C</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={() => void editorActions.paste()}>
              {t("Titlebar.menu.edit.paste")}
              <MenubarShortcut>Ctrl+V</MenubarShortcut>
            </MenubarItem>

            <MenubarSeparator />

            <MenubarItem onSelect={editorActions.selectAll}>
              {t("Titlebar.menu.edit.selectAll")}
              <MenubarShortcut>Ctrl+A</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={editorActions.find}>
              {t("Titlebar.menu.edit.find")}
              <MenubarShortcut>Ctrl+K</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="h-full w-fit px-2 text-sm">
            {t("Titlebar.menu.help")}
          </MenubarTrigger>
          <MenubarContent className="w-fit transition-all duration-100 ease-in-out">
            <MenubarItem
              onSelect={() => {
                navigator("/framework");
              }}
            >
              {t("Titlebar.menu.about.framework")}
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={openAbout}>
              {t("Titlebar.menu.about")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <div
        className="flex min-w-0 items-center justify-center px-2"
        data-tauri-drag-region
      >
        <TitlebarTitle data-tauri-drag-region />
      </div>

      <div className="flex shrink-0 items-center gap-1 self-stretch">
        <TitlebarOperations />
      </div>
    </div>
  );
}
