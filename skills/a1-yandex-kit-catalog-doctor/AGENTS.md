# Editing a1-yandex-kit-catalog-doctor

First read the repo contract: ../../CLAUDE.md.

## What this skill must never do

- Mutate anything on the audit route. Audits, inspections and «найди проблемы»
  are strictly read-only; a finding or recommendation never authorizes a fix —
  only an explicit owner command with an exact target, operation and value does.
- Use `all: true` in audits — explicit `page`/`per_page: 100` until
  `total_count`, so a convenience cap cannot hide entities.
- Promote an unread reference to a confirmed blocker: a failed
  `get_product`/`get_category`/`get_warehouse` stays a coverage risk.
- Retry a mutation after timeout/5xx — one attempt, then an ambiguous outcome.

## What to preserve when editing

- The two-route structure (read-only audit vs exact catalog fix) and the
  reference-loading order: `audit-protocol.md` + `core-catalog-audit.md`
  always, scope references (`structural-audit.md`, `merchandising-audit.md`,
  `catalog-fix-operations.md`) only when the request selects them.
- The Блокеры / Риски / Рекомендации classification and the explicit
  «Покрытие» / «Страниц» coverage lines in reports.
- The read → one write → re-read cycle with full preserved arrays (sibling
  warehouses, `reserved`, sibling media) on the fix route.
- `references/exact-write-protocol.md` is generated from
  `packages/codegen/src/skill-src/` — edit the source and run `npm run gen`;
  an identical-copy test compares every consumer skill's copy.
- `metadata.version` is bumped by hand (see CLAUDE.md «Version sync»).

## How to verify an edit

Check the edit against every criterion in
`../../docs/CATALOG-DOCTOR-SKILL-VERIFICATION.md` (scenario tests live in
`packages/mcp/src/scenarios/catalog-doctor-skill-*.test.ts`), then run
`npm test` and `npm run validate:agent-plugin`.
