#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KitClient } from "yandex-kit-core";
import { loadConfig, type Config } from "./config.js";
import { registerMetaTools } from "./tools/meta.js";
import { registerStoreTools } from "./tools/store.js";
import { registerProductTools } from "./tools/products.js";
import { registerVariantTools } from "./tools/variants.js";
import { registerCategoryTools } from "./tools/categories.js";

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

  registerMetaTools(server, client);
  registerStoreTools(server, client);
  registerProductTools(server, client);
  registerVariantTools(server, client);
  registerCategoryTools(server, client);

  await server.connect(new StdioServerTransport());
  // stdout belongs to the stdio transport — diagnostics go to stderr.
  console.error("mcp-yandex-kit ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
