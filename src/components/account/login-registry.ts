import type { ComponentType } from "react";

import type { PlatformDescriptor, PlatformId } from "@/api/platforms";
import BilibiliLoginDialog from "@/components/account/BilibiliLoginDialog";

export interface PlatformLoginDialogProps {
  platform: PlatformDescriptor;
}

const loginDialogs: Partial<
  Record<PlatformId, ComponentType<PlatformLoginDialogProps>>
> = {
  bilibili: BilibiliLoginDialog,
};

export function resolveLoginDialog(
  platformId: PlatformId
): ComponentType<PlatformLoginDialogProps> | undefined {
  return loginDialogs[platformId];
}
