export const SERVER_NAME = "yandex-kit";
export const FALLBACK_SERVER_NAME = "a1-yandex-kit-global";
export const TOKEN_KEY = "YANDEX_KIT_TOKEN";
export const SERVER_COMMAND = "npx";
export const SERVER_ARGS = ["-y", "mcp-yandex-kit@latest"];
export const BACKUP_SUFFIX = ".a1-yandex-kit-setup.bak";
export const TOKEN_PLACEHOLDER = "{{YANDEX_KIT_TOKEN}}";

export class SetupError extends Error {
  constructor(message, code = "SETUP_ERROR") {
    super(message);
    this.name = "SetupError";
    this.code = code;
  }
}

export function normalizeServerName(serverName = SERVER_NAME) {
  const normalized = String(serverName || "").trim();
  if (![SERVER_NAME, FALLBACK_SERVER_NAME].includes(normalized)) {
    throw new SetupError(
      `Unsupported managed server name "${normalized}".`,
      "INVALID_SERVER_NAME",
    );
  }
  return normalized;
}

export function redactSecret(text, secret) {
  if (!secret) return String(text);
  return String(text).split(secret).join("[redacted]");
}

export function stripCommentOutsideQuotes(value, configPath, syntax) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote === "'" && char === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      continue;
    }
    if (char === "#" && !quote) return value.slice(0, index).trimEnd();
  }
  if (quote || escaped) {
    throw new SetupError(
      `Cannot safely parse ${syntax} config at ${configPath}: unterminated string.`,
      "MALFORMED_CONFIG",
    );
  }
  return value.trimEnd();
}

export function configStatus({
  entryPresent,
  command,
  args,
  token,
  transportValid = true,
}) {
  const tokenPresent = Boolean(token);
  return {
    entryPresent,
    configured: tokenPresent,
    canonical:
      entryPresent &&
      command === SERVER_COMMAND &&
      Array.isArray(args) &&
      args.length === SERVER_ARGS.length &&
      args.every((value, index) => value === SERVER_ARGS[index]) &&
      tokenPresent &&
      transportValid,
    tokenPresent,
    token,
  };
}
