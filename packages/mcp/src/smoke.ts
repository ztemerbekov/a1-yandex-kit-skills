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
  customers?: Array<{ customer_id?: string; birth_date?: unknown; updated_at?: unknown }>;
  total_count?: number;
}

interface Cart {
  items?: unknown[];
  total_final_price?: string;
  updated_at?: string;
}

interface OrderCollection {
  orders?: Array<{ customer_id?: unknown; updated_at?: unknown; items?: Array<{ name?: unknown }> }>;
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

  // Regression detector for issue #54 (fixed server-side by 2026-10): the KIT
  // API used to strip ARCHIVED from the GetVariants status filter and return
  // the default listing. Informational; an empty archive proves nothing, which
  // is why e2e archives a variant of its own and checks it is listed.
  const filtered = await client.call<VariantCollection>("GetVariants", {
    query: { page: 1, per_page: 100, status: ["ARCHIVED"] },
  });
  const variants = filtered?.variants ?? [];
  const archived = variants.filter((v) => v.status === "ARCHIVED").length;
  const outside = variants.length - archived;
  console.log(
    outside > 0
      ? `archived-filter: REGRESSION — status=ARCHIVED returned ${outside} non-archived ` +
          "variants (the default listing); list_variants now fails with STATUS_FILTER_IGNORED"
      : archived > 0
        ? `archived-filter: honored — status=ARCHIVED returned ${archived} archived variants`
        : "archived-filter: indeterminate — the archive is empty; e2e carries the positive probe",
  );

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

  // Fields and sort added in the 2026-10-09 KIT release — again flags and counts only.
  const syncOrders = await client.call<OrderCollection>("GetOrders", {
    query: { page: 1, per_page: 2, sort_by: "updated_at", sort_direction: "asc" },
  });
  const firstOrder = syncOrders?.orders?.[0];
  if (firstOrder === undefined) {
    console.log("order customer link: indeterminate — the store has no orders to probe with");
  } else {
    const present = (v: unknown) => (typeof v === "string" ? "present" : "MISSING");
    const firstItem = firstOrder.items?.[0];
    console.log(
      `order customer link: customer_id=${present(firstOrder.customer_id)} ` +
        `updated_at=${present(firstOrder.updated_at)} items[].name=` +
        `${firstItem === undefined ? "no items" : present(firstItem.name)}`,
    );
    const [a, b] = (syncOrders?.orders ?? []).map((o) => o.updated_at);
    console.log(
      typeof a === "string" && typeof b === "string"
        ? `orders sort_by=updated_at asc: ${a <= b ? "honored" : "IGNORED"} on the first two`
        : "orders sort_by=updated_at asc: indeterminate — fewer than two orders",
    );
  }

  const allCustomers = customerProbe?.total_count;
  const recentCustomers = (
    await client.call<CustomerCollection>("GetCustomers", {
      query: { page: 1, per_page: 1, updated_from: new Date(Date.now() - DAY_MS).toISOString() },
    })
  )?.total_count;
  console.log(
    allCustomers === undefined || recentCustomers === undefined
      ? "customers updated_from: indeterminate — the listing carries no total_count"
      : allCustomers === 0
        ? "customers updated_from: indeterminate — the store has no customers to probe with"
        : recentCustomers < allCustomers
          ? `customers updated_from: honored — ${recentCustomers} of ${allCustomers} changed in the last 24h`
          : `customers updated_from: unproven — ${recentCustomers} of ${allCustomers}; either every ` +
            "customer changed within the window or the filter is ignored",
  );
  if (customer !== undefined) {
    console.log(
      `customer updated_at: ${typeof customer.updated_at === "string" ? "present" : "MISSING"}`,
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
