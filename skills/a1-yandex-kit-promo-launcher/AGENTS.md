# Editing a1-yandex-kit-promo-launcher

First read the repo contract: ../../CLAUDE.md.

## What this skill must never do

- Infer a business condition: «бессрочно», «без лимита», a time zone, a scope,
  a value or an active/inactive state come only from the owner. An ambiguous
  launch («Запусти акцию 15%») asks one grouped question and writes nothing.
- Duplicate an equivalent promotion — return the existing ID instead.
- Mix variants with categories/collections in one binding request, or bind
  anything but variants to a gift; gifts also accept no action dates.
- Retry a mutation after timeout/5xx, or run a dependent stage (bind,
  activate) before the previous stage's verification read matches.
- Delete a gift for anything but the exact phrase «удали навсегда»; add
  backups, snapshots, rollbacks or a second confirmation.

## What to preserve when editing

- The dependent-stage plan for selected scopes: create `INACTIVE` → verify →
  bind → verify object IDs → activate → verify. One precise imperative
  authorizes the whole sequence without another confirmation.
- Documented API defaults are reported, not invented: `0.00`/`false` for
  optional promocode fields, `POPULARITY` for gift sort.
- Gift meta-writes go `get_operation_schema` → validate → one `kit_request`.
- `references/exact-write-protocol.md` is generated from
  `packages/codegen/src/skill-src/` — edit the source and run `npm run gen`.
- The `../a1-yandex-kit/references/merchant-communication.md` link and the
  support-footer rules; `metadata.version` is bumped by hand.

## How to verify an edit

Check the edit against every criterion in
`../../docs/PROMO-LAUNCHER-SKILL-VERIFICATION.md` (scenario tests live in
`packages/mcp/src/scenarios/promo-launcher-skill-*.test.ts`), then run
`npm test` and `npm run validate:agent-plugin`.
