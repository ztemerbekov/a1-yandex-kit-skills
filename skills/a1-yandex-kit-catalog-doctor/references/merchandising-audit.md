# Merchandising audit

Read this reference only when the owner explicitly asks about dynamic filters,
badges, context collections, similar cards or merchandising. It extends all
other audit references. A general request to check «мерчандайзинг» selects all
four scopes below; a narrower request selects only the named scopes.

## Coverage

- **Dynamic filters:** inspect `Collection.dynamic_filter`. Also read
  `GetBadges`, because `badge_slugs` cannot be validated without it.
- **Badge bindings:** paginate `GetBadges` with
  `query: {page: <N>, per_page: 100}`. For `SELECTED_VARIANTS`, paginate
  `GetBadgeVariantIDs` with `path_params: {badge_id: <id>}`. For
  `SELECTED_CATEGORIES_COLLECTIONS`, paginate both `GetBadgeCategoryIDs` and
  `GetBadgeCollectionIDs` with the same path parameter. Every badge-binding
  list also uses `query: {page: <N>, per_page: 100}`.
- **Context collections:** paginate `GetContextCollections` with
  `query: {page: <N>, per_page: 100}`.
- **Similar cards:** two stores exist and neither API returns the other's
  bindings, so read both for every checked card with
  `path_params: {product_card_id: <id>}`:
  - settings: `GetSimilarCardsById`. A not-found (404) means the card has no
    settings — not a defect and not a coverage gap; any other failure is a
    coverage gap. By `binding_mode`, paginate `GetSimilarCardsCardIDs` for
    `SELECTED_CARDS`, both `GetSimilarCardsCategoryIDs` and
    `GetSimilarCardsCollectionIDs` for `SELECTED_CATEGORIES_COLLECTIONS`, and
    nothing for `ALL_VARIANTS`;
  - deprecated symmetric links: paginate `GetSimilarProductCardIDs`.

  Every similar-card list uses `query: {page: <N>, per_page: 100}`.

Use the pagination, fallback and interruption rules from `audit-protocol.md`.
Absence of an optional merchandising entity is not a defect.

## Rules

- For an explicit dynamic-filter request, validate category slugs,
  characteristic slugs and badge slugs against the entities actually read.
- For an explicit badge request, validate the relation kind required by
  `binding_mode` and report unresolved variant/category/collection IDs.
- For an explicit context-collection request, validate characteristic
  conditions against the characteristic slugs actually read.
- For an explicit similar-card request, validate returned card IDs against
  checked `product_card_id` values, and settings-bound category and collection
  IDs against the categories and collections actually read; report each
  unresolved ID. A `SELECTED_CARDS` or `SELECTED_CATEGORIES_COLLECTIONS`
  setting whose fully read bindings are empty is a risk: the buyer sees no
  similar products. The report line «похожие карточки N/M» counts cards whose
  every similar-card read completed.
- No collection, badge, context collection or similar-card relation is required
  merely because the API supports it. Report only a broken fact in the requested
  scope.

This scope is complete only when every requested relationship collection has
reached its termination rule or recorded exact partial coverage, and every
returned ID has been checked against entities actually read.
