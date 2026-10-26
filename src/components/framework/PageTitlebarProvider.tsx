import { useMemo, useState, type PropsWithChildren } from "react";

import { PageTitlebarContext } from "@/contexts/pageTitlebar";

export default function PageTitlebarProvider({ children }: PropsWithChildren) {
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(
    null
  );
  const value = useMemo(
    () => ({ pageTitle, setPageTitle, actionsTarget, setActionsTarget }),
    [pageTitle, actionsTarget]
  );

  return (
    <PageTitlebarContext.Provider value={value}>
      {children}
    </PageTitlebarContext.Provider>
  );
}
