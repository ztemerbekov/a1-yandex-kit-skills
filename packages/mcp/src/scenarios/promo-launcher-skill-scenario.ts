import type { components } from "yandex-kit-core";

import {
  FakeOperatorMcp,
  type OperatorDiscount,
  type OperatorOrder,
  type OperatorProduct,
  type OperatorPromocode,
  type OperatorVariant,
  type OperatorWebhook,
  type RecordedToolCall,
} from "./operator-skill-scenario.js";
import { mutationResultIsAmbiguous } from "./skill-mutation-protocol.js";

export interface PromoCategory {
  id: string;
  title: string;
  status: "ACTIVE" | "ARCHIVED";
}

export interface PromoCollection {
  id: string;
  title: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface PromoStore {
  id: string;
  slug: string;
  b2c_url?: string;
}

export interface PromoWarehouse {
  id: string;
  title: string;
  status: "ACTIVE" | "ARCHIVED";
}

export interface PromoGift {
  id: string;
  title: string;
  min_cart_total: string;
  status: "ACTIVE" | "INACTIVE";
  default_sort: "POPULARITY" | "CHEAPEST" | "EXPENSIVE" | "NEWEST" | "OLDEST";
}

type P1PageEntity =
  | "orders"
  | "products"
  | "variants"
  | "categories"
  | "warehouses"
  | "discounts"
  | "promocodes"
  | "gifts";

interface P1McpFixture {
  store?: PromoStore;
  orders?: OperatorOrder[];
  variants?: OperatorVariant[];
  products?: OperatorProduct[];
  categories?: PromoCategory[];
  collections?: PromoCollection[];
  warehouses?: PromoWarehouse[];
  discounts?: OperatorDiscount[];
  promocodes?: OperatorPromocode[];
  gifts?: PromoGift[];
  webhooks?: OperatorWebhook[];
  bindings?: Record<string, string[]>;
  readErrors?: Record<string, Error>;
  writeErrors?: Record<string, Error>;
  writeNoops?: string[];
  pageSize?: number | Partial<Record<P1PageEntity, number>>;
}

const READ_ONLY_P1_TOOLS = new Set([
  "get_store",
  "list_orders",
  "get_order",
  "get_order_addons",
  "list_products",
  "get_product",
  "list_variants",
  "get_variant",
  "list_categories",
  "get_category",
  "list_collections",
  "get_collection",
  "list_warehouses",
  "get_warehouse",
  "list_discounts",
  "get_discount",
  "list_promocodes",
  "get_promocode",
  "list_gifts",
  "get_gift",
  "list_webhooks",
  "get_webhook",
  "get_operation_schema",
]);

/**
 * P1 extends the already-used P0 fake MCP instead of introducing another scenario
 * architecture. Existing orders, catalog, promotions and webhooks are delegated to
 * FakeOperatorMcp; P1-only entities and writes share its call journal and object arrays.
 */
export class FakeP1Mcp {
  readonly #base: FakeOperatorMcp;
  readonly #store: PromoStore | undefined;
  readonly #orders: OperatorOrder[];
  readonly #variants: OperatorVariant[];
  readonly #products: OperatorProduct[];
  readonly #categories: PromoCategory[];
  readonly #collections: PromoCollection[];
  readonly #warehouses: PromoWarehouse[];
  readonly #discounts: OperatorDiscount[];
  readonly #promocodes: OperatorPromocode[];
  readonly #gifts: PromoGift[];
  readonly #bindings: Record<string, string[]>;
  readonly #readErrors: Record<string, Error>;
  readonly #writeErrors: Record<string, Error>;
  readonly #writeNoops: Set<string>;
  readonly #pageSize: Record<P1PageEntity, number>;
  #discountSequence: number;
  #promocodeSequence: number;
  #giftSequence: number;

  constructor({
    store,
    orders = [],
    variants = [],
    products = [],
    categories = [],
    collections = [],
    warehouses = [],
    discounts = [],
    promocodes = [],
    gifts = [],
    webhooks = [],
    bindings = {},
    readErrors = {},
    writeErrors = {},
    writeNoops = [],
    pageSize = 100,
  }: P1McpFixture = {}) {
    this.#store = store;
    this.#orders = orders;
    this.#variants = variants;
    this.#products = products;
    this.#categories = categories;
    this.#collections = collections;
    this.#warehouses = warehouses;
    this.#discounts = discounts;
    this.#promocodes = promocodes;
    this.#gifts = gifts;
    this.#bindings = bindings;
    this.#readErrors = readErrors;
    this.#writeErrors = writeErrors;
    this.#writeNoops = new Set(writeNoops);
    const sizeFor = (
      entity: P1PageEntity,
    ): number =>
      typeof pageSize === "number" ? pageSize : (pageSize[entity] ?? 100);
    this.#pageSize = {
      orders: sizeFor("orders"),
      products: sizeFor("products"),
      variants: sizeFor("variants"),
      categories: sizeFor("categories"),
      warehouses: sizeFor("warehouses"),
      discounts: sizeFor("discounts"),
      promocodes: sizeFor("promocodes"),
      gifts: sizeFor("gifts"),
    };
    this.#discountSequence = discounts.length + 1;
    this.#promocodeSequence = promocodes.length + 1;
    this.#giftSequence = gifts.length + 1;
    this.#base = new FakeOperatorMcp({
      orders,
      variants,
      products,
      discounts,
      promocodes,
      webhooks,
      bindings,
      readErrors,
      writeErrors,
      writeNoops,
    });
  }

  get calls(): RecordedToolCall[] {
    return this.#base.calls;
  }

  get writeCalls(): RecordedToolCall[] {
    return this.calls.filter((call) => {
      if (call.name === "kit_request") {
        return !String(call.arguments.operation_id).startsWith("Get");
      }
      return !READ_ONLY_P1_TOOLS.has(call.name);
    });
  }

  get finalAnswer(): string | undefined {
    return this.#base.finalAnswer;
  }

  #record(name: string, arguments_: Record<string, unknown>): void {
    this.#base.calls.push({ name, arguments: arguments_ });
  }

  #preparedWriteError(name: string, id?: string): Error | undefined {
    return (id ? this.#writeErrors[`${name}:${id}`] : undefined) ?? this.#writeErrors[name];
  }

  #page<T>(
    items: T[],
    entity: P1PageEntity,
    arguments_: Record<string, unknown>,
  ): { items: T[]; total_count: number } {
    const page = typeof arguments_.page === "number" ? arguments_.page : 1;
    const size = this.#pageSize[entity];
    const start = (page - 1) * size;
    return {
      items: items.slice(start, start + size),
      total_count: items.length,
    };
  }

  #preparedReadError(name: string, arguments_: Record<string, unknown>): Error | undefined {
    const page = typeof arguments_.page === "number" ? arguments_.page : undefined;
    return (page ? this.#readErrors[`${name}:${page}`] : undefined) ?? this.#readErrors[name];
  }

  async call(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    if (name === "get_store") {
      this.#record(name, arguments_);
      if (this.#readErrors[name]) throw this.#readErrors[name];
      if (!this.#store) throw new Error("Store is not prepared in FakeP1Mcp");
      return structuredClone(this.#store);
    }

    if (name === "list_orders") {
      this.#record(name, arguments_);
      const error = this.#preparedReadError(name, arguments_);
      if (error) throw error;
      const page = this.#page(this.#orders, "orders", arguments_);
      return { orders: page.items, total_count: page.total_count };
    }

    if (name === "list_variants" && arguments_.all !== true) {
      this.#record(name, arguments_);
      const error = this.#preparedReadError(name, arguments_);
      if (error) throw error;
      const statuses = Array.isArray(arguments_.status)
        ? new Set(arguments_.status.map(String))
        : undefined;
      const filtered = this.#variants.filter(
        (variant) => !statuses || statuses.has(variant.status),
      );
      const page = this.#page(filtered, "variants", arguments_);
      return { variants: page.items, total_count: page.total_count };
    }

    if (name === "list_products" && arguments_.all !== true) {
      this.#record(name, arguments_);
      const error = this.#preparedReadError(name, arguments_);
      if (error) throw error;
      const page = this.#page(this.#products, "products", arguments_);
      return { products: page.items, total_count: page.total_count };
    }

    if (name === "list_categories") {
      this.#record(name, arguments_);
      const error = this.#preparedReadError(name, arguments_);
      if (error) throw error;
      const statuses = Array.isArray(arguments_.status)
        ? new Set(arguments_.status.map(String))
        : undefined;
      const filtered = this.#categories.filter(
        (category) => !statuses || statuses.has(category.status),
      );
      const page = this.#page(filtered, "categories", arguments_);
      return { categories: page.items, total_count: page.total_count };
    }

    if (name === "list_warehouses") {
      this.#record(name, arguments_);
      const error = this.#preparedReadError(name, arguments_);
      if (error) throw error;
      const statuses = Array.isArray(arguments_.status)
        ? new Set(arguments_.status.map(String))
        : undefined;
      const filtered = this.#warehouses.filter(
        (warehouse) => !statuses || statuses.has(warehouse.status),
      );
      const page = this.#page(filtered, "warehouses", arguments_);
      return { warehouses: page.items, total_count: page.total_count };
    }

    if (name === "list_discounts" && arguments_.all !== true) {
      this.#record(name, arguments_);
      const error = this.#preparedReadError(name, arguments_);
      if (error) throw error;
      const statuses = Array.isArray(arguments_.status)
        ? new Set(arguments_.status.map(String))
        : new Set([String(arguments_.status ?? "ACTIVE")]);
      const filtered = this.#discounts.filter((discount) => statuses.has(discount.status));
      const page = this.#page(filtered, "discounts", arguments_);
      return { discounts: page.items, total_count: page.total_count };
    }

    if (name === "list_promocodes" && arguments_.all !== true) {
      this.#record(name, arguments_);
      const error = this.#preparedReadError(name, arguments_);
      if (error) throw error;
      const status = typeof arguments_.status === "string" ? arguments_.status : undefined;
      const filtered = this.#promocodes.filter(
        (promocode) => !status || promocode.status === status,
      );
      const page = this.#page(filtered, "promocodes", arguments_);
      return { promocodes: page.items, total_count: page.total_count };
    }

    if (name === "get_operation_schema") {
      this.#record(name, arguments_);
      if (this.#readErrors[name]) throw this.#readErrors[name];
      return {
        operationId: arguments_.operation_id,
        requestSchema: { type: "object" },
      };
    }

    if (name === "kit_request" && String(arguments_.operation_id).includes("Gift")) {
      this.#record(name, arguments_);
      const operationId = String(arguments_.operation_id);
      const readError =
        this.#readErrors[`kit_request:${operationId}`] ?? this.#readErrors[operationId];
      if (readError && operationId.startsWith("Get")) throw readError;
      const writeError =
        this.#writeErrors[`kit_request:${operationId}`] ?? this.#writeErrors[operationId];
      if (writeError && !operationId.startsWith("Get")) throw writeError;
      const id = String(
        (arguments_.path_params as Record<string, unknown> | undefined)?.id ?? "",
      );

      if (operationId === "GetGifts") {
        const status = String(
          (arguments_.query as Record<string, unknown> | undefined)?.status ?? "",
        );
        const gifts = this.#gifts.filter((gift) => !status || gift.status === status);
        const page = this.#page(gifts, "gifts", {
          ...((arguments_.query as Record<string, unknown> | undefined) ?? {}),
        });
        return { gifts: structuredClone(page.items), total_count: page.total_count };
      }
      if (operationId === "GetGiftById") {
        const found = this.#gifts.find((candidate) => candidate.id === id);
        if (!found) throw new Error(`Gift ${id} is not prepared in FakeP1Mcp`);
        return structuredClone(found);
      }
      if (operationId === "GetGiftVariants") {
        const variantIds = this.#bindings[`GetGiftVariants:${id}`] ?? [];
        return { variant_ids: [...variantIds], total_count: variantIds.length };
      }
      if (operationId === "CreateGift") {
        if (
          this.#writeNoops.has("kit_request:CreateGift") ||
          this.#writeNoops.has("CreateGift")
        ) {
          return { ok: true };
        }
        const body = arguments_.body as components["schemas"]["CreateGiftRequest"];
        const created: PromoGift = {
          id: `gift-${this.#giftSequence++}`,
          title: body.title,
          min_cart_total: body.min_cart_total,
          status: "INACTIVE",
          default_sort: body.default_sort ?? "POPULARITY",
        };
        this.#gifts.push(created);
        this.#bindings[`GetGiftVariants:${created.id}`] = [...body.variant_ids];
        return structuredClone(created);
      }
      if (operationId === "UpdateGift") {
        if (
          this.#writeNoops.has(`kit_request:UpdateGift:${id}`) ||
          this.#writeNoops.has("kit_request:UpdateGift")
        ) {
          return { ok: true };
        }
        const found = this.#gifts.find((candidate) => candidate.id === id);
        if (!found) throw new Error(`Gift ${id} is not prepared in FakeP1Mcp`);
        Object.assign(
          found,
          structuredClone(arguments_.body as components["schemas"]["UpdateGiftRequest"]),
        );
        return structuredClone(found);
      }
      if (operationId === "AddGiftVariants" || operationId === "RemoveGiftVariants") {
        const requested = (arguments_.body as components["schemas"]["GiftVariantsRequest"])
          .variant_ids;
        const key = `GetGiftVariants:${id}`;
        const current = this.#bindings[key] ?? [];
        this.#bindings[key] =
          operationId === "RemoveGiftVariants"
            ? current.filter((candidate) => !requested.includes(candidate))
            : [...new Set([...current, ...requested])];
        return { ok: true };
      }
      if (operationId === "DeleteGift") {
        const index = this.#gifts.findIndex((candidate) => candidate.id === id);
        if (index < 0) throw new Error(`Gift ${id} is not prepared in FakeP1Mcp`);
        this.#gifts.splice(index, 1);
        delete this.#bindings[`GetGiftVariants:${id}`];
        return { ok: true };
      }
    }

    if (name === "get_category") {
      this.#record(name, arguments_);
      if (this.#readErrors[name]) throw this.#readErrors[name];
      const id = String(arguments_.id);
      const found = this.#categories.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Category ${id} is not prepared in FakeP1Mcp`);
      return structuredClone(found);
    }

    if (name === "get_collection") {
      this.#record(name, arguments_);
      if (this.#readErrors[name]) throw this.#readErrors[name];
      const id = String(arguments_.id);
      const found = this.#collections.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Collection ${id} is not prepared in FakeP1Mcp`);
      return structuredClone(found);
    }

    if (name === "create_discount") {
      this.#record(name, arguments_);
      const error = this.#preparedWriteError(name);
      if (error) throw error;
      if (this.#writeNoops.has(name)) return { ok: true };
      const request = arguments_.discount as components["schemas"]["CreateDiscountRequest"];
      const created: OperatorDiscount = {
        id: `discount-${this.#discountSequence++}`,
        title: request.title,
        discount_value: structuredClone(request.discount_value),
        discount_dates: structuredClone(request.discount_dates),
        status: request.status,
        binding_mode: request.binding_mode,
      };
      this.#discounts.push(created);
      return structuredClone(created);
    }

    if (name === "create_promocode") {
      this.#record(name, arguments_);
      const error = this.#preparedWriteError(name);
      if (error) throw error;
      if (this.#writeNoops.has(name)) return { ok: true };
      const request = arguments_.promocode as components["schemas"]["CreatePromocodeRequest"];
      const created: OperatorPromocode = {
        id: `promocode-${this.#promocodeSequence++}`,
        code: request.code,
        title: request.title,
        discount_value: structuredClone(request.discount_value),
        minimum_order_amount: request.minimum_order_amount ?? "0.00",
        max_usage: request.max_usage,
        max_discount_amount: request.max_discount_amount,
        one_time_use: request.one_time_use ?? false,
        first_order_only: request.first_order_only ?? false,
        show_in_pdp: request.show_in_pdp ?? false,
        promocode_dates: structuredClone(request.promocode_dates),
        type: request.type,
        binding_mode: request.binding_mode,
        status: "INACTIVE",
        usage_count: 0,
      };
      this.#promocodes.push(created);
      return structuredClone(created);
    }

    if (name === "manage_promocode_objects") {
      this.#record(name, arguments_);
      const id = String(arguments_.id);
      const error = this.#preparedWriteError(name, id);
      if (error) throw error;
      if (this.#writeNoops.has(`${name}:${id}`) || this.#writeNoops.has(name)) return { ok: true };
      const promocode = this.#promocodes.find((candidate) => candidate.id === id);
      if (!promocode) throw new Error(`Promocode ${id} is not prepared in FakeP1Mcp`);
      const objects = arguments_.objects as components["schemas"]["PromocodeObjects"];
      const entries: Array<[string, string[] | undefined]> = [
        ["GetPromocodeVariantIDs", objects.product_variant_ids],
        ["GetPromocodeCategoryIDs", objects.category_ids],
        ["GetPromocodeCollectionIDs", objects.collection_ids],
      ];
      for (const [operationId, requestedIds] of entries) {
        if (!requestedIds) continue;
        const key = `${operationId}:${id}`;
        const current = this.#bindings[key] ?? [];
        this.#bindings[key] =
          arguments_.action === "remove"
            ? current.filter((candidate) => !requestedIds.includes(candidate))
            : [...new Set([...current, ...requestedIds])];
      }
      if ((objects.category_ids?.length ?? 0) + (objects.collection_ids?.length ?? 0) > 0) {
        promocode.binding_mode = "SELECTED_CATEGORIES_COLLECTIONS";
      } else if ((objects.product_variant_ids?.length ?? 0) > 0) {
        promocode.binding_mode = "SELECTED_VARIANTS";
      }
      return { ok: true };
    }

    if (name === "manage_discount_objects") {
      this.#record(name, arguments_);
      const id = String(arguments_.id);
      const error = this.#preparedWriteError(name, id);
      if (error) throw error;
      if (this.#writeNoops.has(`${name}:${id}`) || this.#writeNoops.has(name)) return { ok: true };
      const discount = this.#discounts.find((candidate) => candidate.id === id);
      if (!discount) throw new Error(`Discount ${id} is not prepared in FakeP1Mcp`);
      const objects = arguments_.objects as components["schemas"]["DiscountObjects"];
      const entries: Array<[string, string[] | undefined]> = [
        ["GetDiscountVariantIDs", objects.product_variant_ids],
        ["GetDiscountCategoryIDs", objects.category_ids],
        ["GetDiscountCollectionIDs", objects.collection_ids],
      ];
      for (const [operationId, requestedIds] of entries) {
        if (!requestedIds) continue;
        const key = `${operationId}:${id}`;
        const current = this.#bindings[key] ?? [];
        this.#bindings[key] =
          arguments_.action === "remove"
            ? current.filter((candidate) => !requestedIds.includes(candidate))
            : [...new Set([...current, ...requestedIds])];
      }
      if ((objects.category_ids?.length ?? 0) + (objects.collection_ids?.length ?? 0) > 0) {
        discount.binding_mode = "SELECTED_CATEGORIES_COLLECTIONS";
      } else if ((objects.product_variant_ids?.length ?? 0) > 0) {
        discount.binding_mode = "SELECTED_VARIANTS";
      }
      return { ok: true };
    }

    return this.#base.call(name, arguments_);
  }

  finish(report: string): void {
    this.#base.finish(report);
  }
}

type PromotionScope =
  | { kind: "all"; ids: [] }
  | { kind: "variants"; ids: string[] }
  | { kind: "categories"; ids: string[] }
  | { kind: "collections"; ids: string[] };

interface DiscountPlan {
  title: string;
  value: components["schemas"]["DiscountValue"];
  dates: components["schemas"]["DiscountDates"];
  status: "ACTIVE" | "INACTIVE";
  scope: PromotionScope;
}

interface PromocodePlan {
  code: string;
  title: string;
  value: components["schemas"]["DiscountValue"];
  dates: components["schemas"]["PromocodeDates"];
  type: "ORDER" | "PRODUCTS";
  status: "ACTIVE" | "INACTIVE";
  scope?: PromotionScope;
  minimumOrderAmount?: string;
  maxUsage?: number;
  unlimitedUsage: boolean;
  maxDiscountAmount?: string;
  oneTimeUse?: boolean;
  firstOrderOnly?: boolean;
  showInPdp?: boolean;
}

interface GiftPlan {
  title: string;
  minCartTotal: string;
  variantIds: string[];
  status: "ACTIVE" | "INACTIVE";
  defaultSort: PromoGift["default_sort"];
}

export interface PromoLauncherResult {
  kind: "completed" | "needs_input" | "failed" | "ambiguous";
  report: string;
  promotionId?: string;
}

const RUSSIAN_MONTHS: Record<string, number> = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
};

function zonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")) - 1,
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday: value("weekday"),
  };
}

function zonedDateToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const localAsUtc = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute);
  let candidate = new Date(localAsUtc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const represented = zonedParts(candidate, timeZone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month,
      represented.day,
      represented.hour,
      represented.minute,
    );
    candidate = new Date(candidate.getTime() + (localAsUtc - representedAsUtc));
  }
  return candidate;
}

export function parseLocalDate(
  text: string,
  now: Date,
  timeZone: string,
  boundary: "start" | "end",
): Date | undefined {
  const prefix = boundary === "start" ? "с" : "до";
  const tomorrow = text.match(
    new RegExp(`${prefix}\\s+завтра(?:шнего дня)?\\s+(\\d{1,2}):(\\d{2})`, "iu"),
  );
  if (tomorrow) {
    const current = zonedParts(now, timeZone);
    const tomorrowDate = new Date(Date.UTC(current.year, current.month, current.day + 1));
    return zonedDateToUtc(
      {
        year: tomorrowDate.getUTCFullYear(),
        month: tomorrowDate.getUTCMonth(),
        day: tomorrowDate.getUTCDate(),
        hour: Number(tomorrow[1]),
        minute: Number(tomorrow[2]),
      },
      timeZone,
    );
  }

  if (boundary === "end") {
    const sunday = text.match(/до\s+воскресенья\s+(\d{1,2}):(\d{2})/iu);
    if (sunday) {
      const current = zonedParts(now, timeZone);
      const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
        current.weekday,
      );
      const daysUntilSunday = (7 - weekdayIndex) % 7 || 7;
      const target = new Date(
        Date.UTC(current.year, current.month, current.day + daysUntilSunday),
      );
      return zonedDateToUtc(
        {
          year: target.getUTCFullYear(),
          month: target.getUTCMonth(),
          day: target.getUTCDate(),
          hour: Number(sunday[1]),
          minute: Number(sunday[2]),
        },
        timeZone,
      );
    }
  }

  const absolute = text.match(
    new RegExp(
      `${prefix}\\s+(\\d{1,2})\\s+(${Object.keys(RUSSIAN_MONTHS).join("|")})\\s+(\\d{4})\\s+(\\d{1,2}):(\\d{2})`,
      "iu",
    ),
  );
  if (!absolute) return undefined;
  return zonedDateToUtc(
    {
      year: Number(absolute[3]),
      month: RUSSIAN_MONTHS[absolute[2]!.toLowerCase()]!,
      day: Number(absolute[1]),
      hour: Number(absolute[4]),
      minute: Number(absolute[5]),
    },
    timeZone,
  );
}

function exactScope(request: string): PromotionScope | undefined {
  if (/на весь каталог/iu.test(request)) return { kind: "all", ids: [] };
  const variant = request.match(/на (?:вариант|sku)\s+([0-9a-z-]+)/iu);
  if (variant) return { kind: "variants", ids: [variant[1]!] };
  const category = request.match(/на категори(?:ю|и)\s+([0-9a-z-]+)/iu);
  if (category) return { kind: "categories", ids: [category[1]!] };
  const collection = request.match(/на коллекци(?:ю|и)\s+([0-9a-z-]+)/iu);
  if (collection) return { kind: "collections", ids: [collection[1]!] };
  return undefined;
}

function groupedQuestion(missing: string[]): string {
  return `Уточните одним сообщением: ${missing.join("; ")}. До этого промо не создаю.`;
}

function parseDiscountPlan({
  request,
  now,
  conversationTimeZone,
}: {
  request: string;
  now: Date;
  conversationTimeZone?: string;
}): { plan?: DiscountPlan; question?: string; error?: string } {
  const missing: string[] = [];
  if (!/скидк/iu.test(request)) missing.push("механизм — автоматическая скидка, промокод или подарок");

  const title = request.match(/[«"]([^»"]+)[»"]/)?.[1]?.trim();
  if (!title) missing.push("название скидки");

  const rawValue = request.match(/(\d+(?:[.,]\d+)?)\s*(%|руб(?:лей|ля|ль)?|₽)/iu);
  if (!rawValue) missing.push("размер и тип скидки");

  const scope = exactScope(request);
  if (!scope) missing.push("область действия");

  const status = /неактивн|черновик/iu.test(request)
    ? "INACTIVE"
    : /запусти|активн/iu.test(request)
      ? "ACTIVE"
      : undefined;
  if (!status) missing.push("статус — запустить или создать неактивной");

  const timeZone = /по москв/iu.test(request) ? "Europe/Moscow" : conversationTimeZone;
  const usesLocalDate = /завтра|воскресень|[а-яё]+\s+\d{4}\s+\d{1,2}:\d{2}/iu.test(request);
  if (usesLocalDate && !timeZone) missing.push("часовой пояс для дат");

  const perpetual = /бессрочн/iu.test(request);
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  if (timeZone) {
    startDate = parseLocalDate(request, now, timeZone, "start");
    if (!perpetual) endDate = parseLocalDate(request, now, timeZone, "end");
  }
  if (!startDate) missing.push("дату начала");
  if (!perpetual && !endDate) missing.push("дату окончания либо явное «бессрочно»");

  if (missing.length > 0) return { question: groupedQuestion([...new Set(missing)]) };
  const numericValue = Number(rawValue![1]!.replace(",", "."));
  const valueType = rawValue![2] === "%" ? "PERCENT" : "VALUE";
  if (numericValue <= 0 || (valueType === "PERCENT" && numericValue > 100)) {
    return { error: `Недопустимое значение скидки: ${rawValue![0]}` };
  }
  if (endDate && startDate!.getTime() >= endDate.getTime()) {
    return { error: "Дата начала скидки должна быть раньше даты окончания" };
  }

  return {
    plan: {
      title: title!,
      value: { value: numericValue.toFixed(2), type: valueType },
      dates: {
        start_date: startDate!.toISOString(),
        ...(endDate ? { end_date: endDate.toISOString() } : {}),
      },
      status: status!,
      scope: scope!,
    },
  };
}

function labelledMoney(request: string, label: RegExp): string | undefined {
  const match = request.match(
    new RegExp(`${label.source}\\s+(\\d+(?:[.,]\\d+)?)\\s*(?:руб(?:лей|ля|ль)?|₽)`, "iu"),
  );
  if (!match) return undefined;
  return Number(match[1]!.replace(",", ".")).toFixed(2);
}

function parsePromocodePlan({
  request,
  now,
  conversationTimeZone,
}: {
  request: string;
  now: Date;
  conversationTimeZone?: string;
}): { plan?: PromocodePlan; question?: string; error?: string } {
  const missing: string[] = [];
  const code = request.match(/промокод\s+([0-9a-z_-]+)/iu)?.[1]?.toUpperCase();
  if (!code) missing.push("точный код промокода");
  const title = request.match(/[«"]([^»"]+)[»"]/)?.[1]?.trim();
  if (!title) missing.push("название промокода");
  const rawValue = request.match(/(\d+(?:[.,]\d+)?)\s*(%|руб(?:лей|ля|ль)?|₽)/iu);
  if (!rawValue) missing.push("размер и тип скидки");

  const type = /на заказ/iu.test(request)
    ? "ORDER"
    : /на товар|на весь каталог|на (?:вариант|sku|категори|коллекци)/iu.test(request)
      ? "PRODUCTS"
      : undefined;
  if (!type) missing.push("тип — на заказ или на товары");
  const scope = type === "PRODUCTS" ? exactScope(request) : undefined;
  if (type === "PRODUCTS" && !scope) missing.push("область действия товарного промокода");

  const status = /неактивн|черновик/iu.test(request)
    ? "INACTIVE"
    : /запусти|активн/iu.test(request)
      ? "ACTIVE"
      : undefined;
  if (!status) missing.push("статус — запустить или создать неактивным");

  const unlimitedUsage = /без лимита/iu.test(request);
  const maxUsageMatch = request.match(/(?:^|[,;]\s*|\s)лимит(?: использований)?\s+(\d+)/iu);
  const maxUsage = maxUsageMatch ? Number(maxUsageMatch[1]) : undefined;
  if (!unlimitedUsage && maxUsage === undefined) {
    missing.push("лимит использований либо явное «без лимита»");
  }

  const timeZone = /по москв/iu.test(request) ? "Europe/Moscow" : conversationTimeZone;
  const usesLocalDate = /завтра|воскресень|[а-яё]+\s+\d{4}\s+\d{1,2}:\d{2}/iu.test(request);
  if (usesLocalDate && !timeZone) missing.push("часовой пояс для дат");
  const perpetual = /бессрочн/iu.test(request);
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  if (timeZone) {
    startDate = parseLocalDate(request, now, timeZone, "start");
    if (!perpetual) endDate = parseLocalDate(request, now, timeZone, "end");
  }
  if (!startDate) missing.push("дату начала");
  if (!perpetual && !endDate) missing.push("дату окончания либо явное «бессрочно»");

  if (missing.length > 0) return { question: groupedQuestion([...new Set(missing)]) };
  const numericValue = Number(rawValue![1]!.replace(",", "."));
  const valueType = rawValue![2] === "%" ? "PERCENT" : "VALUE";
  if (numericValue <= 0 || (valueType === "PERCENT" && numericValue > 100)) {
    return { error: `Недопустимое значение промокода: ${rawValue![0]}` };
  }
  if (maxUsage !== undefined && (!Number.isInteger(maxUsage) || maxUsage <= 0)) {
    return { error: "Лимит использований должен быть положительным целым числом" };
  }
  if (endDate && startDate!.getTime() >= endDate.getTime()) {
    return { error: "Дата начала промокода должна быть раньше даты окончания" };
  }

  return {
    plan: {
      code: code!,
      title: title!,
      value: { value: numericValue.toFixed(2), type: valueType },
      dates: {
        start_date: startDate!.toISOString(),
        ...(endDate ? { end_date: endDate.toISOString() } : {}),
      },
      type: type!,
      status: status!,
      scope,
      minimumOrderAmount: labelledMoney(
        request,
        /минимальн[а-яёa-z]*\s+сумм[а-яёa-z]*(?:\s+заказа)?/iu,
      ),
      maxUsage,
      unlimitedUsage,
      maxDiscountAmount: labelledMoney(
        request,
        /максимальн[а-яёa-z]*\s+скидк[а-яёa-z]*/iu,
      ),
      oneTimeUse: /одно использование|один раз/iu.test(request) ? true : undefined,
      firstOrderOnly: /только первый заказ|для первого заказа/iu.test(request)
        ? true
        : undefined,
      showInPdp: /показыва[а-яёa-z]*\s+на странице товара/iu.test(request)
        ? true
        : undefined,
    },
  };
}

function parseGiftPlan(request: string): { plan?: GiftPlan; question?: string; error?: string } {
  if (
    /(?:^|\s)(?:с|до)\s+(?:\d{1,2}\s+[а-яё]+|завтра|воскресень)/iu.test(request)
  ) {
    return {
      error:
        "KIT API не поддерживает даты действия подарка. Уберите расписание и укажите, " +
        "создать подарок неактивным или запустить сейчас; запись не выполнялась.",
    };
  }
  const missing: string[] = [];
  const title = request.match(/[«"]([^»"]+)[»"]/)?.[1]?.trim();
  if (!title) missing.push("название подарка");
  const minCartMatch = request.match(
    /корзин[а-яёa-z]*\s+от\s+(\d+(?:[.,]\d+)?)\s*(?:руб(?:лей|ля|ль)?|₽)/iu,
  );
  if (!minCartMatch) missing.push("положительную минимальную сумму корзины");
  const variantIds = [
    ...request.matchAll(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu,
    ),
  ].map((match) => match[0]!);
  if (variantIds.length === 0) missing.push("от 1 до 50 точных variant IDs");
  const status = /неактивн|черновик/iu.test(request)
    ? "INACTIVE"
    : /запусти|активн/iu.test(request)
      ? "ACTIVE"
      : undefined;
  if (!status) missing.push("статус — запустить или создать неактивным");
  if (missing.length > 0) return { question: groupedQuestion(missing) };
  if (variantIds.length > 50) {
    return { error: `Подарок поддерживает от 1 до 50 вариантов; получено ${variantIds.length}` };
  }
  const minCartTotal = Number(minCartMatch![1]!.replace(",", "."));
  if (minCartTotal <= 0) {
    return { error: "Минимальная сумма корзины должна быть положительной" };
  }
  const sortMatch = request.match(
    /сортировка\s+(POPULARITY|CHEAPEST|EXPENSIVE|NEWEST|OLDEST)/iu,
  );
  return {
    plan: {
      title: title!,
      minCartTotal: minCartTotal.toFixed(2),
      variantIds: [...new Set(variantIds)],
      status: status!,
      defaultSort: (sortMatch?.[1]?.toUpperCase() as GiftPlan["defaultSort"] | undefined) ??
        "POPULARITY",
    },
  };
}

async function validateScope(mcp: FakeP1Mcp, scope: PromotionScope): Promise<string[]> {
  const errors: string[] = [];
  for (const id of scope.ids) {
    try {
      if (scope.kind === "variants") {
        const variant = (await mcp.call("get_variant", { id })) as OperatorVariant;
        if (variant.status === "ARCHIVED") errors.push(`Вариант ${id} архивирован`);
      } else if (scope.kind === "categories") {
        const category = (await mcp.call("get_category", { id })) as PromoCategory;
        if (category.status !== "ACTIVE") errors.push(`Категория ${id} архивирована`);
      } else if (scope.kind === "collections") {
        const collection = (await mcp.call("get_collection", { id })) as PromoCollection;
        if (collection.status !== "ACTIVE") errors.push(`Коллекция ${id} неактивна`);
      }
    } catch (error) {
      errors.push(
        `${id}: цель не прочитана — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return errors;
}

function scopeOperation(scope: PromotionScope, promotionKind: "Discount" | "Promocode"): string {
  const suffix =
    scope.kind === "variants"
      ? "VariantIDs"
      : scope.kind === "categories"
        ? "CategoryIDs"
        : "CollectionIDs";
  return `Get${promotionKind}${suffix}`;
}

async function readScopeIds(
  mcp: FakeP1Mcp,
  promotionId: string,
  scope: PromotionScope,
  promotionKind: "Discount" | "Promocode" = "Discount",
): Promise<string[]> {
  if (scope.kind === "all") return [];
  const operationId = scopeOperation(scope, promotionKind);
  const response = (await mcp.call("kit_request", {
    operation_id: operationId,
    path_params: { id: promotionId },
    query: { page: 1, per_page: 100 },
  })) as {
    variant_ids?: string[];
    category_ids?: string[];
    collection_ids?: string[];
  };
  return response.variant_ids ?? response.category_ids ?? response.collection_ids ?? [];
}

function sameValue(
  left: components["schemas"]["DiscountValue"] | undefined,
  right: components["schemas"]["DiscountValue"],
): boolean {
  return left?.type === right.type && Number(left.value) === Number(right.value);
}

function sameDates(
  left: components["schemas"]["DiscountDates"],
  right: components["schemas"]["DiscountDates"],
): boolean {
  return (
    left.start_date === right.start_date &&
    (left.end_date ?? undefined) === (right.end_date ?? undefined)
  );
}

function bindingModeForCreate(scope: PromotionScope): "ALL_VARIANTS" | "SELECTED_VARIANTS" {
  return scope.kind === "all" ? "ALL_VARIANTS" : "SELECTED_VARIANTS";
}

function bindingObjects(scope: PromotionScope): components["schemas"]["DiscountObjects"] {
  if (scope.kind === "variants") return { product_variant_ids: scope.ids };
  if (scope.kind === "categories") return { category_ids: scope.ids };
  if (scope.kind === "collections") return { collection_ids: scope.ids };
  return {};
}

function promocodeBindingObjects(
  scope: PromotionScope,
): components["schemas"]["PromocodeObjects"] {
  if (scope.kind === "variants") return { product_variant_ids: scope.ids };
  if (scope.kind === "categories") return { category_ids: scope.ids };
  if (scope.kind === "collections") return { collection_ids: scope.ids };
  return {};
}

async function findEquivalentDiscount(
  mcp: FakeP1Mcp,
  plan: DiscountPlan,
  discounts: OperatorDiscount[],
): Promise<OperatorDiscount | undefined> {
  for (const discount of discounts) {
    if (
      discount.title !== plan.title ||
      discount.status !== plan.status ||
      !sameValue(discount.discount_value, plan.value) ||
      !sameDates(discount.discount_dates, plan.dates)
    ) {
      continue;
    }
    if (plan.scope.kind === "all" && discount.binding_mode === "ALL_VARIANTS") return discount;
    if (plan.scope.kind !== "all") {
      const ids = await readScopeIds(mcp, discount.id, plan.scope);
      if (
        ids.length === plan.scope.ids.length &&
        plan.scope.ids.every((id) => ids.includes(id))
      ) {
        return discount;
      }
    }
  }
  return undefined;
}

function finish(mcp: FakeP1Mcp, result: PromoLauncherResult): PromoLauncherResult {
  mcp.finish(result.report);
  return result;
}

function sameOptionalMoney(left: string | undefined, right: string | undefined): boolean {
  return Number(left ?? "0") === Number(right ?? "0");
}

async function promocodeIsEquivalent(
  mcp: FakeP1Mcp,
  existing: OperatorPromocode,
  plan: PromocodePlan,
): Promise<boolean> {
  if (
    existing.code.toUpperCase() !== plan.code ||
    existing.title !== plan.title ||
    existing.type !== plan.type ||
    existing.status !== plan.status ||
    !sameValue(existing.discount_value, plan.value) ||
    !sameDates(existing.promocode_dates, plan.dates) ||
    !sameOptionalMoney(existing.minimum_order_amount, plan.minimumOrderAmount) ||
    existing.max_usage !== plan.maxUsage ||
    !sameOptionalMoney(existing.max_discount_amount, plan.maxDiscountAmount) ||
    (existing.one_time_use ?? false) !== (plan.oneTimeUse ?? false) ||
    (existing.first_order_only ?? false) !== (plan.firstOrderOnly ?? false) ||
    (existing.show_in_pdp ?? false) !== (plan.showInPdp ?? false)
  ) {
    return false;
  }
  if (plan.type === "ORDER") return existing.binding_mode === undefined;
  if (plan.scope?.kind === "all") return existing.binding_mode === "ALL_VARIANTS";
  if (!plan.scope) return false;
  const ids = await readScopeIds(mcp, existing.id, plan.scope, "Promocode");
  return (
    ids.length === plan.scope.ids.length &&
    plan.scope.ids.every((id) => ids.includes(id))
  );
}

function promocodeCreateRequest(
  plan: PromocodePlan,
): components["schemas"]["CreatePromocodeRequest"] {
  return {
    code: plan.code,
    title: plan.title,
    discount_value: plan.value,
    promocode_dates: plan.dates,
    type: plan.type,
    ...(plan.type === "PRODUCTS" && plan.scope
      ? {
          binding_mode:
            plan.scope.kind === "all"
              ? ("ALL_VARIANTS" as const)
              : plan.scope.kind === "variants"
                ? ("SELECTED_VARIANTS" as const)
                : ("SELECTED_CATEGORIES_COLLECTIONS" as const),
        }
      : {}),
    minimum_order_amount: plan.minimumOrderAmount ?? "0.00",
    ...(plan.maxUsage !== undefined ? { max_usage: plan.maxUsage } : {}),
    ...(plan.maxDiscountAmount
      ? { max_discount_amount: plan.maxDiscountAmount }
      : {}),
    one_time_use: plan.oneTimeUse ?? false,
    first_order_only: plan.firstOrderOnly ?? false,
    show_in_pdp: plan.type === "PRODUCTS" ? (plan.showInPdp ?? false) : false,
  };
}

async function runPromocodeScenario({
  request,
  now,
  timeZone,
  mcp,
}: {
  request: string;
  now: Date;
  timeZone?: string;
  mcp: FakeP1Mcp;
}): Promise<PromoLauncherResult> {
  const parsed = parsePromocodePlan({
    request,
    now,
    conversationTimeZone: timeZone,
  });
  if (parsed.question) return finish(mcp, { kind: "needs_input", report: parsed.question });
  if (parsed.error) return finish(mcp, { kind: "failed", report: parsed.error });
  const plan = parsed.plan!;

  if (plan.scope) {
    const targetErrors = await validateScope(mcp, plan.scope);
    if (targetErrors.length > 0) {
      return finish(mcp, {
        kind: "failed",
        report: `Промокод не создан:\n${targetErrors.map((error) => `- ${error}`).join("\n")}`,
      });
    }
  }

  let results: Array<{ items: OperatorPromocode[]; truncated?: boolean }>;
  try {
    results = [];
    for (const status of ["ACTIVE", "INACTIVE"] as const) {
      results.push(
        (await mcp.call("list_promocodes", { status, all: true })) as {
          items: OperatorPromocode[];
          truncated?: boolean;
        },
      );
    }
  } catch (error) {
    return finish(mcp, {
      kind: "failed",
      report:
        "Промокод не создан: проверка существующего кода не выполнена — " +
        (error instanceof Error ? error.message : String(error)),
    });
  }
  if (results.some((result) => result.truncated)) {
    return finish(mcp, {
      kind: "failed",
      report: "Промокод не создан: список кодов прочитан не полностью",
    });
  }
  const sameCode = results
    .flatMap((result) => result.items)
    .filter((promocode) => promocode.code.toUpperCase() === plan.code);
  for (const existing of sameCode) {
    if (await promocodeIsEquivalent(mcp, existing, plan)) {
      return finish(mcp, {
        kind: "completed",
        promotionId: existing.id,
        report: `Эквивалентный промокод ${plan.code} уже существует: ${existing.id}; дубль не создан.`,
      });
    }
  }
  if (sameCode.length > 0) {
    return finish(mcp, {
      kind: "needs_input",
      report:
        `Код ${plan.code} уже занят промокодом ${sameCode.map((item) => item.id).join(", ")} ` +
        "с другими условиями. Изменить существующий или использовать новый код?",
    });
  }

  let created: OperatorPromocode;
  try {
    created = (await mcp.call("create_promocode", {
      promocode: promocodeCreateRequest(plan),
    })) as OperatorPromocode;
  } catch (error) {
    return finish(mcp, {
      kind: mutationResultIsAmbiguous(error) ? "ambiguous" : "failed",
      report:
        `Создание промокода вызвано один раз и завершилось ошибкой «${
          error instanceof Error ? error.message : String(error)
        }»; ` +
        (mutationResultIsAmbiguous(error)
          ? "результат неизвестен, нужна проверка"
          : "повтор не выполнялся"),
    });
  }

  let bindingError: unknown;
  if (plan.type === "PRODUCTS" && plan.scope && plan.scope.kind !== "all") {
    try {
      await mcp.call("manage_promocode_objects", {
        id: created.id,
        action: "add",
        objects: promocodeBindingObjects(plan.scope),
      });
    } catch (error) {
      bindingError = error;
    }
  }

  let actual: OperatorPromocode;
  try {
    actual = (await mcp.call("get_promocode", { id: created.id })) as OperatorPromocode;
  } catch (error) {
    return finish(mcp, {
      kind: "ambiguous",
      promotionId: created.id,
      report: `Промокод ${created.id} создан, но первое проверочное чтение не удалось: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  let statusError: unknown;
  if (plan.status === "ACTIVE" && actual.status !== "ACTIVE") {
    try {
      await mcp.call("update_promocode", {
        id: actual.id,
        promocode: { status: "ACTIVE" },
      });
    } catch (error) {
      statusError = error;
    }
    try {
      actual = (await mcp.call("get_promocode", { id: created.id })) as OperatorPromocode;
    } catch (error) {
      return finish(mcp, {
        kind: "ambiguous",
        promotionId: created.id,
        report: `Активация промокода вызвана один раз, но повторное чтение не удалось: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  let actualIds: string[] = [];
  if (plan.type === "PRODUCTS" && plan.scope && plan.scope.kind !== "all") {
    try {
      actualIds = await readScopeIds(mcp, actual.id, plan.scope, "Promocode");
    } catch (error) {
      return finish(mcp, {
        kind: "ambiguous",
        promotionId: actual.id,
        report: `Промокод ${actual.id} создан, но фактические привязки не прочитаны: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
  const bindingComplete =
    plan.type === "ORDER" ||
    plan.scope?.kind === "all" ||
    (plan.scope !== undefined &&
      actualIds.length === plan.scope.ids.length &&
      plan.scope.ids.every((id) => actualIds.includes(id)));
  const statusComplete = actual.status === plan.status;
  const ambiguous =
    (bindingError !== undefined && mutationResultIsAmbiguous(bindingError)) ||
    (statusError !== undefined && mutationResultIsAmbiguous(statusError));
  const kind = ambiguous
    ? "ambiguous"
    : bindingError || statusError || !bindingComplete || !statusComplete
      ? "failed"
      : "completed";
  const report =
    `Промокод ${actual.code} (${actual.id}): статус ${actual.status}; тип ${actual.type}; ` +
    `значение ${actual.discount_value?.value} ${actual.discount_value?.type}; ` +
    `даты ${actual.promocode_dates.start_date} — ${
      actual.promocode_dates.end_date ?? "бессрочно"
    }; лимит ${actual.max_usage ?? "без лимита"}; минимум заказа ${
      actual.minimum_order_amount ?? "0.00"
    }; максимум скидки ${actual.max_discount_amount ?? "без лимита"}; ` +
    `first_order_only=${actual.first_order_only ?? false}, ` +
    `one_time_use=${actual.one_time_use ?? false}, show_in_pdp=${actual.show_in_pdp ?? false}; ` +
    `покрытие ${
      plan.type === "ORDER"
        ? "весь заказ"
        : plan.scope?.kind === "all"
          ? "весь каталог"
          : `${actualIds.length} объектов`
    }.` +
    (bindingError
      ? ` Ошибка привязки: ${bindingError instanceof Error ? bindingError.message : String(bindingError)}.`
      : "") +
    (statusError
      ? ` Ошибка активации: ${statusError instanceof Error ? statusError.message : String(statusError)}.`
      : "");
  return finish(mcp, { kind, promotionId: actual.id, report });
}

async function runGiftScenario({
  request,
  mcp,
}: {
  request: string;
  mcp: FakeP1Mcp;
}): Promise<PromoLauncherResult> {
  const parsed = parseGiftPlan(request);
  if (parsed.question) return finish(mcp, { kind: "needs_input", report: parsed.question });
  if (parsed.error) return finish(mcp, { kind: "failed", report: parsed.error });
  const plan = parsed.plan!;

  const targetErrors = await validateScope(mcp, {
    kind: "variants",
    ids: plan.variantIds,
  });
  if (targetErrors.length > 0) {
    return finish(mcp, {
      kind: "failed",
      report: `Подарок не создан:\n${targetErrors.map((error) => `- ${error}`).join("\n")}`,
    });
  }

  try {
    await mcp.call("get_operation_schema", { operation_id: "CreateGift" });
  } catch (error) {
    return finish(mcp, {
      kind: "failed",
      report:
        "Подарок не создан: не удалось получить схему CreateGift для проверки тела — " +
        (error instanceof Error ? error.message : String(error)),
    });
  }

  let created: PromoGift;
  try {
    created = (await mcp.call("kit_request", {
      operation_id: "CreateGift",
      body: {
        title: plan.title,
        min_cart_total: plan.minCartTotal,
        default_sort: plan.defaultSort,
        variant_ids: plan.variantIds,
      },
    })) as PromoGift;
  } catch (error) {
    return finish(mcp, {
      kind: mutationResultIsAmbiguous(error) ? "ambiguous" : "failed",
      report:
        `CreateGift вызван один раз и завершился ошибкой «${
          error instanceof Error ? error.message : String(error)
        }»; ` +
        (mutationResultIsAmbiguous(error)
          ? "результат неизвестен, нужна проверка"
          : "повтор не выполнялся"),
    });
  }

  let actual: PromoGift;
  try {
    actual = (await mcp.call("kit_request", {
      operation_id: "GetGiftById",
      path_params: { id: created.id },
    })) as PromoGift;
  } catch (error) {
    return finish(mcp, {
      kind: "ambiguous",
      promotionId: created.id,
      report: `Подарок ${created.id} создан, но не перечитан: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  let activationError: unknown;
  if (plan.status === "ACTIVE" && actual.status !== "ACTIVE") {
    try {
      await mcp.call("kit_request", {
        operation_id: "UpdateGift",
        path_params: { id: actual.id },
        body: { status: "ACTIVE" },
      });
    } catch (error) {
      activationError = error;
    }
    try {
      actual = (await mcp.call("kit_request", {
        operation_id: "GetGiftById",
        path_params: { id: actual.id },
      })) as PromoGift;
    } catch (error) {
      return finish(mcp, {
        kind: "ambiguous",
        promotionId: created.id,
        report: `Активация подарка вызвана один раз, но повторное чтение не удалось: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  let variantIds: string[];
  try {
    const response = (await mcp.call("kit_request", {
      operation_id: "GetGiftVariants",
      path_params: { id: actual.id },
      query: { page: 1, per_page: 100 },
    })) as { variant_ids: string[] };
    variantIds = response.variant_ids;
  } catch (error) {
    return finish(mcp, {
      kind: "ambiguous",
      promotionId: actual.id,
      report: `Подарок ${actual.id} перечитан, но состав товаров не проверен: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  const variantsComplete =
    variantIds.length === plan.variantIds.length &&
    plan.variantIds.every((id) => variantIds.includes(id));
  const statusComplete = actual.status === plan.status;
  const kind =
    activationError && mutationResultIsAmbiguous(activationError)
      ? "ambiguous"
      : activationError || !variantsComplete || !statusComplete
        ? "failed"
        : "completed";
  const report =
    `Подарок ${actual.title} (${actual.id}): минимальная корзина ${actual.min_cart_total}; ` +
    `статус ${actual.status}; сортировка ${actual.default_sort}; ` +
    `товаров-подарков: ${variantIds.length}. Даты действия KIT API не поддерживает.` +
    (activationError
      ? ` Активация завершилась ошибкой: ${
          activationError instanceof Error ? activationError.message : String(activationError)
        }; повторной записи не было.`
      : "");
  return finish(mcp, { kind, promotionId: actual.id, report });
}

export async function runPromoLauncherScenario({
  request,
  now,
  timeZone,
  mcp,
}: {
  request: string;
  now: Date;
  timeZone?: string;
  mcp: FakeP1Mcp;
}): Promise<PromoLauncherResult> {
  if (/подар(?:ок|ка)/iu.test(request)) {
    return runGiftScenario({ request, mcp });
  }
  if (/промокод/iu.test(request)) {
    return runPromocodeScenario({ request, now, timeZone, mcp });
  }
  const parsed = parseDiscountPlan({
    request,
    now,
    conversationTimeZone: timeZone,
  });
  if (parsed.question) {
    return finish(mcp, { kind: "needs_input", report: parsed.question });
  }
  if (parsed.error) {
    return finish(mcp, { kind: "failed", report: parsed.error });
  }
  const plan = parsed.plan!;

  const targetErrors = await validateScope(mcp, plan.scope);
  if (targetErrors.length > 0) {
    return finish(mcp, {
      kind: "failed",
      report: `Скидка не создана:\n${targetErrors.map((error) => `- ${error}`).join("\n")}`,
    });
  }

  let listed: { items: OperatorDiscount[]; truncated?: boolean };
  try {
    listed = (await mcp.call("list_discounts", {
      status: ["ACTIVE", "INACTIVE", "ARCHIVED"],
      all: true,
    })) as { items: OperatorDiscount[]; truncated?: boolean };
  } catch (error) {
    return finish(mcp, {
      kind: "failed",
      report:
        "Скидка не создана: проверка дублей не выполнена — " +
        (error instanceof Error ? error.message : String(error)),
    });
  }
  if (listed.truncated) {
    return finish(mcp, {
      kind: "failed",
      report: "Скидка не создана: список существующих скидок прочитан не полностью",
    });
  }

  const duplicate = await findEquivalentDiscount(mcp, plan, listed.items);
  if (duplicate) {
    return finish(mcp, {
      kind: "completed",
      promotionId: duplicate.id,
      report: `Эквивалентная скидка уже существует: ${duplicate.id}; дубль не создан.`,
    });
  }
  const overlapRisk = listed.items.some((discount) => discount.status === "ACTIVE");

  let created: OperatorDiscount;
  try {
    created = (await mcp.call("create_discount", {
      discount: {
        title: plan.title,
        discount_value: plan.value,
        discount_dates: plan.dates,
        status: plan.status,
        binding_mode: bindingModeForCreate(plan.scope),
      },
    })) as OperatorDiscount;
  } catch (error) {
    return finish(mcp, {
      kind: mutationResultIsAmbiguous(error) ? "ambiguous" : "failed",
      report:
        `Создание скидки вызвано один раз и завершилось ошибкой «${
          error instanceof Error ? error.message : String(error)
        }»; ` +
        (mutationResultIsAmbiguous(error)
          ? "результат неизвестен, нужна проверка"
          : "повтор не выполнялся"),
    });
  }

  let bindingError: unknown;
  if (plan.scope.kind !== "all") {
    try {
      await mcp.call("manage_discount_objects", {
        id: created.id,
        action: "add",
        objects: bindingObjects(plan.scope),
      });
    } catch (error) {
      bindingError = error;
    }
  }

  let actual: OperatorDiscount;
  let actualIds: string[] = [];
  try {
    actual = (await mcp.call("get_discount", { id: created.id })) as OperatorDiscount;
    actualIds = await readScopeIds(mcp, created.id, plan.scope);
  } catch (error) {
    return finish(mcp, {
      kind: "ambiguous",
      promotionId: created.id,
      report:
        `Скидка ${created.id} создана, но повторное чтение не завершено: ${
          error instanceof Error ? error.message : String(error)
        }. Результат нужно проверить.`,
    });
  }

  const bindingComplete =
    plan.scope.kind === "all" ||
    (actualIds.length === plan.scope.ids.length &&
      plan.scope.ids.every((id) => actualIds.includes(id)));
  const kind =
    bindingError && mutationResultIsAmbiguous(bindingError)
      ? "ambiguous"
      : bindingError || !bindingComplete
        ? "failed"
        : "completed";
  const risk = overlapRisk
    ? "Риск: есть другое активное промо; совместимость не задана владельцем."
    : "Пересечения с активными промо не обнаружены.";
  const report =
    `Скидка ${actual.id}: статус ${actual.status}; значение ${actual.discount_value?.value} ` +
    `${actual.discount_value?.type}; даты ${actual.discount_dates.start_date} — ` +
    `${actual.discount_dates.end_date ?? "бессрочно"}; режим ${actual.binding_mode}; ` +
    `объектов: ${plan.scope.kind === "all" ? "весь каталог" : actualIds.length}. ${risk}` +
    (bindingError
      ? ` Привязка завершилась ошибкой: ${
          bindingError instanceof Error ? bindingError.message : String(bindingError)
        }; повторной записи не было.`
      : "");
  return finish(mcp, { kind, promotionId: actual.id, report });
}
