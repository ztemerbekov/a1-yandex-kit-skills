---
name: a1-yandex-kit-setup
description: "Connect a Yandex KIT store to the current AI client, or reconnect it by replacing its token. Use for natural-language setup requests, including Russian text or voice transcripts such as «Связь с магазином», «Подключим магазин», «Переподключим магазин», «Переустановим связь с магазином» and «Поменяем токен». Treat short «Связь с магазином» as an orientation request."
metadata:
  author: Zinnur Temerbekov
---

# A1 Yandex KIT Setup

## Communication

Before producing any user-facing message, read and apply
[`../a1-yandex-kit/references/merchant-communication.md`](../a1-yandex-kit/references/merchant-communication.md)
completely.

Make setup a concierge flow for typed requests and voice transcriptions alike.
Start from the branch that invoked it:

- For the short orientation request `Связь с магазином`, ask one question:
  `Что сделать: подключить магазин или переподключить его с новым токеном?`
- A concrete request to connect or reconnect authorizes updating the selected
  client's user-level MCP configuration after the required inputs are collected
  and the candidate token passes validation. Reinstalling the connection and
  changing the token are both reconnection requests.

A project-local skill installation does not limit the configuration to that
project.

Use `scripts/setup.mjs` for configuration and the direct read-only smoke test.
Resolve every relative path from this skill directory, not from the user's
project.

## 1. Identify the client and prerequisite

Infer the current client from the host when it is clear. Otherwise ask one short
question: `В каком приложении вы сейчас хотите подключить Яндекс KIT?`

Normalize the answer to one of:

`claude-code`, `claude-desktop`, `cursor`, `codex`, `vscode`, `kimi`,
`kimi-desktop`, `hermes`, `openclaw`.

Treat Kimi Code and Kimi Desktop as different clients. Use `kimi` only for the
Kimi Code CLI and `kimi-desktop` for the Kimi Work desktop application. When
the user says only “Kimi” and the host does not disambiguate it, ask:
`Вы используете приложение Kimi на компьютере или Kimi Code в терминале?`

For a tested client, run:

```bash
node "<skill-directory>/scripts/setup.mjs" status --client <client> --json
```

`status` verifies both Node.js 20+ and an executable `npx` before any token is
requested or any config is changed. If either prerequisite is unavailable, give
one exact Node.js installation link or instruction appropriate to the operating
system and stop. Leave installation to that operating-system installer. For
another client, run the independent preflight and continue to the compatibility
ladder in step 2:

For Claude Code, Cursor, VS Code and Kimi Code, `status` also checks whether a
known project- or local-scope server named `yandex-kit` would override the
user-level entry. On an exact-name collision it selects the managed fallback
name `a1-yandex-kit-global`. It ignores every differently named MCP server. A
previously configured canonical fallback stays selected on later runs.

```bash
node "<skill-directory>/scripts/setup.mjs" preflight --json
```

Run `status` later only when the ladder establishes a supported format and path.
This step is complete when Node.js 20+, `npx` and one client are identified.

## 2. Validate the compatibility profile

Read [`references/client-profiles.md`](references/client-profiles.md) for the
selected client. Check the installed client's version or MCP help when its CLI is
available, and check that the resolved user-level path and configuration shape
match the local installation.

Use the tested profile when those signals agree. On a mismatch, an unknown
client, or a client not listed above, read
[`references/compatibility.md`](references/compatibility.md) completely and run
its compatibility ladder. This step is complete when the chosen adapter is
supported by local evidence or current official vendor documentation.

## 3. Obtain the token

Use the `status` result without reading or displaying the stored token.
For a native CLI without a supported file adapter, use its documented
list/show command: treat an existing managed `yandex-kit` or
`a1-yandex-kit-global` entry as `configured: true` without attempting to read its
token.

- When `configured` is false, ask:
  `Для настройки потребуется токен Яндекс KIT. Чтобы его получить, зайдите в кабинет Яндекс KIT: Настройки → API и скопируйте ключ. Вставьте его сюда — я привяжу его к приложению и не буду повторять в ответе. Токен останется в истории этого чата и будет сохранён в пользовательском конфиге приложения.`
- When `configured` is true, continue from the selected branch:
  - For reconnection, including reinstallation or token replacement, ask:
    `Пришлите новый токен из **Настройки → API** — я обновлю подключение и не буду повторять его в ответе. Новый токен останется в истории этого чата и будет сохранён в пользовательском конфиге приложения.`
  - For a first-connection request when a token is already configured, ask:
    `Токен Яндекс KIT уже сохранён в настройках. Хотите переподключить магазин с новым токеном?`
    - For `нет`, finish with:
      `Принято! Оставляем действующий токен Яндекс KIT без изменений. Всё работает в прежнем режиме.`
    - For `да`, use the reconnection prompt above.

Accept the token in chat. Do not echo, summarize, quote, log or interpolate it
into a shell command. Pass a new token only through stdin to `setup.mjs`: write
the token followed by one newline. The first newline terminates the input, so
the helper starts immediately and never waits for the stdin pipe to close;
closing stdin after the newline is also safe.

Before writing any new or replacement token, validate it with the direct
read-only MCP smoke test:

```bash
node "<skill-directory>/scripts/setup.mjs" smoke-token --token-stdin --json
```

`smoke-token` and `smoke` require external network access: the helper reaches
the npm registry to start `mcp-yandex-kit@latest` and the Yandex KIT API for
`get_store`. In a host that sandboxes shell commands, such as Codex, run these
commands with network access granted on the first attempt — request the
network-enabled or escalated execution mode instead of trying an isolated
sandbox first. The helper probes connectivity before starting the server and
fails fast with `code: "NETWORK_UNAVAILABLE"` when the network is blocked;
re-run the same command with network access instead of treating it as a token
problem. The whole smoke run shares one wall-clock deadline, so it either
finishes or fails within about a minute.

If authentication fails (`code: "SMOKE_AUTH"`), ask for another token with the
replacement-token prompt and repeat this validation until it succeeds or the
user explicitly cancels. Do not impose a retry limit. Because configuration has not started,
cancellation leaves the current client settings unchanged. Treat other smoke
failures as their own diagnostics instead of asking for a different token.

This step is complete when one candidate token has passed `get_store`. The
explicit `нет` branch for an existing first connection finishes the skill
without reaching this point.

## 4. Configure the user-level client

For a new or replacement token, run the helper in an interactive process and
write the token followed by a newline to its stdin; the newline completes the
input, so the helper does not wait for the pipe to close:

```bash
node "<skill-directory>/scripts/setup.mjs" configure --client <client> --token-stdin --json
```

For a dynamically discovered native CLI, follow
[`references/compatibility.md`](references/compatibility.md) and run
`native-configure`. The helper reads the token from stdin, substitutes it into
the documented child-process arguments, keeps it out of the agent-issued shell
command and shell history, and redacts it from output.

For a dynamically discovered file adapter, also pass its verified capability
and path:

```bash
node "<skill-directory>/scripts/setup.mjs" configure --client <label> --format <format> --config <absolute-path> --token-stdin --json
```

In either route, the canonical server is always:

```text
npx -y mcp-yandex-kit@latest
```

Only add or update the selected managed entry. Preserve every differently named
MCP server and every unrelated client setting. Do not remove, rename, disable or
rewrite another server. When an exact project/local `yandex-kit` entry shadows
the user-level name, leave that entry unchanged and configure
`a1-yandex-kit-global` instead.

Use the concrete setup request selected at the start as the configuration
authorization and surface only the host application's unavoidable filesystem
approval. If an existing config cannot be parsed safely, leave it unchanged and
return to the compatibility ladder to try the client's documented native CLI.
Give the technical handoff only when the native route is also unavailable or
fails.

For a file adapter, this step is complete when the helper reports
`configured: true`, the token is present without being printed, unrelated
client settings remain intact, and a backup exists for every changed
pre-existing config. On POSIX systems, the changed config and its backup must
have mode `0600`. For a native CLI, this step is complete when the documented
add command exits successfully; the client owns its configuration mutation.

## 5. Prove the connection

For a tested client, run the client check:

```bash
node "<skill-directory>/scripts/setup.mjs" client-check --client <client> --json
```

Treat `structural` as the expected client check for GUI clients without a
non-interactive MCP diagnostic. For a dynamic adapter, run the client-level
verification established from its official documentation.

The client check must verify the effective managed definition, not merely that
its name appears in a list. If a locally changed client path or precedence rule
still causes `SERVER_SHADOWED`, configure the same validated token once under
`a1-yandex-kit-global` by passing
`--server-name a1-yandex-kit-global` to `configure`, `client-check` and `smoke`.
Leave the shadowing project entry and all other MCP servers unchanged.

For a file adapter, then run:

```bash
node "<skill-directory>/scripts/setup.mjs" smoke --client <client> --json
```

Repeat the verified `--format` and `--config` flags for a dynamic adapter.
For a native CLI without a supported file adapter, use the successful direct
smoke from step 3 and do not run the file-based `smoke --client` command.
The smoke test must complete the MCP initialize handshake, list tools, find
`get_store`, and call only `get_store`. It must not call any write tool.

If the tested profile fails because its path, schema or client command changed,
restore only this run's change when `configure` reported `changed: true`, then
execute the dynamic compatibility branch. For a pre-existing config, use every
rollback value returned by that configure run:

```bash
node "<skill-directory>/scripts/setup.mjs" rollback --config <configPath> --backup <backupPath> --backup-hash <backupHash> --expected-hash <configHash> --json
```

When this run created the config, use:

```bash
node "<skill-directory>/scripts/setup.mjs" rollback --config <configPath> --created --expected-hash <configHash> --json
```

If the hash check refuses rollback, preserve the newer config and report its
path. If a post-write check reports authentication failure, roll back this run's
file change when one exists, then return to the unlimited token-validation loop
in step 3. If the config is malformed, do not repair it; try the documented
native CLI before using the technical handoff.

This step is complete only when the client check passes and the direct MCP
smoke test has passed during this run.

## 6. Offer work without host stops

After the connection is proved, read
[`references/approval-policies.md`](references/approval-policies.md) completely.
Use the same branch when the user reports repeated `Allow` prompts during an
import, even if the store was connected earlier.

Inspect the current client's capability, state that the grant covers every
current and future Yandex KIT tool, and ask once whether to enable **Работу без
остановок** on this computer. After `да`, apply the managed server wildcard.
The warning must name deletes, orders, promotions and store administration
before consent. Do not ask again for individual tools added later.

This step is complete when the helper reports `automatic`, `guided` or
`unsupported`, and the user knows any remaining restart or UI action before
work starts.

## 7. Finish simply

Reload MCP automatically only when the validated client exposes a documented
non-interactive reload command. Otherwise give the single restart instruction
from `references/client-profiles.md`; do not force-close the application.

End with one short result, for example:

`Готово — Яндекс KIT подключён к Cursor. Проверка прошла: вижу магазин «Название».`

Do not show configuration contents, token fragments, diagnostic dumps or
additional terminal commands. Setup is complete when the user sees the selected
client, a successful store check, and at most one necessary restart action.
