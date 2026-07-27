# CLAUDE.md — yandex-kit-ai-toolkit

npm-workspaces monorepo: typed client, MCP server (stdio) and Claude agent skills for the
Yandex KIT e-commerce API, all driven by the bundled OpenAPI spec
(`specs/kit-swagger.openapi.json` — 133 operations, 21 tag groups, the single source of truth).

## Commands

```bash
npm ci
npm run typecheck   # builds core first, then checks every workspace
npm run build       # core + mcp -> dist/
npm test            # unit tests, no network (currently 156: core 27 + mcp 129)
npm run gen         # regenerate registry/types/TOOLS.md/skills (deterministic)
npm run spec:fetch  # refresh specs/ from Yandex + diff report
npm run smoke       # live READ-ONLY calls (needs YANDEX_KIT_TOKEN)
```

Verify like CI does (node 20/22/24 matrix):

```bash
npm run typecheck && npm run build && npm test
npm run gen
git add -N -- packages/core/src/generated docs/TOOLS.md skills   # register untracked generated files
git diff --exit-code -- packages/core/src/generated docs/TOOLS.md skills
YANDEX_KIT_TOKEN=dummy npx @modelcontextprotocol/inspector --cli node packages/mcp/dist/index.js --method tools/list
```

More detail in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Tool list: [docs/TOOLS.md](docs/TOOLS.md).

## Repo map

- `packages/core` — `yandex-kit-core`: `KitClient` (Bearer auth, timeout, token-bucket
  rate limiter at 3 rps, backoff retries on network/5xx/429 **and** `LIMIT_EXCEEDED`
  which arrives with HTTP 400, auto-pagination via `listAll`, per-operation content type:
  merge-patch and multipart where the spec says so), `KitApiError`, ajv-based
  `validateRequestBody`/`resolveOperationSchema`, and `src/generated/{registry.json,types.ts}`.
- `packages/mcp` — `mcp-yandex-kit`: stdio MCP server with 61 tools; `src/tools/*.ts` is
  one file per domain; `meta.ts` hosts the trio (`search_operations`,
  `get_operation_schema`, `kit_request`) that covers all 133 operations (65 have curated tools).
- `packages/codegen` — private generators run via tsx: `gen-registry`, `gen-types`,
  `gen-docs`, `gen-skills`, `fetch-spec`.
- `skills/` — 6 agent skills (yandex-kit router + catalog/orders/marketing/store/webhooks).
- `.claude-plugin/{plugin,marketplace}.json` + `.mcp.json` — Claude Code plugin
  (plugin `yandex-kit`, marketplace `yandex-kit-ai-toolkit`).

## Generated files — never hand-edit

`skills/**`, `docs/TOOLS.md` and `packages/core/src/generated/**` are outputs of
`packages/codegen`. To change them, edit the generator (`gen-skills.ts`, `gen-docs.ts`,
`gen-registry.ts`, `gen-types.ts`) and run `npm run gen`. Generation is deterministic and
CI fails on drift (`git add -N` + `git diff --exit-code`), so hand edits both break CI and
get silently overwritten by the next `gen`.

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

`0.1.0` must stay identical across: `packages/mcp/package.json` (and
`packages/core/package.json` — mcp depends on the exact version), `server.json`
(root `version` **and** `packages[].version`), `.claude-plugin/plugin.json`, and
`SKILL_VERSION` in `packages/codegen/src/gen-skills.ts` followed by `npm run gen` so every
SKILL.md `metadata.version` matches. `mcpName` in `packages/mcp/package.json` must equal
`name` in `server.json`. Release steps: [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Safety

- **No sandbox** — every call hits a live production store. `smoke` is read-only by
  design; write paths are exercised only by mocked tests. Never put a real token in CI.
