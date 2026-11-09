import { invoke } from "@tauri-apps/api/core";

export interface CommandError {
  code: string;
  message: string;
  action?: string;
}

export type AccountStatus =
  "anonymous" | "authenticated" | "expired" | "locked";

export interface AccountProfile {
  mid: number;
  name: string;
  avatarUrl?: string;
  level?: number;
  vip: boolean;
}

export interface BilibiliAccount {
  status: AccountStatus;
  profile?: AccountProfile;
  messageCode?: string;
}

export interface LoginCapabilities {
  credentialStorageAvailable: boolean;
  qrAvailable: boolean;
  smsAvailable: boolean;
}

export type QrLoginStatus =
  "pending" | "scanned" | "expired" | "succeeded" | "failed";

export interface QrLoginStart {
  loginId: string;
  imageDataUrl: string;
  expiresInSeconds: number;
}

export interface QrLoginPoll {
  loginId: string;
  status: QrLoginStatus;
  account?: BilibiliAccount;
  messageCode?: string;
}

export type CaptchaProvider = "geetest" | "tencent";

export interface SmsChallenge {
  challengeId: string;
  provider: CaptchaProvider;
  gt?: string;
  challenge?: string;
  tencentAppId?: string;
  expiresInSeconds: number;
}

export interface SmsCodeSent {
  smsFlowId: string;
  retryAfterSeconds: number;
  expiresInSeconds: number;
}

export function asCommandError(error: unknown): CommandError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return {
      code: error.code,
      message:
        "message" in error && typeof error.message === "string"
          ? error.message
          : "",
      action:
        "action" in error && typeof error.action === "string"
          ? error.action
          : undefined,
    };
  }
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function getBilibiliLoginCapabilities(): Promise<LoginCapabilities> {
  return invoke("get_bilibili_login_capabilities");
}

export async function getBilibiliAccount(): Promise<BilibiliAccount> {
  return invoke("get_bilibili_account");
}

export async function refreshBilibiliAccount(): Promise<BilibiliAccount> {
  return invoke("refresh_bilibili_account");
}

export async function startBilibiliQrLogin(): Promise<QrLoginStart> {
  return invoke("start_bilibili_qr_login");
}

export async function pollBilibiliQrLogin(
  loginId: string
): Promise<QrLoginPoll> {
  return invoke("poll_bilibili_qr_login", { loginId });
}

export async function cancelBilibiliQrLogin(loginId: string): Promise<void> {
  return invoke("cancel_bilibili_qr_login", { loginId });
}

export async function createBilibiliSmsChallenge(): Promise<SmsChallenge> {
  return invoke("create_bilibili_sms_challenge");
}

export async function sendBilibiliSmsCode(
  challengeId: string,
  countryCode: string,
  phone: string,
  challenge: string,
  validate: string,
  seccode: string
): Promise<SmsCodeSent> {
  return invoke("send_bilibili_sms_code", {
    challengeId,
    countryCode,
    phone,
    challenge,
    validate,
    seccode,
  });
}

export async function loginBilibiliWithSms(
  smsFlowId: string,
  code: string
): Promise<BilibiliAccount> {
  return invoke("login_bilibili_with_sms", { smsFlowId, code });
}

export async function cancelBilibiliSmsLogin(
  challengeId?: string,
  smsFlowId?: string
): Promise<void> {
  return invoke("cancel_bilibili_sms_login", {
    challengeId: challengeId ?? null,
    smsFlowId: smsFlowId ?? null,
  });
}

export async function logoutBilibili(): Promise<BilibiliAccount> {
  return invoke("logout_bilibili");
}

export async function resetBilibiliDeviceIdentity(): Promise<void> {
  return invoke("reset_bilibili_device_identity");
}
