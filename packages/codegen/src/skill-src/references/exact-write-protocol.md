# Exact-write protocol

This is the shared safety core for exact writes performed by
`a1-yandex-kit-operator` and `a1-yandex-kit-catalog-doctor`. The invoking skill
defines its accepted value sources, supported operations, preconditions,
whole-value fields and report vocabulary. Those local rules may narrow this
protocol but never weaken it.

## Authorization gate

Proceed only from an explicit write command that supplies:

- one exact operation;
- one exact target for each requested item;
- every required business value, or a source the invoking skill explicitly
  accepts as authoritative.

The command authorizes exactly those targets, operations and values. If any
part is missing or ambiguous, make zero writes and ask one concrete question
that names the gap. Once the gate is satisfied, proceed without another
confirmation, diff, backup, snapshot or rollback.

## Exact target

An explicit object ID may proceed directly to its detail read. Resolve an
alternate key such as an order number, SKU, title or code only after a complete,
untruncated lookup returns exactly one match. A failed or truncated lookup
cannot prove uniqueness. Zero or multiple exact matches require an exact ID and
zero writes.

## Per-object protocol

Apply this sequence independently to every target, including every batch item:

1. Detail-read the exact current object. A failed read is a failed outcome with
   zero writes.
2. Check the operation-specific preconditions against that detail read. An
   unmet or unverified precondition is a failed outcome with zero writes.
3. Build one minimal mutation. When the API replaces an array or object, start
   from the detail-read value, change only the authorized element and preserve
   every untouched field and sibling.
4. Call exactly one write operation. Never issue a second mutation for that
   target after timeout, abort, network failure or any other response.
5. Detail-read the same object after the write attempt and compare the complete
   expected field or state. An operation-specific rule may define confirmed
   not-found as the successful verification state for permanent deletion.
6. Give the target exactly one final outcome:
   - **completed** only when the write returned without error and the verification
     read matches the complete expected state;
   - **failed** for a confirmed lookup, precondition, validation or local API
     failure that is not transport-ambiguous;
   - **ambiguous** for timeout, abort, network failure, HTTP 408, HTTP 5xx, an
     unreadable verification, or a verification mismatch after a possible write.

A successful write response without matching verification is ambiguous, not
completed. Transport ambiguity takes priority even if a later read happens to
match: the write acknowledgement remains unreliable. Report
«результат неизвестен, нужна проверка» and never retry the mutation blindly.

## Batch completion

Process targets independently and within the MCP/API rate limit. Continue after
each local failed or ambiguous outcome, retain one outcome for every requested
target, and never let one target trigger another target's mutation.

A batch is complete only when every requested target is accounted for as
completed, failed or ambiguous. The final report states the exact counts,
identifies every target and includes the observed result or reason.
