import { useEffect, useState, type ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";

interface RetainedRouteProps {
  active: boolean;
  children: ReactNode;
}

export default function RetainedRoute({
  active,
  children,
}: RetainedRouteProps) {
  const [visited, setVisited] = useState(active);

  useEffect(() => {
    if (active && !visited) setVisited(true);
  }, [active, visited]);

  if (!active && !visited) return null;

  return (
    <div hidden={!active} className="h-full min-h-0 w-full">
      <ScrollArea className="h-full w-full">{children}</ScrollArea>
    </div>
  );
}
