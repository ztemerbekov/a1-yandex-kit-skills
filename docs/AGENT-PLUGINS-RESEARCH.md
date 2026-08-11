# Agent Plugins v1.0.0: исследование первоисточников

Дата проверки: 2026-08-11.

Область исследования: только первоисточники стандарта и его авторский пример — сайт [Agent Plugins](https://agent-plugins.org/), [нормативная спецификация](https://agent-plugins.org/specification), канонический репозиторий [agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec), репозиторий [agentplugins/agent-plugins-example](https://github.com/agentplugins/agent-plugins-example), а также запрошенная задача [a1-yandex-kit-skills#60](https://github.com/ztemerbekov/a1-yandex-kit-skills/issues/60). Вторичные статьи и пересказы не использовались.

## Короткий вывод

Agent Plugins v1.0.0 — это небольшой переносимый формат пакета, а не полный стандарт установки, marketplace, UI, permissions или всех возможностей конкретного клиента. Переносимое ядро состоит ровно из двух типов компонентов: Agent Skills в `skills/` и MCP-серверов в корневом `mcp.json`; корневой `plugin.json` обязателен, а клиентские возможности выносятся в reverse-domain extensions. [Обзор стандарта](https://agent-plugins.org/) · [§4, §6–§8 спецификации](https://agent-plugins.org/specification#4-plugin-package-model)

Спецификация публикует версию `1.0.0`, но прямо помечает её как `Working Draft`. Нормативными являются разделы 1–11; приложение с checklist и Design Decisions — справочные, а при конфликте текст спецификации главнее JSON Schema. [Статус и язык требований](https://agent-plugins.org/specification#1-status-and-version) · [репозиторный README](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/README.md)

## 1. Нормативная модель v1.0.0

### Статус и conformance

- Версия формата — `1.0.0`; клиент или пакет, заявляющий совместимость с Agent Plugins v1, **MUST** выполнять требования документа. Ключевые слова `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `MAY` и т. п. трактуются по RFC 2119/8174 только в верхнем регистре. [§1–§2 спецификации](https://agent-plugins.org/specification#1-status-and-version)
- Текущий статус страницы спецификации — `Working Draft`, а не финальный/стабильный стандарт. Это важно учитывать в release policy и обратной совместимости. [Шапка спецификации](https://agent-plugins.org/specification#agent-plugins-specification)
- Стандарт описывает формат пакета и поведение conformant client; установка, distribution, enablement, updates и UI остаются под управлением клиента. [§4 и §11 спецификации](https://agent-plugins.org/specification#4-plugin-package-model) · [Build an Agent Plugin](https://agent-plugins.org/plugin-authors)

### Границы пакета

- Плагин — каталог с одной filesystem root location и обязательным обычным файлом `plugin.json` в корне. `skills/`, `mcp.json` и extension directory — опциональны. [§4.1 и §5.1](https://agent-plugins.org/specification#41-general-requirements) · [руководство автора](https://agent-plugins.org/plugin-authors)
- Любой путь к файлу или каталогу, supplied by package, после filesystem resolution должен оставаться внутри plugin root. Symlink, junction, reparse point и эквивалентные механизмы не должны позволять выйти за root. Plugin-relative path должен начинаться с `./`; прочие значения, включая аргументы и значения `env`, не считаются package paths только из-за похожего текста. [§4.1](https://agent-plugins.org/specification#41-general-requirements)
- Фиксированные места нельзя переопределить из `plugin.json`: skills обнаруживаются из `skills/`, MCP — из `mcp.json`. Inline MCP или альтернативные core paths не являются переносимым форматом v1. [§6.1 и §7.2.1](https://agent-plugins.org/specification#61-fixed-locations) · [страница MCP](https://agent-plugins.org/plugin-authors/mcp-servers)

## 2. `plugin.json`: закрытая схема и семантика

### Разрешённые поля

Корневой manifest — JSON object. Обязательны:

| Поле | Требование v1.0.0 |
| --- | --- |
| `$schema` | Ровно `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`. Клиент выбирает локально поддерживаемые правила по этому идентификатору и не должен скачивать схему при загрузке. |
| `name` | Строка длиной 1–64 символа; только `a-z`, `0-9`, `-`, `.`; первый и последний символ — alphanumeric; запрещены `--` и `..`. |

Опциональны только `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords` и `extensions`. `author` сам закрыт и может содержать только строковые `name`, `email`, `url`; `keywords` — массив строк; каждый namespace в `extensions` должен иметь object value. [§5.2–§5.6 спецификации](https://agent-plugins.org/specification#52-schema-identifier) · [официальная `plugin.schema.json`](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/plugin.schema.json)

Схема действительно закрыта: `additionalProperties: false` стоит на корневом manifest и на `author`. При этом есть важное нормативное исключение: неизвестное поле верхнего уровня — schema violation, но клиент должен сообщить о нём и проигнорировать его; остальные нарушения manifest фатальны — plugin отклоняется, а компоненты не обнаруживаются и не исполняются. Поле `extensions` не-object также обрабатывается как non-fatal: клиент сообщает и игнорирует его. [§5.2 и §8.1](https://agent-plugins.org/specification#52-schema-identifier) · [схема manifest](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/plugin.schema.json)

Строковые metadata-поля проверяются в основном по JSON type: клиент не обязан отклонять manifest только потому, что `version` не соответствует SemVer, URL не распознан как URL, email не распознан как email или `license` не является SPDX identifier. Это рекомендации, а не дополнительные schema constraints. [§5.4](https://agent-plugins.org/specification#54-metadata-fields) · [страница manifest](https://agent-plugins.org/plugin-authors/manifest)

### Нельзя добавлять в portable root

На верхнем уровне `plugin.json` v1 не должны появляться `hooks`, `agents`, `commands`, `skills`, `mcpServers`, `lspServers` и произвольные client fields. Portable MCP находится в `mcp.json`; client-owned данные — в `extensions`; hooks/agents/commands/LSP/UI/marketplace остаются client-specific или compatibility artifacts. [Канонический README примера](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/README.md) · [migration guide](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/migration-guide.md)

Минимальный manifest:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "example-plugin"
}
```

Такого файла достаточно для валидного plugin package; skills и MCP — опциональны. [Build an Agent Plugin](https://agent-plugins.org/plugin-authors) · [README примера](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/README.md)

## 3. Discovery и failure isolation

Порядок загрузки принципиален: клиент сначала находит, читает и валидирует корневой `plugin.json`, затем обнаруживает компоненты и применяет поддерживаемые extensions. Если обязательный manifest отсутствует или содержит фатальную ошибку, plugin отклоняется целиком. [§5.1–§5.3](https://agent-plugins.org/specification#51-location-and-loading)

| Ситуация | Обязательное поведение клиента |
| --- | --- |
| Нет `skills/` или `mcp.json` | Не считать это ошибкой; отсутствующий тип компонента просто не загружается. |
| `skills` есть, но это не directory; `mcp.json` есть, но не regular file | Сделать invalid только этот component type и продолжить остальные. |
| Невалидный `SKILL.md` | Пропустить только этот skill, по возможности сообщить, продолжить другие skills и MCP. |
| Невалидный `mcp.json` верхнего уровня | Отключить MCP для plugin, но продолжить skills и extensions. |
| Невалидный или недоступный server entry | Пропустить только entry; остальные servers и компоненты продолжают загружаться. |
| Server не стартует, не подключается, не проходит auth/handshake | Изолировать ошибку этого server и продолжить остальные компоненты. |
| Клиент не поддерживает component type/transport/extension | Игнорировать неподдерживаемую часть; это само по себе не ошибка plugin. |

Skills обнаруживаются только в непосредственных дочерних каталогах `skills/`: каталог считается skill, если `<child>/SKILL.md` — regular file. Рекурсивный поиск вложенных skill directories запрещён; сам формат `SKILL.md` и его frontmatter определяет Agent Skills specification, а не Agent Plugins. [§6.2 и §7.1](https://agent-plugins.org/specification#71-skills) · [страница Skills](https://agent-plugins.org/plugin-authors/skills)

В v1 определены ровно два portable component types — skills и MCP servers. Клиенты могут поддерживать их по отдельности, но conformant client должен поддерживать хотя бы один component type. [§7 и §11.1–§11.2](https://agent-plugins.org/specification#11-client-conformance)

## 4. `mcp.json`: закрытая схема

`mcp.json` — отдельный корневой JSON object, содержащий только `$schema` и `mcpServers`; `mcpServers` — object с именами серверов и configuration objects. Пустой `mcpServers` допустим. Для v1 `$schema` должен быть ровно `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`; его версия должна совпадать с версией в `plugin.json`. [§7.2.1](https://agent-plugins.org/specification#721-discovery-and-configuration) · [официальная `mcp.schema.json`](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/mcp.schema.json)

Каждый server object должен соответствовать ровно одному закрытому transport variant. Неизвестное поле, неизвестный `type` или поле, принадлежащее другому variant, делает только этот entry invalid. [§7.2.1](https://agent-plugins.org/specification#721-discovery-and-configuration) · [определения `$defs/server`](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/mcp.schema.json)

| Transport | Обязательные поля | Допустимые опциональные поля |
| --- | --- | --- |
| `stdio` | `type: "stdio"`, `command` | `args: string[]`, `env: object<string,string>`, `cwd: string` |
| `streamable-http` | `type: "streamable-http"`, `url` | `headers: object<string,string>` |
| `sse` | `type: "sse"`, `url` | `headers: object<string,string>` |

`streamable-http` — текущий remote MCP transport; `sse` — deprecated legacy HTTP+SSE transport и его поддержка клиентом optional. Клиент, поддерживающий MCP, обязан поддерживать хотя бы `stdio` или `streamable-http`, должен поддерживать оба по возможности, а `sse` может не поддерживать. Fallback между transports стандарт не определяет: initial connection attempt использует объявленный `type`. [§7.2.1 и §7.2.2](https://agent-plugins.org/specification#721-discovery-and-configuration) · [страница MCP](https://agent-plugins.org/plugin-authors/mcp-servers)

## 5. MCP stdio, paths, env и placeholders

### `command` и `cwd`

- `command` — один executable token, не shell command line. Это либо bare executable name, разрешаемый platform search rules, либо plugin-relative path, начинающийся с `./`. Placeholder expansion в `command` запрещён. Если executable поставляется внутри package, следует использовать plugin-relative path; plugin не должен зависеть от того, участвует ли настроенный `PATH` в resolution bare command. [§7.2.1](https://agent-plugins.org/specification#721-discovery-and-configuration)
- Если `cwd` отсутствует, он равен plugin root. Если задан, допустимы только `./...`, `${PLUGIN_ROOT}`/`${PLUGIN_ROOT}/...` или `${PLUGIN_DATA}`/`${PLUGIN_DATA}/...`; после expansion путь обязан оставаться внутри соответствующего root. Эти правила защищают package/data containment, но не являются sandboxing subprocess. [§4.1 и §7.2.1](https://agent-plugins.org/specification#41-general-requirements)

### Reserved environment

Клиент, запускающий stdio subprocess, обязан передать:

- `PLUGIN_ROOT` — абсолютный filesystem-resolved plugin root;
- `PLUGIN_DATA` — отдельный writable data directory для установленного plugin instance, который создаётся до запуска и сохраняется при обновлениях; клиент может удалить его при uninstall.

`PLUGIN_ROOT` предназначен для bundled scripts/binaries/config; `PLUGIN_DATA` — для persistent state, generated code, caches и устанавливаемых зависимостей. Клиент сам решает, какие ambient variables наследовать, очищать или скрывать. [§9.1](https://agent-plugins.org/specification#91-subprocess-environment)

### Expansion rules

В `args`, строковых значениях `env` и `cwd` клиент выполняет однопроходную, нерекурсивную текстовую замену `${PLUGIN_ROOT}` и `${PLUGIN_DATA}`. В `command`, `env` keys, URLs, HTTP headers и fixed component locations expansion не выполняется. Неизвестный placeholder-like text остаётся буквальным; никакой другой environment-variable expansion стандарт не разрешает. [§9.2](https://agent-plugins.org/specification#92-placeholder-expansion)

`env` в package — видимые package data, а не portable secret mechanism. Нельзя встраивать credentials, tokens или другие secrets в `env`; entries с именами `PLUGIN_ROOT` или `PLUGIN_DATA` запрещены, поскольку эти переменные задаёт сам клиент. [§9.2](https://agent-plugins.org/specification#92-placeholder-expansion) · [MCP schema](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/mcp.schema.json)

Практическое следствие для `mcp-yandex-kit`: shell-конструкция вроде `${YANDEX_KIT_TOKEN:-}` не является portable Agent Plugins expansion. Токен нельзя класть в `plugin.json`, `mcp.json` или tracked package; безопасный способ передачи должен использовать client-managed credential/auth/setup flow. Сам стандарт не задаёт portable OAuth или credential-reference field. [§7.2.1 и §9.2](https://agent-plugins.org/specification#721-discovery-and-configuration) · [страница MCP](https://agent-plugins.org/plugin-authors/mcp-servers)

## 6. Remote MCP и секреты

Для `streamable-http` и `sse`:

- `url` должен быть абсолютным HTTP/HTTPS URL без user information и fragment; non-loopback endpoint обязан использовать HTTPS. HTTP допускается для `localhost` или loopback IP literal.
- `headers` — literal fixed HTTP headers. Placeholder и environment expansion в URL, header names и header values запрещены.
- Header values видимы внутри package и не могут быть credential/secret storage. Клиентские auth/HTTP/MCP headers имеют приоритет; redirect на другой origin не должен переносить configured headers без явного user authorization.
- v1 не содержит portable OAuth-конфигурации или credential-reference fields; authorization discovery, user interaction и credential storage — client-managed. Auth failure считается connection failure конкретного server, а не invalid plugin.

[§7.2.1 спецификации](https://agent-plugins.org/specification#721-discovery-and-configuration) · [страница MCP servers](https://agent-plugins.org/plugin-authors/mcp-servers) · [MCP schema variants](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/mcp.schema.json)

## 7. Client extensions

Extensions — escape hatch для client-owned поведения, которое не вошло в portable core. Namespace должен быть reverse-domain identifier, желательно основанный на домене, который контролирует клиент, и стабильный.

- Manifest data хранится в `plugin.json.extensions["com.example.client"]`; значение namespace должно быть object.
- Файлы клиента хранятся в top-level directory с точно таким же именем, например `com.example.client/`.
- Клиент может использовать manifest data, directory или оба варианта.
- Agent Plugins не задаёт для extension содержимое, validation, discovery, loading или failure semantics; это делает владелец namespace.
- Клиент игнорирует неподдерживаемые namespaces без валидации их contents и без потери валидных portable components.

[§8 спецификации](https://agent-plugins.org/specification#8-client-extensions) · [Client extensions](https://agent-plugins.org/plugin-authors/client-extensions) · [references/client-extensions.md](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/client-extensions.md)

В частности, hooks, custom agents, commands, LSP, UI и marketplace metadata не стали portable v1-компонентами только от того, что их положили в extension. Нужны документированный namespace и semantics конкретного клиента; иначе следует сохранить compatibility package/adapter. [README примера](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/README.md) · [migration guide](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/migration-guide.md)

## 8. Versioning

Нужно различать две версии:

1. **Specification/schema version.** Версия `1.0.0` относится к полному контракту, тексту, `plugin.schema.json` и `mcp.schema.json`. Каждый выпуск обязан публиковать обе схемы с той же версией; изменение любой схемы требует нового specification release; canonical schema identifiers нельзя переиспользовать для другого содержимого.
2. **Plugin version.** `plugin.json.version` — версия самого plugin. SemVer рекомендован: major для breaking changes, minor для backward-compatible feature, patch для исправлений. Клиент может использовать её для update checks и cache freshness.

Если `mcp.json` присутствует, его `$schema` должен совпадать с `$schema` manifest; mismatch инвалидирует MCP configuration, но не весь plugin и не другие component types. Existing plugins могут продолжать ссылаться на старую spec version, если клиент её поддерживает или явно считает совместимой. [§10.1–§10.2](https://agent-plugins.org/specification#10-versioning) · [manifest page](https://agent-plugins.org/plugin-authors/manifest)

## 9. Поддерживаемые клиенты

Официальная страница совместимости прямо говорит, что clients могут принимать portable component types поэтапно, и перечисляет поддерживаемые компоненты/transports так:

| Клиент | Agent Skills | MCP transports, указанные на официальной странице |
| --- | --- | --- |
| VS Code | Да | stdio, Streamable HTTP, legacy SSE |
| Cursor | Да | stdio, Streamable HTTP, legacy SSE |
| GitHub Copilot | Да | stdio, Streamable HTTP, legacy SSE |
| ChatGPT & Codex | Да | stdio, Streamable HTTP |
| Kiro | Да | stdio, Streamable HTTP, legacy SSE |
| Hermes Agent | Да | stdio, Streamable HTTP |
| OpenClaw | Да | stdio, Streamable HTTP, legacy SSE |

[Официальный список Compatible Clients](https://agent-plugins.org/compatible-clients)

Это список/documentation текущей поддержки, а не требование, чтобы каждый клиент реализовал весь v1. Нормативная conformance допускает skills-only client или MCP client с поддержкой хотя бы одного из `stdio`/`streamable-http`; unsupported component/transport должен быть изолирован, а не обязательно считаться ошибкой. [§11.1–§11.3](https://agent-plugins.org/specification#11-client-conformance)

Claude Code на текущей странице Compatible Clients не указан. Поэтому нельзя на основании только этих первоисточников обещать для Claude Code native portable Agent Plugins v1. Если нужен Claude Code, его следует вести как отдельно проверяемый compatibility path/adapter, пока сам клиент не документирует поддержку Agent Plugins или соответствующий extension namespace. Это вывод из сопоставления официального списка и migration guidance, а не новое нормативное требование. [Compatible Clients](https://agent-plugins.org/compatible-clients) · [client extension guidance](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/client-extensions.md)

## 10. Практическая миграция

Канонический пример и встроенный skill `migrate-agent-plugin` рекомендуют additive, reversible migration:

1. **Inventory.** Зафиксировать все manifests, skills, prompts/commands, agents, MCP servers, hooks, LSP, UI resources, scripts, secret requirements, marketplace entries, а также клиентов, install paths и discovery rules. До выяснения consumers ничего не удалять/перемещать. [SKILL.md, workflow 1](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/SKILL.md) · [migration guide §1](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/migration-guide.md#1-inventory-before-conversion)
2. **Classify.** Разнести каждый artifact на portable core (`plugin.json`, `skills/`, root `mcp.json`), documented client extension, compatibility layer или distribution metadata. Не пытаться объявить hooks/agents/commands/LSP/UI/marketplace частью portable v1. [SKILL.md, workflow 2](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/SKILL.md) · [mapping table](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/migration-guide.md#2-map-every-artifact)
3. **Create manifest.** Добавить корневой `plugin.json` с canonical `$schema`, допустимым `name` и только разрешёнными metadata fields; не добавлять paths или client fields в root. [SKILL.md, workflow 3](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/SKILL.md) · [manifest schema](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/plugin.schema.json)
4. **Normalize skills.** Переместить каждый переносимый skill в `skills/<name>/SKILL.md`, оставить scripts/references/assets внутри skill directory, привести frontmatter `name` и имя каталога к правилам Agent Skills; не рассчитывать на recursive discovery. [SKILL.md, workflow 4](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/SKILL.md) · [Skills page](https://agent-plugins.org/plugin-authors/skills)
5. **Convert MCP.** Перенести portable MCP в root `mcp.json`, выставить matching schema, указать явный `stdio`, `streamable-http` или `sse`, сделать `command` одним executable token, отдельно передать `args`, убрать shell/env interpolation, не встраивать secrets. [migration guide §5](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/migration-guide.md#5-convert-mcp-configuration) · [MCP page](https://agent-plugins.org/plugin-authors/mcp-servers)
6. **Preserve non-core behavior.** Использовать только реально опубликованный owning-client namespace; если клиент пока требует legacy layout, оставить или генерировать отдельный compatibility package. Не выдумывать namespace и не ожидать, что чужой клиент его поймёт. [SKILL.md, workflow 5](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/SKILL.md) · [client extensions reference](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/client-extensions.md)
7. **Validate incrementally.** Проверить schema, path containment, каждую skill, MCP configuration/transport, отдельно smoke-test каждого поддерживаемого клиента и всех сохранённых hooks/agents/commands/LSP/UI. Удалять legacy artifacts только после прохождения тех же behavior checks. [SKILL.md, workflow 6](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/SKILL.md) · [validation checklist](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/validation-checklist.md)
8. **Prepare migration report.** Зафиксировать source format, target clients, mapping каждого artifact, added/moved/generated/retained/omitted files, validation/smoke results и remaining risks/manual steps. [SKILL.md, Required migration report](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/SKILL.md#required-migration-report)

Рекомендуемая структура source of truth: portable package и client adapters как sibling artifacts, где portable files — canonical, а legacy copies/manifest layouts генерируются или синхронизируются, когда это нужно конкретному клиенту. [Migration guide §6](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/migration-guide.md#6-preserve-platform-behavior)

## 11. Уточнения к текущему issue #60

Ниже — не изменение issue, а сверка его формулировок с первоисточниками: [a1-yandex-kit-skills#60](https://github.com/ztemerbekov/a1-yandex-kit-skills/issues/60).

### Подтверждается первоисточниками

- Нужны root `plugin.json` и optional root `mcp.json` с canonical v1.0.0 schema identifiers; поля manifest и MCP configuration закрыты. [Manifest schema](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/plugin.schema.json) · [MCP schema](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/mcp.schema.json)
- Skills обнаруживаются из immediate children `skills/`, MCP — из root `mcp.json`; ошибки должны изолироваться на минимальной границе. [§6–§7](https://agent-plugins.org/specification#6-component-discovery)
- `stdio.command` — один token; portable expansion ограничена `${PLUGIN_ROOT}` и `${PLUGIN_DATA}` в `args`, `env` values и `cwd`; secrets нельзя помещать в package configuration. [§7.2 и §9](https://agent-plugins.org/specification#72-component-types)
- Portable OAuth/credential-reference fields v1 не определены, поэтому передача `YANDEX_KIT_TOKEN` должна оставаться client-managed. [§7.2.1](https://agent-plugins.org/specification#721-discovery-and-configuration)
- Hooks, agents, commands, LSP, UI и marketplace должны быть compatibility/extension/distribution concerns, а не объявляться portable component types. [Migration guide](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/migration-guide.md#2-map-every-artifact)

### Что следует поправить или явно пометить как проектное решение

1. **`Working Draft` — не деталь, а статус контракта.** Issue уже упоминает этот статус, но его нужно повторять в release checklist и не называть v1.0.0 финальным стандартом. Нормативная версия и текущий draft status указаны на самой странице спецификации. [Спецификация](https://agent-plugins.org/specification#agent-plugins-specification)
2. **«Минимум Codex и Cursor» — acceptance criterion проекта, не универсальная гарантия стандарта.** Официальная страница сейчас перечисляет VS Code, Cursor, GitHub Copilot, ChatGPT & Codex, Kiro, Hermes Agent и OpenClaw с разными transport sets; стандарт сам допускает incremental adoption. [Compatible Clients](https://agent-plugins.org/compatible-clients) · [§11.2](https://agent-plugins.org/specification#112-incremental-adoption)
3. **Claude Code не подтверждён этой матрицей.** Он отсутствует в официальном списке Compatible Clients. Для него нужно проверять отдельный documented compatibility path и не выдавать его за native portable support без первоисточника от клиента. [Compatible Clients](https://agent-plugins.org/compatible-clients) · [extension/compatibility guidance](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/client-extensions.md#choose-the-right-compatibility-strategy)
4. **`mcp-yandex-kit` как `stdio` — выбор реализации, а не требование v1.** Стандарт также задаёт `streamable-http` и legacy `sse`; выбор stdio оправдан локальным MCP-сервером, но должен быть описан как проектное решение. [§7.2.1](https://agent-plugins.org/specification#721-discovery-and-configuration)
5. **`server.json`, npm-публикация и marketplace — отдельные каналы.** В portable core v1 для них нет component type или registry/index contract; их можно сохранять как distribution metadata/compatibility process, не добавляя поля в closed `plugin.json`. [README примера](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/README.md) · [migration guide mapping](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/migration-guide.md#2-map-every-artifact)
6. **Compatibility не означает автоматическую загрузку.** Extension работает только если owning client документировал и реализует namespace; другой клиент обязан его игнорировать. Поэтому общий source of truth и генерируемые adapters безопаснее ручных divergent copies. [§8](https://agent-plugins.org/specification#8-client-extensions) · [migration skill](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/SKILL.md#preserve-non-core-behavior)

## Источники, использованные в работе

- [Agent Plugins overview](https://agent-plugins.org/)
- [Build an Agent Plugin](https://agent-plugins.org/plugin-authors)
- [Plugin manifest](https://agent-plugins.org/plugin-authors/manifest)
- [Skills](https://agent-plugins.org/plugin-authors/skills)
- [MCP servers](https://agent-plugins.org/plugin-authors/mcp-servers)
- [Client extensions](https://agent-plugins.org/plugin-authors/client-extensions)
- [Compatible Clients](https://agent-plugins.org/compatible-clients)
- [Agent Plugins Specification v1.0.0](https://agent-plugins.org/specification)
- [`plugin.schema.json`](https://github.com/agentplugins/agent-plugins-spec/blob/main/schemas/1.0.0/plugin.schema.json) · [raw schema](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/plugin.schema.json)
- [`mcp.schema.json`](https://github.com/agentplugins/agent-plugins-spec/blob/main/schemas/1.0.0/mcp.schema.json) · [raw schema](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.0.0/mcp.schema.json)
- [agent-plugins-spec README](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/README.md)
- [agent-plugins-example README](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/README.md)
- [`migrate-agent-plugin/SKILL.md`](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/SKILL.md)
- [Migration guide](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/migration-guide.md)
- [Client extensions reference](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/client-extensions.md)
- [Validation checklist](https://raw.githubusercontent.com/agentplugins/agent-plugins-example/main/skills/migrate-agent-plugin/references/validation-checklist.md)
- [Текущий issue #60](https://github.com/ztemerbekov/a1-yandex-kit-skills/issues/60)
