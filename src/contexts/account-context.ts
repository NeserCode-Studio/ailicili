import { createContext, useContext } from "react";

import type {
  BilibiliAccount,
  CommandError,
  LoginCapabilities,
} from "@/api/account";

export type LoginMethod = "qr" | "sms";

export interface AccountContextValue {
  account: BilibiliAccount | null;
  capabilities: LoginCapabilities | null;
  loading: boolean;
  error: CommandError | null;
  loginOpen: boolean;
  loginMethod: LoginMethod;
  openLogin: (method?: LoginMethod) => void;
  closeLogin: () => void;
  setLoginMethod: (method: LoginMethod) => void;
  acceptAccount: (account: BilibiliAccount) => void;
  refresh: () => Promise<BilibiliAccount>;
  logout: () => Promise<BilibiliAccount>;
  resetDeviceIdentity: () => Promise<void>;
}

export const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error("useAccount must be used within AccountProvider");
  }
  return context;
}
