import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KitClient } from "yandex-kit-core";
import { READ_ONLY, ok, fail } from "../util.js";

export function registerStoreTools(server: McpServer, client: KitClient): void {
  server.registerTool(
    "get_store",
    {
      title: "Get store",
      description:
        "Get information about the current store (id, slug, b2c_url). Operation: GetStore.",
      annotations: READ_ONLY,
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.call("GetStore"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_current_user",
    {
      title: "Get current user",
      description: "Get the user that owns the API token. Operation: GetCurrentUser.",
      annotations: READ_ONLY,
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.call("GetCurrentUser"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // GetRegions has no query params in the registry and is not paginated,
  // so the tool takes no input.
  server.registerTool(
    "get_regions",
    {
      title: "Get regions",
      description:
        "Get the list of geographic regions (countries, regions, cities). Each region has an id, a name and a parent region id, forming a hierarchy. Operation: GetRegions.",
      annotations: READ_ONLY,
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.call("GetRegions"));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
