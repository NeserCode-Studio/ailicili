import assert from "node:assert/strict";
import test from "node:test";

import {
  scanRustText,
  scanTypeScriptText,
} from "../scripts/check-log-secrets.mjs";

test("TypeScript log AST rejects sensitive values and object fields", () => {
  const violations = scanTypeScriptText(`
    const qrcodeKey = "fixture";
    const captchaKey = "fixture";
    log.info(qrcodeKey);
    log.warn("captcha", { captchaKey });
    console.error("cookie", cookie);
  `);

  assert.deepEqual(
    violations.map((violation) => violation.rule),
    ["sensitive-qrcodekey", "sensitive-captchakey", "sensitive-cookie"]
  );
});

test("TypeScript log AST accepts lengths, presence booleans, and metadata", () => {
  const violations = scanTypeScriptText(`
    log.info("safe", qrcodeKey.length);
    log.info("safe", {
      qrcodeKeyLength: qrcodeKey.length,
      challengePresent: Boolean(challenge),
      phoneLength: phone.length,
      provider: challenge.provider,
      streamHost: sourceHost(streamUrl),
      avatarFields: imageLogFields(streamUrl),
    });
    log.info(\`safe \${cookie ? "present" : "missing"}\`);
  `);

  assert.deepEqual(violations, []);
});

test("TypeScript comments and strings do not count as logger calls", () => {
  const violations = scanTypeScriptText(`
    const example = 'log.info(qrcodeKey)';
    // log.error("cookie", cookie);
  `);

  assert.deepEqual(violations, []);
});

test("TypeScript scanner covers direct console calls and generic request locations", () => {
  const violations = scanTypeScriptText(`
    console.log(cookie);
    log.trace(url);
    log.info({ query });
  `);

  assert.deepEqual(
    violations.map((violation) => violation.rule),
    ["sensitive-cookie", "sensitive-url", "sensitive-query"]
  );
});

test("Rust log macro scanner rejects formatted and captured secrets", () => {
  const violations = scanRustText(`
    info!(target: "Fixture", "cookie={}", cookie);
    warn!("qrcode_key={}", qrcode_key);
    error!("captcha_key={captcha_key}");
    eprintln!("headers={:?}", headers);
  `);

  assert.deepEqual(
    violations.map((violation) => violation.rule),
    [
      "sensitive-cookie",
      "sensitive-qrcodekey",
      "sensitive-captchakey",
      "sensitive-headers",
    ]
  );
});

test("Rust log macro scanner accepts sanitized metadata and ignores comments", () => {
  const violations = scanRustText(`
    info!("len={}", qrcode_key.len());
    info!("cookie_present={}", !cookie.is_empty());
    info!("token_present={}", session.sessdata.is_some());
    // info!("{}", cookie);
    const EXAMPLE: &str = r#"info!("{}", cookie)"#;
  `);

  assert.deepEqual(violations, []);
});
