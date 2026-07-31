---
name: a1-yandex-kit-setup
description: "Connect the Yandex KIT MCP server to the user's current AI client. Use when the user asks «подключи Яндекс KIT» or «настрой Yandex KIT», or explicitly wants to replace its Yandex KIT token. Handles Claude Code, Claude Desktop, Cursor, OpenAI Codex, VS Code, Kimi Code, Hermes Agent, OpenClaw and new clients through a compatibility ladder."
---

# A1 Yandex KIT Setup

Make setup a concierge flow. Treat invoking this skill as authorization
to update the selected client's user-level MCP configuration. A project-local
skill installation does not limit the configuration to that project.

Use `scripts/setup.mjs` for configuration and the direct read-only smoke test.
Resolve every relative path from this skill directory, not from the user's
project.

## 1. Identify the client and prerequisite

Infer the current client from the host when it is clear. Otherwise ask one short
question: `В каком приложении вы сейчас хотите подключить Яндекс KIT?`

Normalize the answer to one of:

`claude-code`, `claude-desktop`, `cursor`, `codex`, `vscode`, `kimi`,
`hermes`, `openclaw`.

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
list/show command: treat an existing `yandex-kit` entry as `configured: true`
without attempting to read its token.

- When `configured` is false, ask:
  `Для настройки потребуется токен Яндекс KIT. Чтобы его получить, зайдите в кабинет Яндекс KIT: Настройки → API и скопируйте ключ. Вставьте его сюда — я привяжу его к приложению и не буду повторять в ответе. Токен останется в истории этого чата и будет сохранён в пользовательском конфиге приложения.`
- When `configured` is true, always ask:
  `Токен Яндекс KIT уже сохранён в настройках. Вы хотите его обновить?`
  - For `нет`, do not configure, normalize or verify anything. Finish with:
    `Хорошо, текущий токен и настройки Яндекс KIT оставлены без изменений.`
  - For `да`, ask:
    `Пришлите новый токен из **Настройки → API** — я обновлю подключение и не буду повторять его в ответе. Новый токен останется в истории этого чата и будет сохранён в пользовательском конфиге приложения.`

Accept the token in chat. Do not echo, summarize, quote, log or interpolate it
into a shell command. Pass a new token only through stdin to `setup.mjs`. This
step is complete when the run has either one new token or an explicit decision
to keep the stored token.

## 4. Configure the user-level client

For a new or replacement token, run the helper in an interactive process and
write the token followed by a newline to its stdin:

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

Treat skill invocation as the configuration authorization and surface only the
host application's unavoidable filesystem approval. If an existing config
cannot be parsed safely, leave it unchanged and return to the compatibility
ladder to try the client's documented native CLI. Give the technical handoff
only when the native route is also unavailable or fails.

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

Then run:

```bash
node "<skill-directory>/scripts/setup.mjs" smoke --client <client> --json
```

Repeat the verified `--format` and `--config` flags for a dynamic adapter.
After native CLI configuration without a supported file adapter, pass the same
token through stdin:

```bash
node "<skill-directory>/scripts/setup.mjs" smoke-token --token-stdin --json
```

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
path. If authentication fails, ask for a replacement token once. If the config
is malformed, do not repair it; try the documented native CLI before using the
technical handoff.

This step is complete only when both the client check and the direct MCP smoke
test pass.

## 6. Finish simply

Reload MCP automatically only when the validated client exposes a documented
non-interactive reload command. Otherwise give the single restart instruction
from `references/client-profiles.md`; do not force-close the application.

End with one short result, for example:

`Готово — Яндекс KIT подключён к Cursor. Проверка прошла: вижу магазин «Название».`

Do not show configuration contents, token fragments, diagnostic dumps or
additional terminal commands. Setup is complete when the user sees the selected
client, a successful store check, and at most one necessary restart action.
