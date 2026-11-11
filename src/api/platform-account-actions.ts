import { resetPlatformDeviceIdentity } from "@/api/account";
import type { PlatformId } from "@/api/platforms";

type PlatformAction = () => Promise<void>;

export function resolveDeviceIdentityReset(
  platformId: PlatformId
): PlatformAction | undefined {
  return () => resetPlatformDeviceIdentity(platformId);
}
