# yandex-kit-core

Типизированный клиент **API Яндекс KIT** — конструктора интернет-магазинов ([kit.yandex.ru](https://kit.yandex.ru)), построенный по официальной OpenAPI-спеке (133 операции). Основа MCP-сервера [`mcp-yandex-kit`](https://www.npmjs.com/package/mcp-yandex-kit), но пригоден и как самостоятельный клиент.

Что внутри:

- **`KitClient`** — Bearer-авторизация, таймаут на попытку, лимитер 3 rps (token bucket), ретраи с бэкоффом на сетевых ошибках, 5xx, 429 и `LIMIT_EXCEEDED` (который KIT возвращает с **HTTP 400**), автопагинация `listAll`, корректные content-type (`merge-patch+json`, `multipart/form-data`) там, где их требует API.
- **`KitApiError`** — типизированные ошибки API: `status`, `code`, `message`, `trace_id`.
- **ajv-валидация** — `validateRequestBody` / `resolveOperationSchema` проверяют тела запросов по схемам спеки **до** отправки в сеть.
- **Сгенерированный реестр операций** — метод, путь, параметры и content-type каждой из 133 операций.

## Использование

```js
import { KitClient } from "yandex-kit-core";

const client = new KitClient({ token: process.env.YANDEX_KIT_TOKEN });

// Любая операция по её operationId из спеки
const store = await client.call("GetStore");

// Автопагинация списков (per_page=100, до maxItems элементов)
const { items } = await client.listAll("GetProducts", {}, { maxItems: 500 });
```

Требования: Node.js 20+.

## Документация

- [Репозиторий проекта](https://github.com/ztemerbekov/a1-yandex-kit-skills) — полный README, MCP-сервер, агентские скиллы.
- [Официальная документация Яндекс KIT](https://yandex.ru/dev/kit/ru/) — авторизация, лимиты, ошибки, OpenAPI-справочник.

## Лицензия

MIT — см. [LICENSE](https://github.com/ztemerbekov/a1-yandex-kit-skills/blob/main/LICENSE).
