import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { usePageTitlebar } from "@/contexts/pageTitlebar";

export default function PageTitlebarActions({
  children,
}: {
  children: ReactNode;
}) {
  const { actionsTarget } = usePageTitlebar();
  return actionsTarget ? createPortal(children, actionsTarget) : null;
}
