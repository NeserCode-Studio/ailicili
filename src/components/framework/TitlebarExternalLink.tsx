import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import PageTitlebarActions from "@/components/framework/PageTitlebarActions";

interface TitlebarExternalLinkProps {
  label: string;
  onOpen: () => void;
}

export default function TitlebarExternalLink({
  label,
  onOpen,
}: TitlebarExternalLinkProps) {
  return (
    <PageTitlebarActions>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={label}
        title={label}
        onClick={onOpen}
        className="border-border bg-background/70 mr-1 h-6 gap-1.5 rounded-sm px-2 text-xs shadow-none"
      >
        <ExternalLink className="size-3.5" />
        <span className="hidden min-[900px]:inline">{label}</span>
      </Button>
    </PageTitlebarActions>
  );
}
