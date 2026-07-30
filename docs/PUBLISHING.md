# Публикация и листинг сервера

Как выпустить релиз и попасть в каталоги MCP, чтобы сервер находили из Claude,
Cursor, LobeHub и др. Каналы (в этом порядке): npm → официальный реестр MCP →
GitHub Release → Glama → awesome-mcp-servers.

Публикуются два пакета: `yandex-kit-core` (клиент) и `mcp-yandex-kit`
(MCP-сервер, зависит от core). Остальные воркспейсы приватные.

## 0. Синхронный bump версии

Версия должна совпадать во всех местах сразу — bump выполняется одним коммитом:

| Где | Что менять |
|---|---|
| `packages/core/package.json` | `version` |
| `packages/mcp/package.json` | `version` **и** версия зависимости `yandex-kit-core` (она точная, без `^`) |
| `server.json` (корень репозитория) | `version` в корне **и** в `packages[].version` |
| `.claude-plugin/plugin.json` | `version` |
| `packages/codegen/src/gen-skills.ts` | константа `SKILL_VERSION`, затем `npm run gen` — обновит метаданные всех 6 скиллов |

После bump: `git diff` — убедиться, что нигде не осталось старой версии
(в помощь: `grep -rn "<старая версия>" packages/*/package.json server.json .claude-plugin/plugin.json skills/*/SKILL.md`).

## 1. Предпубликационные проверки

```bash
npm run typecheck && npm test && npm run build   # 236 тестов, всё зелёное
npm run gen && git diff --exit-code              # нет дрейфа сгенерированного
npm publish --dry-run -w packages/core -w packages/mcp
```

Заодно убедиться: в `packages/core/package.json` и `packages/mcp/package.json`
нет `"private": true`, а в `packages/mcp/package.json` есть поле `mcpName`
(см. §3) — оно должно попасть в npm **до** публикации в реестр MCP.

## 2. npm — порядок важен

Сначала `yandex-kit-core`, затем `mcp-yandex-kit`: сервер зависит от core с точной
версией, и npm должен уже знать её на момент публикации сервера.

```bash
npm publish -w packages/core
npm publish -w packages/mcp
```

Реестр npm неизменяем по версиям: даже правка одних метаданных требует нового bump.

## 3. Официальный реестр MCP

Манифест лежит в корне репозитория — [`server.json`](../server.json).

Что проверяет реестр:

- **Namespace** — имя вида `io.github.gistrec/*` подтверждается входом под
  GitHub-аккаунтом `gistrec` (`mcp-publisher login github`).
- **Владение npm-пакетом** — поле `mcpName` в `packages/mcp/package.json`
  опубликованной версии должно совпадать с `name` из `server.json`; версии в
  `server.json` (корень и `packages[].version`) — с версией в npm.

```bash
# 1. Установить CLI (macOS)
brew install mcp-publisher
#    или скачать бинарь из релизов modelcontextprotocol/registry

# 2. Залогиниться под аккаунтом-владельцем namespace
mcp-publisher login github

# 3. Из корня репозитория (где лежит server.json)
mcp-publisher publish
```

Проверка: `https://registry.modelcontextprotocol.io/v0/servers?search=mcp-yandex-kit`.

## 4. GitHub Release

`git push --follow-tags` пушит тег, но **не** создаёт релиз — его нужно создать явно:

```bash
git tag -a vX.Y.Z -m vX.Y.Z
git push origin main --follow-tags
gh release create vX.Y.Z --title vX.Y.Z --generate-notes --verify-tag
```

## 5. Glama

[`glama.json`](../glama.json) уже лежит в корне (мейнтейнер — `gistrec`); Glama
индексирует репозиторий сам. Отдельный манифест не требуется — карточка строится
из README и `server.json`.

## 6. awesome-mcp-servers

PR в [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)
со ссылкой на репозиторий. **Строго один сервер на PR** — пачку из нескольких
серверов мейнтейнеры закрывают не глядя.

## Чек-лист повторного релиза

1. Bump версии по §0 (одним коммитом, включая `npm run gen`).
2. Проверки по §1.
3. `npm publish -w packages/core`, затем `npm publish -w packages/mcp`.
4. `mcp-publisher publish`.
5. Тег + `gh release create` (§4).

Glama и awesome-mcp-servers обновляются автоматически по репозиторию.
