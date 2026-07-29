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

export interface OperatorVariant {
  id: string;
  sku: string;
  name: string;
  status: string;
  product_id: string;
  pricing: { price?: string };
  stocks: Array<{ warehouse_id: string; quantity: number; reserved: number }>;
  media: Array<{ type: string; image_id?: string }>;
}

export interface OperatorProduct {
  id: string;
  category_ids: string[];
}

export interface OperatorDiscount {
  id: string;
  title: string;
  status: string;
  discount_dates: { start_date: string; end_date?: string };
  binding_mode: string;
}

export interface OperatorPromocode {
  id: string;
  code: string;
  title: string;
  status: string;
  type: string;
  binding_mode?: string;
  max_usage?: number;
  usage_count: number;
  promocode_dates: { start_date: string; end_date?: string };
}

export interface OperatorWebhook {
  id: string;
  url: string;
  status: string;
  events: string[];
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
  "list_variants",
  "list_products",
  "list_discounts",
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
  readonly #addonErrors: Record<string, Error>;
  readonly #variants: OperatorVariant[];
  readonly #products: OperatorProduct[];
  readonly #discounts: OperatorDiscount[];
  readonly #promocodes: OperatorPromocode[];
  readonly #webhooks: OperatorWebhook[];
  readonly #bindings: Record<string, string[]>;
  readonly #truncated: Partial<Record<"variants" | "products" | "discounts" | "promocodes", boolean>>;
  finalAnswer: string | undefined;

  constructor({
    orders,
    pageSize = 100,
    addons = {},
    getOrderErrors = {},
    addonErrors = {},
    variants = [],
    products = [],
    discounts = [],
    promocodes = [],
    webhooks = [],
    bindings = {},
    truncated = {},
  }: {
    orders: OperatorOrder[];
    pageSize?: number;
    addons?: Record<string, unknown>;
    getOrderErrors?: Record<string, Error>;
    addonErrors?: Record<string, Error>;
    variants?: OperatorVariant[];
    products?: OperatorProduct[];
    discounts?: OperatorDiscount[];
    promocodes?: OperatorPromocode[];
    webhooks?: OperatorWebhook[];
    bindings?: Record<string, string[]>;
    truncated?: Partial<Record<"variants" | "products" | "discounts" | "promocodes", boolean>>;
  }) {
    this.#orders = orders;
    this.#pageSize = pageSize;
    this.#addons = addons;
    this.#getOrderErrors = getOrderErrors;
    this.#addonErrors = addonErrors;
    this.#variants = variants;
    this.#products = products;
    this.#discounts = discounts;
    this.#promocodes = promocodes;
    this.#webhooks = webhooks;
    this.#bindings = bindings;
    this.#truncated = truncated;
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
      const start = (page - 1) * this.#pageSize;
      return {
        orders: this.#orders.slice(start, start + this.#pageSize),
        total_count: this.#orders.length,
      };
    }

    if (name === "get_order") {
      const id = String(arguments_.id);
      if (this.#getOrderErrors[id]) throw this.#getOrderErrors[id];
      const found = this.#orders.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Order ${id} is not prepared in FakeOperatorMcp`);
      return found;
    }

    if (name === "get_order_addons") {
      const id = String(arguments_.id);
      if (this.#addonErrors[id]) throw this.#addonErrors[id];
      return this.#addons[id] ?? [];
    }

    if (name === "list_variants") {
      const variants = this.#variants.filter((variant) => variant.status === "PUBLISHED");
      if (arguments_.all) return { items: variants, pages: 1, truncated: this.#truncated.variants ?? false };
      return { variants, total_count: variants.length };
    }
    if (name === "list_products") {
      if (arguments_.all) return { items: this.#products, pages: 1, truncated: this.#truncated.products ?? false };
      return { products: this.#products };
    }
    if (name === "list_discounts") {
      const discounts = this.#discounts.filter((discount) => discount.status === "ACTIVE");
      if (arguments_.all) return { items: discounts, pages: 1, truncated: this.#truncated.discounts ?? false };
      return { discounts, total_count: discounts.length };
    }
    if (name === "list_promocodes") {
      const promocodes = this.#promocodes.filter((promocode) => promocode.status === "ACTIVE");
      if (arguments_.all) return { items: promocodes, pages: 1, truncated: this.#truncated.promocodes ?? false };
      return { promocodes, total_count: promocodes.length };
    }
    if (name === "list_webhooks") return { webhooks: this.#webhooks, total_count: this.#webhooks.length };
    if (name === "kit_request") {
      const operationId = String(arguments_.operation_id);
      const id = String((arguments_.path_params as Record<string, unknown> | undefined)?.id);
      const ids = this.#bindings[`${operationId}:${id}`] ?? [];
      if (operationId.includes("Category")) return { category_ids: ids, total_count: ids.length };
      if (operationId.includes("Collection")) return { collection_ids: ids, total_count: ids.length };
      return { variant_ids: ids, total_count: ids.length };
    }

    if (WRITE_ORDER_TOOLS.has(name)) {
      throw new Error(`Unexpected write tool in read-only operator scenario: ${name}`);
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
  return /как дела(?: в магазине)?|дай статус|проведи разбор|всё ли нормально|что срочного|что требует внимания|статус.*магазин/u.test(
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
  const [variantResult, productResult, discountResult, promocodeResult, webhookResult] = await Promise.all([
    mcp.call("list_variants", { status: ["PUBLISHED"], all: true }) as Promise<{ items: OperatorVariant[]; truncated?: boolean }>,
    mcp.call("list_products", { all: true }) as Promise<{ items: OperatorProduct[]; truncated?: boolean }>,
    mcp.call("list_discounts", { status: ["ACTIVE"], all: true }) as Promise<{ items: OperatorDiscount[]; truncated?: boolean }>,
    mcp.call("list_promocodes", { status: "ACTIVE", all: true }) as Promise<{ items: OperatorPromocode[]; truncated?: boolean }>,
    mcp.call("list_webhooks", {}) as Promise<{ webhooks: OperatorWebhook[] }>,
  ]);
  const signals: OperationalSignal[] = [];
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
    const bindingIds = await selectedBindingIds(mcp, "Discount", discount.id, discount.binding_mode);
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
    const bindingIds = await selectedBindingIds(mcp, "Promocode", promocode.id, promocode.binding_mode);
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
  const coveredEvents = new Set(activeWebhooks.flatMap((webhook) => webhook.events));
  const missingEvents = requiredEvents.filter((event) => !coveredEvents.has(event));
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
  do {
    const response = (await mcp.call("list_orders", { page, per_page: 100 })) as {
      orders: OperatorOrder[];
      total_count: number;
    };
    orders.push(...response.orders);
    totalCount = response.total_count;
    if (response.orders.length === 0 && orders.length < totalCount) {
      throw new Error(`Order pagination stopped at ${orders.length} of ${totalCount}`);
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
  const visibleStoreSignals = storeSignals.filter((signal) => !urgentOnly || signal.critical);
  const reportLines = [
    ...visibleOrderFindings.map((finding) => ({ kind: finding.kind, text: formatFinding(finding) })),
    ...visibleStoreSignals.map((signal) => ({ kind: signal.kind, text: formatSignal(signal) })),
  ].sort((left, right) => signalRank(left.kind) - signalRank(right.kind));

  const report = [
    urgentOnly ? "Срочный операционный срез" : "Текущий операционный статус",
    period ? `Срез: ${period.label}; UTC ${period.from.toISOString()} — ${period.to.toISOString()}.` : "Срез: текущий статус.",
    `Проверено заказов: ${orders.length} из ${totalCount}; страниц: ${page - 1}.`,
    `Сводка сигналов: заказы ${visibleOrderFindings.length}, каталог ${visibleStoreSignals.filter((signal) => signal.kind === "storefront").length}, промо ${visibleStoreSignals.filter((signal) => signal.kind === "money").length}, вебхуки ${visibleStoreSignals.filter((signal) => signal.kind === "reputation").length}.`,
    reportLines.length === 0
      ? "Объективных рисков по прочитанным данным не найдено."
      : reportLines.map((line) => line.text).join("\n"),
    "API не содержит признака просмотра заказа, поэтому отчёт не делает выводов о непросмотренных заказах.",
    "Это read-only разбор: операции подтверждения и отмены не вызывались.",
  ].join("\n\n");
  mcp.finish(report);
  return { report };
}
