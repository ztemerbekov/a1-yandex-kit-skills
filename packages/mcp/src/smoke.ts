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
  variants?: Array<{ status?: string; relative_link_url?: unknown }>;
}

interface LabelFormatCollection {
  services?: Array<{ delivery_service?: string; mode?: string; formats?: unknown[] }>;
}

interface AlertCollection {
  alerts?: Array<{ severity?: string }>;
}

interface VideoCollection {
  videos?: unknown[];
}

interface ColorCollection {
  colors?: unknown[];
}

interface CustomerCollection {
  customers?: Array<{ customer_id?: string; birth_date?: unknown }>;
}

interface Cart {
  items?: unknown[];
  total_final_price?: string;
  updated_at?: string;
}

interface OrderCollection {
  total_count?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
  // is still present. Only a listed archived variant proves the fix; an empty
  // archive merely shows the old symptom is gone, and e2e (which archives a
  // variant of its own) carries the positive probe (issue #151).
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
        ? "archived-filter: defect symptom gone — status=ARCHIVED returned an empty page, " +
            "not the default listing; the archive is empty, so the fix is unproven here — " +
            "see the e2e archived-filter probe before removing the guardrail (issue #151)"
        : "archived-filter: indeterminate — the store has no variants to probe with",
    );
  }

  // Endpoints added in the 2026-08 KIT release — read-only reachability check.
  const alerts = await client.call<AlertCollection>("GetAlerts", {
    query: { page: 1, per_page: 100, status: ["ACTIVE"] },
  });
  const active = alerts?.alerts ?? [];
  const critical = active.filter((a) => a.severity === "CRITICAL").length;
  console.log(`alerts: active=${active.length} critical=${critical}`);

  const videos = await client.call<VideoCollection>("GetVideos", {
    query: { page: 1, per_page: 1, status: ["UPLOADED", "PROCESSING", "READY", "ERROR"] },
  });
  console.log(`videos: fetched=${videos?.videos?.length ?? 0} (page=1 per_page=1)`);

  const colors = await client.call<ColorCollection>("GetCharacteristicColors", {
    query: { page: 1, per_page: 1 },
  });
  console.log(`characteristic colors: fetched=${colors?.colors?.length ?? 0} (page=1 per_page=1)`);

  // Endpoints and fields added in the 2026-09-17 KIT release. GetOrderDeliveryLabels
  // is deliberately left out: its first call per chunk asks the delivery service for a
  // real label, which is not a read-only act against a live store.
  const formats = await client.call<LabelFormatCollection>("GetDeliveryLabelFormats", {
    query: { delivery_service: ["YANDEX_DELIVERY"] },
  });
  const yandexDelivery = (formats?.services ?? []).find(
    (service) => service.delivery_service === "YANDEX_DELIVERY",
  );
  console.log(
    `delivery label formats: mode=${yandexDelivery?.mode ?? "?"} ` +
      `sizes=${yandexDelivery?.formats?.length ?? 0} (YANDEX_DELIVERY)`,
  );

  const linkProbe = await client.call<VariantCollection>("GetVariants", {
    query: { page: 1, per_page: 1 },
  });
  const probed = linkProbe?.variants?.[0];
  console.log(
    probed === undefined
      ? "variant storefront link: indeterminate — the store has no variants to probe with"
      : `variant storefront link: relative_link_url=${
          typeof probed.relative_link_url === "string" ? "present" : "MISSING"
        }`,
  );

  // Endpoints and fields added in the 2026-10-02 KIT release. Nothing personal is
  // printed: only presence flags and counts, because smoke output ends up in logs.
  const customerProbe = await client.call<CustomerCollection>("GetCustomers", {
    query: { page: 1, per_page: 1 },
  });
  const customer = customerProbe?.customers?.[0];
  if (customer?.customer_id === undefined) {
    console.log("customer cart: indeterminate — the store has no customers to probe with");
  } else {
    console.log(
      `customer birth_date: ${typeof customer.birth_date === "string" ? "present" : "absent"}`,
    );
    const cart = await client.call<Cart>("GetCustomerCart", {
      pathParams: { customer_id: customer.customer_id },
    });
    console.log(
      `customer cart: items=${cart?.items?.length ?? 0} total_final_price=` +
        `${cart?.total_final_price ?? "?"} updated_at=${cart?.updated_at ?? "never"}`,
    );
  }

  const allOrders = await client.call<OrderCollection>("GetOrders", {
    query: { page: 1, per_page: 1 },
  });
  const recentOrders = await client.call<OrderCollection>("GetOrders", {
    query: { page: 1, per_page: 1, updated_from: new Date(Date.now() - DAY_MS).toISOString() },
  });
  const allTotal = allOrders?.total_count;
  const recentTotal = recentOrders?.total_count;
  console.log(
    allTotal === undefined || recentTotal === undefined
      ? "orders updated_from: indeterminate — the listing carries no total_count"
      : allTotal === 0
        ? "orders updated_from: indeterminate — the store has no orders to probe with"
        : recentTotal < allTotal
          ? `orders updated_from: honored — ${recentTotal} of ${allTotal} orders changed in the last 24h`
          : `orders updated_from: unproven — ${recentTotal} of ${allTotal}; either every order ` +
            "changed within the window or the filter is ignored",
  );

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
