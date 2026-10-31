import { KitClient, type KitClientOptions } from "yandex-kit-core";
import { ConfigError, loadRuntimeConfig, type Config } from "./config.js";

export interface Runtime {
  readonly config: Config;
  readonly client: KitClient;
  readonly store?: Readonly<{ id: string; name: string; url?: string }>;
}

export interface RuntimeOptions {
  env?: NodeJS.ProcessEnv;
  argv?: readonly string[];
  storageRoot?: string;
  /** Internal transport seams for offline tests; never CLI/env URL overrides. */
  clientOptions?: Pick<KitClientOptions, "fetchImpl" | "maxRetries" | "retryBaseMs">;
}

function freezeRuntime(runtime: Runtime): Runtime {
  // KitClient contains its token internally; it must not enter public status JSON.
  Object.defineProperty(runtime, "client", { enumerable: false });
  return Object.freeze(runtime);
}

/** Resolves the connection once, before an MCP transport or any tools exist. */
export async function createRuntime({ env = process.env, argv = [], storageRoot, clientOptions }: RuntimeOptions = {}): Promise<Runtime> {
  const config = await loadRuntimeConfig(env, argv, { storageRoot });
  const client = new KitClient({ token: config.token, baseUrl: config.baseUrl, rps: config.rps, timeoutMs: config.timeoutMs, ...clientOptions });
  if (!config.project) return freezeRuntime({ config, client });
  let value: unknown;
  try {
    // Uses the existing bounded, GET-only retries; mutations keep one attempt.
    value = await client.call("GetStore");
  } catch {
    // Neither API messages nor transport errors are trusted to be secret-free.
    throw new ConfigError("Cannot verify the project store. Check the token and network, then restart the server.", "invalid_config");
  }
  if (!value || typeof value !== "object" || !("id" in value) || value.id !== config.project.expectedStoreId) {
    throw new ConfigError("Project store identity does not match its saved connection. Run project setup again.", "invalid_config");
  }
  const metadata = value as { id: string; slug?: unknown; b2c_url?: unknown };
  const name = typeof metadata.slug === "string" && metadata.slug.trim() ? metadata.slug : (config.project.storeName ?? "Project store");
  const url = typeof metadata.b2c_url === "string" ? metadata.b2c_url : config.project.storeUrl;
  return freezeRuntime({ config, client, store: Object.freeze({ id: metadata.id, name, url }) });
}
