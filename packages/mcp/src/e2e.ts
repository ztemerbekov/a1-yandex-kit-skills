// E2E test: drives the real stdio MCP server end-to-end against a LIVE store.
// Performs WRITE calls (create category/product/variant, update, archive), so it
// must only ever run against a test store: it refuses to start unless
// YANDEX_KIT_E2E_WRITE=1 is set alongside YANDEX_KIT_TOKEN.
//
// Flow: connect over stdio -> tools/list sanity -> get_store -> create an E2E
// category -> create a product in it -> create a HIDDEN variant (never visible
// on the storefront) -> update its price -> read it back -> archive the variant
// -> permanently delete it (DeleteVariant is only legal for ARCHIVED variants;
// without this step every run leaves one more card in the merchant UI's
// archive tab, see issue #54) -> archive the category. The product itself
// cannot be deleted or archived (the API has no such operation) but stays
// bound to the archived category only.
//
// Plain CLI — console.log is fine here (not part of the MCP stdio server).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const REQUIRED_TOOLS = [
  "get_store",
  "create_category",
  "category_action",
  "create_product",
  "get_product",
  "create_variant",
  "update_variant",
  "get_variant",
  "variant_action",
  "kit_request",
];

const PRICE_INITIAL = "999.00";
const PRICE_UPDATED = "1499.00";

function fatal(message: string): never {
  console.log(message);
  process.exit(1);
}

interface ToolCaller {
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
}

class ToolError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Call a tool, unwrap the ok()/fail() JSON payload, throw ToolError on isError. */
async function tool<T = Record<string, unknown>>(
  client: ToolCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = res.content?.find((c) => c.type === "text")?.text ?? "";
  if (res.isError) {
    let status: number | undefined;
    try {
      status = (JSON.parse(text) as { status?: number }).status;
    } catch {
      /* non-JSON failure payload */
    }
    throw new ToolError(`${name} failed: ${text}`, status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ToolError(`${name} returned non-JSON payload: ${text.slice(0, 300)}`);
  }
}

/**
 * Caller-side 429 retry — the client itself never retries mutations (issue #6),
 * so retry decisions live here, and only for steps where a repeat is provably
 * safe: updates that set the same value and idempotent archive actions.
 * Creates are deliberately NOT wrapped.
 */
async function toolRetrying<T = Record<string, unknown>>(
  client: ToolCaller,
  name: string,
  args: Record<string, unknown>,
  attempts = 4,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await tool<T>(client, name, args);
    } catch (err) {
      if (err instanceof ToolError && err.status === 429 && attempt < attempts - 1) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

/** KIT create/get responses are the entity itself; be lenient about nesting. */
function idOf(entity: Record<string, unknown>, wrapper: string): string {
  const nested = entity[wrapper];
  const source = (
    nested && typeof nested === "object" ? nested : entity
  ) as Record<string, unknown>;
  const id = source.id;
  assertOk(typeof id === "string" && id.length > 0, `${wrapper} response has an id`);
  return id;
}

async function main(): Promise<void> {
  if (!process.env.YANDEX_KIT_TOKEN) {
    fatal("YANDEX_KIT_TOKEN is required.");
  }
  if (process.env.YANDEX_KIT_E2E_WRITE !== "1") {
    fatal(
      "E2E performs WRITE calls on the live store behind the token.\n" +
        "Run it against a TEST store only, and confirm with YANDEX_KIT_E2E_WRITE=1.",
    );
  }

  const serverPath = new URL("../dist/index.js", import.meta.url).pathname;
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  for (const key of [
    "YANDEX_KIT_TOKEN",
    "YANDEX_KIT_BASE_URL",
    "YANDEX_KIT_RPS",
    "YANDEX_KIT_TIMEOUT_MS",
  ]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  // The live edge limiter is stricter than the documented 3 rps in practice
  // (bursts get 429 with a plain-text "limited" body). E2E is in no hurry.
  if (!env.YANDEX_KIT_RPS) env.YANDEX_KIT_RPS = "1";

  const client = new Client({ name: "e2e", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env,
  });
  await client.connect(transport);

  const stamp = new Date().toISOString();
  let categoryId: string | undefined;
  let variantId: string | undefined;
  let failed = false;

  try {
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    const missing = REQUIRED_TOOLS.filter((t) => !names.has(t));
    assertOk(missing.length === 0, `tools/list has required tools (missing: ${missing.join(", ")})`);
    console.log(`[1/10] tools/list: ${tools.length} tools, all required present`);

    const store = await tool(client, "get_store", {});
    console.log(`[2/10] get_store: id=${store.id ?? "?"} slug=${store.slug ?? "?"}`);

    const category = await tool(client, "create_category", {
      category: { title: `E2E ${stamp}`, is_hidden_in_menu: true },
    });
    categoryId = idOf(category, "category");
    console.log(`[3/10] create_category: id=${categoryId}`);

    const product = await tool(client, "create_product", {
      product: { category_ids: [categoryId] },
    });
    const productId = idOf(product, "product");
    console.log(`[4/10] create_product: id=${productId}`);

    const productBack = await tool(client, "get_product", { id: productId });
    assertOk(idOf(productBack, "product") === productId, "get_product returns the created product");
    console.log(`[5/10] get_product: readback OK`);

    const variant = await tool(client, "create_variant", {
      variant: {
        name: `E2E Test Item ${stamp}`,
        product_id: productId,
        status: "HIDDEN",
        pricing: { price: PRICE_INITIAL },
      },
    });
    variantId = idOf(variant, "variant");
    console.log(`[6/10] create_variant: id=${variantId} (HIDDEN, price=${PRICE_INITIAL})`);

    await toolRetrying(client, "update_variant", {
      id: variantId,
      variant: { pricing: { price: PRICE_UPDATED } },
    });
    const variantBack = await tool(client, "get_variant", { id: variantId });
    const pricing = (variantBack.pricing ?? {}) as Record<string, unknown>;
    assertOk(
      Number.parseFloat(String(pricing.price)) === Number.parseFloat(PRICE_UPDATED),
      `updated price readback (${String(pricing.price)} == ${PRICE_UPDATED})`,
    );
    assertOk(variantBack.status === "HIDDEN", "variant stays HIDDEN after update");
    console.log(`[7/10] update_variant + get_variant: price=${String(pricing.price)}, still HIDDEN`);
  } catch (err) {
    failed = true;
    console.log(err instanceof Error ? err.message : String(err));
  } finally {
    // Cleanup always runs; each step reports but never masks the test failure.
    let variantArchived = false;
    if (variantId) {
      try {
        await toolRetrying(client, "variant_action", { id: variantId, action: "archive" });
        const archived = await tool(client, "get_variant", { id: variantId });
        assertOk(archived.status === "ARCHIVED", "variant is ARCHIVED after archive");
        variantArchived = true;
        console.log(`[8/10] variant_action: variant archived`);
      } catch (err) {
        failed = true;
        console.log(`cleanup: variant archive failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (variantId && variantArchived) {
      // Permanent delete is only legal for ARCHIVED variants; without it every
      // run leaves one more card in the merchant UI's archive tab (issue #54),
      // and the API cannot even list them back (ARCHIVED is stripped from the
      // GetVariants status filter).
      try {
        await tool(client, "kit_request", {
          operation_id: "DeleteVariant",
          path_params: { id: variantId },
        });
        let readBack: unknown;
        try {
          readBack = await tool(client, "get_variant", { id: variantId });
        } catch (err) {
          assertOk(
            err instanceof ToolError && err.status === 404,
            `get_variant after delete returns 404 (got: ${err instanceof Error ? err.message : err})`,
          );
        }
        assertOk(readBack === undefined, "deleted variant must not be readable");
        console.log(`[9/10] kit_request DeleteVariant: variant deleted, readback is 404`);
      } catch (err) {
        failed = true;
        console.log(`cleanup: variant delete failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (categoryId) {
      try {
        await toolRetrying(client, "category_action", {
          id: categoryId,
          action: "archive",
          archive_variants: true,
        });
        console.log(`[10/10] category_action: category archived`);
      } catch (err) {
        failed = true;
        console.log(`cleanup: category archive failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    await client.close();
  }

  if (failed) {
    fatal("e2e FAILED");
  }
  console.log("e2e OK (product remains by design: the API has no product delete/archive)");
}

main().catch((err) => {
  console.log(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
