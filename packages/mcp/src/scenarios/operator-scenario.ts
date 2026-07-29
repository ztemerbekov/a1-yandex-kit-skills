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

export interface RecordedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export const WRITE_ORDER_TOOLS = new Set(["confirm_order", "cancel_order"]);

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
  finalAnswer: string | undefined;

  constructor({
    orders,
    pageSize = 100,
    addons = {},
    getOrderErrors = {},
    addonErrors = {},
  }: {
    orders: OperatorOrder[];
    pageSize?: number;
    addons?: Record<string, unknown>;
    getOrderErrors?: Record<string, Error>;
    addonErrors?: Record<string, Error>;
  }) {
    this.#orders = orders;
    this.#pageSize = pageSize;
    this.#addons = addons;
    this.#getOrderErrors = getOrderErrors;
    this.#addonErrors = addonErrors;
  }

  get writeCalls(): RecordedToolCall[] {
    return this.calls.filter((call) => WRITE_ORDER_TOOLS.has(call.name));
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
  const visibleFindings = allFindings
    .filter((finding) => finding.critical || inPeriod(finding.order, period))
    .filter((finding) => !urgentOnly || finding.critical)
    .sort((left, right) => kindRank(left.kind) - kindRank(right.kind));

  const report = [
    urgentOnly ? "Срочный операционный срез" : "Текущий операционный статус",
    period ? `Срез: ${period.label}; UTC ${period.from.toISOString()} — ${period.to.toISOString()}.` : "Срез: текущий статус.",
    `Проверено заказов: ${orders.length} из ${totalCount}; страниц: ${page - 1}.`,
    visibleFindings.length === 0
      ? "Объективных рисков по прочитанным данным не найдено."
      : visibleFindings.map(formatFinding).join("\n"),
    "API не содержит признака просмотра заказа, поэтому отчёт не делает выводов о непросмотренных заказах.",
    "Это read-only разбор: операции подтверждения и отмены не вызывались.",
  ].join("\n\n");
  mcp.finish(report);
  return { report };
}
