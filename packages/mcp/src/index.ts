#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KitClient } from "yandex-kit-core";
import { loadConfig, type Config } from "./config.js";
import { instrumentToolCalls, Telemetry } from "./telemetry.js";
import { registerMetaTools } from "./tools/meta.js";
import { registerStoreTools } from "./tools/store.js";
import { registerProductTools } from "./tools/products.js";
import { registerVariantTools } from "./tools/variants.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerGiftCardTools } from "./tools/giftcards.js";
import { registerDiscountTools } from "./tools/discounts.js";
import { registerPromocodeTools } from "./tools/promocodes.js";
import { registerWebhookTools } from "./tools/webhooks.js";
import { registerWarehouseTools } from "./tools/warehouses.js";
import { registerCollectionTools } from "./tools/collections.js";
import { registerFileTools } from "./tools/files.js";

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const config = loadConfigOrExit();
  const client = new KitClient({
    token: config.token,
    baseUrl: config.baseUrl,
    rps: config.rps,
    timeoutMs: config.timeoutMs,
  });

  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const server = new McpServer({ name: "mcp-yandex-kit", version: pkg.version });

  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with YANDEX_KIT_TELEMETRY=0. Must be wired before tools register.
  const telemetry = new Telemetry(pkg.version);
  instrumentToolCalls(server, telemetry);
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    telemetry.send("server_start");
  };

  registerMetaTools(server, client);
  registerStoreTools(server, client);
  registerProductTools(server, client);
  registerVariantTools(server, client);
  registerCategoryTools(server, client);
  registerOrderTools(server, client);
  registerCustomerTools(server, client);
  registerGiftCardTools(server, client);
  registerDiscountTools(server, client);
  registerPromocodeTools(server, client);
  registerWebhookTools(server, client);
  registerWarehouseTools(server, client);
  registerCollectionTools(server, client);
  registerFileTools(server, client);

  await server.connect(new StdioServerTransport());
  // stdout belongs to the stdio transport — diagnostics go to stderr.
  console.error("mcp-yandex-kit ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
