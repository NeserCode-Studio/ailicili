import type { SmsChallenge } from "@/api/account";

const GEETEST_SCRIPT = "https://static.geetest.com/static/js/gt.0.4.9.js";
const GEETEST_READY_TIMEOUT_MS = 20_000;

interface GeetestResult {
  geetest_challenge?: unknown;
  geetest_validate?: unknown;
  geetest_seccode?: unknown;
}

export interface GeetestInstance {
  appendTo: (container: HTMLElement) => void;
  destroy?: () => void;
  getValidate: () => GeetestResult | false | undefined;
  onClose?: (callback: (payload?: unknown) => void) => void;
  onError: (callback: (error?: unknown) => void) => void;
  onReady: (callback: (payload?: unknown) => void) => void;
  onSuccess: (callback: (payload?: unknown) => void) => void;
  reset?: () => void;
  verify?: () => void;
}

interface GeetestOptions {
  gt: string;
  challenge: string;
  offline: boolean;
  lang: "zh-cn";
  product: "bind";
  new_captcha: boolean;
  width: string;
}

declare global {
  interface Window {
    initGeetest?: (
      options: GeetestOptions,
      callback: (instance: GeetestInstance) => void
    ) => void;
  }
}

export interface CaptchaValidation {
  challenge: string;
  validate: string;
  seccode: string;
}

export interface GeetestValidationDiagnostics {
  resultType: "object" | "false" | "undefined" | "missing-method" | "error";
  keys: string[];
  fields: string[];
  hasChallenge: boolean;
  hasValidate: boolean;
  hasSeccode: boolean;
}

export interface GeetestEventDiagnostics {
  sequence: number;
  event: "ready" | "success" | "error" | "close";
  callbackKeys: string[];
  callbackShape: string;
}

export interface GeetestValidationSnapshot {
  validation: CaptchaValidation | null;
  diagnostics: GeetestValidationDiagnostics;
}

export interface GeetestEventHandlers {
  onReady?: (event: GeetestEventDiagnostics) => void;
  onSuccess: (
    validation: CaptchaValidation | null,
    diagnostics: GeetestValidationDiagnostics,
    event: GeetestEventDiagnostics
  ) => void;
  onError: (error: unknown, event: GeetestEventDiagnostics) => void;
  onClose: (
    validation: CaptchaValidation | null,
    diagnostics: GeetestValidationDiagnostics,
    event: GeetestEventDiagnostics
  ) => void;
}

let geetestLoader: Promise<void> | null = null;

function geetestErrorLabel(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 120);
  if (typeof error === "object" && error !== null) {
    if ("error_code" in error) return String(error.error_code).slice(0, 80);
    if ("code" in error) return String(error.code).slice(0, 80);
  }
  return "unknown";
}

function destroyGeetestInstance(instance: GeetestInstance | null): void {
  try {
    instance?.destroy?.();
  } catch {
    // Third-party cleanup must not mask the challenge failure.
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function valueShape(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string(len=${value.length})`;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return `boolean(${value})`;
  if (Array.isArray(value)) return `array(len=${value.length})`;
  if (typeof value === "object") {
    if (depth >= 3) return "object";
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).slice(0, 16).sort();
    return `object(${keys
      .map((key) => `${key}:${valueShape(record[key], depth + 1)}`)
      .join(",")})`;
  }
  return typeof value;
}

function inspectCallbackPayload(payload: unknown): {
  keys: string[];
  shape: string;
} {
  if (typeof payload !== "object" || payload === null) {
    return { keys: [], shape: valueShape(payload) };
  }
  return {
    keys: Object.keys(payload).slice(0, 16).sort(),
    shape: valueShape(payload),
  };
}

export function loadGeetestScript(): Promise<void> {
  if (window.initGeetest) return Promise.resolve();
  if (geetestLoader) return geetestLoader;

  geetestLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GEETEST_SCRIPT}"]`
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => {
          geetestLoader = null;
          reject(new Error("captcha script failed"));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = GEETEST_SCRIPT;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        geetestLoader = null;
        reject(new Error("captcha script failed"));
      },
      { once: true }
    );
    document.head.appendChild(script);
  });

  return geetestLoader;
}

export async function createGeetestChallenge(
  challenge: SmsChallenge,
  handlers: GeetestEventHandlers
): Promise<GeetestInstance> {
  if (
    challenge.provider !== "geetest" ||
    !challenge.gt ||
    !challenge.challenge
  ) {
    throw new Error("unsupported captcha challenge");
  }
  await loadGeetestScript();
  if (!window.initGeetest) {
    throw new Error("captcha component unavailable");
  }

  return new Promise<GeetestInstance>((resolve, reject) => {
    let settled = false;
    let sequence = 0;
    let instanceRef: GeetestInstance | null = null;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      destroyGeetestInstance(instanceRef);
      reject(new Error("captcha component ready timed out"));
    }, GEETEST_READY_TIMEOUT_MS);
    const eventDiagnostics = (
      event: GeetestEventDiagnostics["event"],
      payload: unknown
    ): GeetestEventDiagnostics => {
      const callback = inspectCallbackPayload(payload);
      sequence += 1;
      return {
        sequence,
        event,
        callbackKeys: callback.keys,
        callbackShape: callback.shape,
      };
    };

    window.initGeetest?.(
      {
        gt: challenge.gt ?? "",
        challenge: challenge.challenge ?? "",
        offline: false,
        lang: "zh-cn",
        product: "bind",
        new_captcha: true,
        width: "100%",
      },
      (instance) => {
        instanceRef = instance;
        const handleSuccess = (payload?: unknown) => {
          const event = eventDiagnostics("success", payload);
          const snapshot = readGeetestValidation(instance);
          handlers.onSuccess(snapshot.validation, snapshot.diagnostics, event);
        };
        const handleClose = (payload?: unknown) => {
          const event = eventDiagnostics("close", payload);
          const snapshot = readGeetestValidation(instance);
          handlers.onClose(snapshot.validation, snapshot.diagnostics, event);
        };
        const handleError = (error: unknown) => {
          const event = eventDiagnostics("error", error);
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            destroyGeetestInstance(instanceRef);
            reject(
              new Error(`captcha challenge failed: ${geetestErrorLabel(error)}`)
            );
            return;
          }
          handlers.onError(error, event);
        };
        const handleReady = (payload?: unknown) => {
          const event = eventDiagnostics("ready", payload);
          handlers.onReady?.(event);
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve(instance);
        };

        try {
          // The Bilibili passport wrapper uses product=bind and calls verify()
          // only after onReady. Register all events before the first user action.
          instance.onSuccess(handleSuccess);
          instance.onError(handleError);
          instance.onClose?.(handleClose);
          instance.onReady(handleReady);
        } catch (error) {
          settled = true;
          window.clearTimeout(timeout);
          destroyGeetestInstance(instanceRef);
          reject(error);
        }
      }
    );
  });
}

export function openGeetestChallenge(instance: GeetestInstance): "verify" {
  if (typeof instance.verify !== "function") {
    throw new Error("captcha verify method unavailable");
  }
  instance.verify();
  return "verify";
}

function emptyDiagnostics(
  resultType: GeetestValidationDiagnostics["resultType"]
): GeetestValidationDiagnostics {
  return {
    resultType,
    keys: [],
    fields: [],
    hasChallenge: false,
    hasValidate: false,
    hasSeccode: false,
  };
}

function inspectGeetestResult(
  result: GeetestResult | false | undefined
): GeetestValidationDiagnostics {
  if (result === false) return emptyDiagnostics("false");
  if (result === undefined) return emptyDiagnostics("undefined");
  if (typeof result !== "object" || result === null) {
    return emptyDiagnostics("undefined");
  }

  const record = result as Record<string, unknown>;
  const keys = Object.keys(record).slice(0, 16).sort();
  return {
    resultType: "object",
    keys,
    fields: keys.map((key) => `${key}:${valueShape(record[key])}`),
    hasChallenge: isNonEmptyString(record.geetest_challenge),
    hasValidate: isNonEmptyString(record.geetest_validate),
    hasSeccode: isNonEmptyString(record.geetest_seccode),
  };
}

export function readGeetestValidation(
  instance: GeetestInstance
): GeetestValidationSnapshot {
  let result: GeetestResult | false | undefined;
  try {
    if (typeof instance.getValidate !== "function") {
      return {
        validation: null,
        diagnostics: emptyDiagnostics("missing-method"),
      };
    }
    result = instance.getValidate();
  } catch {
    return {
      validation: null,
      diagnostics: emptyDiagnostics("error"),
    };
  }

  const diagnostics = inspectGeetestResult(result);
  if (
    diagnostics.resultType === "object" &&
    diagnostics.hasChallenge &&
    diagnostics.hasValidate &&
    diagnostics.hasSeccode
  ) {
    const record = result as Record<string, unknown>;
    return {
      validation: {
        challenge: String(record.geetest_challenge),
        validate: String(record.geetest_validate),
        seccode: String(record.geetest_seccode),
      },
      diagnostics,
    };
  }

  return { validation: null, diagnostics };
}
