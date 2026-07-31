# Tested client profiles

These profiles are starting points, not permanent truths. Validate the selected
profile against the installed client before writing. All paths are user-level;
the location of the installed skill is irrelevant.

Use the canonical server definition and token rule from steps 3–4 of
`SKILL.md`.

## Profile table

| Client | Helper ID | Capability and default user config | Local validation | Client check | Restart when reload is unavailable |
|---|---|---|---|---|---|
| Claude Code | `claude-code` | JSON `mcpServers` in `~/.claude.json` | `claude mcp --help`; confirm user scope | captured `claude mcp get <managed-name>`; verify the effective command and args | Start a new Claude Code session |
| Claude Desktop | `claude-desktop` | JSON `mcpServers`; macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`, Linux path requires current-doc validation | App version plus current official local-MCP page | structural parse and exact entry | Quit and reopen Claude Desktop |
| Cursor | `cursor` | JSON `mcpServers` in `~/.cursor/mcp.json` | `cursor-agent mcp --help` when available; otherwise Cursor MCP settings | captured `cursor-agent mcp list` when available, otherwise structural | Reload the Cursor window |
| OpenAI Codex | `codex` | TOML `mcp_servers` in `$CODEX_HOME/config.toml` or `~/.codex/config.toml` | `codex mcp --help` | captured `codex mcp list --json` | Start a new Codex session |
| VS Code | `vscode` | JSON `servers` in the active user profile's `mcp.json`; default user paths are `~/Library/Application Support/Code/User/mcp.json`, `%APPDATA%\Code\User\mcp.json`, and `~/.config/Code/User/mcp.json` | `code --help` must advertise `--add-mcp`, or current MCP settings/docs must confirm the path | structural parse and exact entry | Run `Developer: Reload Window` |
| Kimi Code | `kimi` | JSON `mcpServers` in `$KIMI_CODE_HOME/mcp.json` or `~/.kimi-code/mcp.json`; project override in `.kimi-code/mcp.json` | `kimi mcp --help` plus the current official MCP page | captured `kimi mcp test <managed-name>` when available, otherwise structural | Start a new Kimi Code session |
| Hermes Agent | `hermes` | YAML `mcp_servers` in `$HERMES_HOME/config.yaml` or `~/.hermes/config.yaml` | `hermes mcp --help` plus the current official MCP page | structural parse and exact entry | Hermes auto-reloads config; use `/reload-mcp` only when the current session has not refreshed |
| OpenClaw | `openclaw` | nested JSON `mcp.servers` in `~/.openclaw/openclaw.json` | `openclaw mcp --help` | captured `openclaw mcp doctor <managed-name> --probe` | Run the documented MCP reload command shown by local help, or restart OpenClaw |

The helper accepts `--config <absolute-path>` when a validated non-default
profile or client installation uses another path.

## Official profile sources

- Claude Code: <https://code.claude.com/docs/en/mcp>
- Claude Desktop: <https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop>
- Cursor: <https://docs.cursor.com/context/model-context-protocol>
- OpenAI Codex: <https://developers.openai.com/codex/mcp/>
- VS Code: <https://code.visualstudio.com/docs/copilot/customization/mcp-servers>
- Kimi Code: <https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html>
- Hermes Agent: <https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp>
- OpenClaw: <https://docs.openclaw.ai/cli/mcp>

Use only the selected client's section during a normal run.
