import type { components } from "yandex-kit-core";
import {
  executeVerifiedMutation,
  isKitObjectId,
  type MutationOutcome,
  type MutationOutcomeKind,
} from "./mutation-scenario.js";

export interface OperatorOrder {
  id: string;
  order_number: number;
  created_at: string;
  status: string;
  client: Record<string, unknown>;
  payment?: { status?: string };
  delivery_chunks: Array<{
    id: number;
    items?: unknown[];
    delivery_info: {
      delivered_at?: string;
      raw_status: string;
      human_status: string;
      interval?: { from?: string; to?: string };
      address: Record<string, unknown>;
    };
  }>;
  total_price: string;
  total_final_price: string;
  purchased_price: string;
  gift_card_discount: string;
}

type KitVariant = components["schemas"]["Variant"];
type KitVariantUpdate = components["schemas"]["UpdateVariantRequest"];

export interface OperatorVariant {
  id: KitVariant["id"];
  sku: KitVariant["sku"];
  name: KitVariant["name"];
  status: KitVariant["status"];
  product_id: KitVariant["product_id"];
  pricing: { price?: KitVariant["pricing"]["price"] };
  stocks: KitVariant["stocks"];
  media: KitVariant["media"];
}

export interface OperatorProduct {
  id: string;
  category_ids: string[];
}

export interface OperatorDiscount {
  id: components["schemas"]["Discount"]["id"];
  title: components["schemas"]["Discount"]["title"];
  status: components["schemas"]["Discount"]["status"];
  discount_value?: components["schemas"]["Discount"]["discount_value"];
  discount_dates: components["schemas"]["Discount"]["discount_dates"];
  binding_mode: components["schemas"]["Discount"]["binding_mode"];
}

type KitDiscountUpdate = components["schemas"]["UpdateDiscountRequest"];

type KitPromocode = components["schemas"]["Promocode"];
type KitPromocodeUpdate = Partial<components["schemas"]["UpdatePromocodeRequest"]>;

export interface OperatorPromocode {
  id: KitPromocode["id"];
  code: KitPromocode["code"];
  title: KitPromocode["title"];
  status: KitPromocode["status"];
  type: KitPromocode["type"];
  binding_mode?: KitPromocode["binding_mode"];
  max_usage?: KitPromocode["max_usage"];
  usage_count: KitPromocode["usage_count"];
  promocode_dates: KitPromocode["promocode_dates"];
}

type KitWebhook = components["schemas"]["Webhook"];

export interface OperatorWebhook {
  id: KitWebhook["id"];
  url: KitWebhook["url"];
  status: KitWebhook["status"];
  events: KitWebhook["events"];
}

export interface RecordedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export const WRITE_ORDER_TOOLS = new Set(["confirm_order", "cancel_order"]);
const READ_ONLY_OPERATOR_TOOLS = new Set([
  "list_orders",
  "get_order",
  "get_order_addons",
  "get_variant",
  "get_promocode",
  "get_webhook",
  "list_variants",
  "list_products",
  "list_discounts",
  "get_discount",
  "list_promocodes",
  "list_webhooks",
]);

/**
 * A small deterministic MCP double for scenario evaluations. It represents prepared
 * orders, payment and delivery facts; every call and the final user-facing report are
 * retained for assertions.
 */
export class FakeOperatorMcp {
  readonly calls: RecordedToolCall[] = [];
  readonly #orders: OperatorOrder[];
  readonly #pageSize: number;
  readonly #addons: Record<string, unknown>;
  readonly #getOrderErrors: Record<string, Error>;
  readonly #listOrderErrors: Record<number, Error>;
  readonly #addonErrors: Record<string, Error>;
  readonly #readErrors: Record<string, Error>;
  readonly #variants: OperatorVariant[];
  readonly #products: OperatorProduct[];
  readonly #discounts: OperatorDiscount[];
  readonly #promocodes: OperatorPromocode[];
  readonly #webhooks: OperatorWebhook[];
  readonly #bindings: Record<string, string[]>;
  readonly #truncated: Partial<Record<"variants" | "products" | "discounts" | "promocodes", boolean>>;
  readonly #writeErrors: Record<string, Error>;
  readonly #writeNoops: Set<string>;
  readonly #variantWriteOverrides: Record<string, Partial<OperatorVariant>>;
  finalAnswer: string | undefined;

  constructor({
    orders,
    pageSize = 100,
    addons = {},
    getOrderErrors = {},
    listOrderErrors = {},
    addonErrors = {},
    readErrors = {},
    variants = [],
    products = [],
    discounts = [],
    promocodes = [],
    webhooks = [],
    bindings = {},
    truncated = {},
    writeErrors = {},
    writeNoops = [],
    variantWriteOverrides = {},
  }: {
    orders: OperatorOrder[];
    pageSize?: number;
    addons?: Record<string, unknown>;
    getOrderErrors?: Record<string, Error>;
    listOrderErrors?: Record<number, Error>;
    addonErrors?: Record<string, Error>;
    readErrors?: Record<string, Error>;
    variants?: OperatorVariant[];
    products?: OperatorProduct[];
    discounts?: OperatorDiscount[];
    promocodes?: OperatorPromocode[];
    webhooks?: OperatorWebhook[];
    bindings?: Record<string, string[]>;
    truncated?: Partial<Record<"variants" | "products" | "discounts" | "promocodes", boolean>>;
    writeErrors?: Record<string, Error>;
    writeNoops?: string[];
    variantWriteOverrides?: Record<string, Partial<OperatorVariant>>;
  }) {
    this.#orders = orders;
    this.#pageSize = pageSize;
    this.#addons = addons;
    this.#getOrderErrors = getOrderErrors;
    this.#listOrderErrors = listOrderErrors;
    this.#addonErrors = addonErrors;
    this.#readErrors = readErrors;
    this.#variants = variants;
    this.#products = products;
    this.#discounts = discounts;
    this.#promocodes = promocodes;
    this.#webhooks = webhooks;
    this.#bindings = bindings;
    this.#truncated = truncated;
    this.#writeErrors = writeErrors;
    this.#writeNoops = new Set(writeNoops);
    this.#variantWriteOverrides = variantWriteOverrides;
  }

  get writeCalls(): RecordedToolCall[] {
    return this.calls.filter((call) => {
      if (call.name === "kit_request") return !String(call.arguments.operation_id).startsWith("Get");
      return !READ_ONLY_OPERATOR_TOOLS.has(call.name);
    });
  }

  async call(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, arguments: arguments_ });

    if (name === "list_orders") {
      const page = typeof arguments_.page === "number" ? arguments_.page : 1;
      if (this.#listOrderErrors[page]) throw this.#listOrderErrors[page];
      const start = (page - 1) * this.#pageSize;
      return {
        orders: this.#orders.slice(start, start + this.#pageSize),
        total_count: this.#orders.length,
      };
    }

    if (this.#readErrors[name]) throw this.#readErrors[name];

    if (name === "get_order") {
      const id = String(arguments_.id);
      if (this.#getOrderErrors[id]) throw this.#getOrderErrors[id];
      const found = this.#orders.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Order ${id} is not prepared in FakeOperatorMcp`);
      return structuredClone(found);
    }

    if (name === "get_order_addons") {
      const id = String(arguments_.id);
      if (this.#addonErrors[id]) throw this.#addonErrors[id];
      return this.#addons[id] ?? [];
    }

    if (name === "list_variants") {
      const search = typeof arguments_.name === "string" ? arguments_.name.toLowerCase() : undefined;
      const statuses = Array.isArray(arguments_.status)
        ? new Set(arguments_.status.map(String))
        : typeof arguments_.status === "string"
          ? new Set([arguments_.status])
          : undefined;
      const variants = this.#variants.filter(
        (variant) =>
          (statuses ? statuses.has(variant.status) : variant.status !== "ARCHIVED") &&
          (!search ||
            variant.id.toLowerCase() === search ||
            variant.sku.toLowerCase() === search ||
            variant.name.toLowerCase().includes(search)),
      );
      if (arguments_.all) return { items: variants, pages: 1, truncated: this.#truncated.variants ?? false };
      return { variants, total_count: variants.length };
    }
    if (name === "get_variant") {
      const id = String(arguments_.id);
      const found = this.#variants.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Variant ${id} is not prepared in FakeOperatorMcp`);
      return structuredClone(found);
    }
    if (name === "list_products") {
      if (arguments_.all) return { items: this.#products, pages: 1, truncated: this.#truncated.products ?? false };
      return { products: this.#products };
    }
    if (name === "list_discounts") {
      const requestedStatuses = Array.isArray(arguments_.status)
        ? new Set(arguments_.status.map(String))
        : new Set([String(arguments_.status ?? "ACTIVE")]);
      const discounts = this.#discounts.filter((discount) => requestedStatuses.has(discount.status));
      if (arguments_.all) return { items: discounts, pages: 1, truncated: this.#truncated.discounts ?? false };
      return { discounts, total_count: discounts.length };
    }
    if (name === "get_discount") {
      const id = String(arguments_.id);
      const found = this.#discounts.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Discount ${id} is not prepared in FakeOperatorMcp`);
      return structuredClone(found);
    }
    if (name === "list_promocodes") {
      const status = typeof arguments_.status === "string" ? arguments_.status : undefined;
      const promocodes = this.#promocodes.filter((promocode) => !status || promocode.status === status);
      if (arguments_.all) return { items: promocodes, pages: 1, truncated: this.#truncated.promocodes ?? false };
      return { promocodes, total_count: promocodes.length };
    }
    if (name === "get_promocode") {
      const id = String(arguments_.id);
      const found = this.#promocodes.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Promocode ${id} is not prepared in FakeOperatorMcp`);
      return structuredClone(found);
    }
    if (name === "list_webhooks") return { webhooks: this.#webhooks, total_count: this.#webhooks.length };
    if (name === "get_webhook") {
      const id = String(arguments_.id);
      const found = this.#webhooks.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Webhook ${id} is not prepared in FakeOperatorMcp`);
      return structuredClone(found);
    }
    if (name === "kit_request") {
      const operationId = String(arguments_.operation_id);
      const id = String((arguments_.path_params as Record<string, unknown> | undefined)?.id);
      const ids = this.#bindings[`${operationId}:${id}`] ?? [];
      if (operationId.includes("Category")) return { category_ids: ids, total_count: ids.length };
      if (operationId.includes("Collection")) return { collection_ids: ids, total_count: ids.length };
      return { variant_ids: ids, total_count: ids.length };
    }

    if (name === "confirm_order") {
      const id = String(arguments_.id);
      const writeKey = `${name}:${id}`;
      const preparedError = this.#writeErrors[writeKey];
      if (preparedError) throw preparedError;
      if (this.#writeNoops.has(writeKey)) return { ok: true };
      const found = this.#orders.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Order ${id} is not prepared in FakeOperatorMcp`);
      if (found.status !== "WAIT_FOR_CONFIRMATION") {
        throw new Error(`Order ${id} is ${found.status}, expected WAIT_FOR_CONFIRMATION`);
      }
      found.status = "ORDER_PLACED";
      return { ok: true };
    }

    if (name === "cancel_order") {
      const id = String(arguments_.id);
      const writeKey = `${name}:${id}`;
      const preparedError = this.#writeErrors[writeKey];
      if (preparedError) throw preparedError;
      if (this.#writeNoops.has(writeKey)) return { ok: true };
      const found = this.#orders.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Order ${id} is not prepared in FakeOperatorMcp`);
      if (TERMINAL_ORDER_STATUSES.has(found.status)) {
        throw new Error(`Order ${id} is already ${found.status}`);
      }
      found.status = "CANCELLED";
      return { ok: true };
    }

    if (name === "update_variant") {
      const id = String(arguments_.id);
      const writeKey = `${name}:${id}`;
      const preparedError = this.#writeErrors[writeKey];
      if (preparedError) throw preparedError;
      if (this.#writeNoops.has(writeKey)) return { ok: true };
      const found = this.#variants.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Variant ${id} is not prepared in FakeOperatorMcp`);
      const patch = arguments_.variant as KitVariantUpdate;
      if (patch.pricing) found.pricing = { ...found.pricing, ...patch.pricing };
      if (patch.stocks) found.stocks = patch.stocks;
      if (patch.media) found.media = patch.media;
      Object.assign(
        found,
        structuredClone(
          this.#variantWriteOverrides[writeKey] ?? this.#variantWriteOverrides[id] ?? {},
        ),
      );
      return found;
    }

    if (name === "update_promocode") {
      const id = String(arguments_.id);
      const writeKey = `${name}:${id}`;
      const preparedError = this.#writeErrors[writeKey];
      if (preparedError) throw preparedError;
      if (this.#writeNoops.has(writeKey)) return { ok: true };
      const found = this.#promocodes.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Promocode ${id} is not prepared in FakeOperatorMcp`);
      const patch = arguments_.promocode as KitPromocodeUpdate;
      if (patch.max_usage !== undefined) found.max_usage = patch.max_usage ?? undefined;
      if (patch.status !== undefined) found.status = patch.status;
      return found;
    }

    if (name === "update_discount") {
      const id = String(arguments_.id);
      const writeKey = `${name}:${id}`;
      const preparedError = this.#writeErrors[writeKey];
      if (preparedError) throw preparedError;
      if (this.#writeNoops.has(writeKey)) return { ok: true };
      const found = this.#discounts.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Discount ${id} is not prepared in FakeOperatorMcp`);
      const patch = arguments_.discount as KitDiscountUpdate;
      if (patch.discount_value !== undefined) found.discount_value = patch.discount_value;
      if (patch.status !== undefined) found.status = patch.status;
      if (patch.binding_mode !== undefined) found.binding_mode = patch.binding_mode;
      return found;
    }

    if (name === "manage_promocode_objects") {
      const id = String(arguments_.id);
      const writeKey = `${name}:${id}`;
      const preparedError = this.#writeErrors[writeKey];
      if (preparedError) throw preparedError;
      if (this.#writeNoops.has(writeKey)) return { ok: true };
      const objects = arguments_.objects as components["schemas"]["PromocodeObjects"];
      const ids = objects.product_variant_ids ?? [];
      const bindingKey = `GetPromocodeVariantIDs:${id}`;
      const current = this.#bindings[bindingKey] ?? [];
      this.#bindings[bindingKey] =
        arguments_.action === "remove"
          ? current.filter((candidate) => !ids.includes(candidate))
          : [...new Set([...current, ...ids])];
      return { ok: true };
    }

    if (name === "validate_webhook") {
      const id = String(arguments_.id);
      const writeKey = `${name}:${id}`;
      const preparedError = this.#writeErrors[writeKey];
      if (preparedError) throw preparedError;
      if (this.#writeNoops.has(writeKey)) return { ok: true };
      const found = this.#webhooks.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Webhook ${id} is not prepared in FakeOperatorMcp`);
      if (arguments_.activate === true) found.status = "ACTIVE";
      return { ok: true };
    }

    if (WRITE_ORDER_TOOLS.has(name)) {
      throw new Error(`Unsupported write tool in FakeOperatorMcp: ${name}`);
    }
    throw new Error(`Unsupported FakeOperatorMcp tool: ${name}`);
  }

  finish(report: string): void {
    this.finalAnswer = report;
  }
}

interface OrderFinding {
  order: OperatorOrder;
  kind: "existing_order" | "lost_sale" | "money" | "reputation";
  facts: string;
  consequence: string;
  action: string;
  critical: boolean;
  detail?: OperatorOrder;
  addons?: unknown;
  missingData: string[];
}

const TERMINAL_ORDER_STATUSES = new Set(["DELIVERED", "CANCELLED", "COMPLETED"]);
const REFUND_OR_CANCELLATION_STATUSES = new Set([
  "CANCELLATION_IN_PROGRESS",
  "DELIVERY_CANCELLED",
  "FULL_REFUND",
  "PARTIAL_REFUND",
]);

function isKnownOperatorRequest(request: string): boolean {
  return /как дела(?: в магазине)?|дай статус|проведи разбор|всё ли нормально|что срочного|что требует внимания|статус.*магазин|проверь.*магазин|покажи.*магазин|разбери.*магазин|найди.*магазин/u.test(
    request.toLowerCase(),
  );
}

function hasOverdueDelivery(order: OperatorOrder, now: Date): boolean {
  if (TERMINAL_ORDER_STATUSES.has(order.status)) return false;
  return order.delivery_chunks.some((chunk) => {
    const deadline = chunk.delivery_info.interval?.to;
    return deadline !== undefined && new Date(deadline).getTime() < now.getTime() && !chunk.delivery_info.delivered_at;
  });
}

function paymentIsSuspicious(order: OperatorOrder): boolean {
  const paymentStatus = order.payment?.status;
  return (
    paymentStatus === "PAYMENT_REFUNDED" ||
    (paymentStatus === "PAYMENT_PENDING_OR_UNPAID" &&
      ["WAIT_FOR_DELIVERY", "CREATING_FINAL_RECEIPTS", "DELIVERED", "COMPLETED"].includes(order.status))
  );
}

function findingsFor(order: OperatorOrder, now: Date): OrderFinding[] {
  const findings: OrderFinding[] = [];

  if (order.status === "WAIT_FOR_CONFIRMATION") {
    findings.push({
      order,
      kind: "existing_order",
      facts: "статус WAIT_FOR_CONFIRMATION",
      consequence: "заказ ждёт действия продавца и может сорвать выполнение",
      action: "проверить детали и, если решение уже принято, отдельно запросить подтверждение заказа",
      critical: true,
      missingData: [],
    });
  } else if (order.status === "NEW") {
    findings.push({
      order,
      kind: "lost_sale",
      facts: "новый заказ (статус NEW)",
      consequence: "нужна оперативная обработка, чтобы не потерять продажу",
      action: "проверить детали заказа и следующий разрешённый статус",
      critical: false,
      missingData: [],
    });
  }

  if (REFUND_OR_CANCELLATION_STATUSES.has(order.status)) {
    findings.push({
      order,
      kind: "money",
      facts: `статус ${order.status}`,
      consequence: "заказ затрагивает деньги или исполнение обязательств",
      action: "сверить причину и статус оплаты; API не сообщает причину сам по себе",
      critical: true,
      missingData: [],
    });
  }

  if (paymentIsSuspicious(order)) {
    findings.push({
      order,
      kind: "money",
      facts: `статус заказа ${order.status}, статус оплаты ${order.payment?.status}`,
      consequence: "состояние оплаты не согласуется с этапом исполнения",
      action: "сверить платёж у эквайера и историю статусов; данных о причине в ответе нет",
      critical: true,
      missingData: [],
    });
  }

  if (hasOverdueDelivery(order, now)) {
    const deadline = order.delivery_chunks.find((chunk) => {
      const to = chunk.delivery_info.interval?.to;
      return to !== undefined && new Date(to).getTime() < now.getTime() && !chunk.delivery_info.delivered_at;
    })?.delivery_info.interval?.to;
    findings.push({
      order,
      kind: "reputation",
      facts: `интервал доставки завершился ${deadline}, но delivered_at отсутствует`,
      consequence: "покупатель может не получить заказ вовремя, что создаёт репутационный риск",
      action: "сверить доставку с перевозчиком и зафиксировать фактический результат",
      critical: true,
      missingData: [],
    });
  }

  return findings;
}

interface TimeSlice {
  from: Date;
  to: Date;
  label: string;
}

function requestedPeriod(request: string, now: Date): TimeSlice | undefined {
  const normalized = request.toLowerCase();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (/сегодня|за день/u.test(normalized)) return { from: todayStart, to: now, label: "сегодня" };
  if (/утро/u.test(normalized)) {
    return {
      from: todayStart,
      to: new Date(Math.min(now.getTime(), todayStart.getTime() + 12 * 60 * 60 * 1000)),
      label: "утро",
    };
  }
  if (/недел/u.test(normalized)) {
    const weekday = (now.getUTCDay() + 6) % 7;
    return {
      from: new Date(todayStart.getTime() - weekday * 24 * 60 * 60 * 1000),
      to: now,
      label: "текущая неделя",
    };
  }
  return undefined;
}

function inPeriod(order: OperatorOrder, period: TimeSlice | undefined): boolean {
  if (!period) return true;
  const createdAt = new Date(order.created_at).getTime();
  return createdAt >= period.from.getTime() && createdAt <= period.to.getTime();
}

function formatFinding(finding: OrderFinding): string {
  const order = finding.detail ?? finding.order;
  const client = [order.client.last_name, order.client.first_name, order.client.patronymic]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
  const itemCount = order.delivery_chunks.reduce((total, chunk) => total + (chunk.items?.length ?? 0), 0);
  const observedDetails = [
    client && `Клиент: ${client}`,
    itemCount > 0 && `позиций: ${itemCount}`,
    Array.isArray(finding.addons) && `услуг: ${finding.addons.length}`,
  ].filter(Boolean);
  const missingData = finding.missingData.length > 0 ? ` Недостающие данные: ${finding.missingData.join("; ")}.` : "";
  const details = observedDetails.length > 0 ? ` Детали: ${observedDetails.join(", ")}.` : "";
  return `- Заказ #${order.order_number} (${order.id}): ${finding.facts}. Возможное последствие: ${finding.consequence}. Доступное действие: ${finding.action}.${details}${missingData}`;
}

function kindRank(kind: OrderFinding["kind"]): number {
  return ["existing_order", "lost_sale", "money", "reputation"].indexOf(kind);
}

type SignalKind = OrderFinding["kind"] | "storefront";

interface OperationalSignal {
  kind: SignalKind;
  object: string;
  facts: string;
  consequence: string;
  action: string;
  critical: boolean;
  requiresReview?: boolean;
}

function signalRank(kind: SignalKind): number {
  return [...["existing_order", "lost_sale", "money", "reputation"], "storefront"].indexOf(kind);
}

function formatSignal(signal: OperationalSignal): string {
  const label = signal.requiresReview ? "Требует проверки" : "Проблема";
  return `- ${label}: ${signal.object}. ${signal.facts}. Возможное последствие: ${signal.consequence}. Доступное действие: ${signal.action}.`;
}

function expired(endDate: string | undefined, now: Date): boolean {
  return endDate !== undefined && new Date(endDate).getTime() < now.getTime();
}

async function selectedBindingIds(
  mcp: FakeOperatorMcp,
  resource: "Discount" | "Promocode",
  id: string,
  bindingMode: string | undefined,
): Promise<string[] | undefined> {
  if (bindingMode === "SELECTED_VARIANTS") {
    const response = (await mcp.call("kit_request", {
      operation_id: `Get${resource}VariantIDs`,
      path_params: { id },
    })) as { variant_ids?: string[] };
    return (response.variant_ids ?? []).map((variantId) => `variant:${variantId}`);
  }
  if (bindingMode === "SELECTED_CATEGORIES_COLLECTIONS") {
    const [categories, collections] = await Promise.all([
      mcp.call("kit_request", { operation_id: `Get${resource}CategoryIDs`, path_params: { id } }) as Promise<{
        category_ids?: string[];
      }>,
      mcp.call("kit_request", { operation_id: `Get${resource}CollectionIDs`, path_params: { id } }) as Promise<{
        collection_ids?: string[];
      }>,
    ]);
    return [
      ...(categories.category_ids ?? []).map((categoryId) => `category:${categoryId}`),
      ...(collections.collection_ids ?? []).map((collectionId) => `collection:${collectionId}`),
    ];
  }
  return undefined;
}

async function inspectStore(mcp: FakeOperatorMcp, now: Date): Promise<OperationalSignal[]> {
  const signals: OperationalSignal[] = [];
  const safeRead = async <T>(
    object: string,
    read: Promise<T>,
    kind: SignalKind,
  ): Promise<T | undefined> => {
    try {
      return await read;
    } catch (error) {
      signals.push({
        kind,
        object,
        facts: `чтение не удалось: ${error instanceof Error ? error.message : String(error)}`,
        consequence: "этот раздел не проверен полностью",
        action: "повторить чтение; не делать вывод о полном отсутствии рисков",
        critical: false,
        requiresReview: true,
      });
      return undefined;
    }
  };
  const [
    variantRead,
    productRead,
    discountRead,
    promocodeRead,
    webhookRead,
  ] = await Promise.all([
    safeRead(
      "Покрытие каталога",
      mcp.call("list_variants", { status: ["PUBLISHED"], all: true }) as Promise<{
        items: OperatorVariant[];
        truncated?: boolean;
      }>,
      "storefront",
    ),
    safeRead(
      "Покрытие каталога",
      mcp.call("list_products", { all: true }) as Promise<{
        items: OperatorProduct[];
        truncated?: boolean;
      }>,
      "storefront",
    ),
    safeRead(
      "Покрытие промо",
      mcp.call("list_discounts", { status: ["ACTIVE"], all: true }) as Promise<{
        items: OperatorDiscount[];
        truncated?: boolean;
      }>,
      "money",
    ),
    safeRead(
      "Покрытие промо",
      mcp.call("list_promocodes", { status: "ACTIVE", all: true }) as Promise<{
        items: OperatorPromocode[];
        truncated?: boolean;
      }>,
      "money",
    ),
    safeRead(
      "Покрытие вебхуков",
      mcp.call("list_webhooks", {}) as Promise<{ webhooks: OperatorWebhook[] }>,
      "reputation",
    ),
  ]);
  const variantResult = variantRead ?? { items: [] };
  const productResult = productRead ?? { items: [] };
  const discountResult = discountRead ?? { items: [] };
  const promocodeResult = promocodeRead ?? { items: [] };
  const webhookResult = webhookRead ?? { webhooks: [] };
  if (variantResult.truncated || productResult.truncated) {
    signals.push({
      kind: "storefront",
      object: "Покрытие каталога",
      facts: "автопагинация остановилась до полного чтения SKU или продуктов",
      consequence: "оставшиеся карточки не проверены",
      action: "повторить проверку меньшими страницами; не считать каталог полностью проверенным",
      critical: false,
      requiresReview: true,
    });
  }
  if (discountResult.truncated || promocodeResult.truncated) {
    signals.push({
      kind: "money",
      object: "Покрытие промо",
      facts: "автопагинация остановилась до полного чтения активных скидок или промокодов",
      consequence: "оставшиеся предложения не проверены",
      action: "повторить проверку меньшими страницами; не считать промо полностью проверенными",
      critical: false,
      requiresReview: true,
    });
  }
  const promotionTargets: Array<{ object: string; ids: string[] | undefined }> = [];
  const products = new Map(productResult.items.map((product) => [product.id, product]));

  for (const variant of variantResult.items) {
    const object = `SKU ${variant.sku} (${variant.id})`;
    if (!variant.pricing.price || Number(variant.pricing.price) <= 0) {
      signals.push({
        kind: "storefront",
        object,
        facts: "опубликованный SKU не имеет положительной базовой цены",
        consequence: "витрина не может корректно предложить товар покупателю",
        action: "передать полный аудит в a1-yandex-kit-catalog-doctor и указать правильную цену",
        critical: true,
      });
    }
    const available = variant.stocks.reduce((total, stock) => total + Math.max(0, stock.quantity - stock.reserved), 0);
    if (available === 0) {
      signals.push({
        kind: "storefront",
        object,
        facts: "доступный остаток равен нулю",
        consequence: "товар нельзя купить со склада",
        action: "сверить остатки и источник правильного количества",
        critical: true,
      });
    }
    if (!variant.media.some((media) => media.type === "IMAGE" && media.image_id)) {
      signals.push({
        kind: "storefront",
        object,
        facts: "нет изображения",
        consequence: "карточка хуже продаёт и может выглядеть незавершённой",
        action: "передать глубокую проверку изображений в a1-yandex-kit-catalog-doctor",
        critical: false,
      });
    }
    const product = products.get(variant.product_id);
    if (!product) {
      signals.push({
        kind: "storefront",
        object,
        facts: `не прочитан родительский продукт ${variant.product_id}`,
        consequence: "невозможно подтвердить наличие активной категории",
        action: "прочитать продукт и его привязки категорий",
        critical: false,
      });
    } else if (product.category_ids.length === 0) {
      signals.push({
        kind: "storefront",
        object,
        facts: "у родительского продукта нет активной категории",
        consequence: "опубликованный товар может быть недоступен в навигации витрины",
        action: "передать выбор правильной категории в a1-yandex-kit-catalog-doctor",
        critical: true,
      });
    }
  }

  for (const discount of discountResult.items) {
    if (expired(discount.discount_dates.end_date, now)) {
      signals.push({
        kind: "money",
        object: `Скидка ${discount.title} (${discount.id})`,
        facts: `статус ACTIVE при завершении ${discount.discount_dates.end_date}`,
        consequence: "покупателю может примениться истёкшее предложение",
        action: "сверить правило акции и при явном решении отдельно запросить её отключение",
        critical: true,
      });
    }
    let bindingIds: string[] | undefined;
    try {
      bindingIds = await selectedBindingIds(mcp, "Discount", discount.id, discount.binding_mode);
    } catch (error) {
      signals.push({
        kind: "money",
        object: `Скидка ${discount.title} (${discount.id})`,
        facts: `привязки не прочитаны: ${error instanceof Error ? error.message : String(error)}`,
        consequence: "область применения акции не проверена",
        action: "повторить чтение привязок",
        critical: false,
        requiresReview: true,
      });
    }
    promotionTargets.push({ object: `Скидка ${discount.title} (${discount.id})`, ids: bindingIds });
    if (bindingIds?.length === 0) {
      signals.push({
        kind: "money",
        object: `Скидка ${discount.title} (${discount.id})`,
        facts: `режим ${discount.binding_mode}, но привязанные объекты отсутствуют`,
        consequence: "акция не достигнет ожидаемых товаров",
        action: "сверить нужные объекты; не подбирать их автоматически",
        critical: true,
      });
    }
  }

  for (const promocode of promocodeResult.items) {
    if (expired(promocode.promocode_dates.end_date, now)) {
      signals.push({
        kind: "money",
        object: `Промокод ${promocode.code} (${promocode.id})`,
        facts: `статус ACTIVE при завершении ${promocode.promocode_dates.end_date}`,
        consequence: "покупателю может быть обещано истёкшее предложение",
        action: "сверить правило промокода и при явном решении отдельно запросить отключение",
        critical: true,
      });
    }
    if (promocode.max_usage !== undefined && promocode.usage_count >= promocode.max_usage) {
      signals.push({
        kind: "money",
        object: `Промокод ${promocode.code} (${promocode.id})`,
        facts: `использований ${promocode.usage_count} из лимита ${promocode.max_usage}`,
        consequence: "промокод больше не даст ожидаемую скидку",
        action: "сообщить владельцу об исчерпанном лимите; новый лимит не угадывать",
        critical: true,
      });
    }
    let bindingIds: string[] | undefined;
    try {
      bindingIds = await selectedBindingIds(mcp, "Promocode", promocode.id, promocode.binding_mode);
    } catch (error) {
      signals.push({
        kind: "money",
        object: `Промокод ${promocode.code} (${promocode.id})`,
        facts: `привязки не прочитаны: ${error instanceof Error ? error.message : String(error)}`,
        consequence: "область применения промокода не проверена",
        action: "повторить чтение привязок",
        critical: false,
        requiresReview: true,
      });
    }
    promotionTargets.push({ object: `Промокод ${promocode.code} (${promocode.id})`, ids: bindingIds });
    if (bindingIds?.length === 0) {
      signals.push({
        kind: "money",
        object: `Промокод ${promocode.code} (${promocode.id})`,
        facts: `режим ${promocode.binding_mode}, но привязанные объекты отсутствуют`,
        consequence: "промокод не достигнет ожидаемых товаров",
        action: "сверить нужные объекты; не подбирать их автоматически",
        critical: true,
      });
    }
  }

  const overlappingPair = promotionTargets.find((left, index) =>
    promotionTargets.slice(index + 1).some((right) =>
      left.ids === undefined || right.ids === undefined || left.ids.some((id) => right.ids?.includes(id)),
    ),
  );
  const overlappingWith = overlappingPair && promotionTargets.find((candidate) =>
    candidate !== overlappingPair &&
    (overlappingPair.ids === undefined || candidate.ids === undefined || overlappingPair.ids.some((id) => candidate.ids?.includes(id))),
  );
  if (overlappingPair && overlappingWith) {
    signals.push({
      kind: "money",
      object: `${overlappingPair.object} и ${overlappingWith.object}`,
      facts: "их области применения могут пересекаться",
      consequence: "правило их совместимости не подтверждено",
      action: "требуется правило владельца о совместном применении; не объявлять это ошибкой без правила",
      critical: false,
      requiresReview: true,
    });
  }

  const activeWebhooks = webhookResult.webhooks.filter((webhook) => webhook.status === "ACTIVE");
  for (const webhook of webhookResult.webhooks.filter((webhook) => webhook.status === "INACTIVE")) {
    signals.push({
      kind: "reputation",
      object: `Вебхук ${webhook.id}`,
      facts: `статус INACTIVE (${webhook.url})`,
      consequence: "интеграция не получит его события",
      action: "сверить необходимость вебхука и события до явной активации",
      critical: true,
    });
  }
  const requiredEvents = ["ORDER_STATUS_CHANGED", "ORDER_PAYMENT_STATUS_CHANGED", "ORDER_DELIVERY_STATUS_CHANGED"];
  const coveredEvents = new Set<string>(activeWebhooks.flatMap((webhook) => webhook.events));
  const missingEvents = webhookRead
    ? requiredEvents.filter((event) => !coveredEvents.has(event))
    : [];
  if (missingEvents.length > 0) {
    signals.push({
      kind: "reputation",
      object: "Покрытие вебхуков",
      facts: `не подтверждено покрытие событий ${missingEvents.join(", ")}`,
      consequence: "внешняя система может не узнать о части изменений заказа",
      action: "требуется проверка необходимости интеграции и её ожидаемых событий; отсутствие вебхука само по себе не ошибка",
      critical: false,
      requiresReview: true,
    });
  }

  return signals;
}

export async function runOperatorReadOnlyScenario({
  request,
  kitContext,
  now,
  mcp,
}: {
  request: string;
  kitContext: boolean;
  now: Date;
  mcp: FakeOperatorMcp;
}): Promise<{ report: string }> {
  if (/^как дела\?*$/iu.test(request.trim()) && !kitContext) {
    const report = "Уточните, о чём речь: нужен контекст Яндекс KIT, чтобы разобрать магазин.";
    mcp.finish(report);
    return { report };
  }
  if (!isKnownOperatorRequest(request)) {
    const report = "Уточните запрос к магазину Яндекс KIT: нужен текущий статус, полный разбор или только срочные проблемы?";
    mcp.finish(report);
    return { report };
  }

  const orders: OperatorOrder[] = [];
  let page = 1;
  let totalCount = 0;
  let orderCoverageError: string | undefined;
  do {
    let response: { orders: OperatorOrder[]; total_count: number };
    try {
      response = (await mcp.call("list_orders", { page, per_page: 100 })) as {
        orders: OperatorOrder[];
        total_count: number;
      };
    } catch (error) {
      orderCoverageError =
        `страница ${page}: ${error instanceof Error ? error.message : String(error)}`;
      break;
    }
    orders.push(...response.orders);
    totalCount = response.total_count;
    if (response.orders.length === 0 && orders.length < totalCount) {
      orderCoverageError =
        `страница ${page}: пагинация остановилась на ${orders.length} из ${totalCount}`;
      break;
    }
    page += 1;
  } while (orders.length < totalCount);

  const allFindings = orders.flatMap((order) => findingsFor(order, now));
  const needsDetails = new Set(allFindings.map((finding) => finding.order.id));
  for (const id of needsDetails) {
    const orderFindings = allFindings.filter((finding) => finding.order.id === id);
    try {
      const detail = (await mcp.call("get_order", { id })) as OperatorOrder;
      for (const finding of orderFindings) finding.detail = detail;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const finding of orderFindings) finding.missingData.push(`детали заказа: ${message}`);
    }
    try {
      const addons = await mcp.call("get_order_addons", { id });
      for (const finding of orderFindings) finding.addons = addons;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const finding of orderFindings) finding.missingData.push(`услуги заказа: ${message}`);
    }
  }

  const urgentOnly = /что срочного/u.test(request.toLowerCase());
  const period = requestedPeriod(request, now);
  const visibleOrderFindings = allFindings
    .filter((finding) => finding.critical || inPeriod(finding.order, period))
    .filter((finding) => !urgentOnly || finding.critical)
    .sort((left, right) => kindRank(left.kind) - kindRank(right.kind));
  const storeSignals = await inspectStore(mcp, now);
  const visibleStoreSignals = storeSignals.filter(
    (signal) =>
      !urgentOnly ||
      signal.critical ||
      (signal.requiresReview && signal.object.startsWith("Покрытие")),
  );
  const reportLines = [
    ...visibleOrderFindings.map((finding) => ({ kind: finding.kind, text: formatFinding(finding) })),
    ...visibleStoreSignals.map((signal) => ({ kind: signal.kind, text: formatSignal(signal) })),
  ].sort((left, right) => signalRank(left.kind) - signalRank(right.kind));

  const report = [
    urgentOnly ? "Срочный операционный срез" : "Текущий операционный статус",
    period ? `Срез: ${period.label}; UTC ${period.from.toISOString()} — ${period.to.toISOString()}.` : "Срез: текущий статус.",
    `Проверено заказов: ${orders.length} из ${orderCoverageError && totalCount === 0 ? "?" : totalCount}; страниц: ${page - 1}.`,
    orderCoverageError
      ? `Покрытие заказов неполное: проверено ${orders.length} из ${totalCount === 0 ? "?" : totalCount}; ${orderCoverageError}.`
      : `Покрытие заказов полное: проверено ${orders.length} из ${totalCount}.`,
    `Сводка сигналов: заказы ${visibleOrderFindings.length}, каталог ${visibleStoreSignals.filter((signal) => signal.kind === "storefront").length}, промо ${visibleStoreSignals.filter((signal) => signal.kind === "money").length}, вебхуки ${visibleStoreSignals.filter((signal) => signal.kind === "reputation").length}.`,
    reportLines.length === 0 && !orderCoverageError
      ? "Объективных рисков по прочитанным данным не найдено."
      : [
          orderCoverageError
            ? "- Требует проверки: неполное покрытие заказов; вывод об отсутствии рисков не делается."
            : undefined,
          ...reportLines.map((line) => line.text),
        ]
          .filter(Boolean)
          .join("\n"),
    "API не содержит признака просмотра заказа, поэтому отчёт не делает выводов о непросмотренных заказах.",
    "Это read-only разбор: операции подтверждения и отмены не вызывались.",
  ].join("\n\n");
  mcp.finish(report);
  return { report };
}

type ExactResolution<T> =
  | { matched: T; fromDetail: boolean; outcome?: never }
  | { matched?: never; outcome: MutationOutcome };

function resolveExact<T>({
  items,
  reference,
  label,
  pluralLabel,
  complete = true,
  idOf,
  alternateMatches,
}: {
  items: T[];
  reference: string;
  label: string;
  pluralLabel: string;
  complete?: boolean;
  idOf: (item: T) => string;
  alternateMatches: (item: T) => boolean;
}): ExactResolution<T> {
  const idMatches = items.filter((item) => idOf(item) === reference);
  if (idMatches.length === 1) return { matched: idMatches[0]!, fromDetail: false };
  if (idMatches.length > 1) {
    return {
      outcome: {
        kind: "ambiguous",
        message: `Найдено несколько ${pluralLabel} с ID «${reference}»; запись не выполняется`,
      },
    };
  }
  const matches = items.filter(alternateMatches);
  if (!complete) {
    return {
      outcome: {
        kind: "failed",
        message:
          `${label} ${reference}: чтение списка неполное, поэтому уникальность цели ` +
          "не подтверждена; укажите точный ID или повторите после полного чтения",
      },
    };
  }
  if (matches.length === 1) return { matched: matches[0]!, fromDetail: false };
  if (matches.length === 0) {
    return { outcome: { kind: "failed", message: `${label} ${reference}: не найден` } };
  }
  return {
    outcome: {
      kind: "ambiguous",
      message: `Найдено несколько ${pluralLabel} для «${reference}»; укажите точный ID`,
    },
  };
}

async function findOrderByReference(
  mcp: FakeOperatorMcp,
  reference: string,
): Promise<ExactResolution<OperatorOrder>> {
  if (isKitObjectId(reference)) {
    try {
      return {
        matched: (await mcp.call("get_order", { id: reference })) as OperatorOrder,
        fromDetail: true,
      };
    } catch (error) {
      return {
        outcome: {
          kind: "failed",
          message: `Заказ ${reference}: чтение явного ID не удалось — ${error instanceof Error ? error.message : String(error)}; запись не выполняется`,
        },
      };
    }
  }
  const orders: OperatorOrder[] = [];
  let page = 1;
  let totalCount = 0;
  do {
    let response: { orders: OperatorOrder[]; total_count: number };
    try {
      response = (await mcp.call("list_orders", { page, per_page: 100 })) as {
        orders: OperatorOrder[];
        total_count: number;
      };
    } catch (error) {
      return {
        outcome: {
          kind: "failed",
          message:
            `Заказ ${reference}: разрешение цели остановилось на странице ${page} — ` +
            `${error instanceof Error ? error.message : String(error)}; запись не выполняется`,
        },
      };
    }
    orders.push(...response.orders);
    totalCount = response.total_count;
    if (response.orders.length === 0 && orders.length < totalCount) {
      return {
        outcome: {
          kind: "failed",
          message:
            `Заказ ${reference}: пагинация остановилась на ${orders.length} из ${totalCount}; ` +
            "уникальность цели не подтверждена, запись не выполняется",
        },
      };
    }
    page += 1;
  } while (orders.length < totalCount);

  return resolveExact({
    items: orders,
    reference,
    label: "Заказ",
    pluralLabel: "заказов",
    idOf: (order) => order.id,
    alternateMatches: (order) => String(order.order_number) === reference,
  });
}

function formatMutationOutcomes(outcomes: MutationOutcome[]): string {
  const sections: Array<{ kind: MutationOutcomeKind; title: string }> = [
    { kind: "completed", title: "Выполнено" },
    { kind: "failed", title: "Не выполнено" },
    { kind: "ambiguous", title: "Неоднозначно" },
  ];
  return sections
    .map(({ kind, title }) => {
      const items = outcomes.filter((outcome) => outcome.kind === kind);
      const details = items.map((item) => `- ${item.message}.`).join("\n");
      return `${title} (${items.length})${details ? `\n${details}` : ""}`;
    })
    .join("\n\n");
}

function finishMutationReport(mcp: FakeOperatorMcp, outcomes: MutationOutcome[]): { report: string } {
  const report = formatMutationOutcomes(outcomes);
  mcp.finish(report);
  return { report };
}

async function findVariantByReference(
  mcp: FakeOperatorMcp,
  reference: string,
): Promise<ExactResolution<OperatorVariant>> {
  if (isKitObjectId(reference)) {
    try {
      return {
        matched: (await mcp.call("get_variant", { id: reference })) as OperatorVariant,
        fromDetail: true,
      };
    } catch (error) {
      return {
        outcome: {
          kind: "failed",
          message: `SKU ${reference}: чтение явного ID не удалось — ${error instanceof Error ? error.message : String(error)}; запись не выполняется`,
        },
      };
    }
  }
  let listed: { items: OperatorVariant[]; truncated?: boolean };
  try {
    listed = (await mcp.call("list_variants", { name: reference, all: true })) as {
      items: OperatorVariant[];
      truncated?: boolean;
    };
  } catch (error) {
    return {
      outcome: {
        kind: "failed",
        message: `SKU ${reference}: поиск не выполнен — ${error instanceof Error ? error.message : String(error)}; запись не выполняется`,
      },
    };
  }
  return resolveExact({
    items: listed.items,
    reference,
    label: "SKU",
    pluralLabel: "SKU",
    complete: !listed.truncated,
    idOf: (variant) => variant.id,
    alternateMatches: (variant) => variant.sku.toLowerCase() === reference.toLowerCase(),
  });
}

async function findPromocodeByReference(
  mcp: FakeOperatorMcp,
  reference: string,
): Promise<ExactResolution<OperatorPromocode>> {
  if (isKitObjectId(reference)) {
    try {
      return {
        matched: (await mcp.call("get_promocode", { id: reference })) as OperatorPromocode,
        fromDetail: true,
      };
    } catch (error) {
      return {
        outcome: {
          kind: "failed",
          message: `Промокод ${reference}: чтение явного ID не удалось — ${error instanceof Error ? error.message : String(error)}; запись не выполняется`,
        },
      };
    }
  }
  let results: Array<{ items: OperatorPromocode[]; truncated?: boolean }>;
  try {
    results = await Promise.all(
      (["ACTIVE", "INACTIVE"] as const).map(
        (status) =>
          mcp.call("list_promocodes", { status, all: true }) as Promise<{
            items: OperatorPromocode[];
            truncated?: boolean;
          }>,
      ),
    );
  } catch (error) {
    return {
      outcome: {
        kind: "failed",
        message: `Промокод ${reference}: поиск не выполнен — ${error instanceof Error ? error.message : String(error)}; запись не выполняется`,
      },
    };
  }
  return resolveExact({
    items: results.flatMap((result) => result.items),
    reference,
    label: "Промокод",
    pluralLabel: "промокодов",
    complete: results.every((result) => !result.truncated),
    idOf: (promocode) => promocode.id,
    alternateMatches: (promocode) => promocode.code.toLowerCase() === reference.toLowerCase(),
  });
}

async function findDiscountsByReference(
  mcp: FakeOperatorMcp,
  reference: string,
): Promise<ExactResolution<OperatorDiscount>> {
  if (isKitObjectId(reference)) {
    try {
      return {
        matched: (await mcp.call("get_discount", { id: reference })) as OperatorDiscount,
        fromDetail: true,
      };
    } catch (error) {
      return {
        outcome: {
          kind: "failed",
          message: `Акция ${reference}: чтение явного ID не удалось — ${error instanceof Error ? error.message : String(error)}; запись не выполняется`,
        },
      };
    }
  }
  let result: { items: OperatorDiscount[]; truncated?: boolean };
  try {
    result = (await mcp.call("list_discounts", {
      status: ["ACTIVE", "INACTIVE", "ARCHIVED"],
      all: true,
    })) as { items: OperatorDiscount[]; truncated?: boolean };
  } catch (error) {
    return {
      outcome: {
        kind: "failed",
        message: `Акция ${reference}: поиск не выполнен — ${error instanceof Error ? error.message : String(error)}; запись не выполняется`,
      },
    };
  }
  return resolveExact({
    items: result.items,
    reference,
    label: "Акция",
    pluralLabel: "акций",
    complete: !result.truncated,
    idOf: (discount) => discount.id,
    alternateMatches: (discount) =>
      discount.title.toLowerCase() === reference.toLowerCase(),
  });
}

async function cancelOrder(
  mcp: FakeOperatorMcp,
  order: OperatorOrder,
  reason?: string,
  fromDetail = false,
): Promise<MutationOutcome> {
  return executeVerifiedMutation({
    subject: `Заказ ${order.id}`,
    initialBefore: fromDetail ? order : undefined,
    read: () => mcp.call("get_order", { id: order.id }) as Promise<OperatorOrder>,
    validateBefore: (before) =>
      TERMINAL_ORDER_STATUSES.has(before.status)
        ? `статус ${before.status}, отмена недоступна`
        : undefined,
    write: (before) =>
      mcp.call("cancel_order", reason ? { id: before.id, reason } : { id: before.id }),
    verifyAfter: (after) => ({
      valid: after.status === "CANCELLED",
      message:
        after.status === "CANCELLED"
          ? reason
            ? `Заказ ${after.id} отменён. Причина владельца: ${reason}. API отмены не сохраняет причину; она остаётся только в журнале MCP и отчёте`
            : `Заказ ${after.id} отменён; причина владельцем не указана`
          : `Заказ ${after.id}: после отмены текущий статус ${after.status}`,
    }),
  });
}

export async function runOperatorScenario({
  request,
  kitContext,
  now,
  mcp,
}: {
  request: string;
  kitContext: boolean;
  now: Date;
  mcp: FakeOperatorMcp;
}): Promise<{ report: string }> {
  if (/обработай\s+заказы/iu.test(request)) {
    return finishMutationReport(mcp, [
      {
        kind: "ambiguous",
        message: "Уточните действие: заказы нужно подтвердить или отменить?",
      },
    ]);
  }

  const missingPrice = request.match(/исправь\s+цену\s+([^\s,]+)/iu);
  if (missingPrice) {
    return finishMutationReport(mcp, [
      {
        kind: "ambiguous",
        message: `Укажите точную новую цену для ${missingPrice[1]}; без значения запись не выполняется`,
      },
    ]);
  }

  const priceChange = request.match(
    /поставь\s+цену\s+([\d\s]+(?:[.,]\d{1,2})?)\s+для\s+([^\s,]+)/iu,
  );
  if (priceChange) {
    const rawPrice = priceChange[1]!.replace(/\s+/gu, "").replace(",", ".");
    const price = Number(rawPrice).toFixed(2);
    const reference = priceChange[2]!;
    const resolution = await findVariantByReference(mcp, reference);
    if (resolution.outcome) return finishMutationReport(mcp, [resolution.outcome]);
    const matched = resolution.matched;
    const outcome = await executeVerifiedMutation({
      subject: `SKU ${matched.sku} (${matched.id})`,
      initialBefore: resolution.fromDetail ? matched : undefined,
      read: () => mcp.call("get_variant", { id: matched.id }) as Promise<OperatorVariant>,
      write: (before) =>
        mcp.call("update_variant", {
        id: before.id,
        variant: { pricing: { price } },
        }),
      verifyAfter: (after) => ({
        valid: after.pricing.price === price,
        message:
          after.pricing.price === price
            ? `SKU ${after.sku} (${after.id}): цена установлена ${price}`
            : `SKU ${after.sku} (${after.id}): ожидалась цена ${price}, прочитано ${after.pricing.price ?? "нет цены"}`,
      }),
    });
    return finishMutationReport(mcp, [outcome]);
  }

  const stockChange = request.match(
    /(?:установи|поставь)\s+остаток\s+(\d+)\s+для\s+([^\s,]+)\s+на\s+складе\s+([^\s,]+)/iu,
  );
  if (stockChange) {
    const quantity = Number(stockChange[1]);
    const reference = stockChange[2]!;
    const warehouseId = stockChange[3]!;
    const resolution = await findVariantByReference(mcp, reference);
    if (resolution.outcome) return finishMutationReport(mcp, [resolution.outcome]);
    const matched = resolution.matched;
    const outcome = await executeVerifiedMutation({
      subject: `SKU ${matched.sku} (${matched.id}), склад ${warehouseId}`,
      initialBefore: resolution.fromDetail ? matched : undefined,
      read: () => mcp.call("get_variant", { id: matched.id }) as Promise<OperatorVariant>,
      validateBefore: (before) =>
        before.stocks.some((stock) => stock.warehouse_id === warehouseId)
          ? undefined
          : `склад ${warehouseId} отсутствует в текущих остатках; источник нового склада нужно уточнить`,
      write: (before) =>
        mcp.call("update_variant", {
          id: before.id,
          variant: {
            stocks: before.stocks.map((stock) =>
              stock.warehouse_id === warehouseId ? { ...stock, quantity } : stock,
            ),
          },
        }),
      verifyAfter: (after, before) => {
        const expectedStocks = before.stocks.map((stock) =>
          stock.warehouse_id === warehouseId ? { ...stock, quantity } : stock,
        );
        const matchesExpectedState =
          JSON.stringify(after.stocks) === JSON.stringify(expectedStocks);
        return {
          valid: matchesExpectedState,
          message: matchesExpectedState
            ? `SKU ${after.sku} (${after.id}), склад ${warehouseId}: остаток установлен ${quantity}; полный массив остатков подтверждён`
            : `SKU ${after.sku} (${after.id}): ожидался полный массив stocks ${JSON.stringify(expectedStocks)}, прочитано ${JSON.stringify(after.stocks)}`,
        };
      },
    });
    return finishMutationReport(mcp, [outcome]);
  }

  const promocodeLimit = request.match(
    /(?:установи|поставь)\s+лимит\s+(\d+)\s+для\s+промокода\s+([^\s,]+)/iu,
  );
  if (promocodeLimit) {
    const limit = Number(promocodeLimit[1]);
    const reference = promocodeLimit[2]!;
    const resolution = await findPromocodeByReference(mcp, reference);
    if (resolution.outcome) return finishMutationReport(mcp, [resolution.outcome]);
    const matched = resolution.matched;
    const outcome = await executeVerifiedMutation({
      subject: `Промокод ${matched.code} (${matched.id})`,
      initialBefore: resolution.fromDetail ? matched : undefined,
      read: () => mcp.call("get_promocode", { id: matched.id }) as Promise<OperatorPromocode>,
      write: (before) =>
        mcp.call("update_promocode", {
          id: before.id,
          promocode: { max_usage: limit },
        }),
      verifyAfter: (after) => ({
        valid: after.max_usage === limit,
        message:
          after.max_usage === limit
            ? `Промокод ${after.code} (${after.id}): лимит установлен ${limit}`
            : `Промокод ${after.code} (${after.id}): ожидался лимит ${limit}, прочитано ${after.max_usage ?? "без лимита"}`,
      }),
    });
    return finishMutationReport(mcp, [outcome]);
  }

  const promocodeStatus = request.match(/(активируй|отключи)\s+промокод\s+([^\s,]+)/iu);
  if (promocodeStatus) {
    const reference = promocodeStatus[2]!;
    const status: OperatorPromocode["status"] =
      promocodeStatus[1]!.toLowerCase() === "активируй" ? "ACTIVE" : "INACTIVE";
    const resolution = await findPromocodeByReference(mcp, reference);
    if (resolution.outcome) return finishMutationReport(mcp, [resolution.outcome]);
    const matched = resolution.matched;
    const outcome = await executeVerifiedMutation({
      subject: `Промокод ${matched.code} (${matched.id})`,
      initialBefore: resolution.fromDetail ? matched : undefined,
      read: () => mcp.call("get_promocode", { id: matched.id }) as Promise<OperatorPromocode>,
      write: (before) =>
        mcp.call("update_promocode", {
          id: before.id,
          promocode: { status },
        }),
      verifyAfter: (after) => ({
        valid: after.status === status,
        message:
          after.status === status
            ? `Промокод ${after.code} (${after.id}): статус установлен ${status}`
            : `Промокод ${after.code} (${after.id}): ожидался статус ${status}, прочитано ${after.status}`,
      }),
    });
    return finishMutationReport(mcp, [outcome]);
  }

  const discountValue = request.match(
    /установи\s+скидку\s+(\d+(?:[.,]\d+)?)\s*(%|₽|руб(?:ль|ля|лей)?)\s+для\s+акции\s+(.+)$/iu,
  );
  if (discountValue) {
    const value = Number(discountValue[1]!.replace(",", ".")).toFixed(2);
    const type: components["schemas"]["DiscountValue"]["type"] =
      discountValue[2] === "%" ? "PERCENT" : "VALUE";
    const reference = discountValue[3]!.trim();
    const resolution = await findDiscountsByReference(mcp, reference);
    if (resolution.outcome) return finishMutationReport(mcp, [resolution.outcome]);
    const matched = resolution.matched;
    const outcome = await executeVerifiedMutation({
      subject: `Акция ${matched.title} (${matched.id})`,
      initialBefore: resolution.fromDetail ? matched : undefined,
      read: () => mcp.call("get_discount", { id: matched.id }) as Promise<OperatorDiscount>,
      validateBefore: (before) =>
        before.status === "ARCHIVED" ? "архивную акцию нельзя обновить без явной разархивации" : undefined,
      write: (before) =>
        mcp.call("update_discount", {
          id: before.id,
          discount: { discount_value: { value, type } },
        }),
      verifyAfter: (after) => ({
        valid: after.discount_value?.value === value && after.discount_value.type === type,
        message:
          after.discount_value?.value === value && after.discount_value.type === type
            ? `Акция ${after.title} (${after.id}): скидка установлена ${value} ${type}`
            : `Акция ${after.title} (${after.id}): ожидалась скидка ${value} ${type}, прочитано ${after.discount_value?.value ?? "нет значения"} ${after.discount_value?.type ?? ""}`.trim(),
      }),
    });
    return finishMutationReport(mcp, [outcome]);
  }

  const promocodeBinding = request.match(
    /привяжи\s+([^\s,]+)\s+к\s+промокоду\s+([^\s,]+)/iu,
  );
  if (promocodeBinding) {
    const variantReference = promocodeBinding[1]!;
    const promocodeReference = promocodeBinding[2]!;
    const [variantResolution, promocodeResolution] = await Promise.all([
      findVariantByReference(mcp, variantReference),
      findPromocodeByReference(mcp, promocodeReference),
    ]);
    if (variantResolution.outcome) {
      return finishMutationReport(mcp, [variantResolution.outcome]);
    }
    if (promocodeResolution.outcome) {
      return finishMutationReport(mcp, [promocodeResolution.outcome]);
    }
    const variant = variantResolution.matched;
    const promocode = promocodeResolution.matched;
    const readBinding = async () => {
      const currentPromocode = (await mcp.call("get_promocode", {
        id: promocode.id,
      })) as OperatorPromocode;
      const response = (await mcp.call("kit_request", {
        operation_id: "GetPromocodeVariantIDs",
        path_params: { id: promocode.id },
      })) as { variant_ids?: string[] };
      return { promocode: currentPromocode, variantIds: response.variant_ids ?? [] };
    };
    const outcome = await executeVerifiedMutation({
      subject: `Промокод ${promocode.code} (${promocode.id}), SKU ${variant.sku} (${variant.id})`,
      read: readBinding,
      validateBefore: (before) =>
        before.promocode.binding_mode === "SELECTED_VARIANTS"
          ? undefined
          : `режим ${before.promocode.binding_mode ?? "не указан"}; для точной привязки SKU нужен SELECTED_VARIANTS`,
      write: () =>
        mcp.call("manage_promocode_objects", {
          id: promocode.id,
          action: "add",
          objects: { product_variant_ids: [variant.id] },
        }),
      verifyAfter: (after) => ({
        valid: after.variantIds.includes(variant.id),
        message: after.variantIds.includes(variant.id)
          ? `Промокод ${promocode.code} (${promocode.id}): SKU ${variant.sku} (${variant.id}) привязан`
          : `Промокод ${promocode.code} (${promocode.id}): повторное чтение не содержит SKU ${variant.sku} (${variant.id})`,
      }),
    });
    return finishMutationReport(mcp, [outcome]);
  }

  const webhookActivation = request.match(
    /(?:(?:проверь|валидируй)\s+и\s+)?активируй\s+вебхук\s+([^\s,]+)/iu,
  );
  if (webhookActivation) {
    const id = webhookActivation[1]!;
    const outcome = await executeVerifiedMutation({
      subject: `Вебхук ${id}`,
      read: () => mcp.call("get_webhook", { id }) as Promise<OperatorWebhook>,
      write: () => mcp.call("validate_webhook", { id, activate: true }),
      verifyAfter: (after) => ({
        valid: after.status === "ACTIVE",
        message:
          after.status === "ACTIVE"
            ? `Вебхук ${after.id}: валидация выполнена, текущий статус ACTIVE`
            : `Вебхук ${after.id}: после валидации текущий статус ${after.status}`,
      }),
    });
    return finishMutationReport(mcp, [outcome]);
  }

  const confirmationBatch = request.match(/подтверд(?:и|ить)\s+заказы\s+(.+)$/iu);
  if (confirmationBatch) {
    const references = confirmationBatch[1]!
      .split(/[,\s]+/u)
      .map((reference) => reference.trim())
      .filter(Boolean);
    const outcomes: MutationOutcome[] = [];

    for (const reference of references) {
      const resolution = await findOrderByReference(mcp, reference);
      if (resolution.outcome) {
        outcomes.push(resolution.outcome);
        continue;
      }
      const listedOrder = resolution.matched;
      outcomes.push(
        await executeVerifiedMutation({
          subject: `Заказ ${listedOrder.id}`,
          initialBefore: resolution.fromDetail ? listedOrder : undefined,
          read: () => mcp.call("get_order", { id: listedOrder.id }) as Promise<OperatorOrder>,
          validateBefore: (before) =>
            before.status === "WAIT_FOR_CONFIRMATION"
              ? undefined
              : `статус ${before.status}, подтверждение недоступно`,
          write: (before) => mcp.call("confirm_order", { id: before.id }),
          verifyAfter: (after) => ({
            valid: after.status !== "WAIT_FOR_CONFIRMATION",
            message:
              after.status === "WAIT_FOR_CONFIRMATION"
                ? `Заказ ${after.id}: после записи статус не изменился`
                : `Заказ ${after.id} подтверждён; текущий статус ${after.status}`,
          }),
        }),
      );
    }

    return finishMutationReport(mcp, outcomes);
  }

  const cancellationBatch = request.match(/отмен(?:и|ить)\s+заказы\s+(.+)$/iu);
  if (cancellationBatch) {
    const [rawReferences, rawReason] = cancellationBatch[1]!.split(
      /\s*,?\s*причина\s*:\s*/iu,
      2,
    );
    const reason = rawReason?.trim() || undefined;
    const references = rawReferences!
      .split(/[,\s]+/u)
      .map((reference) => reference.trim())
      .filter(Boolean);
    const outcomes: MutationOutcome[] = [];

    for (const reference of references) {
      const resolution = await findOrderByReference(mcp, reference);
      if (resolution.outcome) {
        outcomes.push(resolution.outcome);
        continue;
      }
      outcomes.push(
        await cancelOrder(mcp, resolution.matched, reason, resolution.fromDetail),
      );
    }

    return finishMutationReport(mcp, outcomes);
  }

  const cancellation = request.match(
    /отмен(?:и|ить)\s+заказ\s+([^\s,]+)(?:\s*,?\s*причина\s*:\s*(.+))?$/iu,
  );
  if (cancellation) {
    const reference = cancellation[1]!;
    const reason = cancellation[2]?.trim() || undefined;
    const resolution = await findOrderByReference(mcp, reference);
    if (resolution.outcome) return finishMutationReport(mcp, [resolution.outcome]);
    const outcome = await cancelOrder(
      mcp,
      resolution.matched,
      reason,
      resolution.fromDetail,
    );
    return finishMutationReport(mcp, [outcome]);
  }

  const confirmation = request.match(/подтверд(?:и|ить)\s+заказ\s+([^\s,]+)/iu);
  if (!confirmation) return runOperatorReadOnlyScenario({ request, kitContext, now, mcp });

  const reference = confirmation[1]!;
  const resolution = await findOrderByReference(mcp, reference);
  if (resolution.outcome) return finishMutationReport(mcp, [resolution.outcome]);
  const listedOrder = resolution.matched;

  const outcome = await executeVerifiedMutation({
    subject: `Заказ ${listedOrder.id}`,
    initialBefore: resolution.fromDetail ? listedOrder : undefined,
    read: () => mcp.call("get_order", { id: listedOrder.id }) as Promise<OperatorOrder>,
    validateBefore: (before) =>
      before.status === "WAIT_FOR_CONFIRMATION"
        ? undefined
        : `статус ${before.status}, подтверждение недоступно`,
    write: (before) => mcp.call("confirm_order", { id: before.id }),
    verifyAfter: (after) => ({
      valid: after.status !== "WAIT_FOR_CONFIRMATION",
      message:
        after.status === "WAIT_FOR_CONFIRMATION"
          ? `Заказ ${after.id}: после записи статус не изменился`
          : `Заказ ${after.id} подтверждён; текущий статус ${after.status}`,
    }),
  });
  return finishMutationReport(mcp, [outcome]);
}
