import {
  runLaunchCheckScenario,
  type LaunchCheckResult,
} from "./launch-check-skill-scenario.js";
import {
  runPromoLifecycleScenario,
  type PromoLifecycleResult,
} from "./promo-launcher-lifecycle-scenario.js";
import { FakeP1Mcp } from "./promo-launcher-skill-scenario.js";
import type { OperatorVariant } from "./operator-skill-scenario.js";
import { mutationResultIsAmbiguous } from "./skill-mutation-protocol.js";

export type KnownLaunchFix =
  | {
      kind: "stock";
      variantId: string;
      warehouseId: string;
      quantity: number;
    }
  | {
      kind: "promocode_status";
      id: string;
      status: "ACTIVE" | "INACTIVE";
    }
  | {
      kind: "discount_status";
      id: string;
      status: "ACTIVE" | "INACTIVE";
    }
  | {
      kind: "gift_status";
      id: string;
      status: "ACTIVE" | "INACTIVE";
    }
  | {
      kind: "unknown";
      objectId: string;
      field:
        | "price"
        | "stock"
        | "category"
        | "image"
        | "promotion"
        | "webhook";
      question: string;
    };

type FixOutcomeKind = "completed" | "failed" | "ambiguous";

interface FixOutcome {
  id: string;
  kind: FixOutcomeKind;
  message: string;
}

export interface LaunchCheckFixResult {
  kind: "completed" | "needs_input" | "failed" | "ambiguous" | "partial";
  succeeded: string[];
  failed: string[];
  ambiguous: string[];
  launch: LaunchCheckResult;
  report: string;
}

function outcomeFromPromo(
  id: string,
  result: PromoLifecycleResult,
): FixOutcome {
  if (result.succeeded.includes(id)) {
    return { id, kind: "completed", message: result.report };
  }
  if (result.ambiguous.includes(id) || result.kind === "ambiguous") {
    return { id, kind: "ambiguous", message: result.report };
  }
  return { id, kind: "failed", message: result.report };
}

async function executeStockFix(
  mcp: FakeP1Mcp,
  fix: Extract<KnownLaunchFix, { kind: "stock" }>,
): Promise<FixOutcome> {
  let before: OperatorVariant;
  try {
    before = (await mcp.call("get_variant", {
      id: fix.variantId,
    })) as OperatorVariant;
  } catch (error) {
    return {
      id: fix.variantId,
      kind: "failed",
      message: `SKU ${fix.variantId}: точный объект не прочитан — ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (
    !Number.isInteger(fix.quantity) ||
    fix.quantity < 0 ||
    !before.stocks.some((stock) => stock.warehouse_id === fix.warehouseId)
  ) {
    return {
      id: fix.variantId,
      kind: "failed",
      message:
        `SKU ${fix.variantId}: количество или склад ${fix.warehouseId} не подтверждены; ` +
        "запись не выполнялась",
    };
  }
  const stocks = before.stocks.map((stock) =>
    stock.warehouse_id === fix.warehouseId
      ? { ...stock, quantity: fix.quantity }
      : stock,
  );
  let writeError: unknown;
  try {
    await mcp.call("update_variant", {
      id: fix.variantId,
      variant: { stocks },
    });
  } catch (error) {
    writeError = error;
  }
  let after: OperatorVariant | undefined;
  let rereadError: unknown;
  try {
    after = (await mcp.call("get_variant", {
      id: fix.variantId,
    })) as OperatorVariant;
  } catch (error) {
    rereadError = error;
  }
  if (writeError) {
    const ambiguous = mutationResultIsAmbiguous(writeError);
    return {
      id: fix.variantId,
      kind: ambiguous ? "ambiguous" : "failed",
      message:
        `SKU ${fix.variantId}: update_variant вызван один раз и завершился ошибкой «${
          writeError instanceof Error ? writeError.message : String(writeError)
        }»; ${ambiguous ? "результат неоднозначен" : "изменение не выполнено"}; ` +
        (rereadError ? `повторное чтение: ${String(rereadError)}` : "объект повторно прочитан"),
    };
  }
  if (!after) {
    return {
      id: fix.variantId,
      kind: "ambiguous",
      message: `SKU ${fix.variantId}: запись выполнена, но повторное чтение не удалось — ${String(rereadError)}`,
    };
  }
  if (JSON.stringify(after.stocks) !== JSON.stringify(stocks)) {
    return {
      id: fix.variantId,
      kind: "failed",
      message:
        `SKU ${fix.variantId}: повторное чтение не подтвердило полный сохранённый массив stocks`,
    };
  }
  return {
    id: fix.variantId,
    kind: "completed",
    message:
      `SKU ${after.sku} (${after.id}): остаток склада ${fix.warehouseId} установлен ${fix.quantity}; ` +
      "соседние остатки, media, категории и характеристики не изменялись",
  };
}

async function executeKnownFix(
  mcp: FakeP1Mcp,
  fix: Exclude<KnownLaunchFix, { kind: "unknown" }>,
  now: Date,
): Promise<FixOutcome> {
  if (fix.kind === "stock") return executeStockFix(mcp, fix);

  const request =
    fix.kind === "promocode_status"
      ? `${fix.status === "ACTIVE" ? "Запусти" : "Останови"} промокод ${fix.id}`
      : fix.kind === "discount_status"
        ? `${fix.status === "ACTIVE" ? "Запусти" : "Останови"} скидку ${fix.id}`
        : `${fix.status === "ACTIVE" ? "Запусти" : "Останови"} подарок ${fix.id}`;
  const result = await runPromoLifecycleScenario({ request, now, mcp });
  return outcomeFromPromo(fix.id, result);
}

function exactStockFix(request: string): KnownLaunchFix | undefined {
  const match =
    /(?:поставь|установи)\s+остаток\s+(\d+)\s+для\s+([0-9a-f-]+)\s+на\s+складе\s+([0-9a-f-]+)/iu.exec(
      request,
    );
  if (!match) return undefined;
  return {
    kind: "stock",
    quantity: Number(match[1]),
    variantId: match[2]!,
    warehouseId: match[3]!,
  };
}

function groupedQuestion(unknown: Extract<KnownLaunchFix, { kind: "unknown" }>[]): string {
  return (
    "Чтобы продолжить, укажите одним сообщением:\n" +
    unknown.map((fix) => `- ${fix.question}`).join("\n")
  );
}

function formatSections(
  outcomes: FixOutcome[],
  question: string | undefined,
  launch: LaunchCheckResult,
): string {
  const section = (title: string, kind: FixOutcomeKind): string => {
    const selected = outcomes.filter((outcome) => outcome.kind === kind);
    return `${title} (${selected.length})\n${
      selected.length > 0
        ? selected.map((outcome) => `- ${outcome.message}`).join("\n")
        : "- нет"
    }`;
  };
  return [
    section("Успешно", "completed"),
    section("Неуспешно", "failed"),
    section("Неоднозначно", "ambiguous"),
    ...(question ? [question] : []),
    "Повторная проверка запуска",
    launch.report,
  ].join("\n\n");
}

function resultKind(
  outcomes: FixOutcome[],
  hasUnknown: boolean,
): LaunchCheckFixResult["kind"] {
  const completed = outcomes.filter((outcome) => outcome.kind === "completed").length;
  const failed = outcomes.filter((outcome) => outcome.kind === "failed").length;
  const ambiguous = outcomes.filter((outcome) => outcome.kind === "ambiguous").length;
  if (outcomes.length === 0 && hasUnknown) return "needs_input";
  if (failed + ambiguous === 0 && !hasUnknown) return "completed";
  if (completed > 0 || hasUnknown || (failed > 0 && ambiguous > 0)) return "partial";
  return ambiguous > 0 ? "ambiguous" : "failed";
}

async function launchAndFinish({
  request,
  now,
  externalOrderProcessing,
  mcp,
  outcomes,
  unknown,
}: {
  request: string;
  now: Date;
  externalOrderProcessing?: boolean;
  mcp: FakeP1Mcp;
  outcomes: FixOutcome[];
  unknown: Extract<KnownLaunchFix, { kind: "unknown" }>[];
}): Promise<LaunchCheckFixResult> {
  const launch = await runLaunchCheckScenario({
    request,
    now,
    externalOrderProcessing,
    mcp,
  });
  const question = unknown.length > 0 ? groupedQuestion(unknown) : undefined;
  const report = formatSections(outcomes, question, launch);
  mcp.finish(report);
  return {
    kind: resultKind(outcomes, unknown.length > 0),
    succeeded: outcomes
      .filter((outcome) => outcome.kind === "completed")
      .map((outcome) => outcome.id),
    failed: outcomes
      .filter((outcome) => outcome.kind === "failed")
      .map((outcome) => outcome.id),
    ambiguous: outcomes
      .filter((outcome) => outcome.kind === "ambiguous")
      .map((outcome) => outcome.id),
    launch,
    report,
  };
}

export async function runLaunchCheckFixScenario({
  request,
  now,
  externalOrderProcessing,
  knownFixes = [],
  mcp,
}: {
  request: string;
  now: Date;
  externalOrderProcessing?: boolean;
  knownFixes?: KnownLaunchFix[];
  mcp: FakeP1Mcp;
}): Promise<LaunchCheckFixResult> {
  const exactStock = exactStockFix(request);
  const asksFixAll = /исправь\s+вс[её]/iu.test(request);
  const asksUnknownPrice =
    /исправь\s+цену(?:\s+для)?\s+([0-9a-f-]+)/iu.exec(request);
  const isPromotionCommand =
    /(?:останов|запуст|архивир|восстанов|продл).*(?:скидк|промокод|подар)/iu.test(
      request,
    );

  if (
    !exactStock &&
    !asksFixAll &&
    !asksUnknownPrice &&
    !isPromotionCommand
  ) {
    return launchAndFinish({
      request,
      now,
      externalOrderProcessing,
      mcp,
      outcomes: [],
      unknown: [],
    });
  }

  const planned: KnownLaunchFix[] = exactStock
    ? [exactStock]
    : asksFixAll
      ? knownFixes
      : [];
  if (asksUnknownPrice) {
    planned.push({
      kind: "unknown",
      objectId: asksUnknownPrice[1]!,
      field: "price",
      question: `точную цену для ${asksUnknownPrice[1]}`,
    });
  }

  const outcomes: FixOutcome[] = [];
  if (isPromotionCommand) {
    const promotion = await runPromoLifecycleScenario({ request, now, mcp });
    const ids = [
      ...promotion.succeeded,
      ...promotion.failed,
      ...promotion.ambiguous,
    ];
    for (const id of ids) outcomes.push(outcomeFromPromo(id, promotion));
  }
  const unknown: Extract<KnownLaunchFix, { kind: "unknown" }>[] = [];
  for (const fix of planned) {
    if (fix.kind === "unknown") {
      unknown.push(fix);
      continue;
    }
    outcomes.push(await executeKnownFix(mcp, fix, now));
  }

  return launchAndFinish({
    request,
    now,
    externalOrderProcessing,
    mcp,
    outcomes,
    unknown,
  });
}
