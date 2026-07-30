# Core catalog audit

Read this reference for every Catalog Doctor audit. Apply every rule below to
every checked `PUBLISHED` or `HIDDEN` variant and every product used by those
variants.

## Variant rules

- Flag an absent, unparsable or non-positive `pricing.price`.
- Flag an absent, unparsable or non-positive `pricing.final_price`.
- Flag `manual_discount_price > price`. State the observed values without
  calculating a replacement price.
- Sum `quantity - reserved` across stocks and flag a zero or negative available
  balance.
- Flag each stock where `reserved > quantity`.
- Flag a stock that references a confirmed-missing or `ARCHIVED` warehouse. An
  unreadable warehouse lookup is a risk plus incomplete coverage, not a
  confirmed blocker. Never invent a warehouse or quantity.
- Flag no usable `IMAGE` (`type: IMAGE` with an `image_id`).
- Compare checked variants by normalized exact `slug` and exact `name`; report
  duplicate groups with every ID/SKU.
- Flag a missing `product_id` target and an absent `product_card_id`. Never infer
  a product/card relation from the variant name.

## Product and navigation rules

- Flag no active category and confirmed-missing category IDs. An unreadable
  category lookup is a risk plus incomplete coverage, not a confirmed blocker.
  State that the read-only API cannot distinguish “no category bindings” from
  “only archived bindings”, because both produce an empty
  `Product.category_ids`.
- Compare active categories by normalized exact `slug` and exact `title`; report
  duplicate groups with every ID.
- Treat a product with one active category as an archive risk: archiving that
  category can remove the only observed active path. Treat every used archived
  warehouse as a risk or blocker according to the variant status.

An omitted optional field is not an API error. Report only the consequence tied
to a loaded rule. A missing optional manual discount, category cover, SEO field
or warehouse metadata is not itself a defect in this scope.

This scope is complete only when all checked variants and their used products
have been tested against every rule above, and every category/warehouse fallback
has either resolved or remains explicitly recorded as missing evidence.
