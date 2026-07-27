export interface Config {
  token: string;
  baseUrl?: string;
  rps: number;
  timeoutMs: number;
}

function positiveNumber(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got: ${raw}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.YANDEX_KIT_TOKEN;
  if (!token) {
    throw new Error(
      "YANDEX_KIT_TOKEN is required. Generate a token in the Yandex KIT merchant cabinet: " +
        "Settings -> API -> Generate token (https://yandex.ru/dev/kit/ru/authorization).",
    );
  }
  return {
    token,
    baseUrl: env.YANDEX_KIT_BASE_URL || undefined,
    rps: positiveNumber(env.YANDEX_KIT_RPS, 3, "YANDEX_KIT_RPS"),
    timeoutMs: positiveNumber(env.YANDEX_KIT_TIMEOUT_MS, 30_000, "YANDEX_KIT_TIMEOUT_MS"),
  };
}
