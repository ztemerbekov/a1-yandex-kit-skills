#!/usr/bin/env node
// Демо-клиент для README-GIF: поднимает локальный мок KIT API (docs/demo/mock-api.mjs),
// запускает НАСТОЯЩИЙ MCP-сервер (packages/mcp/dist/index.js) по stdio с
// YANDEX_KIT_BASE_URL, указывающим на мок, и делает настоящий хендшейк и настоящие
// tools/call через официальный SDK. Токен не нужен, в сеть не выходит ничего.
// Запись GIF: vhs docs/demo.tape (см. docs/demo.tape). Ручной прогон: node docs/demo/run.mjs.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMock } from "./mock-api.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------- оформление ----------
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAUVE = "\x1b[35m";
const WIDTH = 92; // терминал vhs при настройках docs/demo.tape — 97 колонок

const out = process.stdout;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function typeOut(text, msPerChar) {
  for (const ch of text) {
    out.write(ch);
    await sleep(msPerChar);
  }
}

async function spinner(ms, label) {
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  const started = Date.now();
  let i = 0;
  while (Date.now() - started < ms) {
    out.write(`\r\x1b[2K  ${DIM}${frames[i++ % frames.length]} ${label}${RESET}`);
    await sleep(80);
  }
  out.write("\r\x1b[2K");
}

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Перенос сырого текста результата по ширине, максимум maxLines строк. */
function wrapRaw(text, maxLines) {
  const flat = text.replace(/\s+/g, " ").trim();
  const body = WIDTH - 6;
  const lines = [];
  for (let pos = 0; pos < flat.length && lines.length < maxLines; pos += body) {
    lines.push(flat.slice(pos, pos + body));
  }
  if (flat.length > maxLines * body) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, body - 1) + "…";
  }
  return lines;
}

async function printResultLines(lines) {
  for (let i = 0; i < lines.length; i++) {
    out.write((i === 0 ? "  ⎿ " : "    ") + lines[i] + "\n");
    await sleep(60);
  }
}

/** Таблица: первая строка — dim-шапка, числовые ячейки прижаты вправо. */
function tableLines(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  const numeric = (v) => /^[\d.]+$/.test(v);
  const fmt = (row) =>
    row
      .map((cell, c) => (numeric(cell) ? cell.padStart(widths[c]) : cell.padEnd(widths[c])))
      .join("  ")
      .trimEnd();
  return [DIM + fmt(rows[0]) + RESET, ...rows.slice(1).map(fmt)];
}

// ---------- рендеры шагов ----------

function renderStore(text) {
  return printResultLines(wrapRaw(text, 2).map((l) => DIM + l + RESET));
}

function renderProducts(text) {
  const { products } = JSON.parse(text);
  const rows = [
    ["группа", "категорий", "id"],
    ...products.map((p) => [p.group_id, String(p.category_ids.length), p.id]),
  ];
  return printResultLines([
    ...tableLines(rows),
    `${DIM}… всего ${products.length} продукта; названия и цены — в SKU-вариантах (list_variants)${RESET}`,
  ]);
}

function renderSearch(text) {
  const { total, results } = JSON.parse(text);
  const rows = results
    .slice(0, 3)
    .map((r) => [r.operationId, r.method.toUpperCase(), r.path, trunc(r.summaryRu ?? "", 30)]);
  return printResultLines([
    `найдено операций: ${BOLD}${total}${RESET} (тег «Промокоды»), первые 3:`,
    ...tableLines([["operationId", "метод", "путь", "описание"], ...rows]).slice(1),
  ]);
}

function renderOrders(text) {
  const { orders, total_count } = JSON.parse(text);
  const date = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
  const rows = [
    ["№", "дата", "статус", "клиент", "сумма ₽", "промокод"],
    ...orders.map((o) => [
      String(o.order_number),
      date(o.created_at),
      o.status,
      `${o.client.last_name} ${o.client.first_name[0]}.`,
      o.total_final_price,
      o.promocode?.code ?? "—",
    ]),
  ];
  return printResultLines([
    ...tableLines(rows),
    `${DIM}… показаны ${orders.length} из ${total_count} заказов (total_count)${RESET}`,
  ]);
}

/** Контракт операции: метод/путь/тело + required-поля из OpenAPI-схемы. */
function renderSchema(text) {
  const s = JSON.parse(text);
  const req = s.requestSchema ?? {};
  const props = Object.keys(req.properties ?? {});
  return printResultLines([
    `${s.method.toUpperCase()} ${s.path} · «${s.summaryRu}» · тело: ${s.requestContentType}`,
    `${DIM}required: ${(req.required ?? []).join(", ")} · всего полей ${props.length}${RESET}`,
  ]);
}

// ---------- сценарий ----------
const QUESTION = "Что происходит в магазине? Покажи каталог и свежие заказы. Хочу запустить промокод.";

const STEPS = [
  { tool: "get_store", args: {}, spin: 1500, label: "GET /v1/store", render: renderStore },
  {
    tool: "list_products",
    args: { per_page: 25 },
    spin: 1800,
    label: "GET /v1/products?page=1&per_page=25",
    render: renderProducts,
  },
  {
    tool: "kit_request",
    args: { operation_id: "GetOrders", query: { per_page: 2 } },
    spin: 2000,
    label: "GET /v1/orders?per_page=2",
    render: renderOrders,
  },
  {
    tool: "search_operations",
    args: { query: "промокод" },
    spin: 1600,
    label: "поиск по каталогу из 151 операции (офлайн)",
    render: renderSearch,
  },
  {
    tool: "get_operation_schema",
    args: { operation_id: "CreatePromocode" },
    spin: 1400,
    label: "схема из OpenAPI-спеки (офлайн)",
    render: renderSchema,
  },
];

// Финальный вывод «ассистента»: строки из сегментов [стиль, текст].
const ANSWER = [
  [[BOLD, "Магазин «Лавка Севера» (lavka-severa.kit.yandex.ru): 3 продукта, 47 заказов."]],
  [
    ["", "  • Заказ "],
    [BOLD, "100413"],
    ["", " на 4 180 ₽ ждёт подтверждения — стоит принять его сегодня."],
  ],
  [
    ["", "  • Промокод "],
    [GREEN + BOLD, "SEVER10"],
    ["", " уже работает: −356 ₽ в заказе 100412."],
  ],
  [
    ["", "  • Новый создам через "],
    [BOLD, "CreatePromocode"],
    ["", " (POST /v1/promocodes) — скажите код и скидку."],
  ],
];

// ---------- прогон ----------
async function main() {
  const mock = await startMock(0); // эфемерный порт: параллельные прогоны не дерутся

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, "packages", "mcp", "dist", "index.js")],
    cwd: repoRoot,
    stderr: "ignore",
    env: {
      ...process.env,
      YANDEX_KIT_TOKEN: "demo-token",
      YANDEX_KIT_BASE_URL: mock.url,
    },
  });
  const client = new Client({ name: "readme-demo", version: "1.0.0" });
  await client.connect(transport);

  const info = client.getServerVersion();
  const { tools } = await client.listTools();
  out.write("\x1b[2J\x1b[H"); // чистый экран: контент обязан уместиться без скролла
  out.write(`${GREEN}●${RESET} ${BOLD}${info.name}${RESET} ${DIM}v${info.version} · stdio · ${tools.length} инструментов${RESET}\n`);
  out.write(`  ${DIM}демо: KIT API замокан локально (docs/demo/mock-api.mjs) — токен и сеть не нужны${RESET}\n\n`);
  await sleep(900);

  out.write(`${CYAN}${BOLD}❯${RESET} `);
  await sleep(600);
  await typeOut(QUESTION, 48);
  await sleep(700);
  out.write("\n\n");

  for (const step of STEPS) {
    // Аргументы в одну строку: длинный JSON обрезаем, чтобы строка вызова не заворачивалась.
    let argsShown = JSON.stringify(step.args);
    const argsMax = WIDTH - step.tool.length - 3;
    if (argsShown.length > argsMax) argsShown = argsShown.slice(0, argsMax - 2) + "…}";
    out.write(`${GREEN}⏺${RESET} ${BOLD}${step.tool}${RESET} ${DIM}${argsShown}${RESET}\n`);
    const [res] = await Promise.all([
      client.callTool({ name: step.tool, arguments: step.args }),
      spinner(step.spin, step.label),
    ]);
    const text = res.content?.[0]?.text ?? "";
    if (res.isError) {
      out.write(`  ${RED}${text}${RESET}\n`);
      process.exit(1);
    }
    await step.render(text);
    out.write("\n");
    await sleep(400);
  }

  await sleep(500);
  out.write(`${MAUVE}✦${RESET} `);
  for (const line of ANSWER) {
    for (const [style, seg] of line) {
      for (const word of seg.split(/(?<= )/)) {
        out.write(style + word + RESET);
        await sleep(45);
      }
    }
    out.write("\n");
  }

  out.write("\x1b[?25l"); // спрятать курсор — чистый финальный кадр
  await client.close(); // убивает дочерний процесс MCP-сервера
  mock.server.closeAllConnections?.();
  mock.server.close();
  // Держим финальный кадр, пока vhs дозаписывает хвост (тейп спит меньше этого),
  // но выходим сами: ручной прогон завершается кодом 0 примерно за полминуты.
  await sleep(Number(process.env.DEMO_HOLD_MS ?? 12_000));
  out.write("\x1b[?25h"); // вернуть курсор — vhs к этому моменту уже дописал хвост
  process.exit(0);
}

main().catch((err) => {
  console.error(`${RED}demo failed:${RESET}`, err);
  process.exit(1);
});
