# Проверка скилла `a1-yandex-kit-promo-launcher`

## Контракт автоматизированных сценариев

`packages/mcp/src/scenarios/promo-launcher-skill-scenario.ts` расширяет существующий
P0 fake MCP через `FakeP1Mcp`: состояние заказов, каталога, скидок, промокодов и
вебхуков делегируется `FakeOperatorMcp`, а P1-сущности используют тот же журнал
инструментов, управляемые ошибки и изменяемое состояние.

`promo-launcher-skill-scenario.test.ts` проверяет внешнее поведение: запрос владельца,
последовательность и аргументы MCP-вызовов, отсутствие лишних записей, итоговое
состояние и классификацию результата. Тест не зависит от внутренних функций
reference model и не сравнивает ответ посимвольно.

## Issue #14

| User story / критерий | Evidence | Result |
| --- | --- | --- |
| Устанавливаемый model-invoked skill и естественный триггер | `an exact category discount reads the target, writes once per step, and re-reads the result`; `skills/a1-yandex-kit-promo-launcher/SKILL.md` | автоматизировано |
| Точная скидка на категорию; относительные даты переведены из Москвы в UTC | `an exact category discount reads the target, writes once per step, and re-reads the result` | автоматизировано |
| Режим всего каталога и явная бессрочность | `an exact perpetual all-catalog discount needs no binding write` | автоматизировано |
| Неоднозначная акция задаёт один сгруппированный вопрос и не пишет | `an ambiguous promotion asks one grouped question and performs no write` | автоматизировано |
| Неизвестный часовой пояс не додумывается | `relative dates without a known time zone stop before target reads or writes` | автоматизировано |
| Отсутствующий срок не превращается в бессрочность | `an omitted end date is never interpreted as perpetual` | автоматизировано |
| Архивная/непригодная цель отсекается до записи | `an archived target is read and rejected before duplicate checks or writes` | автоматизировано |
| Эквивалентная команда не создаёт дубль | `an equivalent discount is returned instead of duplicated` | автоматизировано |
| Пересечение отражается как риск, но не блокирует точную команду | `an overlap is reported as a risk but does not block an exact command` | автоматизировано |
| Timeout мутации не вызывает повтор | `a create timeout is attempted once and remains ambiguous` | автоматизировано |
| Категории/коллекции не смешиваются с вариантами в одном запросе | Отдельные ветви `bindingObjects` и контракт в `SKILL.md`; аргументы category tracer | полуавтоматизировано |
| Естественность сгруппированного вопроса и итогового отчёта | Прогон трёх формулировок в реальном model host с проверкой по журналу fake MCP | manual acceptance pending |

## Issue #15

| User story / критерий | Evidence | Result |
| --- | --- | --- |
| Ограниченный `ORDER` промокод с точными условиями создаётся, активируется один раз и перечитывается | `an exact limited ORDER promocode is created, activated once, and re-read` | автоматизировано |
| `PRODUCTS` промокод проверяет категорию, привязывает её и остаётся неактивным по команде | `a PRODUCTS promocode validates and binds a category without an activation write` | автоматизировано |
| Товарные связи не отправляются для `ORDER` | Проверка отсутствия `manage_promocode_objects` в ORDER tracer | автоматизировано |
| Отсутствующий usage limit не превращается в «без лимита» | `a promocode without a usage limit or explicit unlimited choice performs no read or write` | автоматизировано |
| Конфликт существующего кода требует выбора и не пишет | `a conflicting existing code asks whether to update or choose a new code` | автоматизировано |
| Эквивалентный повтор не создаёт дубль | `an equivalent promocode command returns the existing code without a duplicate` | автоматизировано |
| Документированные API-дефолты передаются и перечисляются | Проверки `minimum_order_amount`, `first_order_only`, `one_time_use`, `show_in_pdp` в ORDER/PRODUCTS tracers | автоматизировано |
| Timeout создания не ретраится | `a promocode create timeout is never retried` | автоматизировано |
| Ясность вопроса о конфликте и итогового отчёта | Запуск ORDER и PRODUCTS формулировок в model host, сверка с fake MCP | manual acceptance pending |

## Issue #16

| User story / критерий | Evidence | Result |
| --- | --- | --- |
| Активный подарок проверяет варианты и OpenAPI schema, создаётся один раз, активируется и перечитывается | `an exact active gift validates variants and schema, creates once, activates, and re-reads` | автоматизировано |
| Неактивный черновик не вызывает активацию и сообщает default sort | `an inactive gift draft keeps the documented POPULARITY default and skips activation` | автоматизировано |
| Ограничение 1–50 вариантов применяется до чтений и записей | `a gift with more than 50 variants is rejected before target reads` | автоматизировано |
| Отсутствующий вариант не передаётся в CreateGift | `a missing gift variant prevents CreateGift` | автоматизировано |
| Даты подарка не обещаются и не превращаются в ложное расписание | `a dated gift explains the API limitation and creates no false schedule` | автоматизировано |
| Meta-write предварён чтением схемы CreateGift | Аргументы и порядок `get_operation_schema` → `kit_request` в active gift tracer | автоматизировано |
| Timeout CreateGift не повторяется и не запускает активацию | `a CreateGift timeout is attempted once and never followed by activation` | автоматизировано |
| Естественность объяснения API-ограничения и итогового отчёта | Запуск active/draft/dated формулировок в model host | manual acceptance pending |

Запуск:

```bash
node --import tsx --test packages/mcp/src/scenarios/promo-launcher-skill-scenario.test.ts
```
