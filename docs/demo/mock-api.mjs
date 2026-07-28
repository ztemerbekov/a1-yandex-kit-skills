// Законсервированный Yandex KIT API для README-демо: локальный node:http-сервер,
// на который MCP-сервер указывается через YANDEX_KIT_BASE_URL. Настоящий код
// (KitClient: Bearer-заголовок, лимитер, ретраи, парсинг) проходит весь свой путь,
// но ни один байт не выходит за 127.0.0.1 и токен не нужен.
//
// Данные вымышленные, но по формам соответствуют схемам OpenAPI-спеки
// (packages/core/src/generated/spec.json): Store, ProductCollection, OrderCollection.
// Запуск отдельно: node docs/demo/mock-api.mjs [port]  (по умолчанию 8787).
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

// ---------- фикстуры: магазин северных деликатесов «Лавка Севера» ----------

// Store: в спеке у магазина только id, slug и b2c_url — «человеческое» имя
// живёт в витрине, а не в API.
const STORE = {
  id: "019c5b7a-1f3e-7c42-9a15-3d2f8e6b0c91",
  slug: "lavka-severa",
  b2c_url: "https://lavka-severa.kit.yandex.ru",
};

const CAT_VARENIE = "019c5b7a-2a11-7d09-8c44-b96f1e2d7a55";
const CAT_CHAI = "019c5b7a-2a11-7d09-8c44-b96f1e2d7a56";
const CAT_RYBA = "019c5b7a-2a11-7d09-8c44-b96f1e2d7a57";
const CH_OBJEM = "019c5b7a-3b20-7e17-9d02-4a8c6f1e0b33";

// Product в KIT — группировка SKU-вариантов: имя/цена/остатки лежат в вариантах,
// у самого продукта — категории, group_id и настройки группировки.
const PRODUCTS = {
  products: [
    {
      id: "019c5b7a-6a2e-7b01-8f3c-2d9e4a7c5b10",
      category_ids: [CAT_VARENIE],
      group_id: "varene-moroshka",
      settings: { grouping_characteristic_ids: [CH_OBJEM], splitting_characteristic_ids: [] },
    },
    {
      id: "019c5b7a-6a2e-7b02-8f3c-2d9e4a7c5b11",
      category_ids: [CAT_CHAI],
      group_id: "ivan-chai-brusnika",
      settings: { grouping_characteristic_ids: [CH_OBJEM], splitting_characteristic_ids: [] },
    },
    {
      id: "019c5b7a-6a2e-7b03-8f3c-2d9e4a7c5b12",
      category_ids: [CAT_RYBA],
      group_id: "muksun-vyalenyi",
      settings: { grouping_characteristic_ids: [], splitting_characteristic_ids: [] },
    },
  ],
};

// Заказы: свежие сверху. В 100412 применён промокод SEVER10 (−10%):
// 2×890 + 1780 = 3560, скидка 356 → итог 3204. total_count больше per_page —
// как в реальной пагинации.
const ORDERS = {
  orders: [
    {
      id: "019c5b7a-9e01-7f7f-b1d2-6c3a4e5f8a11",
      order_number: 100413,
      created_at: "2026-07-28T09:41:00Z",
      status: "NEW",
      client: { last_name: "Сафонов", first_name: "Пётр", phone: "+79165550123", is_notify: true },
      payment: { method: "CARD_ONLINE", status: "PAYMENT_PENDING_OR_UNPAID" },
      delivery_chunks: [
        {
          id: 0,
          items: [
            {
              id: "019c5b7a-9e10-7a01-9c3b-1f2e4d6a8c01",
              product_variant_id: "019c5b7a-7c01-7d21-a4e5-0b9d2f3c6e81",
              is_product_variant_deleted: false,
              quantity: 1,
              price: "4180.00",
              final_price: "4180.00",
              vat: 20,
              loyalty_discount: "0.00",
              promocode_discount: "0.00",
              gift_card_discount: "0.00",
            },
          ],
          delivery_info: {
            method: "COURIER",
            raw_status: "new",
            human_status: "Ожидает подтверждения",
            address: { courier_locality: "Москва", courier_address: "ул. Лесная, 7, кв. 12" },
          },
          total_price: "4180.00",
          total_final_price: "4180.00",
          purchased_price: "4180.00",
        },
      ],
      total_price: "4180.00",
      total_final_price: "4180.00",
      purchased_price: "4180.00",
      gift_card_discount: "0.00",
    },
    {
      id: "019c5b7a-9e01-7f7f-b1d2-6c3a4e5f8a10",
      order_number: 100412,
      created_at: "2026-07-27T14:12:00Z",
      status: "WAIT_FOR_DELIVERY",
      client: { last_name: "Морозова", first_name: "Анна", phone: "+79215550110", is_notify: true },
      payment: { method: "CARD_ONLINE", status: "PAYMENT_PAID" },
      delivery_chunks: [
        {
          id: 0,
          items: [
            {
              id: "019c5b7a-9e10-7a02-9c3b-1f2e4d6a8c02",
              product_variant_id: "019c5b7a-7c02-7d21-a4e5-0b9d2f3c6e82",
              is_product_variant_deleted: false,
              quantity: 2,
              price: "890.00",
              final_price: "801.00",
              vat: 20,
              loyalty_discount: "0.00",
              promocode_discount: "89.00",
              gift_card_discount: "0.00",
            },
            {
              id: "019c5b7a-9e10-7a03-9c3b-1f2e4d6a8c03",
              product_variant_id: "019c5b7a-7c03-7d21-a4e5-0b9d2f3c6e83",
              is_product_variant_deleted: false,
              quantity: 1,
              price: "1780.00",
              final_price: "1602.00",
              vat: 20,
              loyalty_discount: "0.00",
              promocode_discount: "178.00",
              gift_card_discount: "0.00",
            },
          ],
          delivery_info: {
            method: "PICKUP_POINT",
            raw_status: "ready_for_approval",
            human_status: "Готовится к отправке",
            address: { pickup_point_locality: "Санкт-Петербург", pickup_point_address: "Невский пр., 88" },
          },
          total_price: "3560.00",
          total_final_price: "3204.00",
          purchased_price: "3204.00",
        },
      ],
      total_price: "3560.00",
      total_final_price: "3204.00",
      purchased_price: "3204.00",
      acquiring_type: "YANDEX_PAY",
      promocode: { code: "SEVER10", discount: "356.00" },
      gift_card_discount: "0.00",
    },
  ],
  total_count: 47,
};

const ROUTES = new Map([
  ["GET /v1/store", STORE],
  ["GET /v1/products", PRODUCTS],
  ["GET /v1/orders", ORDERS],
]);

// ---------- сервер ----------

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

// Контракт ошибок KIT (schema Error): { code, message, trace_id }.
function sendError(res, status, code, message) {
  sendJson(res, status, { code, message, trace_id: randomUUID().replaceAll("-", "") });
}

export function startMock(port = 8787) {
  const server = createServer((req, res) => {
    // Как настоящий API: без Bearer-токена — 401 с телом по схеме Error.
    if (!/^Bearer .+/.test(req.headers.authorization ?? "")) {
      return sendError(res, 401, "UNAUTHORIZED", "Authorization header is missing or invalid");
    }
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const body = ROUTES.get(`${req.method} ${pathname}`);
    if (body === undefined) {
      // Если сценарий демо уехал от фикстур — ошибка видна сразу, сеть не нужна.
      return sendError(res, 404, "NOT_FOUND", `Not mocked in demo: ${req.method} ${pathname}`);
    }
    sendJson(res, 200, body);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startMock(Number(process.argv[2] ?? 8787));
  console.log(`mock KIT API listening on ${url} (Ctrl+C to stop)`);
}
