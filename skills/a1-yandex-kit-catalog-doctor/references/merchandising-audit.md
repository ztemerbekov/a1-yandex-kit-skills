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
- **Similar cards:** paginate `GetSimilarProductCardIDs` for every checked card
  with `path_params: {product_card_id: <id>}` and
  `query: {page: <N>, per_page: 100}`.

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
  checked `product_card_id` values.
- No collection, badge, context collection or similar-card relation is required
  merely because the API supports it. Report only a broken fact in the requested
  scope.

This scope is complete only when every requested relationship collection has
reached its termination rule or recorded exact partial coverage, and every
returned ID has been checked against entities actually read.
