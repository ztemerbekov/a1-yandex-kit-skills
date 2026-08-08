import type { StartupFailedReason } from "./telemetry.js";

export interface Config {
  token: string;
  baseUrl?: string;
  rps: number;
  timeoutMs: number;
}

/**
 * A missing or malformed environment variable. `reason` ships with the
 * startup_failed ping; its type keeps free-form strings out of telemetry.
 */
export class ConfigError extends Error {
  readonly reason: StartupFailedReason;

  constructor(message: string, reason: StartupFailedReason) {
    super(message);
    this.name = "ConfigError";
    this.reason = reason;
  }
}

/**
 * Fail at startup (with the invalid_config ping) instead of a confusing fetch
 * error on the first call. Never echo the value: a URL can carry credentials.
 */
function validBaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError("YANDEX_KIT_BASE_URL must be a valid http(s) URL.", "invalid_config");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ConfigError("YANDEX_KIT_BASE_URL must use http or https.", "invalid_config");
  }
  return raw;
}

function positiveNumber(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive number, got: ${raw}`, "invalid_config");
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.YANDEX_KIT_TOKEN;
  if (!token) {
    throw new ConfigError(
      "YANDEX_KIT_TOKEN is required. Generate a token in the Yandex KIT merchant cabinet: " +
        "Settings -> API -> Generate token (https://yandex.ru/dev/kit/ru/authorization).",
      "missing_token",
    );
  }
  return {
    token,
    baseUrl: validBaseUrl(env.YANDEX_KIT_BASE_URL),
    rps: positiveNumber(env.YANDEX_KIT_RPS, 3, "YANDEX_KIT_RPS"),
    timeoutMs: positiveNumber(env.YANDEX_KIT_TIMEOUT_MS, 30_000, "YANDEX_KIT_TIMEOUT_MS"),
  };
}
