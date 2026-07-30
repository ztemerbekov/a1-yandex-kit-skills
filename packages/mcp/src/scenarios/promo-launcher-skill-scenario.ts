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

export interface PromoGift {
  id: string;
  title: string;
  min_cart_total: string;
  status: "ACTIVE" | "INACTIVE";
  default_sort: "POPULARITY" | "CHEAPEST" | "EXPENSIVE" | "NEWEST" | "OLDEST";
}

interface P1McpFixture {
  orders?: OperatorOrder[];
  variants?: OperatorVariant[];
  products?: OperatorProduct[];
  categories?: PromoCategory[];
  collections?: PromoCollection[];
  discounts?: OperatorDiscount[];
  promocodes?: OperatorPromocode[];
  gifts?: PromoGift[];
  webhooks?: OperatorWebhook[];
  bindings?: Record<string, string[]>;
  readErrors?: Record<string, Error>;
  writeErrors?: Record<string, Error>;
  writeNoops?: string[];
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
  readonly #categories: PromoCategory[];
  readonly #collections: PromoCollection[];
  readonly #discounts: OperatorDiscount[];
  readonly #promocodes: OperatorPromocode[];
  readonly #gifts: PromoGift[];
  readonly #bindings: Record<string, string[]>;
  readonly #readErrors: Record<string, Error>;
  readonly #writeErrors: Record<string, Error>;
  readonly #writeNoops: Set<string>;
  #discountSequence: number;

  constructor({
    orders = [],
    variants = [],
    products = [],
    categories = [],
    collections = [],
    discounts = [],
    promocodes = [],
    gifts = [],
    webhooks = [],
    bindings = {},
    readErrors = {},
    writeErrors = {},
    writeNoops = [],
  }: P1McpFixture = {}) {
    this.#categories = categories;
    this.#collections = collections;
    this.#discounts = discounts;
    this.#promocodes = promocodes;
    this.#gifts = gifts;
    this.#bindings = bindings;
    this.#readErrors = readErrors;
    this.#writeErrors = writeErrors;
    this.#writeNoops = new Set(writeNoops);
    this.#discountSequence = discounts.length + 1;
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

  async call(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
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

function parseLocalDate(
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
