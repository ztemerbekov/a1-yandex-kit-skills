# Политики подтверждений AI-клиентов для импорта Yandex KIT

Дата проверки: 2026-08-16.

Область исследования: девять профилей, которые сейчас поддерживает установщик
Yandex KIT: Claude Code, Claude Desktop, Cursor, OpenAI Codex, VS Code,
Kimi Code, Kimi Desktop / Kimi Work, Hermes Agent и OpenClaw. Проверялись
только официальная документация и исходный код производителей, а также
локальные факты из установленного клиента и этого репозитория. Сообщение Cursor
о `permissions.json` рассматривалось как непроверенная гипотеза, а не как
инструкция.

## Короткий вывод

Поставленный пользовательский результат — один раз включить «Импорт без
остановок», не снимая подтверждения с удалений и прочих опасных действий —
можно надёжно и автоматически настроить только там, где клиент даёт
машиночитаемую политику **для конкретных MCP-инструментов**.

| Группа | Клиенты | Что можно обещать |
| --- | --- | --- |
| Подтверждено и пригодно для автоматической настройки | Claude Code, OpenAI Codex, Kimi Code | Setup может дописать точные import-tool rules, оставить остальные инструменты в режиме запроса и проверить эффективную политику. |
| Подтверждено с version gate и обязательной проверкой | Cursor | У установленного Cursor есть точный `mcpAllowlist`, но публичная документация и несколько недавних версий расходились с фактической реализацией. Автоматическая настройка допустима только после проверки версии, локальной schema и эффективного server id. |
| Только один ручной шаг пользователя | VS Code | Интерфейс позволяет навсегда одобрить отдельные инструменты или источник, но официальный формат хранения этих решений не опубликован. Setup должен открыть/объяснить нужный экран, а не редактировать внутреннее состояние VS Code. |
| Возможность есть, но безопасная точечность для local MCP не подтверждена | Claude Desktop | UI Claude поддерживает `Allow always` для connector tools, но официальный материал не документирует переносимый файл/API этой политики для local stdio MCP. Нужен ручной fallback. |
| Не удовлетворяет безопасной границе | Kimi Desktop / Work | Есть только широкий `Full access` / `Allow all`, который снимает подтверждения не только с импорта. |
| Нет документированной per-MCP-tool approval policy | Hermes Agent, embedded OpenClaw | Можно скрыть опасные инструменты через include/exclude, но нельзя одновременно оставить их доступными и требовать отдельное подтверждение. У OpenClaw отдельный Codex runtime может передать нативную политику Codex, но это не общая политика embedded OpenClaw. |

Следовательно, универсального файла разрешений для всех клиентов нет. Setup
должен использовать capability profile каждого клиента и заранее сообщать один
из трёх исходов: **настрою автоматически**, **покажу один ручной шаг**,
**этот клиент не поддерживает безопасный режим**.

## Важная граница: что именно разрешается

`yandex-kit:*`, `mcp__yandex-kit__*`, глобальный YOLO и `Full access` не
соответствуют выбранному пользовательскому результату. Они разрешают весь
сервер, а не только импорт, поэтому могут снять подтверждение с удаления и
других несвязанных изменений.

Нужен отдельный, версионируемый список **точных имён import tools**. В текущем
MCP уже есть, например, `upload_file`, `create_product` и `create_variant`, но
состав полного импорта (товары, варианты, медиа, статьи и связанные сущности)
должен быть зафиксирован отдельным решением, а не выведен из префикса имени.
Локальный код также показывает, что MCP annotations используются не для всех
записывающих инструментов одинаково; поэтому автоматическая классификация
«read/write/destructive» по annotations не заменяет явный профиль импорта.
[локальные инструменты MCP](../packages/mcp/src/tools/) ·
[локальные annotations](../packages/mcp/src/util.ts)

На проверенной машине Cursor 3.16.17 уже содержит пользовательский
`~/.cursor/permissions.json` с широкими записями `yandex-kit:*` и
`user-yandex-kit:*`. Они подтверждают, что предложенная Cursor настройка была
записана, но её нужно считать **слишком широкой**, а не готовым безопасным
решением.

## Матрица по клиентам

### 1. Claude Code — подтверждено

**Поддерживаемая политика.** Claude Code хранит пользовательские настройки в
`~/.claude/settings.json`. `permissions.allow` пропускает совпавший tool call
без ручного подтверждения; `permissions.ask` всегда спрашивает; `deny` имеет
приоритет над `ask`, а `ask` — над `allow`. Для MCP поддерживаются точные правила
`mcp__<server>__<tool>` и server wildcard. Эффективные правила и источник каждого
из них видны через `/permissions`.
[Claude Code permissions](https://code.claude.com/docs/en/permissions) ·
[Claude Code settings](https://code.claude.com/docs/en/settings)

**Подходящий контракт.** Добавить в `permissions.allow` только точные import
tools, например `mcp__yandex-kit__upload_file`; не добавлять
`mcp__yandex-kit__*`. Остальные инструменты остаются на стандартном запросе, а
явные `ask`/`deny` пользователя продолжают иметь приоритет. MCP tool,
помеченный сервером как `requiresUserInteraction`, всё равно запросит участие —
allow rule не обходит эту защиту.
[MCP rule syntax and precedence](https://code.claude.com/docs/en/permissions#mcp)

**Безопасное объединение.** Распарсить JSON, сохранить все неизвестные поля и
существующие массивы, добавить с дедупликацией только отсутствующие точные
правила, создать backup. Не удалять и не переставлять пользовательские
`ask`/`deny`. Если managed settings запрещают пользовательские permission rules,
сообщить о конфликте вместо ложного успеха.
[settings precedence](https://code.claude.com/docs/en/permissions#settings-precedence)

**Активация и проверка.** Самый надёжный переносимый шаг после изменения — новая
сессия Claude Code. Затем `/permissions` должен показать каждое точное правило и
его source; проверочный import-tool call должен пройти без prompt, а контрольный
опасный tool call — остановиться на prompt, не выполняясь. Если правило
перекрыто `ask`, `deny` или managed policy, setup оставляет более строгую
политику и сообщает пользователю, что unattended import не включён.

### 2. Claude Desktop — только ручной fallback

**Что подтверждено.** Claude Desktop поддерживает local MCP через
`claude_desktop_config.json`; после изменения конфигурации приложение нужно
полностью закрыть и открыть. В Claude connector UI пользователь может выбрать
`Allow always` только для доверенного connector/tool, а корпоративная политика
может убрать эту возможность и оставить только `Ask`/`Never`.
[local MCP setup](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) ·
[tool approvals and Allow always](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp#taking-actions-with-tools) ·
[Enterprise connector permissions](https://support.claude.com/en/articles/13930452-manage-custom-roles-on-enterprise-plans#connector-permissions)

**Что не подтверждено.** Официальные материалы не публикуют поддерживаемый файл,
CLI или API для программного сохранения per-tool `Allow always` у **local stdio
MCP**. Документированные role policies относятся к organization connectors и
прямо не управляют локальными MCP, запущенными пользователем.
[scope of connector permissions](https://support.claude.com/en/articles/13930452-manage-custom-roles-on-enterprise-plans#where-connector-permissions-apply)

**Безопасный результат setup.** Не редактировать внутренние базы/кэши Claude.
После подключения MCP дать один короткий ручной шаг: запустить первый безопасный
import tool и выбрать `Allow always`, если этот пункт доступен. Повторить только
для точных import tools; не выбирать сервер целиком. Если `Allow always` нет,
заранее сказать, что текущая политика организации требует подтверждение каждого
вызова. Проверка — новый разговор: import tool не спрашивает, контрольный
опасный tool спрашивает. Автоматическая гарантия для Claude Desktop пока
**неподдерживаема**.

### 3. Cursor — условно подтверждено, нужен version/local capability gate

**Официально подтверждено.** Cursor по умолчанию спрашивает перед MCP calls и
умеет Auto-run. Cursor также документирует Auto-review как классификатор,
который можно направлять через `permissions.json`, но прямо предупреждает, что
это best-effort, а не security boundary.
[Cursor MCP approval and Auto-run](https://docs.cursor.com/context/model-context-protocol) ·
[официальный Cursor changelog про `permissions.json`](https://cursor.com/changelog/sdk-updates-jun-2026)

**Локально подтверждено на текущей установке.** Cursor 3.16.17 содержит bundled
JSON Schema
`/Applications/Cursor.app/Contents/Resources/app/extensions/cursor-always-local/schemas/permissions.schema.json`.
Она определяет:

- `mcpAllowlist: string[]` с точными формами `server:tool`, `server:*`,
  `*:tool`, `*:*`;
- `autoRun.allow_instructions` и `autoRun.block_instructions`;
- описание schema как конфигурации user и project permission files.

Установленный `cursor-agent 2026.08.04-aaa8809` также показывает флаги
`--auto-review`, `--approve-mcps` и `--yolo`; последние два слишком широки для
нашей безопасной границы.

**Почему нельзя полагаться только на quoted fix.** Cursor staff подтверждал
регрессии, когда user `mcpAllowlist` не читался (исправлено в 3.10.17), а также
несогласованность сочетания file allowlist с Auto-review. Поэтому natural-language
`allow_instructions` нельзя использовать как доказательство или enforcement;
для импорта нужен exact allowlist и поведенческая проверка на установленной
версии.
[first-party staff confirmation of the fixed allowlist regression](https://forum.cursor.com/t/permissions-json-mcp-wildcard-allowlist-entries-are-not-honoured-while-exact-entries-execute/164710/9) ·
[first-party staff confirmation of Auto-review conflict](https://forum.cursor.com/t/permissions-json-allowlists-disable-auto-review-with-sandbox-contradicts-docs/165722/7)

**Подходящий контракт.** В user-level `~/.cursor/permissions.json` добавить
точные entries вида `<effective-server-id>:<import-tool>`. Не добавлять
`yandex-kit:*`, `user-yandex-kit:*` или `*:*`. Server id нельзя угадывать:
Cursor может показывать user/project prefix, поэтому setup должен получить
effective id из установленного клиента/UI и использовать его в проверочном
вызове.

**Безопасное объединение.** До записи проверить installed schema. Распарсить
JSON/JSONC без потери других top-level полей, сохранить существующие allowlists
и classifier instructions, дедуплицировать точные entries и сделать backup.
Если уже есть broad entry для того же server, точные additions не возвращают
защиту: setup должен отдельно предложить заменить broad entry на точный import
profile. Не менять broad entry молча.

**Активация и проверка.** Bundled schema подтверждает форму, но не стабильный
reload contract. Честный переносимый шаг — `Developer: Reload Window`, затем
проверка в `Settings → Agents → Approvals & Execution`: effective MCP allowlist
должен содержать точные tools. После этого безопасный import call должен пройти
без prompt, а контрольный опасный call должен показать prompt и не выполняться.
Если хоть одна проверка не совпала, вернуть статус «не включено» и дать ручной
путь через settings. Classifier hint сам по себе успехом не считается.

### 4. OpenAI Codex — подтверждено

**Поддерживаемая политика.** Codex хранит MCP servers и их tool policy в
`~/.codex/config.toml`; ChatGPT desktop app, Codex CLI и IDE extension одного
Codex host используют этот конфиг совместно. У server table есть
`default_tools_approval_mode = auto | prompt | writes | approve`, а у каждого
tool — `tools.<tool>.approval_mode` с теми же значениями. `writes` запрашивает
подтверждение для tool, который не помечен `readOnlyHint = true`.
[Codex MCP configuration](https://developers.openai.com/codex/mcp/#configure-with-configtoml) ·
[Codex configuration reference](https://developers.openai.com/codex/config-reference/#mcp_serversiddefault_tools_approval_mode)

**Подходящий контракт.** Для сервера поставить conservative default `prompt`, а
точным import tools — `approve`:

```toml
[mcp_servers.yandex-kit]
default_tools_approval_mode = "prompt"

[mcp_servers.yandex-kit.tools.upload_file]
approval_mode = "approve"
```

Такой профиль точнее, чем `writes`: импорт сам является записью, поэтому
`writes` продолжит спрашивать. Не менять top-level `approval_policy` и не
включать `never` — это затронуло бы не только Yandex KIT.
[MCP approval modes](https://developers.openai.com/codex/mcp/#other-configuration-options) ·
[global approval policy](https://developers.openai.com/codex/config-reference/#approval_policy)

**Безопасное объединение.** Использовать существующий TOML merge установщика:
сохранить unrelated tables и server transport/env, добавить только server
default и точные per-tool subtables. Если пользователь уже задал более строгий
per-tool `prompt`, не ослаблять его без отдельного согласия. Если managed
requirements перекрывают user config, сохранить более строгое ограничение.

**Активация и проверка.** В ChatGPT desktop нажать Restart после изменения MCP;
в IDE — Restart extension; для CLI начать новую сессию. `codex mcp list` и `/mcp`
подтверждают сервер, а `codex mcp get <server>` в текущем CLI показывает
server-level approval mode. Завершающая поведенческая проверка та же: один
безопасный import call без prompt и один опасный call с prompt без выполнения.
[restart and MCP inspection](https://developers.openai.com/codex/mcp/#connect-codex-to-an-mcp-server)

### 5. VS Code — подтверждён ручной UI, нет публичного storage API

**Поддерживаемая политика.** `Chat: Manage Tool Approval` показывает tools,
сгруппированные по источнику, включая MCP server. Пользователь может убрать
pre-approval prompt у отдельного tool или у всего источника. В approval dialog
есть scopes: один вызов, текущая сессия, workspace или все будущие вызовы.
`chat.tools.eligibleForAutoApproval` может принудительно оставить конкретный tool
на ручном подтверждении, в том числе через enterprise policy.
[VS Code approvals](https://code.visualstudio.com/docs/agents/approvals#_tool-approval) ·
[VS Code security model](https://code.visualstudio.com/docs/agents/security)

**Безопасный контракт.** В `Default Approvals` вручную включить pre-approval
только для точных import tools Yandex KIT. Не использовать Bypass Approvals,
Autopilot, `chat.tools.global.autoApprove` или top-level trust всего MCP server:
они шире требуемой границы.
[permission levels and global auto-approval warning](https://code.visualstudio.com/docs/agents/approvals#_permission-levels)

**Safe merge и reload.** Официальная документация не публикует формат файла/API,
куда `Manage Tool Approval` сохраняет индивидуальные решения. Setup не должен
редактировать VS Code globalStorage или SQLite. MCP config остаётся в user
`mcp.json`, а approval — один guided UI step. Управление применяется из UI;
после изменения server config VS Code может автоматически перезапустить MCP по
`chat.mcp.autoStart`, иначе использовать `MCP: List Servers` / restart server.
[VS Code MCP lifecycle](https://code.visualstudio.com/docs/agent-customization/mcp-servers)

**Проверка/fallback.** Повторно открыть `Chat: Manage Tool Approval` и проверить
точные инструменты; затем выполнить безопасный и опасный контрольные вызовы.
Если organization policy запретила auto-approval, заранее сообщить, что импорт
потребует участия пользователя.

### 6. Kimi Code — подтверждено

**Поддерживаемая политика.** Kimi Code хранит постоянные rules в
`$KIMI_CODE_HOME/config.toml` или `~/.kimi-code/config.toml`. MCP tools называются
`mcp__<server>__<tool>`; `*`/`**` разрешены, но параметры MCP call в matching не
участвуют. `[[permission.rules]]` принимает `allow`, `ask` и `deny`; правила
проверяются по порядку, и первое совпадение побеждает. Они загружаются при старте
сессии.
[Kimi MCP permissions](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html#tool-naming-and-permissions) ·
[Kimi permission config](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files.html#permission)

**Подходящий контракт.** Добавить отдельный `allow` для каждого точного import
tool, например:

```toml
[[permission.rules]]
decision = "allow"
pattern = "mcp__yandex-kit__upload_file"
reason = "Yandex KIT unattended import profile"
```

Unmatched MCP calls продолжают вызывать approval. Не использовать
`mcp__yandex-kit__*`, `default_permission_mode = "yolo"`, `--yolo` или `--auto`:
они разрешают больше импорта, включая file writes и shell calls.
[YOLO scope warning](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html) ·
[permission modes](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files.html#top-level-fields)

**Безопасное объединение.** Сохранить все TOML sections и порядок rules. Из-за
first-match semantics простой append небезопасен: прежний broad `ask` остановит
новый allow, а перенос allow выше существующего `deny` ослабит политику. Setup
должен вычислить первое совпадение для каждого tool. При `deny` или `ask`
конфликт не переписывать автоматически; показать его пользователю. При отсутствии
конфликта добавить точные rules с дедупликацией и backup.

**Активация и проверка.** Начать новую Kimi Code session; approval rules именно
так загружаются. Проверить безопасным import call и опасным контрольным call.
`Approve for this session` не заменяет эту проверку постоянной политики, потому
что действует только в текущей сессии.
[session approval behavior](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html#tool-naming-and-permissions)

### 7. Kimi Desktop / Kimi Work — безопасная точечность не поддержана

**Что подтверждено.** Kimi Work предлагает `Ask permission` и `Full access`
(`Allow all`). `Full access` выполняет задачу без остановок, но распространяется
на все действия текущей задачи. Продукт находится в Beta и часто меняется.
[Kimi Work permissions](https://www.kimi.com/help/kimi-work/overview) ·
[Full access flow](https://www.kimi.com/resources/kimi-work-introduction#how-to-run-unscheduled-tasks-in-kimi-work)

**Что отсутствует.** Официальные материалы не документируют per-MCP-server или
per-tool allowlist, поддерживаемый config/API, merge semantics и машинную
проверку эффективной политики. Локальный Daimon config, который текущий setup
использует для MCP server registration, не является доказательством approval
contract.

**Fallback.** Не включать `Full access` автоматически: он нарушает требование
«удаления спрашивают отдельно». Сообщить до импорта: «Kimi Work умеет только
разрешить всю задачу целиком; безопасного режима только для импорта сейчас нет».
Пользователь может выбрать `Full access` вручную на свой риск либо оставить
`Ask permission`. Статус capability — **unsupported**, пока Kimi не опубликует
точечную политику.

### 8. Hermes Agent — нет MCP approval gate

**Что подтверждено.** `approvals.mode` (`smart | manual | off`) в Hermes
контролирует опасные **shell commands**, а не произвольные MCP tool calls.
MCP server config поддерживает `tools.include` и `tools.exclude`: они решают,
какие tools вообще регистрируются. `/reload-mcp` обновляет MCP tool set.
[Hermes security and approval scope](https://hermes-agent.nousresearch.com/docs/user-guide/security/#dangerous-command-approval) ·
[Hermes MCP tool filters](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference#tools-policy-keys) ·
[Hermes reload](https://hermes-agent.nousresearch.com/docs/reference/slash-commands)

**Следствие.** Hermes может дать unattended import, если expose только import
tools, но тогда удаление не «спрашивает отдельно» — tool просто недоступен.
Если expose delete tool, документированной runtime approval gate перед его MCP
call нет. Открытые задачи в официальном репозитории прямо описывают per-MCP-tool
approval как ещё не реализованную возможность; это corroborating evidence, а не
нормативная документация.
[official repository feature request](https://github.com/NousResearch/hermes-agent/issues/49167)

**Safe merge, reload, verification.** Можно безопасно объединить YAML server
entry и exact `include` list, сохранив unrelated servers/options. После
изменения вызвать документированную `/reload-mcp`, затем проверить `hermes
mcp`/tool list и отсутствие excluded tools. Но это проверяет доступность, не
отдельные подтверждения.

**Fallback.** Предложить два честных режима: (1) expose только import tools и
полностью скрыть опасные; (2) оставить весь server и полагаться на явное
подтверждение самого Yandex KIT skill, понимая, что это agent instruction, а не
host enforcement. Capability безопасной host policy — **unsupported**.

### 9. OpenClaw — нет общей per-tool policy для embedded outbound MCP

**Что подтверждено.** OpenClaw registry поддерживает per-server
`toolFilter.include`/`exclude`, `openclaw mcp configure/tools`, live probe через
`openclaw mcp doctor --probe` и `openclaw mcp reload`. Embedded OpenClaw
проецирует только прошедшие filter tools. Для Codex app-server есть специальный
`codex.defaultToolsApprovalMode`, который превращается в нативную политику
Codex; он не действует на embedded OpenClaw, ACP sessions или другие runtimes.
[OpenClaw MCP registry and filters](https://docs.openclaw.ai/cli/mcp) ·
[Codex-only projection](https://docs.openclaw.ai/cli/mcp#choose-the-right-mcp-path)

**Approval mechanisms не дают универсального ответа.** Exec approvals относятся
к host commands. Plugin permission requests позволяют автору plugin написать
собственный `before_tool_call` gate, но generic `allow-always` сам по себе не
сохраняет trust: plugin обязан реализовать persistence. Это расширение/разработка,
а не готовая декларативная настройка setup.
[OpenClaw exec approval scope](https://docs.openclaw.ai/tools/exec-approvals#where-it-applies) ·
[plugin permission requests and persistence](https://docs.openclaw.ai/plugins/plugin-permission-requests#troubleshooting)

**Safe merge и fallback.** Для embedded profile можно merge только exact
`toolFilter.include` с backup и проверить `status --json`/`doctor --probe`;
после изменения вызвать `openclaw mcp reload`, Gateway publish или restart в
зависимости от процесса-владельца. Такой фильтр может оставить только import
tools, но опасные tools станут недоступны, а не approval-gated. Для Codex runtime
использовать подтверждённую политику Codex. Для embedded OpenClaw capability
безопасной host policy — **unsupported** до появления общего per-tool gate.

## Рекомендуемый capability contract для setup

Setup не должен угадывать поддержку по имени клиента. Каждый adapter возвращает
машиночитаемый результат:

```json
{
  "approvalPolicy": {
    "support": "automatic | guided | unsupported",
    "scope": "tool | server | task | none",
    "enforcement": "host | classifier | agent-instruction | none",
    "configSource": "documented-file | documented-ui | local-version-gated | none",
    "requiresRestart": true,
    "verified": false,
    "reasonCode": "..."
  }
}
```

Минимальные стабильные `reasonCode`: `POLICY_APPLIED`, `POLICY_USER_STEP`,
`POLICY_CONFLICT`, `POLICY_TOO_BROAD`, `POLICY_MANAGED`,
`POLICY_CLIENT_UNSUPPORTED`, `POLICY_UNVERIFIED`.

`automatic` допустим только если setup может:

1. определить effective server id и точные import tool names;
2. безопасно распарсить и объединить документированный config;
3. сохранить более строгие пользовательские/managed rules;
4. активировать policy документированным способом;
5. доказать два наблюдаемых поведения: import tool без prompt, опасный tool с
   prompt и без side effect.

Если пятый пункт нельзя проверить неразрушающе, статус остаётся `guided` или
`unsupported`; структурное наличие строки в файле не является доказательством.

## Честные пользовательские сообщения

- **Automatic:** «Импорт без остановок включён для товаров, вариантов, файлов и
  статей. Удаления и остальные действия по-прежнему потребуют подтверждения».
- **Guided:** «В этом приложении настройка хранится внутри интерфейса. Откройте
  управление разрешениями и один раз разрешите перечисленные инструменты
  импорта; удаления не разрешайте».
- **Unsupported:** «Это приложение умеет либо спрашивать каждый раз, либо дать
  полный доступ ко всем действиям. Безопасного режима только для импорта сейчас
  нет, поэтому я не буду включать полный доступ автоматически».

## Решения, которые теперь можно вынести в отдельные tickets

Исследование снимает платформенный туман и делает точными следующие вопросы:

1. Какой versioned список MCP tool names составляет профиль «Импорт без
   остановок», включая статьи и связанные сущности, и какие tools всегда должны
   остаться `prompt`/`deny`?
2. Как выглядит единый adapter/result contract `automatic | guided |
   unsupported`, включая reason codes и conflict rules?
3. Какой безопасный merge/rollback algorithm нужен для JSON/JSONC, TOML и YAML
   approval policies без ослабления существующих правил?
4. Как проверить отсутствие prompt без выполнения опасного side effect — нужен
   ли специальный безвредный canary MCP tool или host-native policy inspection?
5. Какой guided UX нужен для VS Code и Claude Desktop, и какой unsupported UX —
   для Kimi Work, Hermes и embedded OpenClaw?

## Итог

Cursor был прав лишь частично: `permissions.json` и MCP allowlist действительно
существуют в текущем клиенте, но `yandex-kit:*` — неверная граница доверия, а
classifier hint не даёт гарантии. Правильное решение — exact import-tool policy
с version gate и поведенческой проверкой.

Кроссплатформенный продукт должен обещать не «мы отключим Allow везде», а
«setup определит возможности вашего приложения, включит безопасный режим там,
где он поддерживается, проведёт через один ручной шаг там, где политика живёт в
UI, и заранее предупредит там, где клиент предлагает только полный доступ».
