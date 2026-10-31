import type { StartupFailedReason } from "./telemetry.js";
import { isAbsolute } from "node:path";
import { ConnectionStorageError, createConnectionStore } from "yandex-kit-core/connections";

export interface Config {
  readonly token: string;
  readonly baseUrl?: string;
  readonly rps: number;
  readonly timeoutMs: number;
  readonly project?: Readonly<{ expectedStoreId: string; storeName?: string; storeUrl?: string }>;
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
    throw new ConfigError(`${name} must be a positive number.`, "invalid_config");
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
  return freezeConfig({
    token,
    baseUrl: validBaseUrl(env.YANDEX_KIT_BASE_URL),
    rps: positiveNumber(env.YANDEX_KIT_RPS, 3, "YANDEX_KIT_RPS"),
    timeoutMs: positiveNumber(env.YANDEX_KIT_TIMEOUT_MS, 30_000, "YANDEX_KIT_TIMEOUT_MS"),
  });
}

/** Direct token access is private; status/JSON serialization never includes it. */
function freezeConfig(config: Config): Config {
  Object.defineProperty(config, "token", { enumerable: false });
  return Object.freeze(config);
}

/** An explicit flag is the only way to select a project. Invalid args never fall back. */
function projectConfigArgument(argv: readonly string[]): string | undefined {
  if (argv.length === 0) return undefined;
  if (argv.length !== 2 || argv[0] !== "--project-config" || !argv[1] || !isAbsolute(argv[1]) || argv[1].includes("\0")) {
    throw new ConfigError("Usage: mcp-yandex-kit [--project-config <absolute path>].", "invalid_config");
  }
  return argv[1];
}

export async function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = [],
  options: { storageRoot?: string } = {},
): Promise<Config> {
  const projectConfig = projectConfigArgument(argv);
  if (projectConfig === undefined) return loadConfig(env);
  try {
    const storage = createConnectionStore({ ...options, env });
    const binding = await storage.readBinding(projectConfig);
    const { value } = await storage.readConnection(binding.value.connection_id);
    return freezeConfig({
      token: value.token,
      // Project tokens can only go to the client's official default API URL.
      rps: positiveNumber(env.YANDEX_KIT_RPS, 3, "YANDEX_KIT_RPS"),
      timeoutMs: positiveNumber(env.YANDEX_KIT_TIMEOUT_MS, 30_000, "YANDEX_KIT_TIMEOUT_MS"),
      project: Object.freeze({ expectedStoreId: value.store_id, storeName: value.store_name, storeUrl: value.store_url }),
    });
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(err instanceof ConnectionStorageError ? err.message : "Cannot load project connection. Run project setup again.", "invalid_config");
  }
}
