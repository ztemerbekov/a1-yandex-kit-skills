# Exact write-plan protocol

This is the shared safety core for exact writes performed by
`a1-yandex-kit-operator`, `a1-yandex-kit-catalog-doctor`,
`a1-yandex-kit-promo-launcher` and `a1-yandex-kit-launch-check`. The invoking
skill defines its accepted value sources, supported write stages,
preconditions, whole-value fields and report vocabulary. Those local rules may
narrow this protocol but never weaken it.

## Authorization gate

Proceed only from an explicit write command that supplies:

- one exact intended outcome for each requested item;
- one exact target for each requested item, or an exact target resolution rule
  defined by the invoking skill;
- every required business value, or a source the invoking skill explicitly
  accepts as authoritative.

The command authorizes only those targets, values and write stages that the
invoking skill explicitly maps to the intended outcome. If any part is missing
or ambiguous, make zero writes and ask one concrete question that names the
gap. Once the gate is satisfied, proceed without another confirmation, diff,
backup, snapshot or rollback.

## Exact target

An explicit object ID may proceed directly to its detail read. Resolve an
alternate key such as an order number, SKU, title or code only after a complete,
untruncated lookup returns exactly one match. A failed or truncated lookup
cannot prove uniqueness. Zero or multiple exact matches require an exact ID and
zero writes.

A create stage may produce the exact ID for later stages. Do not use that ID
until a detail read has confirmed the complete expected create result.

## Write plan

Before the first write, build one write plan from the invoking skill's explicit
rules. A plan contains one or more mutation stages and the dependency between
them:

- A normal exact change is a one-stage plan.
- A multi-stage plan is allowed only when the invoking skill explicitly maps
  the authorized outcome to that sequence. For example: create inactive →
  verify → bind → verify → activate → verify.
- Each stage contains one exact target, one minimal mutation and one complete
  verification state.
- A later stage may depend on an earlier stage. An independent batch item is a
  separate plan, not another stage in the same plan.

Never add an unlisted setup, cleanup, compensation or rollback stage. Never
turn several independent targets into one dependency chain.

## Per-stage protocol

Apply this sequence to every mutation stage:

1. Detail-read the exact current object and any relation required by the local
   operation. For a create stage, complete the invoking skill's target,
   duplicate and precondition reads first.
2. Check the operation-specific preconditions against those reads. An unmet or
   unverified precondition blocks this stage with zero writes.
3. Build one minimal mutation. When the API replaces an array or object, start
   from the detail-read value, change only the authorized element and preserve
   every untouched field and sibling.
4. Call the stage's write operation at most once. Never issue that mutation a
   second time after timeout, abort, network failure or any other response.
5. Detail-read the same object and every affected relation after the write
   attempt. Compare the complete expected field or state. An operation-specific
   rule may define confirmed not-found as the successful verification state for
   permanent deletion.
6. Give the stage exactly one outcome:
   - **completed** only when the write returned without error and every required
     verification matches the complete expected state;
   - **failed** for a confirmed lookup, precondition, validation or local API
     failure that is not transport-ambiguous;
   - **ambiguous** for timeout, abort, network failure, HTTP 408, HTTP 5xx, an
     unreadable verification, or a verification mismatch after a possible
     write.
7. Run a dependent stage only after every stage it depends on is **completed**.
   A **failed** or **ambiguous** stage blocks all of its dependent stages.

A successful write response without matching verification is ambiguous, not
failed or completed. Transport ambiguity takes priority even if a later read
happens to match: the write acknowledgement remains unreliable. Report
«результат неизвестен, нужна проверка» and never retry the mutation blindly.

## Plan and batch completion

A plan is **completed** only when all of its required stages are completed. If
no write stage was confirmed and the blocking stage is failed or ambiguous,
use that stage outcome for the plan.

If one or more stages were completed but a later stage failed, became ambiguous
or could not satisfy its preconditions, report the plan as **partial**. State:

- every completed stage;
- the failed or ambiguous blocking stage;
- every dependent stage that was not run;
- the exact created or changed object ID and last factually verified state.

A partial result does not authorize a retry, rollback or compensating write.

Process independent plans within the MCP/API rate limit and continue after each
local failed, ambiguous or partial result. A batch is complete only when every
requested target is accounted for. The final report states the exact counts,
identifies every target and includes its observed result or reason.
