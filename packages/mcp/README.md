# mcp-yandex-kit

MCP-сервер для **API Яндекс KIT** — конструктора интернет-магазинов ([kit.yandex.ru](https://kit.yandex.ru)): управляйте каталогом, ценами, заказами, скидками и вебхуками из Claude, Cursor, Codex и других AI-клиентов на естественном языке.

Внутри — **61 MCP-инструмент**: кураторские тулы на повседневные операции (65 из 133 операций API) плюс мета-трио (`search_operations`, `get_operation_schema`, `kit_request`), через которое доступны **все 133 операции**. Под капотом — клиент [`yandex-kit-core`](https://www.npmjs.com/package/yandex-kit-core): лимитер 3 rps, ретраи с бэкоффом, ajv-валидация тел write-запросов **до** отправки в сеть.

Полный README (список инструментов, агентские скиллы, примеры запросов) — в [репозитории на GitHub](https://github.com/ztemerbekov/a1-yandex-kit-skills).

## Быстрый старт

1. Получите токен в кабинете продавца Яндекс KIT: **Настройки → API → «Сгенерировать токен»**. Скопируйте его сразу — он показывается **только один раз**.
2. Добавьте сервер — например, в Claude Code:

   ```bash
   claude mcp add yandex-kit -e YANDEX_KIT_TOKEN=ваш_токен -- npx -y mcp-yandex-kit
   ```

   Конфиги для Claude Desktop, Cursor, OpenAI Codex и VS Code — в [разделе «Установка»](https://github.com/ztemerbekov/a1-yandex-kit-skills#установка) README репозитория.

3. Спросите ассистента: «Покажи мой магазин и первые три товара».

⚠️ Токен даёт **полный доступ** к магазину (каталог, цены, заказы) и хранится **открытым текстом** в конфиге — относитесь к нему как к паролю. Подробнее — в [документации по авторизации](https://yandex.ru/dev/kit/ru/authorization).

## Настройка

| Переменная | Обяз. | По умолчанию | Описание |
|---|---|---|---|
| `YANDEX_KIT_TOKEN` | да | — | API-токен магазина KIT. |
| `YANDEX_KIT_BASE_URL` | нет | `https://api.kit.yandex.net` | Базовый URL API. |
| `YANDEX_KIT_RPS` | нет | `3` | Лимит исходящих запросов в секунду (token bucket). |
| `YANDEX_KIT_TIMEOUT_MS` | нет | `30000` | Таймаут одного HTTP-запроса, мс. |

Требования: Node.js 20+ (через `npx` отдельная установка сервера не нужна), магазин на Яндекс KIT и API-токен из кабинета.

## Ограничения

- **3 запроса в секунду на магазин** — жёсткий лимит API. При превышении приходит `LIMIT_EXCEEDED` с **HTTP 400** (не 429) — клиент сам троттлит и ретраит с бэкоффом.
- **Песочницы нет** — все вызовы идут в боевой магазин. Изучайте API read-only тулами и перепроверяйте каждую запись.
- **API в статусе беты** — контракт может меняться.

## Документация

- [Репозиторий проекта](https://github.com/ztemerbekov/a1-yandex-kit-skills) — полный README, агентские скиллы, плагин Claude Code.
- [docs/TOOLS.md](https://github.com/ztemerbekov/a1-yandex-kit-skills/blob/main/docs/TOOLS.md) — полное описание всех 61 инструмента и карта покрытия операций.
- [Официальная документация Яндекс KIT](https://yandex.ru/dev/kit/ru/) — авторизация, лимиты, ошибки, OpenAPI-справочник.
- [Telegram-сообщество KIT](https://t.me/+f9qV8snaY1pmM2Ji) — вопросы по самому API.

## Лицензия

MIT — см. [LICENSE](https://github.com/ztemerbekov/a1-yandex-kit-skills/blob/main/LICENSE).
