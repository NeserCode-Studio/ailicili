import { createContext, useContext } from "react";

import type {
  AccountCenterSnapshot,
  BilibiliAccount,
  CommandError,
  LoginCapabilities,
  PlatformAccountEntry,
} from "@/api/account";
import type {
  LoginMethod,
  PlatformDescriptor,
  PlatformId,
} from "@/api/platforms";

export interface AccountContextValue {
  account: BilibiliAccount | null;
  capabilities: LoginCapabilities | null;
  platformCatalog: PlatformDescriptor[];
  snapshot: AccountCenterSnapshot | null;
  accountsByPlatform: Readonly<Record<PlatformId, PlatformAccountEntry>>;
  accountRevisions: Readonly<Record<PlatformId, number>>;
  pendingPlatforms: ReadonlySet<PlatformId>;
  loading: boolean;
  error: CommandError | null;
  loginOpen: boolean;
  loginPlatformId: PlatformId | null;
  loginMethod: LoginMethod;
  openLogin: (platformId?: PlatformId, method?: LoginMethod) => void;
  closeLogin: () => void;
  setLoginMethod: (method: LoginMethod) => void;
  acceptAccount: (account: BilibiliAccount, platformId?: PlatformId) => void;
  reload: () => Promise<AccountCenterSnapshot | null>;
  refreshPlatform: (platformId: PlatformId) => Promise<AccountCenterSnapshot>;
  logoutPlatform: (platformId: PlatformId) => Promise<AccountCenterSnapshot>;
  resetPlatformDeviceIdentity: (platformId: PlatformId) => Promise<void>;
  refresh: () => Promise<BilibiliAccount>;
  logout: () => Promise<BilibiliAccount>;
  resetDeviceIdentity: () => Promise<void>;
  openAccountCenter: () => void;
}

export const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error("useAccount must be used within AccountProvider");
  }
  return context;
}
