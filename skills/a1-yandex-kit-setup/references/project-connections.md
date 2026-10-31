# Project connections: Codex and Claude Code

Use this flow for `codex` or `claude-code` in project scope. The MCP identity is
`a1-yandex-kit-project`. Keep `--scope project --project-dir <absolute-root>` on
`status`, `configure`, `token-web`, `client-check`, `smoke` and `rollback`.
Run helpers by their absolute skill path without changing into the skill folder.

This source feature is awaiting a coordinated package release. The generated
entry launches `npx -y mcp-yandex-kit@latest --project-config <absolute-binding>`;
an older published runtime cannot consume that flag. Establish that the released
runtime supports it before operating on a real project. Source/offline checks
are not proof of a released package or of connected client sessions.

## 1. Select the project and inspect

Show the owner the selected project and the saved store name/URL from public
status, when present. Request a project choice only when the host does not
establish it. `--project-dir` defaults to cwd; the helper does not infer another
root from the installed skill or a parent directory.

```bash
node "<skill-directory>/scripts/setup.mjs" status --client <codex|claude-code> --scope project --project-dir "<absolute-root>" --json
```

The shared binding is `<project>/.yandex-kit/project.json`, containing version 1
and a UUID `connection_id`. The token and expected store ID live in a private
record under `~/.a1-yandex-kit/connections/`, outside the repository. A custom
`YANDEX_KIT_CONNECTIONS_DIR` must be an absolute path outside the selected project
and every containing Git repository; use the same root for both agents. Setup
records this nonsecret root in the client entry. POSIX directories use `0700`
and private files `0600`.

Codex writes only `<project>/.codex/config.toml`; a custom/global `--config` is
not a project adapter. Custom config paths belong to explicit `--scope user`.
Claude Code uses the local
`projects[absoluteProjectDir].mcpServers` entry in `~/.claude.json`; that file's
location does not make the entry global. The binding selects the same store for
both agents. `configured: true` proves structural consistency on disk; runtime
and native effective checks below are required before reporting readiness.

## 2. Reuse or migrate before requesting a token

A request to connect the second agent or reinstall the existing connection uses
the binding without a new token:

```bash
node "<skill-directory>/scripts/setup.mjs" configure --client <codex|claude-code> --scope project --project-dir "<absolute-root>" --json
```

With no binding, this command can validate and migrate an identifiable legacy
connection. It recognizes actual KIT commands/packages rather than changing an
unrelated server just because its name matches. If candidates refer to different
stores, show only the returned server/store display choices and have the owner
select one; repeat with `--migrate-server <actually-detected-name>`. There is no
first-store fallback. If no reusable token is available, continue to step 3.
Keep any returned `transactionId` for this run.

Migration preserves global entries for other projects and disables the detected
legacy KIT identity only in this project. For a bundled plugin this means the
actual discovered plugin/server identity; the skills plugin stays installed.
Existing targeted allow/ask/deny and tool rules follow the new identity without
adding wildcard grants. Managed, ambiguous or conflicting policy is an actionable
conflict: preserve it and resolve the stated conflict before readiness. Known
managed-file checks do not prove that MDM/cloud policy is absent.

## 3. Obtain a new or replacement token when needed

For a new connection or an explicit token refresh, use the onboarding and
`token-route` selection in step 3 of `SKILL.md`. On a desktop, start a fresh
one-time page and follow that step's persistent-browser/OS-opener sequence:

```bash
node "<skill-directory>/scripts/setup.mjs" token-web --client <codex|claude-code> --scope project --project-dir "<absolute-root>" --json
```

Keep the page alive while the owner enters the token; never inspect the filled
form. A rejected token leaves it open for retry. A successful page validates and
configures the project, returning secret-free store and transaction metadata.

In a hosted session, use the documented session secret/input mechanism and feed
the token to the helper's stdin. Inherited `YANDEX_KIT_TOKEN` alone does not
configure a project connection. Use chat only after the owner's explicit choice;
explain that the token is then in chat history and will be stored in the private
connection record outside the repository. Never put the token in argv or logs.

```bash
node "<skill-directory>/scripts/setup.mjs" configure --client <codex|claude-code> --scope project --project-dir "<absolute-root>" --token-stdin --json
```

Project configuration validates `get_store` before persistence. Validation and
smoke need external npm/API access; use the host's network-enabled execution
path. Token refresh must return the saved store ID. A token for another store
is rejected without replacing the binding. Return to token input on an
authentication or wrong-store diagnostic; preserve other failures for diagnosis.

Changing the project's store is a separate explicit owner action: add
`--change-store` to `configure` or `token-web`. It creates a new connection and
rebinds only this project. Old private records remain because another clone or
worktree may still reference them. A reconnection request by itself authorizes
refreshing the same store, not switching stores.

## 4. Verify the effective connection

```bash
node "<skill-directory>/scripts/setup.mjs" client-check --client <codex|claude-code> --scope project --project-dir "<absolute-root>" --json
node "<skill-directory>/scripts/setup.mjs" smoke --client <codex|claude-code> --scope project --project-dir "<absolute-root>" --json
```

The native check runs from this project's cwd. Codex uses `mcp get ... --json`
and `mcp list --json`; Claude uses labelled `mcp get` output without an
unsupported JSON flag, then `mcp list`. It checks the effective definition,
binding path and private root, including active KIT duplicates. Unknown output,
unresolved plugin identity or a still-active duplicate is a conflict, not a pass.
If the installed client hides a plugin from inventory, resolve the local disable
with that client's `/mcp` or documented UI and check the effective tools in a new
session. Offline fixtures do not prove native plugin visibility.

Smoke starts the actual runtime with `--project-config`, initializes MCP, lists
tools and calls only `get_store`, verifying the expected store ID. Project mode
ignores inherited `YANDEX_KIT_TOKEN` and `YANDEX_KIT_BASE_URL`; missing/corrupt
binding or a store mismatch fails closed without global fallback.

Setup commits under connection/configuration locks and checks saved revisions.
On verification failure it rolls back only this transaction's owned revisions.
Concurrent edits are preserved and reported as a rollback conflict. A successful
changed setup can also be rolled back explicitly with its returned ID:

```bash
node "<skill-directory>/scripts/setup.mjs" rollback --client <codex|claude-code> --scope project --project-dir "<absolute-root>" --transaction <transactionId> --json
```

Private transaction journals are under the connections root's
`.setup-transactions/`, outside the project. They are configuration/credential
recovery records, not backups of store data. Preserve a conflict for inspection;
do not delete locks or overwrite a newer revision to force rollback.

## 5. Start a new session in the selected project

Existing chats keep their running MCP process. Start a new Codex chat or Claude
Code session after setup or token/store changes, and confirm the displayed
store. Do this in each agent using the binding. Project setup preserves targeted
permissions; skip broad `approval-status`/`approval-configure`. Those CLI commands
are user-only for these clients and require explicit `--scope user` plus a
separate opt-in request.

A clone or worktree is a separate project path. Run setup for that root even if
the nonsecret binding was copied: client args contain absolute paths, and a new
machine also needs its own private connection record. Reuse the binding for the
same store or use an explicit store change to give the new project another one.

Completion: runtime smoke and effective native checks pass for the selected
project, the owner sees its store name/URL, and the required new-session action
is stated. Four-project isolation is covered offline; real multi-project/client
and Windows/plugin acceptance still needs separate read-only client checks.
