export interface Config {
  token: string;
  baseUrl?: string;
  rps: number;
  timeoutMs: number;
}

/**
 * A missing or malformed environment variable. `reason` is the machine-readable
 * code index.ts ships with the startup_failed ping (never a variable's value).
 */
export class ConfigError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "ConfigError";
    this.reason = reason;
  }
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
    baseUrl: env.YANDEX_KIT_BASE_URL || undefined,
    rps: positiveNumber(env.YANDEX_KIT_RPS, 3, "YANDEX_KIT_RPS"),
    timeoutMs: positiveNumber(env.YANDEX_KIT_TIMEOUT_MS, 30_000, "YANDEX_KIT_TIMEOUT_MS"),
  };
}
