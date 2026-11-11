import type { CommandError } from "@/api/account";

const ERROR_KEYS: Record<string, string> = {
  accountUnavailable: "Account.errors.accountUnavailable",
  authRequired: "Account.errors.authRequired",
  bilibiliApiError: "Account.errors.bilibiliApiError",
  captchaUnavailable: "Account.errors.captchaUnavailable",
  credentialStoreError: "Account.errors.credentialStoreError",
  invalidResponse: "Account.errors.invalidResponse",
  loginExpired: "Account.errors.loginExpired",
  liveContentUnavailable: "Live.room.contentUnavailable",
  networkError: "Account.errors.networkError",
  noCompatibleStream: "Account.errors.noCompatibleStream",
  playbackError: "Account.errors.playbackError",
  platformUnavailable: "Account.errors.platformUnavailable",
  rateLimited: "Account.errors.rateLimited",
  riskControl: "Account.errors.riskControl",
  smsCodeExpired: "Account.errors.smsCodeExpired",
  smsCodeInvalid: "Account.errors.smsCodeInvalid",
  smsRequestInvalid: "Account.errors.smsRequestInvalid",
  storageError: "Account.errors.storageError",
  unknown: "Account.errors.unknown",
};

export function commandErrorKey(error: CommandError): string {
  const normalized = error.code.split(":")[0];
  return ERROR_KEYS[normalized] ?? "Account.errors.unknown";
}

export function commandErrorMessage(
  error: CommandError,
  translate: (key: string) => string
): string {
  const key = commandErrorKey(error);
  const value = translate(key);
  return value === key ? translate("Account.errors.unknown") : value;
}
