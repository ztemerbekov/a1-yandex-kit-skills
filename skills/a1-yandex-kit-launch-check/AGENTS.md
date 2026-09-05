# Editing a1-yandex-kit-launch-check

First read the repo contract: ../../CLAUDE.md.

## What this skill must never do

- Write during the default check: «проверь», «покажи», «что мешает», «можно
  запускать» never call a write tool, and a finding never authorizes a fix.
- Create, confirm or pay a test order; checkout evidence comes only from an
  owner-provided order ID or an explicit owner statement.
- Return `READY` from the API-only workflow — that requires complete API
  coverage, a factually reachable storefront and sufficient checkout evidence.
  The presence of `b2c_url` in the API is never proof the storefront opens.
- Turn an unknown fact into a clean result: a failed or stopped page makes
  coverage incomplete and forbids a clean conclusion.

## What to preserve when editing

- The status vocabulary with its Russian labels: `NOT_READY` only for a proven
  blocker, `CONDITIONALLY_READY` as the cap without web + checkout evidence.
- The report sections Блокеры / Риски / Не проверено / Рекомендации /
  Следующие действия, and the explicit statement that KIT API does not expose
  payment/delivery settings.
- Web-check semantics: adapter boundary, 2xx/3xx entry point plus at least one
  discovered same-origin page (up to three checked) for `AVAILABLE`.
- Fix reruns retain already collected web and checkout evidence; fixes route
  through operator/catalog-doctor and promo-launcher semantics.
- `references/exact-write-protocol.md` is generated from
  `packages/codegen/src/skill-src/` — edit the source and run `npm run gen`.
- `metadata.version` is bumped by hand (see CLAUDE.md «Version sync»).

## How to verify an edit

Check the edit against every criterion in
`../../docs/LAUNCH-CHECK-SKILL-VERIFICATION.md` (scenario tests live in
`packages/mcp/src/scenarios/launch-check-skill-*.test.ts`), then run
`npm test` and `npm run validate:agent-plugin`.
