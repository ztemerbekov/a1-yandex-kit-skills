#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError } from "./config.js";
import { createRuntime, type Runtime } from "./runtime.js";
import { createMcpServer } from "./server.js";
import { instrumentToolCalls, Telemetry } from "./telemetry.js";

/** Report only the closed telemetry vocabulary; project data stays local. */
async function loadRuntimeOrExit(telemetry: Telemetry): Promise<Runtime> {
  try {
    return await createRuntime({ argv: process.argv.slice(2) });
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : "Cannot initialize the KIT connection.");
    await telemetry.sendBlocking("startup_failed", { reason: err instanceof ConfigError ? err.reason : "invalid_config" });
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const telemetry = new Telemetry(pkg.version);
  const runtime = await loadRuntimeOrExit(telemetry);
  const server = createMcpServer(runtime, pkg.version, (server) => instrumentToolCalls(server, telemetry));
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    telemetry.send("server_start");
  };
  await server.connect(new StdioServerTransport());
  // stdout belongs to the stdio transport; diagnostics go to stderr.
  console.error(runtime.store ? `mcp-yandex-kit ready: ${JSON.stringify(runtime.store.name)}` : "mcp-yandex-kit ready");
}

main().catch(() => {
  console.error("mcp-yandex-kit failed to start.");
  process.exit(1);
});
