import type { components } from "yandex-kit-core";

import type {
  OperatorDiscount,
  OperatorPromocode,
} from "./operator-skill-scenario.js";
import {
  FakeP1Mcp,
  parseLocalDate,
  type PromoGift,
} from "./promo-launcher-skill-scenario.js";
import { mutationResultIsAmbiguous } from "./skill-mutation-protocol.js";

type PromotionKind = "discount" | "promocode" | "gift";
type ObjectKind = "variants" | "categories" | "collections";
type ItemOutcomeKind = "completed" | "failed" | "ambiguous";

interface ItemOutcome {
  id: string;
  kind: ItemOutcomeKind;
  report: string;
}

export interface PromoLifecycleResult {
  kind: "completed" | "needs_input" | "failed" | "ambiguous" | "partial";
  report: string;
  succeeded: string[];
  failed: string[];
  ambiguous: string[];
}

function finish(
  mcp: FakeP1Mcp,
  result: PromoLifecycleResult,
): PromoLifecycleResult {
  mcp.finish(result.report);
  return result;
}

function immediate(
  mcp: FakeP1Mcp,
  kind: "needs_input" | "failed",
  report: string,
): PromoLifecycleResult {
  return finish(mcp, {
    kind,
    report,
    succeeded: [],
    failed: kind === "failed" ? ["request"] : [],
    ambiguous: [],
  });
}

function aggregate(mcp: FakeP1Mcp, outcomes: ItemOutcome[]): PromoLifecycleResult {
  const succeeded = outcomes
    .filter((outcome) => outcome.kind === "completed")
    .map((outcome) => outcome.id);
  const failed = outcomes
    .filter((outcome) => outcome.kind === "failed")
    .map((outcome) => outcome.id);
  const ambiguous = outcomes
    .filter((outcome) => outcome.kind === "ambiguous")
    .map((outcome) => outcome.id);
  const kind =
    failed.length + ambiguous.length === 0
      ? "completed"
      : succeeded.length > 0 || (failed.length > 0 && ambiguous.length > 0)
        ? "partial"
        : ambiguous.length > 0
          ? "ambiguous"
          : "failed";
  const section = (title: string, ids: string[]): string =>
    `${title} (${ids.length})\n${ids.length > 0 ? ids.map((id) => `- ${id}`).join("\n") : "- нет"}`;
  return finish(mcp, {
    kind,
    succeeded,
    failed,
    ambiguous,
    report: [
      ...outcomes.map((outcome) => outcome.report),
      section("Успешно", succeeded),
      section("Неуспешно", failed),
      section("Неоднозначно", ambiguous),
    ].join("\n\n"),
  });
}

function promotionKind(request: string): PromotionKind | undefined {
  if (/подар(?:ок|ка|ки)/iu.test(request)) return "gift";
  if (/промокод/iu.test(request)) return "promocode";
  if (/скидк/iu.test(request)) return "discount";
  return undefined;
}

function targetIds(request: string, kind: PromotionKind): string[] {
  const conventionalPrefix =
    kind === "discount" ? "discount-" : kind === "promocode" ? "promocode-" : "gift-";
  const conventional = [
    ...request.matchAll(new RegExp(`\\b${conventionalPrefix}[0-9a-z-]+\\b`, "giu")),
  ].map((match) => match[0]!);
  if (conventional.length > 0) return [...new Set(conventional)];

  const noun =
    kind === "discount"
      ? "скидк(?:у|и|а)"
      : kind === "promocode"
        ? "промокод(?:ы|а)?"
        : "подар(?:ок|ка|ки)";
  const afterNoun = [
    ...request.matchAll(
      new RegExp(
        `${noun}\\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})`,
        "giu",
      ),
    ),
  ].map((match) => match[1]!);
  return [...new Set(afterNoun)];
}

function objectKind(request: string): ObjectKind | undefined {
  if (/вариант/iu.test(request)) return "variants";
  if (/категори/iu.test(request)) return "categories";
  if (/коллекци/iu.test(request)) return "collections";
  return undefined;
}

function exactObjectId(request: string): string | undefined {
  return request.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
  )?.[0];
}

function bindingOperation(
  kind: Exclude<PromotionKind, "gift">,
  object: ObjectKind,
): string {
  const prefix = kind === "discount" ? "Discount" : "Promocode";
  const suffix =
    object === "variants"
      ? "VariantIDs"
      : object === "categories"
        ? "CategoryIDs"
        : "CollectionIDs";
  return `Get${prefix}${suffix}`;
}

function responseIds(response: unknown): string[] {
  const value = response as {
    variant_ids?: string[];
    category_ids?: string[];
    collection_ids?: string[];
  };
  return value.variant_ids ?? value.category_ids ?? value.collection_ids ?? [];
}

async function readBinding(
  mcp: FakeP1Mcp,
  kind: PromotionKind,
  id: string,
  mode?: string,
): Promise<string[]> {
  if (kind === "gift") {
    return responseIds(
      await mcp.call("kit_request", {
        operation_id: "GetGiftVariants",
        path_params: { id },
        query: { page: 1, per_page: 100 },
      }),
    );
  }
  if (mode === "ALL_VARIANTS" || mode === undefined) return [];
  const objects: ObjectKind[] =
    mode === "SELECTED_VARIANTS"
      ? ["variants"]
      : ["categories", "collections"];
  const ids: string[] = [];
  for (const object of objects) {
    ids.push(
      ...responseIds(
        await mcp.call("kit_request", {
          operation_id: bindingOperation(kind, object),
          path_params: { id },
          query: { page: 1, per_page: 100 },
        }),
      ),
    );
  }
  return ids;
}

async function listEveryPage<T>({
  mcp,
  tool,
  arguments_,
  select,
}: {
  mcp: FakeP1Mcp;
  tool: string;
  arguments_: Record<string, unknown>;
  select: (response: unknown) => { items: T[]; total_count: number };
}): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let totalCount: number | undefined;
  while (totalCount === undefined || items.length < totalCount) {
    const selected = select(
      await mcp.call(tool, {
        ...arguments_,
        page,
        per_page: 100,
      }),
    );
    totalCount = selected.total_count;
    items.push(...selected.items);
    if (selected.items.length === 0 && items.length < totalCount) {
      throw new Error(`Пагинация ${tool} остановилась на ${items.length} из ${totalCount}`);
    }
    page += 1;
  }
  return items;
}

async function listGifts(
  mcp: FakeP1Mcp,
  status: PromoGift["status"],
): Promise<PromoGift[]> {
  const items: PromoGift[] = [];
  let page = 1;
  let totalCount: number | undefined;
  while (totalCount === undefined || items.length < totalCount) {
    const response = (await mcp.call("kit_request", {
      operation_id: "GetGifts",
      query: { status, page, per_page: 100 },
    })) as { gifts: PromoGift[]; total_count: number };
    totalCount = response.total_count;
    items.push(...response.gifts);
    if (response.gifts.length === 0 && items.length < totalCount) {
      throw new Error(`Пагинация подарков остановилась на ${items.length} из ${totalCount}`);
    }
    page += 1;
  }
  return items;
}

async function readOnlyReview(mcp: FakeP1Mcp): Promise<PromoLifecycleResult> {
  try {
    const discounts = (
      await Promise.all(
        (["ACTIVE", "INACTIVE", "ARCHIVED"] as const).map((status) =>
          listEveryPage<OperatorDiscount>({
            mcp,
            tool: "list_discounts",
            arguments_: { status: [status] },
            select: (response) => {
              const value = response as {
                discounts: OperatorDiscount[];
                total_count: number;
              };
              return { items: value.discounts, total_count: value.total_count };
            },
          }),
        ),
      )
    ).flat();
    const promocodes = (
      await Promise.all(
        (["ACTIVE", "INACTIVE"] as const).map((status) =>
          listEveryPage<OperatorPromocode>({
            mcp,
            tool: "list_promocodes",
            arguments_: { status },
            select: (response) => {
              const value = response as {
                promocodes: OperatorPromocode[];
                total_count: number;
              };
              return { items: value.promocodes, total_count: value.total_count };
            },
          }),
        ),
      )
    ).flat();
    const gifts = (
      await Promise.all(
        (["ACTIVE", "INACTIVE"] as const).map((status) => listGifts(mcp, status)),
      )
    ).flat();

    const lines: string[] = [];
    for (const item of discounts) {
      const ids = await readBinding(mcp, "discount", item.id, item.binding_mode);
      lines.push(
        `Скидка ${item.title} (${item.id}): ${item.status}; ` +
          `${item.discount_value?.value ?? "?"} ${item.discount_value?.type ?? "?"}; ` +
          `${item.discount_dates.start_date} — ${item.discount_dates.end_date ?? "бессрочно"}; ` +
          `режим ${item.binding_mode}; привязки ${ids.length > 0 ? ids.join(", ") : "нет/весь каталог"}.`,
      );
    }
    for (const item of promocodes) {
      const ids = await readBinding(mcp, "promocode", item.id, item.binding_mode);
      lines.push(
        `Промокод ${item.code} (${item.id}): ${item.status}; ` +
          `${item.discount_value?.value ?? "?"} ${item.discount_value?.type ?? "?"}; ` +
          `${item.promocode_dates.start_date} — ${item.promocode_dates.end_date ?? "бессрочно"}; ` +
          `лимит ${item.max_usage ?? "без лимита"}, использовано ${item.usage_count}; ` +
          `минимум ${item.minimum_order_amount ?? "0.00"}; привязки ${
            ids.length > 0 ? ids.join(", ") : "нет/весь заказ или каталог"
          }.`,
      );
    }
    for (const item of gifts) {
      const ids = await readBinding(mcp, "gift", item.id);
      lines.push(
        `Подарок ${item.title} (${item.id}): ${item.status}; корзина от ${item.min_cart_total}; ` +
          `сортировка ${item.default_sort}; привязки ${ids.length > 0 ? ids.join(", ") : "нет"}.`,
      );
    }
    return finish(mcp, {
      kind: "completed",
      report: `Фактические промо (${lines.length})\n${lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : "- нет"}`,
      succeeded: [],
      failed: [],
      ambiguous: [],
    });
  } catch (error) {
    return immediate(
      mcp,
      "failed",
      `Не удалось полностью прочитать жизненный цикл промо: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function mutationFailure(
  id: string,
  error: unknown,
  rereadError?: unknown,
): ItemOutcome {
  const ambiguous = mutationResultIsAmbiguous(error);
  return {
    id,
    kind: ambiguous ? "ambiguous" : "failed",
    report:
      `${id}: запись вызвана один раз и завершилась ошибкой «${
        error instanceof Error ? error.message : String(error)
      }»; ` +
      (ambiguous ? "результат неоднозначен" : "изменение не выполнено") +
      (rereadError
        ? `; повторное чтение: ${
            rereadError instanceof Error ? rereadError.message : String(rereadError)
          }`
        : "; объект повторно прочитан"),
  };
}

async function discountOverlapRisk(
  mcp: FakeP1Mcp,
  targetId: string,
): Promise<string> {
  const active = await listEveryPage<OperatorDiscount>({
    mcp,
    tool: "list_discounts",
    arguments_: { status: ["ACTIVE"] },
    select: (response) => {
      const value = response as {
        discounts: OperatorDiscount[];
        total_count: number;
      };
      return { items: value.discounts, total_count: value.total_count };
    },
  });
  const others = active.filter((discount) => discount.id !== targetId);
  return others.length > 0
    ? ` Риск пересечения с активными скидками: ${others.map((item) => item.id).join(", ")}.`
    : "";
}

async function mutateDiscountStatus({
  id,
  status,
  action,
  mcp,
}: {
  id: string;
  status?: "ACTIVE" | "INACTIVE";
  action?: "archive" | "unarchive";
  mcp: FakeP1Mcp;
}): Promise<ItemOutcome> {
  let before: OperatorDiscount;
  try {
    before = (await mcp.call("get_discount", { id })) as OperatorDiscount;
  } catch (error) {
    return { id, kind: "failed", report: `${id}: скидка не прочитана — ${String(error)}` };
  }
  let writeError: unknown;
  try {
    if (action) {
      await mcp.call("discount_action", { id, action });
    } else {
      await mcp.call("update_discount", { id, discount: { status } });
    }
  } catch (error) {
    writeError = error;
  }
  let actual: OperatorDiscount | undefined;
  let rereadError: unknown;
  try {
    actual = (await mcp.call("get_discount", { id })) as OperatorDiscount;
  } catch (error) {
    rereadError = error;
  }
  if (writeError) return mutationFailure(id, writeError, rereadError);
  if (!actual) {
    return {
      id,
      kind: "ambiguous",
      report: `${id}: запись выполнена, но результат не перечитан — ${String(rereadError)}`,
    };
  }
  const expected =
    action === "archive"
      ? "ARCHIVED"
      : action === "unarchive"
        ? "INACTIVE"
        : status;
  if (actual.status !== expected) {
    return {
      id,
      kind: "failed",
      report: `${id}: ожидался статус ${expected}, после записи получен ${actual.status}`,
    };
  }
  const risk =
    expected === "ACTIVE" ? await discountOverlapRisk(mcp, id) : "";
  return {
    id,
    kind: "completed",
    report: `Скидка ${before.title} (${id}): ${before.status} → ${actual.status}.${risk}`,
  };
}

async function mutatePromocodeStatus(
  id: string,
  status: "ACTIVE" | "INACTIVE",
  mcp: FakeP1Mcp,
): Promise<ItemOutcome> {
  let before: OperatorPromocode;
  try {
    before = (await mcp.call("get_promocode", { id })) as OperatorPromocode;
  } catch (error) {
    return { id, kind: "failed", report: `${id}: промокод не прочитан — ${String(error)}` };
  }
  let writeError: unknown;
  try {
    await mcp.call("update_promocode", { id, promocode: { status } });
  } catch (error) {
    writeError = error;
  }
  let actual: OperatorPromocode | undefined;
  let rereadError: unknown;
  try {
    actual = (await mcp.call("get_promocode", { id })) as OperatorPromocode;
  } catch (error) {
    rereadError = error;
  }
  if (writeError) return mutationFailure(id, writeError, rereadError);
  if (!actual) {
    return {
      id,
      kind: "ambiguous",
      report: `${id}: запись выполнена, но результат не перечитан — ${String(rereadError)}`,
    };
  }
  return actual.status === status
    ? {
        id,
        kind: "completed",
        report: `Промокод ${before.code} (${id}): ${before.status} → ${actual.status}.`,
      }
    : {
        id,
        kind: "failed",
        report: `${id}: ожидался статус ${status}, после записи получен ${actual.status}`,
      };
}

async function getGift(mcp: FakeP1Mcp, id: string): Promise<PromoGift> {
  return (await mcp.call("kit_request", {
    operation_id: "GetGiftById",
    path_params: { id },
  })) as PromoGift;
}

async function mutateGiftStatus(
  id: string,
  status: PromoGift["status"],
  mcp: FakeP1Mcp,
): Promise<ItemOutcome> {
  let before: PromoGift;
  try {
    before = await getGift(mcp, id);
  } catch (error) {
    return { id, kind: "failed", report: `${id}: подарок не прочитан — ${String(error)}` };
  }
  let writeError: unknown;
  try {
    await mcp.call("kit_request", {
      operation_id: "UpdateGift",
      path_params: { id },
      body: { status },
    });
  } catch (error) {
    writeError = error;
  }
  let actual: PromoGift | undefined;
  let rereadError: unknown;
  try {
    actual = await getGift(mcp, id);
  } catch (error) {
    rereadError = error;
  }
  if (writeError) return mutationFailure(id, writeError, rereadError);
  if (!actual) {
    return {
      id,
      kind: "ambiguous",
      report: `${id}: запись выполнена, но результат не перечитан — ${String(rereadError)}`,
    };
  }
  return actual.status === status
    ? {
        id,
        kind: "completed",
        report: `Подарок ${before.title} (${id}): ${before.status} → ${actual.status}.`,
      }
    : {
        id,
        kind: "failed",
        report: `${id}: ожидался статус ${status}, после записи получен ${actual.status}`,
      };
}

async function deleteGiftPermanently(
  id: string,
  mcp: FakeP1Mcp,
): Promise<ItemOutcome> {
  try {
    await getGift(mcp, id);
  } catch (error) {
    return { id, kind: "failed", report: `${id}: подарок не прочитан — ${String(error)}` };
  }
  let writeError: unknown;
  try {
    await mcp.call("kit_request", {
      operation_id: "DeleteGift",
      path_params: { id },
    });
  } catch (error) {
    writeError = error;
  }
  let stillExists = false;
  let rereadError: unknown;
  try {
    await getGift(mcp, id);
    stillExists = true;
  } catch (error) {
    rereadError = error;
  }
  if (writeError) return mutationFailure(id, writeError, rereadError);
  return stillExists
    ? {
        id,
        kind: "failed",
        report: `${id}: DeleteGift выполнен, но подарок по-прежнему читается`,
      }
    : {
        id,
        kind: "completed",
        report: `Подарок ${id} удалён навсегда; повторное чтение подтвердило отсутствие.`,
      };
}

async function extendPromotion({
  kind,
  id,
  request,
  now,
  mcp,
}: {
  kind: "discount" | "promocode";
  id: string;
  request: string;
  now: Date;
  mcp: FakeP1Mcp;
}): Promise<ItemOutcome> {
  const timeZone = /по москв/iu.test(request) ? "Europe/Moscow" : undefined;
  if (!timeZone) {
    return {
      id,
      kind: "failed",
      report: `${id}: для новой даты нужен явный часовой пояс`,
    };
  }
  const endDate = parseLocalDate(request, now, timeZone, "end");
  if (!endDate) {
    return { id, kind: "failed", report: `${id}: новая дата окончания не распознана` };
  }
  const readTool = kind === "discount" ? "get_discount" : "get_promocode";
  const writeTool = kind === "discount" ? "update_discount" : "update_promocode";
  const bodyKey = kind === "discount" ? "discount" : "promocode";
  let before: OperatorDiscount | OperatorPromocode;
  try {
    before = (await mcp.call(readTool, { id })) as
      | OperatorDiscount
      | OperatorPromocode;
  } catch (error) {
    return { id, kind: "failed", report: `${id}: промо не прочитано — ${String(error)}` };
  }
  const currentDates =
    kind === "discount"
      ? (before as OperatorDiscount).discount_dates
      : (before as OperatorPromocode).promocode_dates;
  const dates = {
    start_date: currentDates.start_date,
    end_date: endDate.toISOString(),
  };
  if (new Date(dates.start_date).getTime() >= endDate.getTime()) {
    return {
      id,
      kind: "failed",
      report: `${id}: новая дата окончания должна быть позже даты начала`,
    };
  }
  let writeError: unknown;
  try {
    await mcp.call(writeTool, { id, [bodyKey]: { [`${kind === "discount" ? "discount" : "promocode"}_dates`]: dates } });
  } catch (error) {
    writeError = error;
  }
  let actual: OperatorDiscount | OperatorPromocode | undefined;
  let rereadError: unknown;
  try {
    actual = (await mcp.call(readTool, { id })) as
      | OperatorDiscount
      | OperatorPromocode;
  } catch (error) {
    rereadError = error;
  }
  if (writeError) return mutationFailure(id, writeError, rereadError);
  if (!actual) {
    return {
      id,
      kind: "ambiguous",
      report: `${id}: дата записана, но объект не перечитан — ${String(rereadError)}`,
    };
  }
  const actualDates =
    kind === "discount"
      ? (actual as OperatorDiscount).discount_dates
      : (actual as OperatorPromocode).promocode_dates;
  return actualDates.end_date === dates.end_date
    ? {
        id,
        kind: "completed",
        report: `${id}: срок продлён до ${dates.end_date}; прочие условия сохранены.`,
      }
    : {
        id,
        kind: "failed",
        report: `${id}: проверочная дата ${actualDates.end_date ?? "не задана"} не совпала с ${dates.end_date}`,
      };
}

function bindingObjects(
  object: ObjectKind,
  id: string,
): components["schemas"]["DiscountObjects"] {
  if (object === "variants") return { product_variant_ids: [id] };
  if (object === "categories") return { category_ids: [id] };
  return { collection_ids: [id] };
}

function modeAllowsObject(mode: string | undefined, object: ObjectKind): boolean {
  if (mode === undefined || mode === "ALL_VARIANTS") return false;
  return mode === "SELECTED_VARIANTS"
    ? object === "variants"
    : object === "categories" || object === "collections";
}

async function validateAddedObject(
  mcp: FakeP1Mcp,
  object: ObjectKind,
  id: string,
): Promise<void> {
  if (object === "variants") {
    await mcp.call("get_variant", { id });
  } else if (object === "categories") {
    await mcp.call("get_category", { id });
  } else {
    await mcp.call("get_collection", { id });
  }
}

async function mutateBinding({
  kind,
  promotionId,
  object,
  objectId,
  action,
  mcp,
}: {
  kind: "discount" | "promocode";
  promotionId: string;
  object: ObjectKind;
  objectId: string;
  action: "add" | "remove";
  mcp: FakeP1Mcp;
}): Promise<ItemOutcome> {
  const readTool = kind === "discount" ? "get_discount" : "get_promocode";
  const writeTool =
    kind === "discount" ? "manage_discount_objects" : "manage_promocode_objects";
  let before: OperatorDiscount | OperatorPromocode;
  try {
    before = (await mcp.call(readTool, { id: promotionId })) as
      | OperatorDiscount
      | OperatorPromocode;
  } catch (error) {
    return {
      id: promotionId,
      kind: "failed",
      report: `${promotionId}: промо не прочитано — ${String(error)}`,
    };
  }
  const mode = before.binding_mode;
  if (!modeAllowsObject(mode, object)) {
    return {
      id: promotionId,
      kind: "failed",
      report: `${promotionId}: режим ${mode ?? "без привязок"} несовместим с ${object}`,
    };
  }
  if (action === "add") {
    try {
      await validateAddedObject(mcp, object, objectId);
    } catch (error) {
      return {
        id: promotionId,
        kind: "failed",
        report: `${promotionId}: объект ${objectId} не прочитан — ${String(error)}`,
      };
    }
  }
  let writeError: unknown;
  try {
    await mcp.call(writeTool, {
      id: promotionId,
      action,
      objects: bindingObjects(object, objectId),
    });
  } catch (error) {
    writeError = error;
  }
  let actual: OperatorDiscount | OperatorPromocode | undefined;
  let rereadError: unknown;
  try {
    actual = (await mcp.call(readTool, { id: promotionId })) as
      | OperatorDiscount
      | OperatorPromocode;
  } catch (error) {
    rereadError = error;
  }
  if (writeError) return mutationFailure(promotionId, writeError, rereadError);
  if (!actual) {
    return {
      id: promotionId,
      kind: "ambiguous",
      report: `${promotionId}: привязка записана, но промо не перечитано — ${String(rereadError)}`,
    };
  }
  let ids: string[];
  try {
    ids = responseIds(
      await mcp.call("kit_request", {
        operation_id: bindingOperation(kind, object),
        path_params: { id: promotionId },
        query: { page: 1, per_page: 100 },
      }),
    );
  } catch (error) {
    return {
      id: promotionId,
      kind: "ambiguous",
      report: `${promotionId}: промо перечитано, но привязки не проверены — ${String(error)}`,
    };
  }
  const expected = action === "add" ? ids.includes(objectId) : !ids.includes(objectId);
  return expected
    ? {
        id: promotionId,
        kind: "completed",
        report: `${promotionId}: ${action === "add" ? "добавлена" : "удалена"} привязка ${objectId}; привязок: ${ids.length}.`,
      }
    : {
        id: promotionId,
        kind: "failed",
        report: `${promotionId}: проверка привязки ${objectId} не подтвердила действие ${action}`,
      };
}

async function mutateGiftBinding({
  promotionId,
  object,
  objectId,
  action,
  mcp,
}: {
  promotionId: string;
  object: ObjectKind;
  objectId: string;
  action: "add" | "remove";
  mcp: FakeP1Mcp;
}): Promise<ItemOutcome> {
  if (object !== "variants") {
    return {
      id: promotionId,
      kind: "failed",
      report: `${promotionId}: подарок поддерживает только привязки вариантов`,
    };
  }
  try {
    await getGift(mcp, promotionId);
  } catch (error) {
    return {
      id: promotionId,
      kind: "failed",
      report: `${promotionId}: подарок не прочитан — ${String(error)}`,
    };
  }
  if (action === "add") {
    try {
      await validateAddedObject(mcp, object, objectId);
    } catch (error) {
      return {
        id: promotionId,
        kind: "failed",
        report: `${promotionId}: вариант ${objectId} не прочитан — ${String(error)}`,
      };
    }
  }
  let writeError: unknown;
  try {
    await mcp.call("kit_request", {
      operation_id:
        action === "add" ? "AddGiftVariants" : "RemoveGiftVariants",
      path_params: { id: promotionId },
      body: { variant_ids: [objectId] },
    });
  } catch (error) {
    writeError = error;
  }
  let rereadError: unknown;
  try {
    await getGift(mcp, promotionId);
  } catch (error) {
    rereadError = error;
  }
  if (writeError) return mutationFailure(promotionId, writeError, rereadError);
  if (rereadError) {
    return {
      id: promotionId,
      kind: "ambiguous",
      report: `${promotionId}: состав записан, но подарок не перечитан — ${String(rereadError)}`,
    };
  }
  let ids: string[];
  try {
    ids = await readBinding(mcp, "gift", promotionId);
  } catch (error) {
    return {
      id: promotionId,
      kind: "ambiguous",
      report: `${promotionId}: подарок перечитан, но состав не проверен — ${String(error)}`,
    };
  }
  const expected = action === "add" ? ids.includes(objectId) : !ids.includes(objectId);
  return expected
    ? {
        id: promotionId,
        kind: "completed",
        report: `${promotionId}: ${action === "add" ? "добавлен" : "удалён"} вариант ${objectId}; привязок: ${ids.length}.`,
      }
    : {
        id: promotionId,
        kind: "failed",
        report: `${promotionId}: проверка состава не подтвердила действие ${action}`,
      };
}

async function mutatePromocodeConditions({
  id,
  request,
  mcp,
}: {
  id: string;
  request: string;
  mcp: FakeP1Mcp;
}): Promise<ItemOutcome> {
  let before: OperatorPromocode;
  try {
    before = (await mcp.call("get_promocode", { id })) as OperatorPromocode;
  } catch (error) {
    return { id, kind: "failed", report: `${id}: промокод не прочитан — ${String(error)}` };
  }
  const patch: Record<string, unknown> = {};
  const maxUsage = request.match(/лимит(?: использований)?\s+(\d+)/iu);
  if (maxUsage) patch.max_usage = Number(maxUsage[1]);
  const minimum = request.match(
    /минимальн[а-яё]*\s+сумм[а-яё]*(?:\s+заказа)?\s+(\d+(?:[.,]\d+)?)/iu,
  );
  if (minimum) {
    patch.minimum_order_amount = Number(minimum[1]!.replace(",", ".")).toFixed(2);
  }
  const maximumDiscount = request.match(
    /максимальн[а-яё]*\s+скидк[а-яё]*\s+(\d+(?:[.,]\d+)?)/iu,
  );
  if (maximumDiscount) {
    patch.max_discount_amount = Number(
      maximumDiscount[1]!.replace(",", "."),
    ).toFixed(2);
  }
  if (Object.keys(patch).length === 0) {
    return {
      id,
      kind: "failed",
      report: `${id}: не распознано ни одного точного условия для изменения`,
    };
  }
  let writeError: unknown;
  try {
    await mcp.call("update_promocode", { id, promocode: patch });
  } catch (error) {
    writeError = error;
  }
  let actual: OperatorPromocode | undefined;
  let rereadError: unknown;
  try {
    actual = (await mcp.call("get_promocode", { id })) as OperatorPromocode;
  } catch (error) {
    rereadError = error;
  }
  if (writeError) return mutationFailure(id, writeError, rereadError);
  if (!actual) {
    return {
      id,
      kind: "ambiguous",
      report: `${id}: условия записаны, но промокод не перечитан — ${String(rereadError)}`,
    };
  }
  const checks = Object.entries(patch).every(([key, expected]) => {
    const actualValue = actual?.[key as keyof OperatorPromocode];
    return String(actualValue) === String(expected);
  });
  return checks
    ? {
        id,
        kind: "completed",
        report:
          `Промокод ${before.code} (${id}): изменены только ${Object.keys(patch).join(", ")}; ` +
          "остальные условия сохранены.",
      }
    : {
        id,
        kind: "failed",
        report: `${id}: повторное чтение не подтвердило все перечисленные условия`,
      };
}

export async function runPromoLifecycleScenario({
  request,
  now,
  mcp,
}: {
  request: string;
  now: Date;
  mcp: FakeP1Mcp;
}): Promise<PromoLifecycleResult> {
  const hasMutation =
    /(?:останов|запуст|продл|архивир|восстанов|добав|удал|измен)/iu.test(
      request,
    );
  if (!hasMutation) return readOnlyReview(mcp);

  const kind = promotionKind(request);
  if (!kind) {
    return immediate(
      mcp,
      "needs_input",
      "Укажите тип промо: скидка, промокод или подарок.",
    );
  }
  if (
    kind === "gift" &&
    /удал/iu.test(request) &&
    objectKind(request) === undefined &&
    !/удали\s+навсегда/iu.test(request)
  ) {
    return immediate(
      mcp,
      "needs_input",
      "Обычное удаление подарка не выполняю: используйте «останови» для INACTIVE или точную формулировку «удали навсегда».",
    );
  }

  const ids = targetIds(request, kind);
  if (ids.length === 0) {
    return immediate(mcp, "needs_input", "Укажите точный ID целевого промо.");
  }

  if (/добав|удал/iu.test(request) && !/удали\s+навсегда/iu.test(request)) {
    const object = objectKind(request);
    const objectId = exactObjectId(request);
    if (!object || !objectId || ids.length !== 1) {
      return immediate(
        mcp,
        "needs_input",
        "Для привязки укажите одно промо, тип объекта и точный UUID.",
      );
    }
    return aggregate(mcp, [
      kind === "gift"
        ? await mutateGiftBinding({
            promotionId: ids[0]!,
            object,
            objectId,
            action: /добав/iu.test(request) ? "add" : "remove",
            mcp,
          })
        : await mutateBinding({
            kind,
            promotionId: ids[0]!,
            object,
            objectId,
            action: /добав/iu.test(request) ? "add" : "remove",
            mcp,
          }),
    ]);
  }

  const outcomes: ItemOutcome[] = [];
  for (const id of ids) {
    if (kind === "gift" && /удали\s+навсегда/iu.test(request)) {
      outcomes.push(await deleteGiftPermanently(id, mcp));
    } else if (/продл/iu.test(request) && kind !== "gift") {
      outcomes.push(await extendPromotion({ kind, id, request, now, mcp }));
    } else if (/измен/iu.test(request) && kind === "promocode") {
      outcomes.push(await mutatePromocodeConditions({ id, request, mcp }));
    } else if (kind === "discount" && /архивир/iu.test(request)) {
      outcomes.push(await mutateDiscountStatus({ id, action: "archive", mcp }));
    } else if (kind === "discount" && /восстанов/iu.test(request)) {
      outcomes.push(await mutateDiscountStatus({ id, action: "unarchive", mcp }));
    } else if (/останов/iu.test(request)) {
      outcomes.push(
        kind === "discount"
          ? await mutateDiscountStatus({ id, status: "INACTIVE", mcp })
          : kind === "promocode"
            ? await mutatePromocodeStatus(id, "INACTIVE", mcp)
            : await mutateGiftStatus(id, "INACTIVE", mcp),
      );
    } else if (/запуст/iu.test(request)) {
      outcomes.push(
        kind === "discount"
          ? await mutateDiscountStatus({ id, status: "ACTIVE", mcp })
          : kind === "promocode"
            ? await mutatePromocodeStatus(id, "ACTIVE", mcp)
            : await mutateGiftStatus(id, "ACTIVE", mcp),
      );
    } else {
      outcomes.push({
        id,
        kind: "failed",
        report: `${id}: точное изменение не распознано`,
      });
    }
  }
  return aggregate(mcp, outcomes);
}
