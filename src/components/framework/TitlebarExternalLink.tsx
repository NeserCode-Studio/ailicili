import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import PageTitlebarActions from "@/components/framework/PageTitlebarActions";
import { Tooltip } from "@/components/framework/Tooltip";

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
      <Tooltip content={label}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          onClick={onOpen}
          className="border-border bg-background/70 mr-1 size-6 rounded-sm shadow-none"
        >
          <ExternalLink className="size-3.5" />
        </Button>
      </Tooltip>
    </PageTitlebarActions>
  );
}
