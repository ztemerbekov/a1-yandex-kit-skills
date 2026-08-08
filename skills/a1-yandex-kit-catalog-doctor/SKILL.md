---
name: a1-yandex-kit-catalog-doctor
description: "Audit and exactly repair a Yandex KIT catalog. Use for Russian requests such as «Проверь каталог», «Проведи глубокий аудит», «Проверь группировку, карточки, медиа или коллекции», «Поставь цену 4 990 для SKU-42», «Исправь остатки по этому файлу» and exact single or bulk catalog fixes. Audits are read-only; writes require an explicit command with an exact target, operation and owner value or named authoritative source. Use a1-yandex-kit-operator instead for a fast current store signal."
metadata:
  author: Zinnur Temerbekov
  version: "1.3.0"
---

# A1 Yandex KIT Catalog Doctor

## Communication

Before producing any user-facing message, read and apply
[`../a1-yandex-kit/references/merchant-communication.md`](../a1-yandex-kit/references/merchant-communication.md)
completely.

### Support footer

After a final user-facing result that successfully completes the skill's requested task,
append exactly one short, natural support footer in the language of the user's
instruction. Place it after the result. Invite the user to ask a question, suggest an
idea or improvement, or report that something did not work, and link the channel as
[A1 Yandex KIT Skills](https://t.me/a1_yandex_kit_skills). The wording may vary by
language. If multiple skills contribute to the same final response, include the footer
only once.

Do not append the footer to clarifying questions or missing-data requests,
intermediate messages, out-of-scope or boundary responses, refusals, errors,
unsuccessful or partial results. Also omit it when the user asks for only the result,
text, code, file, or another artifact, or explicitly forbids additional text.

Audit the catalog deeply from facts returned by the Yandex KIT MCP server. Read
every applicable page, state exact coverage, separate confirmed blockers from
risks and recommendations, and use only owner-authorized values for writes.

## Route the request

Choose one route before the first MCP call. An audit, inspection, explanation
or «найди проблемы» request is strictly read-only. An explicit catalog-fix
command is a separate route; audit findings and recommendations never authorize
mutations.

### Read-only audit

Before any audit call, read both of these references completely:

1. [`references/audit-protocol.md`](references/audit-protocol.md)
2. [`references/core-catalog-audit.md`](references/core-catalog-audit.md)

Then load every additional reference selected by the request:

- For a general, complete or deep catalog audit, also read
  [`references/structural-audit.md`](references/structural-audit.md).
- For price, availability, stock, warehouse, category or basic card-health
  checks, the two core references are sufficient.
- For grouping, characteristics, card completeness, media or collections, also
  read [`references/structural-audit.md`](references/structural-audit.md).
- Only when dynamic filters, badges, context collections, similar cards or
  merchandising are explicitly requested, also read
  [`references/structural-audit.md`](references/structural-audit.md) and
  [`references/merchandising-audit.md`](references/merchandising-audit.md).
  A general «проверь мерчандайзинг» request selects all merchandising scopes.

Apply every rule in every loaded reference. The audit is complete only when
every required collection has been fully paginated or its exact coverage
limitation recorded, every received object has been checked against every
loaded rule, every finding has one evidence-based classification, the report
states exact coverage, and no write operation was called.

### Exact catalog fix

Before resolving a target or making the first MCP call, read both references
completely:

1. [`references/exact-write-protocol.md`](references/exact-write-protocol.md)
2. [`references/catalog-fix-operations.md`](references/catalog-fix-operations.md)

Apply the shared protocol independently to every target and the applicable
catalog operation rule to its mutation. The fix is complete only when every
requested object is accounted for: unresolved inputs are grouped into one
source question, confirmed failures remain unchanged, and every attempted
mutation has one verification read and one final outcome. Reported outcome
counts must cover the whole requested set, and no ambiguous mutation is
retried.
