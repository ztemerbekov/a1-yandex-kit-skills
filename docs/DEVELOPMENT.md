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
npm test               # юнит-тесты core + mcp + setup-скилл (node --test, без сети)
npm run gen            # перегенерация: registry.json, types.ts, docs/TOOLS.md, skills/*
npm run validate:agent-plugin # проверка portable Agent Plugins package и MCP-конфига
npm run spec:fetch     # обновить снапшот specs/kit-swagger.openapi.json с официального URL
npm run smoke          # живые read-only вызовы к боевому API (нужен YANDEX_KIT_TOKEN)

npm run dev -w packages/mcp   # запуск MCP-сервера из исходников (tsx watch)
```

## Структура репозитория

```
specs/kit-swagger.openapi.json   # снапшот OpenAPI-спеки — единственный source of truth
plugin.json                       # portable Agent Plugins manifest v1.0.0
mcp.json                          # portable MCP configuration v1.0.0, без токена
specs/agent-plugins/              # pinned schemas для offline-проверки
packages/core/                   # yandex-kit-core: клиент (Bearer, ретраи, 3 rps, ajv-валидация)
packages/mcp/                    # mcp-yandex-kit: MCP-сервер (stdio), 84 тула
packages/codegen/                # генераторы: спека → registry / types / скиллы / TOOLS.md
skills/                          # 6 сгенерированных доменных + 5 вручную поддерживаемых скиллов
.codex-plugin/ + .cursor-plugin/ # client-specific manifests, сохраняются для совместимости
.claude-plugin/ + .agents/       # client-specific marketplace metadata
.mcp.json                        # client-specific MCP config с токеном
docs/TOOLS.md                    # справочник тулов (СГЕНЕРИРОВАН)
```

Сервер отдаёт 84 тула: 88 из 162 операций API покрыты кураторскими тулами, а мета-трио
`search_operations` / `get_operation_schema` / `kit_request` даёт доступ ко всем
операциям спеки — их 162 в 24 группах тегов.

## Portable Agent Plugins package

Репозиторий содержит переносимое ядро [Agent Plugins 1.0.0](https://agent-plugins.org/):
корневой `plugin.json`, корневой `mcp.json` и непосредственные дочерние каталоги
`skills/*/SKILL.md`. Схемы закреплены локально в `specs/agent-plugins/`, поэтому
проверка не зависит от сети:

```bash
npm run validate:agent-plugin
```

Корневой `mcp.json` намеренно не содержит `YANDEX_KIT_TOKEN`, `${...:-...}` или
других секретных значений. Токен передаётся через setup-сценарий и конфигурацию
конкретного клиента. `.codex-plugin/`, `.cursor-plugin/`, `.claude-plugin/`,
`.agents/` и `.mcp.json` не объявляются устаревшими: это client-specific или
compatibility-артефакты, которые пока сохраняются отдельно от portable core.

## Сгенерированные файлы — не править руками

Генерируются командой `npm run gen` и коммитятся:

- `packages/core/src/generated/registry.json` и `.../generated/types.ts`;
- `docs/TOOLS.md`;
- шесть доменных `skills/a1-yandex-kit{,-catalog,-orders,-promotions,-store,-webhooks}/`
  целиком (включая `SKILL.md`, `scripts/`, `data/*.json.gz`).

Любые правки этих файлов вносите в генераторы (`packages/codegen/src/gen-*.ts`),
включая прозу скиллов — она живёт в шаблонах `gen-skills.ts`. CI проверяет дрейф:
`npm run gen && git diff --exit-code` должен проходить, иначе сборка красная.

Исключение: setup и верхнеуровневые сценарные навыки поддерживаются вручную,
отдельно от генерации API-справочника. Сейчас это
`skills/a1-yandex-kit-setup/`, `skills/a1-yandex-kit-operator/`,
`skills/a1-yandex-kit-catalog-doctor/`, `skills/a1-yandex-kit-promo-launcher/` и
`skills/a1-yandex-kit-launch-check/`; `npm run gen` не удаляет и не перезаписывает
их, кроме общего write-plan контракта `references/exact-write-protocol.md`. Его
единственный исходник —
`packages/codegen/src/skill-src/references/exact-write-protocol.md`. Ссылка
``[`references/exact-write-protocol.md`](references/exact-write-protocol.md)`` в
`SKILL.md` объявляет зависимость: `npm run gen` автоматически находит все такие
скиллы и кладёт в каждый идентичную generated-копию для автономной установки.
Отдельный список получателей не поддерживается. Если ссылку удалить, генератор
удалит осиротевшую копию только со своим generated-заголовком; вручную созданный
файл он не перезаписывает и не удаляет. Semi-automated сценарии и fake MCP находятся
в `packages/mcp/src/scenarios/`;
тесты setup-скилла находятся рядом с его dependency-free helper. Всё запускается
через обычный `npm test`.

### Имена артефактов сценарных скиллов

Для вручную поддерживаемых сценарных скиллов используется единая схема:

- исполняемая модель: `<короткое-имя>-skill[-<режим>]-scenario.ts`;
- её тест: `<короткое-имя>-skill[-<режим>]-scenario.test.ts`;
- документ приёмки: `docs/<КОРОТКОЕ-ИМЯ>-SKILL-VERIFICATION.md`;
- общий вспомогательный модуль нескольких скиллов: `skill-<назначение>.ts`.

Короткое имя не включает общий префикс `a1-yandex-kit-`: например,
`operator-skill-scenario.ts`, `catalog-doctor-skill-fix-scenario.test.ts` и
`CATALOG-DOCTOR-SKILL-VERIFICATION.md`. Если файл не исполняет самостоятельный
сценарий, слово `scenario` в его имени не используется:
`skill-mutation-protocol.ts`.

Платформенные имена `SKILL.md` и `agents/openai.yaml` не меняются. При
переименовании артефакта в той же правке обновляются импорты, команды запуска и
ссылки из `SKILL.md` и документации.

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
четыре сценарных (`a1-yandex-kit-operator`, `a1-yandex-kit-catalog-doctor`,
`a1-yandex-kit-promo-launcher`, `a1-yandex-kit-launch-check`) и
`a1-yandex-kit-setup`. MCP-сервер из `.mcp.json` использует
`YANDEX_KIT_TOKEN` из окружения; setup-скилл вместо этого может записать токен
непосредственно в пользовательский конфиг клиента.

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
