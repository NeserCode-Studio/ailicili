import { createContext, useContext } from "react";

export type SettingsTab = "search" | "general" | "account";

export interface SettingsDialogContextValue {
  openSettings: (tab?: SettingsTab) => void;
  openAbout: () => void;
}

export const SettingsDialogContext = createContext<SettingsDialogContextValue>({
  openSettings: () => {},
  openAbout: () => {},
});

export function useSettingsDialog() {
  return useContext(SettingsDialogContext);
}
