# Разработка

Требования: Node.js 20+ (CI гоняет матрицу 20/22/24). Репозиторий — npm workspaces
монорепо: три пакета в `packages/*` плюс сгенерированные скиллы в `skills/`.

```bash
git clone https://github.com/ztemerbekov/a1-yandex-kit-skills.git
cd a1-yandex-kit-skills
npm ci
```

## Скрипты (запускать из корня)

```bash
npm run build          # сборка packages/core и packages/mcp в dist/
npm run typecheck      # проверка типов всех воркспейсов: исходники + тесты (без эмита)
npm test               # юнит-тесты core + mcp (node --test, мок-клиент, без сети) — 236 тестов
npm run gen            # перегенерация: registry.json, types.ts, docs/TOOLS.md, skills/*
npm run spec:fetch     # обновить снапшот specs/kit-swagger.openapi.json с официального URL
npm run smoke          # живые read-only вызовы к боевому API (нужен YANDEX_KIT_TOKEN)

npm run dev -w packages/mcp   # запуск MCP-сервера из исходников (tsx watch)
```

## Структура репозитория

```
specs/kit-swagger.openapi.json   # снапшот OpenAPI-спеки — единственный source of truth
packages/core/                   # yandex-kit-core: клиент (Bearer, ретраи, 3 rps, ajv-валидация)
packages/mcp/                    # mcp-yandex-kit: MCP-сервер (stdio), 61 тул
packages/codegen/                # генераторы: спека → registry / types / скиллы / TOOLS.md
skills/                          # 6 сгенерированных доменных + вручную поддерживаемые сценарные скиллы
.claude-plugin/ + .mcp.json      # манифесты плагина Claude Code
docs/TOOLS.md                    # справочник тулов (СГЕНЕРИРОВАН)
```

Сервер отдаёт 61 тул: 65 из 133 операций API покрыты кураторскими тулами, а мета-трио
`search_operations` / `get_operation_schema` / `kit_request` даёт доступ ко всем
133 операциям (21 группа тегов спеки).

## Сгенерированные файлы — не править руками

Генерируются командой `npm run gen` и коммитятся:

- `packages/core/src/generated/registry.json` и `.../generated/types.ts`;
- `docs/TOOLS.md`;
- `skills/**` целиком (включая `SKILL.md`, `scripts/`, `data/*.json.gz`).

Любые правки этих файлов вносите в генераторы (`packages/codegen/src/gen-*.ts`),
включая прозу скиллов — она живёт в шаблонах `gen-skills.ts`. CI проверяет дрейф:
`npm run gen && git diff --exit-code` должен проходить, иначе сборка красная.

Исключение: верхнеуровневые сценарные навыки поддерживаются вручную, отдельно от
генерации API-справочника. Сейчас это `skills/a1-yandex-kit-operator/` и
`skills/a1-yandex-kit-catalog-doctor/`; `npm run gen` не удаляет и не перезаписывает
их. Их semiautomated сценарии и fake MCP находятся в `packages/mcp/src/scenarios/`
и запускаются через обычный `npm test`.

## MCP Inspector

Токен проверяется при старте сервера, но `tools/list` в сеть не ходит — подойдёт заглушка.
Inspector 2 не наследует окружение родительского процесса, поэтому токен передаётся
через `-e`; опции идут после команды сервера:

```bash
npm run build
npx @modelcontextprotocol/inspector@2 --cli node packages/mcp/dist/index.js \
  --method tools/list -e YANDEX_KIT_TOKEN=dummy
```

## Smoke-проверка (вживую, только чтение)

У KIT API нет песочницы — smoke ходит в боевой магазин, поэтому выполняет только
чтение: `GetStore` и `GetProducts` (page=1, per_page=1). Лимит API — 3 запроса
в секунду на магазин, клиент сам его соблюдает.

```bash
YANDEX_KIT_TOKEN=ваш_токен npm run smoke
```

Запускайте локально со своим токеном. В CI smoke гоняется еженедельно
(`.github/workflows/health.yml`) и только если в репозитории задан секрет
`YANDEX_KIT_TOKEN`; в pull request секрет не попадает.

## E2E-проверка (вживую, С ЗАПИСЬЮ — только тестовый магазин!)

E2E гоняет реальный stdio-сервер через MCP-клиент и проходит полный цикл:
`tools/list` → `get_store` → создание категории → товара → скрытого варианта
(`HIDDEN`, на витрине не появляется) → смена цены с read-back → архивация
варианта и категории. Товар остаётся в магазине навсегда: у API нет операции
удаления или архивации товара — поэтому **токен боевого магазина сюда передавать
нельзя**. Скрипт требует явного подтверждения флагом:

```bash
YANDEX_KIT_TOKEN=токен_тестового_магазина YANDEX_KIT_E2E_WRITE=1 npm run e2e
```

Скорость по умолчанию занижена до 1 rps: реальный лимитер API строже
задокументированных 3 rps и на бёрстах отвечает 429 с телом `limited` (не JSON).
Мутации клиент не ретраит (issue #6), поэтому ретраи 429 сделаны на уровне
самого скрипта и только для шагов, где повтор безопасен: обновление тем же
значением и идемпотентные archive-действия.

В CI (`ci.yml`) e2e запускается на pull request и push в main: после прохождения
юнит-тестов, с тем же секретом `YANDEX_KIT_TOKEN` — **в секрете обязан лежать
токен тестового магазина**, потому что каждый прогон навсегда оставляет в нём
один неудаляемый товар. Живые прогоны сериализованы между ветками (fixed
concurrency group), при отсутствии секрета джоба тихо скипается.

## Локальная установка плагина

```bash
claude plugin marketplace add ./
claude plugin install a1-yandex-kit@a1-yandex-kit-skills
```

После установки в Claude Code появляются шесть сгенерированных доменных навыков,
`a1-yandex-kit-operator` и `a1-yandex-kit-catalog-doctor`, а MCP-сервер подключается
автоматически через `.mcp.json` (нужен `YANDEX_KIT_TOKEN` в окружении).

Можно подключить только MCP-сервер, без плагина:

```bash
npm run build
claude mcp add yandex-kit -e YANDEX_KIT_TOKEN=ваш_токен -- node "$PWD/packages/mcp/dist/index.js"
```

Скрипты скиллов самодостаточны и работают голым Node, без `node_modules`:

```bash
node skills/a1-yandex-kit/scripts/search_docs.mjs "создать товар"
```

## Обновление спеки

API находится в бете, спека может дрейфовать. Порядок обновления:

1. `npm run spec:fetch` — печатает `spec unchanged` либо перезаписывает снапшот
   и выводит старое/новое число путей и операций.
2. Посмотреть дифф: `git diff specs/` — оценить, какие группы затронуты.
3. `npm run gen` — перегенерировать registry, типы, скиллы и `docs/TOOLS.md`.
4. `npm run typecheck && npm test` — если изменения задели кураторские тулы,
   поправить их и тесты.

Еженедельный workflow `health.yml` делает шаги 1–2 автоматически и при дрейфе
заводит issue с меткой `spec-drift`.

## CI

- `ci.yml` — на push и pull request: Node 20/22/24, `npm ci` → `typecheck` →
  `build` → `test` → проверка дрейфа сгенерированного кода.
- `health.yml` — еженедельно и вручную (`workflow_dispatch`): проверка дрейфа
  спеки + опциональный smoke по секрету.
