# A1 Yandex KIT Skills — план реализации

> Составлен 2026-07-27 по результатам исследования. Предназначен для автономной реализации
> агентом (ultracode-сессия). Работать по фазам (§6), после каждой фазы прогонять верификацию (§8).
> Все факты об API в §2 проверены против живой документации и боевого эндпоинта — им можно доверять
> без повторной проверки. Спека уже скачана и лежит в `specs/kit-swagger.openapi.json`.

## 1. Контекст и цель

**Яндекс KIT** (kit.yandex.ru, статус beta) — конструктор интернет-магазинов Яндекса, по сути
«российский Shopify». Его API — server-to-server слой для синхронизации каталога, остатков, цен
и управления заказами между бэкендом продавца и платформой.

**Цель проекта** — репозиторий `a1-yandex-kit-skills` по образцу
[Shopify/shopify-ai-toolkit](https://github.com/Shopify/shopify-ai-toolkit), дающий AI-агентам
полный доступ к KIT API. Домены совпадают идеально (e-commerce платформа), поэтому структура
Shopify переносится осмысленно, а не механически.

**Критичное открытие про shopify-ai-toolkit** (учтено в архитектуре): их публичный репозиторий —
это НЕ MCP-сервер и не библиотека. Это сгенерированное «зеркало» плагина для AI-агентов:
- `skills/<name>/` — 20 скиллов: `SKILL.md` (YAML frontmatter + инструкции агенту) + `scripts/`
  (`search_docs.mjs` — поиск по докам, `validate.mjs` — офлайн-валидация кода по забандленной
  схеме) + `data/*.json.gz` (схемы API по версиям);
- манифесты под хосты: `.claude-plugin/{plugin,marketplace}.json`, `.codex-plugin/`,
  `.cursor-plugin/`, корневые `plugin.json`, `gemini-extension.json`;
- `.mcp.json` у них **пустой** (`{"mcpServers":{}}`) — сам MCP-сервер, codegen
  (`generate-agent-skills.ts`) и тесты живут в приватном монорепо `ai-toolkit-source`
  (`packages/dev-mcp`, `packages/shopify-dev-tools`, `packages/plugins`).

**Следствие:** мы зеркалим публичную поверхность Shopify (skills + манифесты) и строим
недостающий пайплайн (codegen из OpenAPI + настоящий MCP-сервер) в том же одном публичном репо.
Наш `.mcp.json` будет непустым — плагин сразу подключает и скиллы, и MCP-сервер. Это осознанное
улучшение относительно оригинала.

**MCP-серверная часть следует конвенциям существующего трио** `askads/mcp-yandex-{direct,metrica,wordstat}`
(TypeScript ESM, `@modelcontextprotocol/sdk`, zod, встроенный `node --test`, публикация
npm + MCP registry + Glama) — см. §5.

## 2. Проверенные факты об API (source of truth)

| Факт | Значение |
|---|---|
| Base URL | `https://api.kit.yandex.net`, все пути с префиксом `/v1/` |
| Аутентификация | `Authorization: Bearer <API_TOKEN>` (HTTP Bearer, не OAuth) |
| Получение токена | ЛК продавца KIT → **Настройки → API → Сгенерировать токен**; повторно не показывается |
| Rate limit | **3 запроса в секунду на магазин** (жёсткий, заголовков квоты нет) |
| Контракт ошибок | JSON `{"code","message","trace_id"}`; коды: `AUTHENTICATION_ERROR`(401), `FORBIDDEN_ERROR`(403), `VALIDATION_ERROR`(400), `LIMIT_EXCEEDED`(400!), `UNSUPPORTED_MEDIA_TYPE`(415), `NOT_FOUND`(404), `CONFLICT`(409), `UNKNOWN_ERROR`(500) |
| Проверено вживую | `GET /v1/store` без токена → `401 {"code":"AUTHENTICATION_ERROR","message":"Ошибка аутентификации","trace_id":"..."}` |
| OpenAPI-спека | 3.0.3, v1.0.0: **87 путей / 133 операции / 21 группа тегов / 188 схем**. URL: `https://yandex.ru/dev/kit/ru/openapi/kit-swagger.openapi.json`. Локальный снапшот: `specs/kit-swagger.openapi.json` (299 KB) |
| operationId | Есть у всех 133 операций, уникальные, чистый PascalCase: `GetProducts`, `CreateCategory`, `ArchiveVariant` → имена тулов выводятся детерминированно (`get_products`) |
| Пагинация | query `page` + `per_page` на всех списках |
| Content-Types | `application/json` (44 body-операции); **`application/merge-patch+json` ровно у 4**: `UpdateCategory`, `UpdateCharacteristic`, `UpdateVariant`, `UpdateWarehouse`; `multipart/form-data` у 1: `POST /v1/files` (поле `file`, binary) |
| Паттерны путей | список/создание `/v1/{res}`, объект `/v1/{res}/{id}`, мягкое удаление `.../archive` + `.../unarchive`, связи `.../objects/add` и `.../objects/remove` |
| Вебхуки | `POST /v1/webhooks` (только HTTPS-URL); события: `ORDER_STATUS_CHANGED`, `ORDER_PAYMENT_STATUS_CHANGED`, `ORDER_DELIVERY_STATUS_CHANGED`; ответ создания содержит `secret` (UUID) для верификации входящих; **алгоритм подписи в доках не описан** |
| Песочница | **Нет.** Только прод. Все даты — UTC |
| Язык доков | Всё на русском; у операций есть и `summary`, и `description` — codegen может их переиспользовать |

21 группа (операций): Товары 17, Скидки 11, Характеристики 11, Бейджи 10, Услуги/addons 10,
Промокоды 9, Коллекции 8, Подарки 8, Вебхуки 6, Заказы 6, Категории 6, Склады 6,
Контекстные коллекции 5, Новости/blogs 5, Редиректы 5, Клиенты 3, Подарочные карты 2,
Файлы 2, Гео 1, Магазин 1, Пользователи 1.

Ключевые URL доков: обзор `https://yandex.ru/dev/kit/ru/`, авторизация `.../ru/authorization`,
лимиты `.../ru/rate-limits`, ошибки `.../ru/errors`, справочник `.../ru/openapi/`.
Комьюнити (Telegram): `https://t.me/+f9qV8snaY1pmM2Ji`.

## 3. Целевая структура репозитория

```
a1-yandex-kit-skills/
├── specs/
│   └── kit-swagger.openapi.json      # снапшот спеки — единственный source of truth (УЖЕ ЛЕЖИТ)
├── packages/
│   ├── core/                         # yandex-kit-core: типизированный клиент (библиотека)
│   │   └── src/
│   │       ├── client.ts             # fetch-обёртка: Bearer, таймаут, ретраи, rate limiter 3 rps
│   │       ├── errors.ts             # KitApiError {status, code, message, traceId}
│   │       ├── validate.ts           # ajv-валидация body/params по схемам спеки
│   │       ├── registry.ts           # доступ к generated/registry.json (все 133 операции)
│   │       ├── generated/
│   │       │   ├── registry.json     # GENERATED: компактный реестр операций
│   │       │   └── types.ts          # GENERATED: openapi-typescript
│   │       └── *.test.ts             # колокейтед-тесты
│   ├── mcp/                          # mcp-yandex-kit: MCP-сервер (bin, stdio)
│   │   └── src/
│   │       ├── index.ts              # McpServer + все register*Tools() + StdioServerTransport
│   │       ├── config.ts             # env → конфиг
│   │       ├── util.ts               # ok/fail/okOrPartial, READ_ONLY-аннотации, клампы
│   │       ├── smoke.ts              # живые read-only вызовы (нужен токен)
│   │       └── tools/                # по файлу на домен: products.ts, orders.ts, meta.ts …
│   │           └── *.test.ts         # мок-клиент, без сети
│   └── codegen/                      # private: генераторы (запускаются через tsx)
│       └── src/
│           ├── fetch-spec.ts         # обновить specs/ с яндексового URL + дифф-отчёт
│           ├── gen-registry.ts       # спека → core/src/generated/registry.json
│           ├── gen-types.ts          # обёртка openapi-typescript → types.ts
│           ├── gen-skills.ts         # спека → skills/* (SKILL.md-таблицы, data/*.gz, скрипты)
│           └── gen-docs.ts           # спека+тулы → docs/TOOLS.md
├── skills/                           # слой shopify-ai-toolkit (частично GENERATED)
│   ├── yandex-kit/                   # роутер-скилл: auth, ошибки, лимиты; scripts/ + data/
│   ├── yandex-kit-catalog/           # Товары, Категории, Характеристики, Коллекции, Контекстные коллекции, Бейджи
│   ├── yandex-kit-orders/            # Заказы, Клиенты, Подарочные карты, Услуги
│   ├── yandex-kit-marketing/         # Скидки, Промокоды, Подарки
│   ├── yandex-kit-store/             # Магазин, Склады, Пользователи, Гео, Файлы, Редиректы, Новости
│   └── yandex-kit-webhooks/          # Вебхуки + верификация secret
│       # в каждом: SKILL.md + scripts/{search_docs.mjs, validate.mjs} + data/kit_v1.json.gz
├── .claude-plugin/
│   ├── plugin.json                   # имя, версия, описание плагина
│   └── marketplace.json              # для локальной установки/каталога
├── .mcp.json                         # НЕпустой: {"mcpServers":{"yandex-kit":{command:"npx",args:["-y","mcp-yandex-kit"],env:{...}}}}
├── docs/                             # DEVELOPMENT.md, PUBLISHING.md, TOOLS.md (generated)
├── .github/workflows/                # ci.yml, health.yml
├── server.json                       # манифест официального MCP-реестра
├── glama.json                        # {"$schema":"https://glama.ai/mcp/schemas/server.json","maintainers":["gistrec"]}
├── CLAUDE.md                         # конвенции для будущих агент-сессий (по образцу mcp-yandex-direct)
├── package.json                      # root: private, workspaces:["packages/*"]
├── tsconfig.base.json  README.md  CHANGELOG.md  LICENSE  .gitignore
```

## 4. Ключевые решения (и альтернативы)

1. **Один монорепо (npm workspaces), а не два репозитория.** Shopify держит пайплайн в приватном
   репо — нам скрывать нечего, а один флагманский реп ценнее для портфолио.
   *Альтернатива:* отдельный `mcp-yandex-kit` в стиле трио — отвергнута (дублирование клиента).
2. **MCP: кураторские тулы, а НЕ 133 сгенерённых.** 133 тула раздули бы контекст потребителя на
   десятки килотокенов. Вместо этого: ~55–60 рукописных тулов на горячие группы (§7) + мета-трио,
   покрывающее **все 133 операции**: `search_operations` (поиск по registry),
   `get_operation_schema` (разрешённая JSON-схема операции), `kit_request` (выполнить любую
   операцию по `operationId` с ajv-валидацией до отправки). Хвостовые группы (бейджи, подарки,
   характеристики, блоги, редиректы…) доступны через это трио с первого дня.
3. **Codegen — свой лёгкий (tsx-скрипты), без тяжёлых генераторов.** Из спеки генерим:
   `registry.json` (операции: id, method, path, tag, summary, параметры, contentType, ссылки на
   схемы, флаг пагинации), `types.ts` (пакет `openapi-typescript`, dev-time), скиллы и TOOLS.md.
   Генерённое коммитится; CI проверяет дрейф (`npm run gen && git diff --exit-code`).
4. **Валидация: ajv по схемам спеки** (аналог забандленного graphql-js у Shopify) — и в
   `kit_request`, и в `validate.mjs` скиллов. **zod — только в рукописных inputSchema тулов**
   (требование `McpServer.registerTool`).
5. **Клиент обязан быть лучше шопифаевского**: у них нет ретраев и пагинации — у нас встроенный
   token-bucket на 3 rps (конфигурируемый), ретраи с backoff (сеть/5xx/429), автопагинация с
   клампом и флагом `_truncated`, per-operation contentType (merge-patch! multipart!).
6. **6 консолидированных скиллов, а не 21 по тегам.** KIT — один REST API, 21 скилл замусорил бы
   список скиллов хоста. Каждый скилл = frontmatter-роутинг + workflow «search → schema →
   validate → execute (MCP-тул или curl)» + сгенерированная таблица эндпоинтов своих групп.
   *Альтернатива:* 1 скилл на тег — легко переключить, генератор один и тот же.
7. **Язык:** всё agent-facing (описания тулов, SKILL.md) — английский (конвенция трио, шире
   аудитория MCP-каталогов); всё human-facing (README, docs/) — русский. Русские
   summary/description из спеки идут в registry как доп. поле `summaryRu` (полезно для поиска).
8. **Скрипты скиллов самодостаточны**: `search_docs.mjs` — только node-builtins (zlib + токенный
   скоринг по registry), `validate.mjs` — esbuild-бандл с ajv (как Shopify бандлит graphql-js).
   Никаких `npm install` у пользователя плагина.
9. **Телеметрию Shopify не воспроизводим** (hooks/track-telemetry — чистая аналитика), манифесты
   Cursor/Codex/Gemini — опционально в Phase 5, начинаем с `.claude-plugin/` + `.mcp.json`.
10. **Версионирование/релизы:** вручную, как в трио (CHANGELOG.md + синхронный bump
    `package.json`+`server.json`), без changesets.

## 5. Конвенции кода (перенести из `~/Projects/mcp-yandex-direct`, там образцы)

- TypeScript strict, ESM (`"type":"module"`), Node >= 20, сборка голым `tsc`, dev через `tsx`.
- `@modelcontextprotocol/sdk` ^1.29 (или новее 1.x), `zod` ^3.25.
- Один файл на домен, экспортирует `register<Name>Tools(server, client)`; всё зовётся в `index.ts`.
- Каждый inputSchema — zod с `.describe()`; пустые update-запросы отклонять до вызова API.
- Чтения — `ok()` (компактный JSON, экономим токены потребителя); записи — `okOrPartial()`;
  read-only тулы помечать `annotations: READ_ONLY`.
- Тесты: встроенный `node --test` через tsx, колокейтед `*.test.ts`, мок-клиент, ноль сети.
- Скрипты package.json: `build`, `dev`, `typecheck`, `test`, `smoke`, `gen`, `spec:fetch`;
  `prepublishOnly: typecheck && test`.
- Env: `YANDEX_KIT_TOKEN` (required, secret), `YANDEX_KIT_BASE_URL` (default прод),
  `YANDEX_KIT_RPS` (default 3), `YANDEX_KIT_TIMEOUT_MS` (default 30000).
- Гайд потребителю-LLM живёт в description тулов, не в CLAUDE.md.
- CI: matrix node 20/22/24 → `npm ci → typecheck → build → test → gen-drift`.

## 6. Фазы реализации

**Phase 0 — скаффолд.** Root package.json (workspaces), tsconfig.base, три пакета-заготовки,
LICENSE/.gitignore, ci.yml. ✅ `npm ci && npm run typecheck` зелёные, CI проходит.

**Phase 1 — codegen + core.** `gen-registry.ts`, `gen-types.ts`, `fetch-spec.ts`; клиент
(Bearer, таймаут, ретраи+backoff, token-bucket 3 rps, KitApiError по контракту из §2,
merge-patch/multipart по registry, автопагинация с клампом), `validate.ts` (ajv, $ref-резолв).
✅ registry.json содержит 133 операции; тесты клиента (мок-fetch): заголовок auth, ретрай на 500,
очередь при >3 rps, парсинг реального 401-контракта, merge-patch content-type, кламп пагинации;
тесты validate: валидный/невалидный body.

**Phase 2 — MCP MVP (~23 тула).** Каркас сервера + группы: meta (3), store (3), products (5),
variants (4), categories (5) — состав в §7. Плюс `smoke.ts` (при наличии токена: `get_store`,
`list_products page=1 per_page=1`). ✅ inspector показывает все тулы; юнит-тесты каждого файла
тулов; `kit_request` блокирует невалидный body ДО отправки.

**Phase 3 — полное кураторское покрытие (~+36).** orders, customers, discounts, promocodes,
webhooks, warehouses, collections, files, gift_cards (§7); `gen-docs.ts` → docs/TOOLS.md.
✅ все тесты зелёные; TOOLS.md перегенерируется без дрейфа.

**Phase 4 — скиллы + плагин.** `gen-skills.ts` (6 скиллов: SKILL.md с frontmatter и
таблицами эндпоинтов, `data/kit_v1.json.gz`, `search_docs.mjs`, esbuild-бандл `validate.mjs`),
`.claude-plugin/{plugin,marketplace}.json`, непустой `.mcp.json`. Рукой дошлифовать прозу
роутер-скилла `yandex-kit` (auth/errors/limits) и `yandex-kit-webhooks` (secret, недокументированная
подпись). ✅ `claude plugin marketplace add ./ && claude plugin install …` локально — скиллы видны,
MCP-сервер подключился; скрипты скиллов запускаются голым node без node_modules.

**Phase 5 — полировка и публикация.** README.md (RU, структура секций как у mcp-yandex-direct:
Быстрый старт / Что умеет / Примеры запросов / Подключение по URL / Установка / Получение токена /
Настройка / Требования / Ограничения / Документация / Поддержка / Лицензия), CLAUDE.md,
docs/{DEVELOPMENT,PUBLISHING}.md, server.json + glama.json, health.yml (еженедельный cron:
`fetch-spec` и дифф против снапшота → issue при дрейфе; smoke по секрету, с гардом
`if: github.repository == …`), опц. VHS-демка. ✅ чек-лист DoD (§11), `npm publish --dry-run` ок.

## 7. Кураторские MCP-тулы

Имена — snake_case от operationId; действия archive/unarchive сворачиваются в `*_action` c enum
(паттерн `campaign_action` из mcp-yandex-direct).

- **meta (3):** `search_operations`, `get_operation_schema`, `kit_request` — покрывают все 133 операции.
- **store (3):** `get_store`, `get_current_user`, `get_regions`.
- **products (5):** `list_products`, `get_product`, `create_product`, `update_product`, `product_action(archive|unarchive)`.
- **variants (4):** `list_variants`, `get_variant`, `update_variant` (merge-patch: цены/остатки), `variant_action`.
- **categories (5):** `list_categories`, `get_category`, `create_category`, `update_category` (merge-patch), `category_action`.
- **orders (5):** `list_orders`, `get_order`, `confirm_order`, `cancel_order`, `get_order_addons`.
- **customers (3):** `list_customers`, `update_customer`, `get_customer_orders`.
- **discounts (6):** `list_discounts`, `get_discount`, `create_discount`, `update_discount`, `discount_action`, `manage_discount_objects(add|remove)`.
- **promocodes (6):** аналогично discounts.
- **webhooks (6):** `list_webhooks`, `create_webhook` (⚠️ в ответе secret — показывается один раз, сказать это в description), `get_webhook`, `update_webhook`, `delete_webhook`, `validate_webhook`.
- **warehouses (4):** `list_warehouses`, `create_warehouse`, `update_warehouse` (merge-patch), `warehouse_action`.
- **collections (5):** `list_collections`, `create_collection`, `update_collection`, `delete_collection`, `manage_collection_cards`.
- **files (2):** `upload_file` (принимает локальный путь ИЛИ base64 — stdio-сервер локальный), `get_file`.
- **gift_cards (2):** `list_gift_cards`, `get_gift_card`.

Итого ~59. Характеристики, бейджи, услуги, подарки, контекстные коллекции, новости, редиректы,
similar/external_ids — сознательно только через meta-трио (добавлять кураторские по мере спроса).

## 8. Верификация (гонять после каждой фазы)

```bash
npm run typecheck && npm test && npm run build          # root, все workspaces
npm run gen && git diff --exit-code                      # дрейф генерённого
npx @modelcontextprotocol/inspector --cli node packages/mcp/dist/index.js --method tools/list
YANDEX_KIT_TOKEN=... npm run smoke -w packages/mcp       # опционально, read-only, боевой API
claude mcp add yandex-kit -e YANDEX_KIT_TOKEN=... -- node $PWD/packages/mcp/dist/index.js
#   → в Claude Code: «покажи мой магазин и первые 3 товара»
claude plugin marketplace add ./ && claude plugin install a1-yandex-kit@<marketplace>  # Phase 4+
node skills/yandex-kit/scripts/search_docs.mjs "создать товар"   # без node_modules!
```

Помнить: боевой лимит 3 rps, песочницы нет → smoke только чтение, write-пути только моками.

## 9. Публикация (Phase 5, по docs/PUBLISHING.md трио)

npm `mcp-yandex-kit` → MCP registry (`mcp-publisher publish` по server.json; `mcpName` в
package.json == `name` в server.json) → GitHub release (`gh release create --generate-notes`) →
Glama → PR в awesome-mcp-servers (**строго один сервер на PR** — урок #8908). Версии
package.json и server.json (root + packages[].version) бампить синхронно.

## 10. Риски и открытые вопросы

1. **Прекондишен пользователя:** для живых вызовов нужен магазин KIT и токен из ЛК. Вся
   разработка мокабельна, smoke опционален — токен НЕ блокирует реализацию.
2. **Namespace GitHub/npm не решён:** текущий remote этой рабочей копии —
   `ztemerbekov/a1-yandex-kit-skills` (не основной неймспейс). Трио живёт в `askads/*`,
   `mcpName` вида `io.github.askads/…`. **Не пушить и не публиковать без решения владельца.**
   Локальной разработке не мешает.
3. **API в бете** → дрейф спеки. Митигация: снапшот в specs/ + health-cron с диффом.
4. **Алгоритм подписи вебхуков не документирован** (есть только secret). В скилле честно
   отметить; уточнить в Telegram-комьюнити или поддержке.
5. **`LIMIT_EXCEEDED` приходит с HTTP 400**, не 429 — ретраить по `code`, не только по статусу.

## 11. Definition of Done

- [ ] `npm run typecheck/test/build/gen` зелёные локально и в CI (node 20/22/24)
- [ ] inspector: tools/list отдаёт ~59 тулов с описаниями и аннотациями
- [ ] `kit_request` выполняет любую из 133 операций; невалидный body режется до сети
- [ ] smoke против боевого API проходит (при токене)
- [ ] плагин ставится в Claude Code локально: 6 скиллов + автоподключение MCP
- [ ] README (RU) + TOOLS.md + CLAUDE.md + server.json/glama.json готовы, версии синхронны
- [ ] `npm publish --dry-run` без ошибок; решение по namespace получено от владельца
