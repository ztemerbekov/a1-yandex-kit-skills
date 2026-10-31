# Project Store Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Одновременно обслуживать магазины в независимых проектах Codex и Claude Code.

**Architecture:** Проект содержит `.yandex-kit/project.json` с UUID подключения; секрет и ожидаемый store_id находятся в приватном пользовательском хранилище. MCP получает `--project-config`, проверяет магазин до готовности и сохраняет привязку на время процесса. Проектные адаптеры выключают старые KIT-серверы только для выбранного проекта.

**Tech Stack:** Node.js >=20.11, ESM, TypeScript, существующие node:test/tsx, MCP SDK, текущие JSON/TOML-адаптеры.

**Spec:** `docs/superpowers/specs/2026-10-31-project-store-connections-design.md`

## Global Constraints

- Пользователь утвердил архитектуру и поручил реализацию; дополнительное согласование плана/метода не требуется. AGENTS предписывает исполнение субагентами gpt-6.1-sol/xhigh.
- Работать в текущей чистой ветке `codex/project-store-connections-design`; она уже выделена для этой задачи. Не создавать дополнительный worktree без нужды и не затрагивать реальные настройки/токены пользователя.
- Новое имя сервера: `a1-yandex-kit-project`; legacy env-режим сохраняется. Проектный режим никогда не использует глобальные токен/base URL при ошибке.
- Один общий модуль формата/хранения для MCP и самодостаточного setup-скилла. Канонический ESM-модуль и детерминированная поставляемая копия допустимы; независимые реализации парсера запрещены.
- Токены не попадают в репозиторий, argv, логи и телеметрию; секреты вне проекта. POSIX 0700/0600, UUID-валидация, безопасные обновления и конфликты конкурентных записей.
- Существующие инструменты, их схемы и GET-only retry contract сохраняются; никаких live-записей, публикации, push или изменений permission policy вне тестовых фикстур.
- Agent-facing instructions English; human docs Russian. Generated files changed through generators only. Версии не повышать до отдельного релизного поручения.

## Review Focus

- Унаследованные токен/base URL при сломанной привязке не должны давать другой магазин: проверка Task 1.
- Два чата и два агента одного проекта должны читать общую привязку: Task 2.
- Старые global/plugin aliases могут оставлять доступ к другому магазину: Task 2 проверяет все обнаруженные KIT identities и эффективные настройки.
- Конкурентная настройка/откат не должна затереть изменения другого процесса: Tasks 1–2 проверяют конфликт и rollback.
- Опубликованные npm-пакеты и отдельно скопированный setup-скилл должны работать без исходников монорепозитория: Tasks 1 и 3 проверяют packaging.

## Task 1: Общая модель подключения и MCP runtime

**Files:** создать общий модуль подключения и его тесты в `packages/core/src/`; изменить `packages/core/package.json`/tsconfig при необходимости, `packages/mcp/src/config.ts`, `index.ts`, добавить runtime-тесты. Для standalone setup поставлять тот же ESM-модуль в `skills/a1-yandex-kit-setup/scripts/lib/`; синхронизация через codegen/build с проверкой детерминизма. Исполнитель выбирает точные имена shared module/export и фиксирует их в ledger до Task 2.

**Interfaces:**
- Вход: `--project-config <absolute path>`; JSON binding `{version:1, connection_id: UUID}`; private connection `{version:1, token:string, store_id:string, ...displayMetadata}`.
- Выход: один immutable Config/KitClient с verified store metadata; functions load/save binding and connection with test-overridable storage root; helpers reusable by setup without TS runtime or npm installation.
- Storage default `~/.a1-yandex-kit/connections/`; overrides для тестирования/удалённых сред должны быть явными и документированными, без изменения HOME/CODEX_HOME.

- [x] Добавить тесты загрузки двух разных проектов, невалидных UUID/версий/пустых токенов/неполных записей, прав приватных файлов, конфликтующих записей и попыток traversal. Увидеть ожидаемые RED.
- [x] Реализовать общий модуль с атомарной записью и контролем конкурентных изменений; исключить секреты из публичных результатов/ошибок.
- [x] Добавить runtime-тесты: проектный режим игнорирует унаследованные token/base URL; missing binding fails closed; GetStore mismatch/auth/network blocks readiness; matching store creates one stable client; legacy env mode still works. Использовать fetch stubs, без live API.
- [x] Реализовать разбор argv, загрузку и identity gate перед рабочим MCP; server title/instructions дают название магазина. Сохранить graceful stderr diagnostics и закрытый vocabulary телеметрии.
- [x] Запустить scoped core/MCP tests и typecheck до GREEN; проверить доступность общего модуля в npm dist и standalone skill. Commit только Task 1.

## Task 2: Проектные настройки и полный setup flow

**Files:** `skills/a1-yandex-kit-setup/scripts/setup.mjs`, `setup-lib.mjs`, `lib/client-profiles.mjs`, `lib/configuration.mjs`, config adapters, `lib/smoke.mjs`, `lib/token-web.mjs`, `lib/approval-policy.mjs` по необходимости; выделять проектную логику в новые небольшие модули; `setup.test.mjs`, `modules.test.mjs` и необходимые fixtures.

**Interfaces:** consumes shared module from Task 1; `--scope project|user`, `--project-dir`, project server name. Для Codex/Claude Code по умолчанию project, прежняя user scope явно доступна; остальные клиенты сохраняют прежний default. Все команды status/configure/token-web/client-check/smoke/rollback используют один выбранный scope и binding.

- [x] Добавить RED-тесты четырёх временных проектов с разными токенами/магазинами, обоих агентов для одной привязки, повторной идемпотентной настройки, путей с пробелами, отсутствующей привязки и неправильной замены токена.
- [x] Реализовать Codex `.codex/config.toml` и Claude Code local project entry в `~/.claude.json`; в argv только путь к binding. Проверка Codex запускается из project cwd, не подменяет CODEX_HOME.
- [x] Реализовать защищённый ввод/проверку/сохранение токена в проектном режиме, reuse существующей привязки вторым агентом, обновление токена только того же store_id и отдельное явное действие смены магазина. Сообщать о необходимости перезапуска существующих чатов.
- [x] Добавить RED-тесты миграции detected legacy `yandex-kit`, `a1-yandex-kit-global`, `a1-yandex-kit` и plugin entries; unrelated same-name серверы не менять; несколько разных магазинов требуют явного выбора. Не выводить токены.
- [x] Реализовать local-only disable: Codex existing inherited entries `enabled=false` + plugin policy; Claude project's `disabledMcpServers` (не `disabledMcpjsonServers`). Проверять реальный identity по команде/пакету. Не удалять глобальные записи. При невозможности подтвердить scoped disable выдавать actionable conflict/manual `/mcp` step, не ложный success.
- [x] Сохранить смысл существующих targeted allow/ask/deny при смене server identity; не расширять разрешения, не игнорировать managed policy. Неоднозначную policy обрабатывать как конфликт настройки.
- [x] Проверить transaction/rollback частичных записей, параллельные настройки, reconnect в protected web flow и public status без секретов. Запустить `npm run test:setup-skill` до GREEN; commit Task 2.

## Task 3: Документация, генерация, интеграционная проверка

**Files:** setup `SKILL.md`, `references/client-profiles.md`, compatibility instructions; `README.md`, `docs/INSTALLATION.md`, `docs/TECHNICAL.md` по затронутому поведению; generators/manifest documentation по фактическим изменениям. При изменении scenario skills читать соответствующие AGENTS.md.

- [x] Обновить инструкции подключения: выбрать project root, показать магазин, reuse между агентами, миграция, замена токена/смена магазина, перезапуск сессий, worktrees/clones и прежний user режим других клиентов.
- [x] Удалить противоречащие инструкции про обязательный global-only setup; не объявлять ещё не опубликованный npm runtime доступным в `@latest`. Описать, что локальные изменения требуют выпуска согласованных пакетов перед использованием установленными скиллами.
- [x] Проверить packaged runtime и standalone skill через существующие тесты упаковки/минимальные команды, без новой тестовой системы. Проверить 4-project isolation с recording stubs и отсутствие новых store/token telemetry fields.
- [x] Выполнить `npm run typecheck && npm run build && npm test`, `npm run gen`, `npm run validate:agent-plugin`; затем проверить отсутствие generated drift через `git add -N -- packages/core/src/generated docs/TOOLS.md skills` и `git diff --exit-code -- packages/core/src/generated docs/TOOLS.md skills` относительно закоммиченных intended outputs. Offline inspector из CLAUDE.md выполнить, если доступен локально; если нужен download, использовать network-enabled путь, не объявлять GREEN при ошибке.
- [x] Исправить обнаруженные ошибки и повторить только затронутые проверки плюс финальные обязательные проверки, когда изменения это требуют. Commit Task 3.
- [ ] Свежий независимый whole-branch review: spec compliance, токены/пути/конкурентность, scopes/migration/packaging. Исправить actionable findings, повторить необходимые проверки. Обновить ledger фактическими результатами и ограничениями live client acceptance.

## Acceptance boundary

Пользовательские настройки и магазины при разработке не менять. Реальные четыре клиентских сессии с токенами требуют отдельного операционного подключения после выпуска. Финальный отчёт различает passing offline checks и ещё не выполненную live клиентскую приёмку. Никаких обещаний уже подключённых четырёх магазинов.

## Offline evidence (2026-10-31)

Task 1 runtime/storage and Task 2 setup commits прошли scoped review, включая
исправления `c4e70a1`. Полный `npm run typecheck && npm run build && npm test`
завершился с exit 0: core 57, codegen 9, MCP 423, setup 101 — всего 590 тестов,
0 failed/skipped. `npm run gen` и `npm run validate:agent-plugin` — exit 0.
Standalone copied setup help/project status и импорт project-check — exit 0.
Offline inspector tools/list — exit 0, 96 tools; schema portability: 0 errors,
32 warnings across 29 tools. Intended outputs закоммичены; точные команды
`git add -N -- packages/core/src/generated docs/TOOLS.md skills` и
`git diff --exit-code -- packages/core/src/generated docs/TOOLS.md skills`
завершились с exit 0. Итоговый whole-branch review остаётся отдельным следующим шагом.
Реальные токены/настройки/магазины не менялись, npm/skills release не выполнялся.
