# Import approval policy

Use this branch after the store connection is proved, or when the user reports
repeated host approval prompts during catalog or content import.

The **unattended import profile** is the versioned exact-tool list owned by
`scripts/lib/approval-policy.mjs`. Read the list from the helper result; this
document never copies it. The profile covers store identity and schemas needed
by import, files and video, products and variants, categories and collections,
characteristics, and news articles. Generic `kit_request`, deletes, order
actions, promotions and store administration remain outside the profile.

## 1. Inspect

Use the managed server name returned by the connection `status` or `configure`
step:

```bash
node "<skill-directory>/scripts/setup.mjs" approval-status \
  --client <client> --server-name <managed-name> --json
```

For Cursor, first establish the installed schema and effective MCP server id
from the local Cursor build or MCP settings, then also pass:

```text
--cursor-schema <absolute-schema-path> --effective-server-id <effective-id>
```

The step is complete when the result has one stable `support` value:

- `automatic` — the helper can safely merge exact tool rules;
- `guided` — the client owns the policy in its UI;
- `unsupported` — the client cannot keep import unattended while separately
  gating dangerous tools.

## 2. Ask once

Ask after a successful store connection:

`Хотите включить «Импорт без остановок» на этом компьютере? Товары, варианты, файлы, характеристики и новости будут импортироваться без повторных Allow. Удаления, заказы, промоакции и настройки магазина останутся под подтверждением.`

`Да` authorizes one policy-config write for this client and computer. `Нет`
leaves the client's current approval behavior unchanged and completes this
branch.

## 3. Apply the supported branch

### Automatic

Run:

```bash
node "<skill-directory>/scripts/setup.mjs" approval-configure \
  --client <client> --server-name <managed-name> --json
```

Repeat the Cursor capability arguments from inspection. Preserve all unrelated
settings. A changed pre-existing file must have a backup; the file and backup
must be mode `0600` on POSIX.

Handle structured outcomes:

- `POLICY_APPLIED` — give the returned restart action and report the exact
  profile boundary.
- `POLICY_TOO_BROAD` — an existing wildcard or whole-server approval also
  permits dangerous operations. Ask whether to replace that broad rule with the
  exact import profile. On `да`, repeat with `--replace-broad`.
- `POLICY_CONFLICT` — an existing `ask` or `deny` rule is stricter. Name the
  conflict without changing it. Ask whether this exact import profile may take
  precedence; on `да`, repeat with `--replace-conflicts`.
- `POLICY_UNVERIFIED` — continue through the guided branch. A classifier hint
  or a config string without the installed schema is not success.

The helper proves the config structure, not the absence of a runtime prompt.
After the documented restart, the first real import is the behavioral check.
If it prompts, preserve the stricter client behavior and use the guided branch.

### Guided

- VS Code: open `Chat: Manage Tool Approval` and permanently pre-approve only
  the exact Yandex KIT tools returned by `approval-status`.
- Claude Desktop: on the first call of each returned import tool, choose
  `Allow always` when the client or organization offers it.

Tell the user before import that this one UI step is required. Whole-source
approval, Bypass Approvals and global auto-approve sit outside this profile.

### Unsupported

Kimi Desktop / Work, Hermes and embedded OpenClaw do not currently expose the
required host-enforced boundary. Keep prompts enabled and say so before import.
A whole-task `Full access`, server wildcard, YOLO mode or tool filter is a
different security model and is never enabled as this profile.

## Completion criterion

This branch is complete when the user sees:

- whether unattended import is automatic, guided or unsupported in this client;
- the exact business boundary of the profile;
- at most one restart or one UI action;
- any remaining prompt limitation before the import starts.
