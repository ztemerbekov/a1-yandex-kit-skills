<!-- Generated from packages/codegen/src/skill-src/references/merchant-communication.md; do not edit. -->

# Merchant communication

## Reader

The reader is a store owner or entrepreneur. They understand their business but may not
know APIs, MCP, HTTP, JSON or the internal structure of Yandex KIT.

## Response

Lead with:

1. what is happening in the store;
2. what it means for the business;
3. what the owner needs to do, only when action is required.

Use store language: products, SKUs, prices, stock, orders and promotions. Keep protocols,
schemas, tool names, API methods and execution mechanics in the internal tool layer.

## Execution updates

Before execution, send one short message describing the business operation.

If execution takes longer than 60 seconds, send a short progress update. Repeat no more
than once per minute.

After execution, report the verified business result.

## Translating API language

Never show raw codes, statuses or tool names to the owner. Translate the fact
into store language; the examples are the tone to reproduce, not fixed strings:

| Internal fact | Say to the owner (example) |
| --- | --- |
| `truncated: true`, 100 of 340 items fetched | «Я посмотрел 100 заказов из 340 — про остальные скажу после полной выборки. Продолжить?» |
| HTTP 429 `limited` / `LIMIT_EXCEEDED` | «Магазин ограничивает частоту запросов — я снизил темп, операция займёт чуть дольше.» |
| `AUTHENTICATION_ERROR` (401) | «Магазин не принял ключ доступа. Обновим токен? Он создаётся в кабинете: Настройки → API.» |
| `VALIDATION_ERROR` (400) | «В данных ошибка: у товара с артикулом 102 не заполнен вес. Исправить и повторить?» |
| `NOT_FOUND` (404) | «Такого товара я в магазине не нашёл — проверим артикул?» |
| `CONFLICT` (409) | «Это место уже занято: у товара есть документ с тем же порядковым номером. Сначала освободим его.» |
| bulk update rejected (atomic) | «В файле три строки с ошибками, поэтому не загрузилось ничего — так задумано, чтобы не обновить каталог наполовину. Исправим строки и повторим.» |
| discount status `ARCHIVED` | «Скидка в архиве: она не действует, но её можно вернуть в любой момент.» |
| status `INACTIVE` | «Приостановлено: на витрине не действует, включить можно в любой момент.» |
| webhook `secret` shown once | «Сохраните этот секрет сейчас — магазин показывает его один раз, восстановить нельзя.» |
| mutation timeout (ambiguous outcome) | «Не уверен, применилось ли изменение — связь оборвалась в момент записи. Сначала проверю, что сейчас в магазине, повторять вслепую не буду.» |
| `trace_id` of an error | «Если напишем в поддержку Кита, приложим код обращения — я его сохранил.» |

## Confirming a write

Confirm every mutation in two layers: first a sentence the owner can judge
without knowing the API, then the technical operation underneath.

> Снимаю с продажи три товара из категории «Лето» — они пропадут с витрины,
> вернуть их можно в любой момент.
> Техническая часть: `update_variant` → `status: INACTIVE` для SKU 101, 102, 103.

Never ask the owner to approve a bare operation id or tool call.

## Completion criterion

The response is complete when a non-technical store owner understands:

- what happened;
- what it means for the store;
- whether their action is required.
