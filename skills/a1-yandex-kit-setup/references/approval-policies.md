# Yandex KIT server wildcard

Use this branch after the store connection is proved, or when the user reports
repeated host approval prompts for Yandex KIT tools.

The **server wildcard** grants the managed Yandex KIT MCP server every current
and future tool without another host-level Allow. It includes reads, imports,
`kit_request`, deletes, order actions, promotions and store administration.
This changes host execution only: working skills still require the user's exact
request before a store write.

`scripts/lib/approval-policy.mjs` owns the machine contract. This document owns
the agent sequence and never copies a tool list.

## 1. Inspect

Use the managed server name returned by connection `status` or `configure`:

```bash
node "<skill-directory>/scripts/setup.mjs" approval-status \
  --client <client> --server-name <managed-name> --json
```

For Cursor, establish the installed schema and effective MCP server id, then
also pass:

```text
--cursor-schema <absolute-schema-path> --effective-server-id <effective-id>
```

The step is complete when the result has one stable `support` value:

- `automatic` — the helper can write and verify a server wildcard;
- `guided` — the client may expose permanent server trust only in its UI;
- `unsupported` — the client has no verified server-scoped wildcard.

## 2. Ask once

Ask exactly once before the config write:

`Включить «Работу без остановок» для Yandex KIT на этом компьютере? Это навсегда разрешит агенту вызывать все текущие и будущие инструменты Yandex KIT без кнопки Allow — включая удаление, заказы, скидки и настройки магазина. Рабочие навыки по-прежнему меняют магазин только по вашей точной команде.`

`Да` authorizes the server-wildcard config write on this computer. `Нет` keeps
the current host approval behavior and completes this branch. Do not split this
consent into per-tool questions.

## 3. Apply

### Automatic

Run:

```bash
node "<skill-directory>/scripts/setup.mjs" approval-configure \
  --client <client> --server-name <managed-name> --json
```

Repeat Cursor's schema and effective-id arguments. Preserve unrelated settings.
A changed pre-existing file must have a backup; the file and backup must be mode
`0600` on POSIX.

Handle structured outcomes:

- `POLICY_APPLIED` — give the returned restart action and state that the grant
  covers current and future Yandex KIT tools.
- `POLICY_CONFLICT` — a broader client or organization rule still overrides the
  server wildcard. Name the blocking rule and keep the client's prompt behavior.
- `POLICY_UNVERIFIED` — continue through the guided branch. A classifier hint or
  unvalidated config string is not success.

The automatic contract is:

- Claude Code: `mcp__<managed-server>__*` in `permissions.allow`;
- Cursor: `<effective-id>:*` and its `user-` alias in `mcpAllowlist`;
- Codex: `default_tools_approval_mode = "approve"` for the managed server;
- Kimi Code: the first matching managed-server rule is
  `mcp__<managed-server>__*` with `decision = "allow"`.

The helper proves config structure. After the documented restart, one real
Yandex KIT call is the behavioral check.

### Guided

In VS Code or Claude Desktop, select permanent trust for the entire Yandex KIT
server only when the installed UI offers that exact scope. Per-tool `Allow
always` is not completion because a newly added tool will prompt again. If the
UI has no server scope, report the client as unsupported for future-proof
wildcard access and keep its prompts.

### Unsupported

Kimi Desktop / Work, Hermes and embedded OpenClaw do not expose a verified
server-scoped wildcard. Keep their current behavior and say so before work
starts. A global Full access or YOLO mode affects more than Yandex KIT and is not
this setup branch.

## Completion criterion

For an automatic client, this branch is complete only when the helper reports
`configured: true`, `scope: "server"`, `tools: ["*"]`,
`includesFutureTools: true`, and `structuralVerified: true`; the user has the
single restart action; and the first post-restart Yandex KIT call no longer
shows Allow. Guided and unsupported clients are complete only after their
remaining limitation is stated before work begins.
