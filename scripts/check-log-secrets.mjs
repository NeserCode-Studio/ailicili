import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { fileURLToPath, pathToFileURL } from "node:url";

const LOG_METHODS = new Set(["debug", "error", "info", "log", "trace", "warn"]);
const RUST_LOG_MACROS = new Set([
  "debug",
  "error",
  "info",
  "log",
  "println",
  "eprintln",
  "trace",
  "warn",
]);
const SENSITIVE_EXACT = new Set([
  "body",
  "deadline",
  "gt",
  "headers",
  "payload",
  "query",
  "sign",
  "signature",
  "tel",
  "uid",
  "uri",
  "url",
]);
const SENSITIVE_BASES = [
  "authbody",
  "bilijct",
  "buvid3",
  "buvid4",
  "captchakey",
  "challenge",
  "cookie",
  "credential",
  "dedeuserid",
  "dedeuseridckmd5",
  "deviceidentity",
  "mediaurl",
  "mobile",
  "password",
  "phone",
  "playbackurl",
  "qrcodekey",
  "rawbody",
  "requestbody",
  "requesturl",
  "responsebody",
  "seccode",
  "secret",
  "session",
  "signeduri",
  "signedurl",
  "smscode",
  "sessdata",
  "streamurl",
  "telephone",
  "token",
  "validate",
  "verificationcode",
  "wrid",
];
const SAFE_METHODS = new Set([
  "count",
  "endsWith",
  "includes",
  "is_empty",
  "is_none",
  "is_some",
  "len",
  "startsWith",
]);
const SANITIZING_WRAPPERS = new Set([
  "Array.isArray",
  "Boolean",
  "imageLogFields",
  "sourceHost",
]);

function normalizeName(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1$2")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function isMetadataName(value) {
  const normalized = normalizeName(value);
  if (!normalized) return false;
  if (/^has[a-z0-9]+$/.test(normalized)) return true;
  return /(?:accepted|age|agems|available|count|enabled|expiresinseconds|fields|field|keys|kind|length|len|messagecode|mounted|names|name|present|provider|ready|required|retryafterseconds|sequence|shape|size|source|status|type|valid)$/.test(
    normalized
  );
}

function sensitiveBaseFor(value) {
  const normalized = normalizeName(value);
  if (!normalized || isMetadataName(normalized)) return null;
  if (SENSITIVE_EXACT.has(normalized)) return normalized;
  for (const base of SENSITIVE_BASES) {
    if (normalized === base) return base;
    if (normalized.startsWith(base) || normalized.endsWith(base)) {
      return base;
    }
  }
  return null;
}

function lineAndColumn(sourceFile, position) {
  const line = sourceFile.getLineAndCharacterOfPosition(position);
  return { line: line.line + 1, column: line.character + 1 };
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function terminalPropertyName(node) {
  const current = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (
    ts.isElementAccessExpression(current) &&
    current.argumentExpression &&
    ts.isStringLiteralLike(current.argumentExpression)
  ) {
    return current.argumentExpression.text;
  }
  if (ts.isIdentifier(current)) return current.text;
  return null;
}

function isLoggerReceiver(node) {
  const text = node.getText().replace(/\s+/g, "").toLowerCase();
  return (
    text === "console" ||
    text === "log" ||
    text.endsWith(".log") ||
    text.endsWith("logger")
  );
}

function isSanitizingWrapper(node) {
  const current = unwrapExpression(node);
  if (!ts.isCallExpression(current)) return false;
  return SANITIZING_WRAPPERS.has(current.expression.getText());
}

function isSafeTsExpression(node) {
  const current = unwrapExpression(node);
  if (isSanitizingWrapper(current)) return true;
  if (
    (ts.isPrefixUnaryExpression(current) &&
      current.operator === ts.SyntaxKind.ExclamationToken) ||
    ts.isTypeOfExpression(current)
  ) {
    return true;
  }
  if (ts.isBinaryExpression(current)) {
    const operator = current.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      operator === ts.SyntaxKind.EqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsToken ||
      operator === ts.SyntaxKind.LessThanToken ||
      operator === ts.SyntaxKind.LessThanEqualsToken ||
      operator === ts.SyntaxKind.GreaterThanToken ||
      operator === ts.SyntaxKind.GreaterThanEqualsToken ||
      operator === ts.SyntaxKind.InKeyword ||
      operator === ts.SyntaxKind.InstanceOfKeyword
    ) {
      return true;
    }
  }
  if (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression)
  ) {
    if (SAFE_METHODS.has(current.expression.name.text)) return true;
  }
  const terminal = terminalPropertyName(current);
  return terminal !== null && isMetadataName(terminal);
}

function inspectTsExpression(node, sourceFile, violations, seen) {
  const current = unwrapExpression(node);
  if (isSafeTsExpression(current)) return;

  const terminal = terminalPropertyName(current);
  const reason = terminal === null ? null : sensitiveBaseFor(terminal);
  if (reason) {
    const position = lineAndColumn(sourceFile, current.getStart(sourceFile));
    const key = `${position.line}:${position.column}:${reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      violations.push({
        ...position,
        rule: `sensitive-${reason}`,
        expression: current.getText(sourceFile).replace(/\s+/g, " "),
      });
    }
    return;
  }

  if (ts.isObjectLiteralExpression(current)) {
    for (const property of current.properties) {
      if (ts.isPropertyAssignment(property)) {
        inspectTsExpression(property.initializer, sourceFile, violations, seen);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        inspectTsExpression(property.name, sourceFile, violations, seen);
      } else if (ts.isSpreadAssignment(property)) {
        inspectTsExpression(property.expression, sourceFile, violations, seen);
      }
    }
    return;
  }
  if (ts.isArrayLiteralExpression(current)) {
    for (const element of current.elements) {
      inspectTsExpression(element, sourceFile, violations, seen);
    }
    return;
  }
  if (ts.isCallExpression(current)) {
    for (const argument of current.arguments) {
      inspectTsExpression(argument, sourceFile, violations, seen);
    }
    if (
      ts.isPropertyAccessExpression(current.expression) ||
      ts.isElementAccessExpression(current.expression)
    ) {
      inspectTsExpression(
        current.expression.expression,
        sourceFile,
        violations,
        seen
      );
    }
    return;
  }
  if (ts.isPropertyAccessExpression(current)) {
    return;
  }
  if (ts.isElementAccessExpression(current)) {
    inspectTsExpression(current.expression, sourceFile, violations, seen);
    if (current.argumentExpression) {
      inspectTsExpression(
        current.argumentExpression,
        sourceFile,
        violations,
        seen
      );
    }
    return;
  }
  if (ts.isTemplateExpression(current)) {
    for (const span of current.templateSpans) {
      inspectTsExpression(span.expression, sourceFile, violations, seen);
    }
    return;
  }
  if (ts.isConditionalExpression(current)) {
    inspectTsExpression(current.whenTrue, sourceFile, violations, seen);
    inspectTsExpression(current.whenFalse, sourceFile, violations, seen);
    return;
  }
  if (ts.isBinaryExpression(current)) {
    inspectTsExpression(current.left, sourceFile, violations, seen);
    inspectTsExpression(current.right, sourceFile, violations, seen);
  }
}

export function scanTypeScriptText(source, file = "inline.ts") {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const violations = [];

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      LOG_METHODS.has(node.expression.name.text) &&
      isLoggerReceiver(node.expression.expression)
    ) {
      const seen = new Set();
      for (const argument of node.arguments) {
        inspectTsExpression(argument, sourceFile, violations, seen);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations.map((violation) => ({ file, ...violation }));
}

function makeToken(kind, value, line, column, start, end) {
  return { kind, value, line, column, start, end };
}

function tokenizeRust(source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const advance = (count = 1) => {
    for (let offset = 0; offset < count; offset += 1) {
      if (source[index + offset] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
    index += count;
  };

  const stringStart = (position) => {
    const rest = source.slice(position);
    let raw = false;
    let prefixLength = 0;
    if (rest.startsWith('br"') || /^br#+"/.test(rest)) {
      raw = true;
      prefixLength = 2;
    } else if (rest.startsWith('b"')) {
      prefixLength = 1;
    } else if (rest.startsWith('r"') || /^r#+"/.test(rest)) {
      raw = true;
      prefixLength = 1;
    } else if (rest.startsWith('"')) {
      prefixLength = 0;
    } else {
      return null;
    }

    const quoteIndex = position + prefixLength;
    if (raw) {
      let hashCount = 0;
      while (source[quoteIndex + hashCount] === "#") hashCount += 1;
      const contentStart = quoteIndex + hashCount + 1;
      const terminator = `"${"#".repeat(hashCount)}`;
      const close = source.indexOf(terminator, contentStart);
      const end = close === -1 ? source.length : close + terminator.length;
      return {
        raw: true,
        content: source.slice(
          contentStart,
          close === -1 ? source.length : close
        ),
        end,
      };
    }

    let cursor = quoteIndex + 1;
    let escaped = false;
    while (cursor < source.length) {
      const char = source[cursor];
      if (!escaped && char === '"') break;
      if (!escaped && char === "\\") {
        escaped = true;
      } else {
        escaped = false;
      }
      cursor += 1;
    }
    return {
      raw: false,
      content: source.slice(quoteIndex + 1, cursor),
      end: Math.min(cursor + 1, source.length),
    };
  };

  const charLiteralEnd = (position) => {
    const quoteIndex =
      source[position] === "b" && source[position + 1] === "'"
        ? position + 1
        : source[position] === "'"
          ? position
          : -1;
    if (quoteIndex === -1) return null;
    let cursor = quoteIndex + 1;
    if (source[cursor] === "\\") {
      cursor += 1;
      const limit = Math.min(source.length, cursor + 16);
      while (cursor < limit) {
        if (source[cursor] === "'") return cursor + 1;
        cursor += 1;
      }
      return null;
    }
    return source[cursor + 1] === "'" ? cursor + 2 : null;
  };

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      advance();
      continue;
    }
    if (source.startsWith("//", index)) {
      while (index < source.length && source[index] !== "\n") advance();
      continue;
    }
    if (source.startsWith("/*", index)) {
      let depth = 0;
      while (index < source.length) {
        if (source.startsWith("/*", index)) {
          depth += 1;
          advance(2);
        } else if (source.startsWith("*/", index)) {
          depth -= 1;
          advance(2);
          if (depth === 0) break;
        } else {
          advance();
        }
      }
      continue;
    }

    const parsedString = stringStart(index);
    if (parsedString) {
      const startLine = line;
      const startColumn = column;
      const start = index;
      const value = parsedString.content;
      advance(parsedString.end - index);
      tokens.push(
        makeToken(
          parsedString.raw ? "raw-string" : "string",
          value,
          startLine,
          startColumn,
          start,
          index
        )
      );
      continue;
    }

    const parsedCharEnd = charLiteralEnd(index);
    if (parsedCharEnd !== null) {
      const start = index;
      const startLine = line;
      const startColumn = column;
      advance(parsedCharEnd - index);
      tokens.push(
        makeToken(
          "char",
          source.slice(start, index),
          startLine,
          startColumn,
          start,
          index
        )
      );
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      const startLine = line;
      const startColumn = column;
      while (/[A-Za-z0-9_]/.test(source[index] ?? "")) advance();
      tokens.push(
        makeToken(
          "ident",
          source.slice(start, index),
          startLine,
          startColumn,
          start,
          index
        )
      );
      continue;
    }

    tokens.push(makeToken("punct", char, line, column, index, index + 1));
    advance();
  }
  return tokens;
}

function splitRustArguments(tokens) {
  const segments = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (value === "(" || value === "[" || value === "{") depth += 1;
    if (value === ")" || value === "]" || value === "}") depth -= 1;
    if (value === "," && depth === 0) {
      segments.push(tokens.slice(start, index));
      start = index + 1;
    }
  }
  segments.push(tokens.slice(start));
  return segments.filter((segment) => segment.length > 0);
}

function trimNamedArgument(segment) {
  if (
    segment.length >= 3 &&
    segment[0].kind === "ident" &&
    segment[1].value === "="
  ) {
    return { name: segment[0].value, expression: segment.slice(2) };
  }
  return { name: null, expression: segment };
}

function isTargetSegment(segment) {
  return (
    segment.length >= 3 &&
    segment[0].kind === "ident" &&
    segment[0].value === "target" &&
    segment[1].value === ":"
  );
}

function rustFormatNames(value) {
  const names = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "{") continue;
    if (value[index + 1] === "{") {
      index += 1;
      continue;
    }
    const close = value.indexOf("}", index + 1);
    if (close === -1) break;
    const captured = value
      .slice(index + 1, close)
      .split(":", 1)[0]
      .trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(captured)) {
      names.push(captured);
    }
    index = close;
  }
  return names;
}

function isSanitizedRustExpression(tokens) {
  if (tokens.length === 0) return true;
  const values = tokens.map((token) => token.value);
  if (
    tokens[0].kind === "ident" &&
    [
      "cookie_names",
      "diagnostic_body_preview",
      "error_code",
      "header_names",
      "json_shape",
      "platform_error_code",
      "request_shape",
    ].includes(tokens[0].value)
  ) {
    return true;
  }
  if (
    values.some((value) => ["==", "!=", "<", ">", "<=", ">="].includes(value))
  ) {
    return true;
  }
  if (
    values[0] === "!" &&
    values.some((value) =>
      ["count", "len", "is_some", "is_none", "is_empty"].includes(value)
    )
  ) {
    return true;
  }
  for (let index = 0; index < values.length - 2; index += 1) {
    if (
      values[index + 1] === "." &&
      ["count", "len", "is_some", "is_none", "is_empty"].includes(
        values[index + 2]
      )
    ) {
      return true;
    }
  }
  return false;
}

function rustExpressionText(tokens) {
  return tokens
    .map((token) => token.value)
    .join(" ")
    .replace(/\s+([,.)\]}])/g, "$1")
    .replace(/([([{.])\s+/g, "$1");
}

function inspectRustExpression(tokens, file, violations, seen) {
  if (isSanitizedRustExpression(tokens)) return;
  for (const token of tokens) {
    if (token.kind !== "ident") continue;
    const reason = sensitiveBaseFor(token.value);
    if (!reason) continue;
    const key = `${token.line}:${token.column}:${reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({
      file,
      line: token.line,
      column: token.column,
      rule: `sensitive-${reason}`,
      expression: rustExpressionText(tokens),
    });
  }
}

export function scanRustText(source, file = "inline.rs") {
  const tokens = tokenizeRust(source);
  const violations = [];

  for (let index = 0; index < tokens.length - 2; index += 1) {
    const macro = tokens[index];
    if (
      macro.kind !== "ident" ||
      !RUST_LOG_MACROS.has(macro.value) ||
      tokens[index + 1].value !== "!"
    ) {
      continue;
    }
    const open = tokens[index + 2];
    if (!["(", "[", "{"].includes(open.value)) continue;
    const expectedClose =
      open.value === "(" ? ")" : open.value === "[" ? "]" : "}";
    let depth = 1;
    let closeIndex = index + 3;
    for (; closeIndex < tokens.length; closeIndex += 1) {
      if (tokens[closeIndex].value === open.value) depth += 1;
      if (tokens[closeIndex].value === expectedClose) depth -= 1;
      if (depth === 0) break;
    }
    if (depth !== 0) continue;

    const segments = splitRustArguments(tokens.slice(index + 3, closeIndex));
    const formatIndex = segments.findIndex(
      (segment) => !isTargetSegment(segment)
    );
    if (formatIndex === -1) {
      index = closeIndex;
      continue;
    }
    const formatSegment = segments[formatIndex];
    const formatToken = formatSegment.find((token) =>
      token.kind.endsWith("string")
    );
    const args = segments.slice(formatIndex + 1).map(trimNamedArgument);
    const namedArguments = new Map(
      args
        .filter((argument) => argument.name)
        .map((argument) => [argument.name, argument])
    );
    const seen = new Set();

    for (const argument of args) {
      inspectRustExpression(argument.expression, file, violations, seen);
    }
    if (formatToken) {
      for (const name of rustFormatNames(formatToken.value)) {
        if (namedArguments.has(name)) continue;
        const reason = sensitiveBaseFor(name);
        if (!reason) continue;
        const key = `${formatToken.line}:${formatToken.column}:${reason}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push({
          file,
          line: formatToken.line,
          column: formatToken.column,
          rule: `sensitive-${reason}`,
          expression: name,
        });
      }
    }
    index = closeIndex;
  }
  return violations;
}

function collectSourceFiles(root, extensions) {
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...collectSourceFiles(fullPath, extensions));
    } else if (extensions.has(path.extname(entry.name))) {
      output.push(fullPath);
    }
  }
  return output;
}

export function scanRepository(repositoryRoot) {
  const violations = [];
  const tsRoot = path.join(repositoryRoot, "src");
  const rustRoot = path.join(repositoryRoot, "src-tauri", "src");
  for (const file of collectSourceFiles(tsRoot, new Set([".ts", ".tsx"]))) {
    const source = fs.readFileSync(file, "utf8");
    violations.push(
      ...scanTypeScriptText(source, path.relative(repositoryRoot, file))
    );
  }
  for (const file of collectSourceFiles(rustRoot, new Set([".rs"]))) {
    const source = fs.readFileSync(file, "utf8");
    violations.push(
      ...scanRustText(source, path.relative(repositoryRoot, file))
    );
  }
  return violations;
}

function run() {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const violations = scanRepository(repositoryRoot);
  if (violations.length === 0) {
    console.log("Log secret check passed.");
    return;
  }
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}:${violation.column} ${violation.rule} ${violation.expression}`
    );
  }
  console.error(
    `Log secret check failed with ${violations.length} violation(s).`
  );
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  run();
}
