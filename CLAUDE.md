# CLAUDE.md — a1-yandex-kit-skills

npm-workspaces monorepo: typed client, MCP server (stdio) and Claude agent skills for the
Yandex KIT e-commerce API, all driven by the bundled OpenAPI spec
(`specs/kit-swagger.openapi.json` — 162 operations, 24 tag groups, the single source of truth).

## Commands

```bash
npm ci
npm run typecheck   # builds core first, then checks every workspace
npm run build       # core + mcp -> dist/
npm test            # unit tests, no network (currently 422: core 37 + codegen 7 + mcp 336 + setup 42)
npm run gen         # regenerate registry/types/TOOLS.md/skills (deterministic)
npm run validate:agent-plugin # validate root Agent Plugins manifest, MCP config and skills
npm run spec:fetch  # refresh specs/ from Yandex + diff report
npm run smoke       # live READ-ONLY calls (needs YANDEX_KIT_TOKEN)
npm run e2e         # live WRITE calls — TEST store only (needs YANDEX_KIT_E2E_WRITE=1)
```

Verify like CI does (node 20/22/24 matrix):

```bash
npm run typecheck && npm run build && npm test
npm run gen
git add -N -- packages/core/src/generated docs/TOOLS.md skills   # register untracked generated files
git diff --exit-code -- packages/core/src/generated docs/TOOLS.md skills
npx @modelcontextprotocol/inspector@2 --cli node packages/mcp/dist/index.js --method tools/list -e YANDEX_KIT_TOKEN=dummy
```

More detail in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Tool list: [docs/TOOLS.md](docs/TOOLS.md).

## Repo map

- `packages/core` — `yandex-kit-core`: `KitClient` (Bearer auth, timeout, token-bucket
  rate limiter at 3 rps, backoff retries on network/5xx/429 (the live limiter answers
  429 with a plain-text `limited` body, no Retry-After) **and** `LIMIT_EXCEEDED`
  which arrives with HTTP 400 — **GET only**: mutations always make exactly one
  network attempt (no idempotency contract from the API, a repeated write could
  duplicate the change), auto-pagination via `listAll`, per-operation content type:
  merge-patch and multipart where the spec says so), `KitApiError`, ajv-based
  `validateRequestBody`/`resolveOperationSchema`, and `src/generated/{registry.json,types.ts}`.
- `packages/mcp` — `mcp-yandex-kit`: stdio MCP server with 84 tools; `src/tools/*.ts` is
  one file per domain; `meta.ts` hosts the trio (`search_operations`,
  `get_operation_schema`, `kit_request`) that covers all 162 operations (88 have curated tools).
  `telemetry.ts` — anonymous usage pings to usage.gistrec.cloud (ids/names/versions only,
  never data or arguments; fire-and-forget, must never block or throw; opt-out
  `YANDEX_KIT_TELEMETRY=0`). `startup_failed` is the exception: `sendBlocking` awaits it,
  because the caller exits right after and a fire-and-forget ping would die in flight.
  Its `reason` is a closed vocabulary (`missing_token`, `invalid_config`) — never a
  variable's name or value.
- `packages/codegen` — private generators run via tsx: `gen-registry`, `gen-types`,
  `gen-docs`, `gen-skills`, `fetch-spec`, plus the offline Agent Plugins validator.
- `skills/` — 6 generated API skills plus setup and the manually maintained
  operator, catalog-doctor, promo-launcher and launch-check scenarios.
  Each manual scenario skill records its editing invariants in `skills/<name>/AGENTS.md`.
- `plugin.json` + `mcp.json` — portable Agent Plugins package; `mcp.json` deliberately
  contains no store token.
- `.codex-plugin/`, `.cursor-plugin/`, `.claude-plugin/`, `.agents/` and `.mcp.json` —
  client-specific or compatibility artifacts retained alongside the portable core.

## Generated files — never hand-edit

The six API-reference skill directories, `docs/TOOLS.md` and
`packages/core/src/generated/**` are outputs of
`packages/codegen`. To change them, edit the generator (`gen-skills.ts`, `gen-docs.ts`,
`gen-registry.ts`, `gen-types.ts`) and run `npm run gen`. Generation is deterministic and
CI fails on drift (`git add -N` + `git diff --exit-code`), so hand edits both break CI and
get silently overwritten by the next `gen`.

`skills/a1-yandex-kit-setup/`, `skills/a1-yandex-kit-operator/`,
`skills/a1-yandex-kit-catalog-doctor/`, `skills/a1-yandex-kit-promo-launcher/` and
`skills/a1-yandex-kit-launch-check/` are manual top-level skills. `gen-skills.ts`
only replaces the six directories it owns and must preserve these five.

## Adding a curated tool

1. Add (or extend) `packages/mcp/src/tools/<domain>.ts` exporting
   `register<Name>Tools(server, client)`.
2. Import and call it in `packages/mcp/src/index.ts`.
3. Colocated `<domain>.test.ts`: connect a client over
   `InMemoryTransport.createLinkedPair()` and pass a recording fetch stub as `fetchImpl`
   to `KitClient` — assert on the captured URL/method/body, zero network.
4. `npm run gen` — `docs/TOOLS.md` (tool tables + the curated-coverage section) is
   regenerated from the registered tools; commit the regenerated files.
5. `npm run typecheck && npm test`.

## Conventions (do not break)

- **inputSchema is a zod ZodRawShape** with `.describe()` on every field — that text is
  the consumer LLM's only documentation. Runtime guidance (one-time webhook secret,
  merge-patch semantics, archive vs delete) belongs in tool descriptions, not this file.
- **Reads return `ok()`** — compact JSON, no pretty-printing (tokens). Errors go through
  `fail()`, which maps `KitApiError` to `{error, code, status, traceId}`.
- **Annotations from `util.ts`:** read-only tools get `READ_ONLY`; irreversible deletes
  get `DESTRUCTIVE`.
- **Write tools call `validateRequestBody(operationId, body)` before the API call** so
  invalid bodies never reach the network, and **reject empty update bodies** before any
  call (see `update_product`/`update_variant` tests).
- **Pagination:** `per_page` clamps via `clampPerPage` (max 100); `all=true` goes through
  the client's `listAll`.
- **stdout belongs to the stdio transport** — diagnostics via `console.error` only.
- **Language:** agent-facing text (tool descriptions, SKILL.md) is English; human docs
  (README, docs/) are Russian.

## Version sync (bump together, one commit)

Keep MCP release versions aligned across `packages/mcp/package.json`,
`packages/core/package.json` (mcp depends on the exact version), and `server.json`
(root `version` **and** `packages[].version`). Keep plugin and skill release versions
aligned across `plugin.json`, `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`, and
`SKILL_VERSION` in `packages/codegen/src/gen-skills.ts`; then run `npm run gen` so every
SKILL.md `metadata.version` matches (the four manual scenario skills are bumped by hand).
`mcpName` in `packages/mcp/package.json` must equal `name` in `server.json`.
Release steps: [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Safety

- **No sandbox** — every call hits a live production store. `smoke` is read-only by
  design; write paths are exercised by mocked tests and by `npm run e2e`, which is
  gated behind `YANDEX_KIT_E2E_WRITE=1` and must only ever get a TEST store token:
  created products cannot be deleted (the API has no such operation). CI (PRs and
  pushes to main) runs e2e with the `YANDEX_KIT_TOKEN` secret — that secret must
  hold the TEST store token, never a production one.

## Agent skills

### Issue tracker

GitHub Issues are the issue tracker for this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical triage labels are used. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a multi-context domain-doc layout. See `docs/agents/domain.md`.
