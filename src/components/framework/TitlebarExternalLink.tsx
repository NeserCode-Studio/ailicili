import { ExternalLink } from "lucide-react";

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
        <button
          type="button"
          aria-label={label}
          onClick={onOpen}
          className="titlebar-op"
        >
          <ExternalLink className="titlebar-op-icon" />
        </button>
      </Tooltip>
    </PageTitlebarActions>
  );
}
