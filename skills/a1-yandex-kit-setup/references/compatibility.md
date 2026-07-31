# Compatibility ladder

Use this branch when a tested profile disagrees with the installed client or
the user names another MCP client. Establish a current adapter immediately from
local evidence and official vendor documentation.

## 1. Collect local evidence

Identify the exact client name, version, operating system and user-level config
path. Inspect the local MCP command's `--help` when one exists. Record only
capabilities and paths; keep tokens and config contents out of the response.

Completion criterion: the client/version and every locally advertised MCP
configuration or diagnostic command are known.

## 2. Read current official documentation

Search only the client's official vendor documentation. Confirm:

- the current user-level MCP config path;
- the stdio server schema or native add command;
- how environment variables are stored;
- how to list/test servers;
- whether a non-interactive reload exists.

Prefer a current native CLI command because it owns its schema. Otherwise map
the documented schema to one helper capability:

| Helper format | Required shape |
|---|---|
| `mcp-json` | JSON root `mcpServers` |
| `vscode-json` | JSON root `servers` with stdio type |
| `codex-toml` | TOML tables under `mcp_servers` |
| `hermes-yaml` | YAML root `mcp_servers` |
| `openclaw-json` | JSON root `mcp.servers` |

Completion criterion: an official source and local evidence agree on either one
native add command or one user-level path and helper capability, plus one
verification method.

## 3. Configure through the capability

### Native CLI

When the vendor documents a native add command, use it immediately. Build a JSON
array containing its exact arguments and replace the token value with the
literal placeholder `{{YANDEX_KIT_TOKEN}}`. Then run the helper interactively
and write the token followed by a newline to its stdin:

```bash
node "<skill-directory>/scripts/setup.mjs" native-configure --command <executable> --args-json '<JSON argument array>' --token-stdin --json
```

The helper substitutes the token inside the child-process arguments. This is
allowed even when the native CLI requires `KEY=<token>` as one argument. The
agent-issued shell command and shell history contain no token, and captured
output is redacted.

If the documented command fails, use its sanitized diagnostic and current local
`--help` to correct the command and retry without sending the user to a
terminal. If the corrected native command still fails and the official
documentation also provides a supported file shape, continue with the file
adapter below before producing a technical handoff.

### Documented file format

When there is no working native add command, pass the verified format and
absolute config path to `scripts/setup.mjs`. Follow the token and configuration
rules in steps 3–4 of `SKILL.md`.

After configuration, use the documented client-level test and the helper's
direct `get_store` smoke test. Use `smoke-token --token-stdin` when the native
CLI does not expose a supported file adapter. A successful run can be reported
immediately; the static profile does not need to be updated first.

## 4. Produce a technical handoff when automation cannot finish

Use this final rung only when official documentation and local evidence provide
neither a working native add command nor a file shape the helper can update.
Give the user one copyable block for a technical specialist containing:

```text
Client and version: <name/version>
Operating system: <OS>
User config path: <absolute path or "not established">
Required server name: yandex-kit
Required stdio command: npx -y mcp-yandex-kit@latest
Required environment entry: YANDEX_KIT_TOKEN=<paste the user's token locally>
Documented config capability: <format or native CLI>
Reload/restart: <current official instruction>
Read-only verification: initialize MCP, list tools, call get_store
Official source: <vendor URL>
Diagnostic: <sanitized failure without token>
```

Explain in one sentence which automatic route failed or was unavailable. Give
the handoff as the immediate next route, with the token represented only by its
local placeholder.
