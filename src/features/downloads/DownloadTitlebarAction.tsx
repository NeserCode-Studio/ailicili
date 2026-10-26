import { useState } from "react";
import { Download } from "lucide-react";

import PageTitlebarActions from "@/components/framework/PageTitlebarActions";
import { Tooltip } from "@/components/framework/Tooltip";
import { useI18n } from "@/composables";
import DownloadDialog from "@/features/downloads/DownloadDialog";

interface DownloadTitlebarActionProps {
  bvid: string;
  cid: number;
  partTitle: string;
}

export default function DownloadTitlebarAction({
  bvid,
  cid,
  partTitle,
}: DownloadTitlebarActionProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!bvid || cid <= 0) return null;

  const label = t("Download.dialog.title");
  return (
    <>
      <PageTitlebarActions>
        <Tooltip content={label}>
          <button
            type="button"
            aria-label={label}
            onClick={() => setOpen(true)}
            className="titlebar-op"
          >
            <Download className="titlebar-op-icon" />
          </button>
        </Tooltip>
      </PageTitlebarActions>
      <DownloadDialog
        open={open}
        onOpenChange={setOpen}
        bvid={bvid}
        cid={cid}
        partTitle={partTitle}
      />
    </>
  );
}
