// Smoke test: live read-only calls against the KIT API. Requires YANDEX_KIT_TOKEN.
// Plain CLI — console.log is fine here (not part of the MCP stdio server).
import { KitApiError, KitClient } from "yandex-kit-core";
import { loadConfig, type Config } from "./config.js";

interface Store {
  id?: string;
  slug?: string;
  b2c_url?: string;
}

interface ProductCollection {
  products?: unknown[];
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    console.log(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const client = new KitClient({
    token: config.token,
    baseUrl: config.baseUrl,
    rps: config.rps,
    timeoutMs: config.timeoutMs,
  });

  const store = await client.call<Store>("GetStore");
  console.log(`store: id=${store?.id ?? "?"} slug=${store?.slug ?? "?"} url=${store?.b2c_url ?? "?"}`);

  const collection = await client.call<ProductCollection>("GetProducts", {
    query: { page: 1, per_page: 1 },
  });
  console.log(`products: fetched=${collection?.products?.length ?? 0} (page=1 per_page=1)`);

  console.log("smoke OK");
}

main().catch((err) => {
  if (err instanceof KitApiError) {
    console.log(
      `KIT API error: status=${err.status} code=${err.code} trace_id=${err.traceId ?? "-"} message=${err.message}`,
    );
  } else {
    console.log(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
