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

interface VariantCollection {
  variants?: Array<{ status?: string }>;
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

  // Issue #54 state detector: the KIT API silently strips ARCHIVED from the
  // GetVariants status filter. Informational only — reports whether the defect
  // is still present so the list_variants guardrail can be removed once fixed.
  const filtered = await client.call<VariantCollection>("GetVariants", {
    query: { page: 1, per_page: 100, status: ["ARCHIVED"] },
  });
  const variants = filtered?.variants ?? [];
  const archived = variants.filter((v) => v.status === "ARCHIVED").length;
  const outside = variants.length - archived;
  if (archived > 0) {
    console.log(
      `archived-filter: API FIXED — status=ARCHIVED returned ${archived} archived variants; ` +
        "the list_variants guardrail (issue #54) can be removed",
    );
  } else if (outside > 0) {
    console.log(
      `archived-filter: KIT defect still present — status=ARCHIVED returned ${outside} ` +
        "non-archived variants (the default listing)",
    );
  } else {
    const control = await client.call<VariantCollection>("GetVariants", {
      query: { page: 1, per_page: 1 },
    });
    const controlNonEmpty = (control?.variants?.length ?? 0) > 0;
    console.log(
      controlNonEmpty
        ? "archived-filter: API FIXED — the filter is honored and the archive is empty; " +
            "the list_variants guardrail (issue #54) can be removed"
        : "archived-filter: indeterminate — the store has no variants to probe with",
    );
  }

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
