import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Runtime } from "./runtime.js";
import { registerMetaTools } from "./tools/meta.js";
import { registerStoreTools } from "./tools/store.js";
import { registerProductTools } from "./tools/products.js";
import { registerSimilarCardsTools } from "./tools/similar-cards.js";
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
import { registerCharacteristicTools } from "./tools/characteristics.js";
import { registerVideoTools } from "./tools/videos.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerBlogTools } from "./tools/blogs.js";

/** Every curated tool and the universal request tool share the verified client. */
export function createMcpServer(runtime: Runtime, version: string): McpServer {
  const { client, store } = runtime;
  const server = new McpServer({
    name: "mcp-yandex-kit",
    title: store ? `Yandex KIT — ${store.name}` : "Yandex KIT",
    version,
  }, store ? { instructions: `This server is connected to the project store ${JSON.stringify(store.name)}. All tools operate on this store for the lifetime of this process.` } : undefined);

  registerMetaTools(server, client);
  registerStoreTools(server, client);
  registerProductTools(server, client);
  registerSimilarCardsTools(server, client);
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
  registerCharacteristicTools(server, client);
  registerVideoTools(server, client);
  registerAlertTools(server, client);
  registerBlogTools(server, client);

  return server;
}
