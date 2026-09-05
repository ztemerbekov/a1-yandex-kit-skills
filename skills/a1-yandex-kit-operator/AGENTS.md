# Editing a1-yandex-kit-operator

First read the repo contract: ../../CLAUDE.md.

## What this skill must never do

- Write without an explicit owner imperative carrying an exact target, action
  and value. «Проверь», «покажи», «разбери», «найди» stay read-only; a missing
  business value (price, quantity, warehouse, webhook URL/event, reason rule)
  becomes one concrete question, never an inferred value.
- Claim clean coverage from a partial read. The review reads every order page
  up to `total_count`; a failed page turns into an exact coverage statement.
- Retry a mutation after timeout/5xx/abort — one attempt, then the
  `completed`/`failed`/`ambiguous` outcome from the shared write protocol.
- Promise operations the KIT API lacks: refunds, arbitrary order/payment/
  delivery statuses, contacting the client, detecting «непросмотренные заказы»
  (no read/unread field exists).

## What to preserve when editing

- The 8-step review workflow order and the distinction between confirmed
  findings and «Требует проверки» (promo overlap, webhook event coverage).
- Russian report vocabulary: «Текущий операционный статус» / «Срочный
  операционный срез», the Выполнено/Не выполнено/Неоднозначно counters, and
  the closing line about the missing order-view flag.
- Links to `../a1-yandex-kit/references/merchant-communication.md` and
  `references/exact-write-protocol.md`. The latter is generated from
  `packages/codegen/src/skill-src/` — edit the source and run `npm run gen`.
- `metadata.version` is bumped by hand (see CLAUDE.md «Version sync»).

## How to verify an edit

Check the edit against every criterion in
`../../docs/OPERATOR-SKILL-VERIFICATION.md` (scenario tests live in
`packages/mcp/src/scenarios/operator-skill-*.test.ts`), then run
`npm test` and `npm run validate:agent-plugin`.
