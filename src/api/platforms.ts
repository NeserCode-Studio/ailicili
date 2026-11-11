import { invoke } from "@tauri-apps/api/core";

import type { PlatformId } from "@/api/media";

export type { PlatformId } from "@/api/media";

export type ContentKind = "video" | "live";
export type PlatformAvailability = "available" | "unavailable";
export type AccountMode = "none" | "optional";
export type LoginMethod = "qr" | "sms";

export interface AccountCapability {
  mode: AccountMode;
  loginMethods: LoginMethod[];
  supportsRefresh: boolean;
  supportsLogout: boolean;
  supportsDeviceReset: boolean;
}

export interface LiveCapability {
  supportsDiscovery: boolean;
  supportsSearch: boolean;
  supportsQualitySelection: boolean;
}

export interface PlatformDescriptor {
  id: PlatformId;
  displayName: string;
  contentKinds: ContentKind[];
  availability: PlatformAvailability;
  accountCapability: AccountCapability;
  liveCapability?: LiveCapability;
}

export async function getPlatformCatalog(): Promise<PlatformDescriptor[]> {
  return invoke("get_platform_catalog");
}
