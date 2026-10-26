import { createContext, useContext, useEffect } from "react";

export interface PageTitlebarContextValue {
  pageTitle: string | null;
  setPageTitle: (title: string | null) => void;
  actionsTarget: HTMLDivElement | null;
  setActionsTarget: (target: HTMLDivElement | null) => void;
}

export const PageTitlebarContext = createContext<PageTitlebarContextValue>({
  pageTitle: null,
  setPageTitle: () => {},
  actionsTarget: null,
  setActionsTarget: () => {},
});

export function usePageTitlebar() {
  return useContext(PageTitlebarContext);
}

export function usePageTitlebarTitle(title?: string) {
  const { setPageTitle } = usePageTitlebar();

  useEffect(() => {
    setPageTitle(title?.trim() || null);
    return () => setPageTitle(null);
  }, [setPageTitle, title]);
}
