# A1 Yandex KIT Skills

[![npm](https://img.shields.io/npm/v/mcp-yandex-kit)](https://www.npmjs.com/package/mcp-yandex-kit)
[![CI](https://github.com/ztemerbekov/a1-yandex-kit-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/ztemerbekov/a1-yandex-kit-skills/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

MCP-сервер и AI-тулкит для **API Яндекс KIT** — конструктора интернет-магазинов ([kit.yandex.ru](https://kit.yandex.ru)): управляйте каталогом, ценами, заказами, скидками и вебхуками из Claude, Cursor, Codex и других AI-клиентов на естественном языке.

Внутри — **61 MCP-инструмент**: кураторские тулы на повседневные операции плюс мета-трио (`search_operations`, `get_operation_schema`, `kit_request`), через которое доступны **все 133 операции** API. А также **6 агентских скиллов** с офлайн-поиском по спеке и валидацией запросов — всё сгенерировано из официальной OpenAPI-спеки.

## Быстрый старт

1. [Получите токен](#получение-токена) в кабинете продавца KIT — он показывается **один раз**.
2. Добавьте сервер — например, в Claude Code ([другие клиенты](#установка)):

   ```bash
   claude mcp add yandex-kit -e YANDEX_KIT_TOKEN=ваш_токен -- npx -y mcp-yandex-kit@latest
   ```

3. Спросите ассистента: «Покажи мой магазин и первые три товара».

## Что умеет

- **Полное покрытие API** — 65 из 133 операций закрыты удобными кураторскими тулами, остальные 68 (бейджи, подарки, характеристики, услуги, новости, редиректы и т.д.) доступны через универсальный `kit_request`.
- **Мета-трио вместо 133 инструментов**: `search_operations` ищет операцию по ключевым словам (включая русские описания из доков), `get_operation_schema` отдаёт полный контракт (метод, путь, параметры, схемы запроса и ответа), `kit_request` выполняет любую операцию по `operationId` — с ajv-валидацией тела **до** отправки в сеть.
- **Устойчивый клиент** — встроенный лимитер 3 rps (token bucket), ретраи с бэкоффом на сетевых ошибках, 5xx, 429 и `LIMIT_EXCEEDED` (только для GET-чтений: write-запросы не повторяются автоматически, чтобы не задублировать изменение), автопагинация, корректные content-type (`merge-patch+json`, `multipart/form-data`) там, где их требует API.
- **Защита от случайных ошибок** — тела write-запросов валидируются по схемам спеки до вызова, пустые обновления отклоняются, read-only тулы помечены аннотациями для MCP-клиента.
- **Надёжная база** — типизированный клиент, 156 юнит-тестов без сети, CI на Node 20/22/24, сгенерированный код проверяется на дрейф.

Карта инструментов (полный список с описаниями — в [docs/TOOLS.md](docs/TOOLS.md)):

| Группа | Инструменты |
|---|---|
| Мета (весь API) | `search_operations`, `get_operation_schema`, `kit_request` |
| Магазин | `get_store`, `get_current_user`, `get_regions` |
| Товары | `list_products`, `get_product`, `create_product`, `update_product` |
| Варианты (SKU) | `list_variants`, `get_variant`, `create_variant`, `update_variant`, `variant_action` |
| Категории | `list_categories`, `get_category`, `create_category`, `update_category`, `category_action` |
| Заказы | `list_orders`, `get_order`, `confirm_order`, `cancel_order`, `get_order_addons` |
| Клиенты | `list_customers`, `get_customer`, `update_customer`, `get_customer_orders` |
| Скидки | `list_discounts`, `get_discount`, `create_discount`, `update_discount`, `discount_action`, `manage_discount_objects` |
| Промокоды | `list_promocodes`, `get_promocode`, `create_promocode`, `update_promocode`, `manage_promocode_objects` |
| Вебхуки | `list_webhooks`, `get_webhook`, `create_webhook`, `update_webhook`, `delete_webhook`, `validate_webhook` |
| Склады | `list_warehouses`, `get_warehouse`, `create_warehouse`, `update_warehouse`, `warehouse_action` |
| Коллекции | `list_collections`, `get_collection`, `create_collection`, `update_collection`, `delete_collection`, `manage_collection_cards` |
| Файлы | `upload_file`, `get_file` |
| Подарочные карты | `list_gift_cards`, `get_gift_card` |

### Агентские скиллы

8 [Agent Skills](https://agentskills.io/) для Codex, Claude Code, Cursor и других совместимых агентов. Шесть доменных навыков самодостаточны: спека забандлена (`data/kit_v1.json.gz`), поиск по докам и офлайн-валидация тел запросов запускаются голым Node.js >= 20, без `npm install` и без сети. Два сценарных навыка оркестрируют их для операционной работы и глубокого аудита:

- `a1-yandex-kit` — роутер: авторизация, лимиты, контракт ошибок, пагинация;
- `a1-yandex-kit-catalog` — товары, варианты, категории, характеристики, коллекции (включая контекстные), бейджи;
- `a1-yandex-kit-orders` — заказы, клиенты, подарочные карты, услуги;
- `a1-yandex-kit-marketing` — скидки, промокоды, подарки;
- `a1-yandex-kit-store` — профиль магазина, склады, пользователи, гео, файлы, редиректы, новости;
- `a1-yandex-kit-webhooks` — вебхуки: события заказов, одноразовый secret.
- `a1-yandex-kit-operator` — текущий статус магазина и точные операционные действия: подтверждение/отмена заказа, заданная цена или остаток, промо и вебхук. Глубокий аудит каталога передаёт `a1-yandex-kit-catalog-doctor`; «проверь/покажи/разбери/найди» всегда read-only, а запись выполняется только при однозначных цели, действии и значении.
- `a1-yandex-kit-catalog-doctor` — полный read-only аудит SKU, продуктов, характеристик, группировки, медиа, категорий, складов и коллекций со счётчиками покрытия и разделением на блокеры, риски и рекомендации; бейджи, динамические фильтры, контекстные коллекции и похожие товары проверяются по явному запросу.

Установка плагина (скиллы + автоподключение MCP-сервера):

```bash
claude plugin marketplace add ztemerbekov/a1-yandex-kit-skills
claude plugin install a1-yandex-kit@a1-yandex-kit-skills
```

Токен плагин берёт из переменной окружения `YANDEX_KIT_TOKEN`. Встроенный MCP-сервер плагина стартует автоматически через `npx -y mcp-yandex-kit@latest`.

## Примеры запросов

Попросите ассистента на русском — например:

- «Покажи заказы за сегодня и их статусы оплаты»
- «Проведи глубокий read-only аудит каталога и покажи покрытие»
- «Найди вариант с артикулом SKU-1042 и подними цену на 10%»
- «Создай промокод WELCOME10 на скидку 10% до конца месяца»
- «Подпишись вебхуком на смену статусов заказов на https://example.com/hooks/kit»
- «Какие товары лежат в архиве? Верни "Кроссовки Alpha" на витрину»
- «Загрузи фото из ~/photos/red-tshirt.jpg и поставь его варианту 123»
- «Найди операции для работы с бейджами и создай бейдж "Хит продаж"»

## Установка

Локальный stdio-сервер: токен хранится только у вас. Разверните своего клиента:

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add yandex-kit -e YANDEX_KIT_TOKEN=ваш_токен -- npx -y mcp-yandex-kit@latest
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

Добавьте сервер в `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "yandex-kit": {
      "command": "npx",
      "args": ["-y", "mcp-yandex-kit@latest"],
      "env": { "YANDEX_KIT_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

<details>
<summary><b>Cursor</b></summary>

`~/.cursor/mcp.json` (или `.cursor/mcp.json` в проекте)

```json
{
  "mcpServers": {
    "yandex-kit": {
      "command": "npx",
      "args": ["-y", "mcp-yandex-kit@latest"],
      "env": { "YANDEX_KIT_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

<details>
<summary><b>OpenAI Codex</b></summary>

Командой: `codex mcp add yandex-kit --env YANDEX_KIT_TOKEN=ваш_токен -- npx -y mcp-yandex-kit@latest`

Или в `~/.codex/config.toml`:

```toml
[mcp_servers.yandex-kit]
command = "npx"
args = ["-y", "mcp-yandex-kit@latest"]

[mcp_servers.yandex-kit.env]
YANDEX_KIT_TOKEN = "ваш_токен"
```

</details>

<details>
<summary><b>VS Code</b></summary>

`.vscode/mcp.json` — ключ `servers` (не `mcpServers`)

```json
{
  "servers": {
    "yandex-kit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-yandex-kit@latest"],
      "env": { "YANDEX_KIT_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

## Обновление

Сервер обновляется при перезапуске MCP-клиента — специальной команды не нужно:

- **Подключение через `npx` с `@latest`** (все примеры выше): npx при каждом старте
  сверяется с npm-реестром, свежая версия подтягивается сама. Достаточно
  перезапустить клиент (для Claude Code — новую сессию).
- **Если в конфиге `mcp-yandex-kit` без тега**: npx кэширует первую установленную
  версию и больше не обновляет её. Либо добавьте `@latest` в конфиг, либо
  очистите кэш: `rm -rf ~/.npm/_npx` (Windows: `%LocalAppData%\npm-cache\_npx`).
- **Нужна стабильность вместо свежести** — закрепите версию явно:
  `mcp-yandex-kit@0.1.0`; обновление тогда — смена пина.
- **Плагин Claude Code**: `claude plugin update a1-yandex-kit` обновляет скиллы;
  встроенный сервер идёт через `npx -y mcp-yandex-kit@latest` и обновляется сам.
- **Локальный клон**: `git pull && npm ci && npm run build`.

Что нового в версиях — в [GitHub Releases](https://github.com/ztemerbekov/a1-yandex-kit-skills/releases).

## Получение токена

1. Откройте кабинет продавца Яндекс KIT.
2. Перейдите в **Настройки → API** и нажмите **«Сгенерировать токен»**.
3. Скопируйте токен в `YANDEX_KIT_TOKEN` сразу: он показывается **только один раз**. При утере — сгенерируйте новый там же.

⚠️ Токен даёт **полный доступ** к магазину (каталог, цены, заказы) и хранится **открытым текстом** в конфиге — относитесь к нему как к паролю. Подробнее — в [документации по авторизации](https://yandex.ru/dev/kit/ru/authorization).

## Настройка

| Переменная | Обяз. | По умолчанию | Описание |
|---|---|---|---|
| `YANDEX_KIT_TOKEN` | да | — | API-токен магазина KIT. |
| `YANDEX_KIT_BASE_URL` | нет | `https://api.kit.yandex.net` | Базовый URL API. |
| `YANDEX_KIT_RPS` | нет | `3` | Лимит исходящих запросов в секунду (token bucket). |
| `YANDEX_KIT_TIMEOUT_MS` | нет | `30000` | Таймаут одного HTTP-запроса, мс. |

## Требования

- Node.js 20+ (через `npx` отдельная установка сервера не нужна).
- Магазин на Яндекс KIT и API-токен из кабинета — см. [Получение токена](#получение-токена).

## Ограничения

- **3 запроса в секунду на магазин** — жёсткий лимит API. При превышении приходит `LIMIT_EXCEEDED` с **HTTP 400** (не 429) — клиент сам троттлит и для чтений (GET) ретраит с бэкоффом, определяя лимит по коду ошибки; write-запросы не повторяются — ошибка с кодом и trace ID возвращается вызывающему.
- **Песочницы нет** — все вызовы идут в боевой магазин. Изучайте API read-only тулами и перепроверяйте каждую запись.
- **API в статусе беты** — контракт может меняться; снапшот спеки лежит в `specs/`, CI следит за дрейфом сгенерированного кода.
- **Вебхуки**: `secret` возвращается только один раз при создании, а алгоритм подписи входящих запросов Яндексом не документирован — детали в скилле `a1-yandex-kit-webhooks`.

## Документация

- [docs/TOOLS.md](docs/TOOLS.md) — полное описание всех 61 инструмента и карта покрытия операций.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — сборка, тесты, codegen, smoke-проверка.
- [docs/PUBLISHING.md](docs/PUBLISHING.md) — публикация в npm и MCP registry.
- [Официальная документация Яндекс KIT](https://yandex.ru/dev/kit/ru/) — авторизация, лимиты, ошибки, OpenAPI-справочник.
- [Telegram-сообщество KIT](https://t.me/+f9qV8snaY1pmM2Ji) — вопросы по самому API.

## Смотрите также

- **[mcp-yandex-direct](https://github.com/askads/mcp-yandex-direct)** — MCP-сервер Яндекс Директа: контекстная реклама на естественном языке.
- **[mcp-yandex-metrica](https://github.com/askads/mcp-yandex-metrica)** — MCP-сервер Яндекс Метрики: веб-аналитика.
- **[mcp-yandex-wordstat](https://github.com/askads/mcp-yandex-wordstat)** — MCP-сервер Вордстата: статистика поисковых запросов.

## Лицензия

MIT — см. [LICENSE](./LICENSE).
