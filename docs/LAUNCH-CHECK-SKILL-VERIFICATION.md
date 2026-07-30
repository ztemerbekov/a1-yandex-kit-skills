# Проверка скилла `a1-yandex-kit-launch-check`

## Контракт автоматизированных сценариев

`packages/mcp/src/scenarios/launch-check-skill-scenario.ts` использует общий
`FakeP1Mcp`, который расширяет P0 fake MCP. Сценарии подают только запрос владельца,
подготовленное состояние магазина и применимость внешней обработки заказов; проверки
наблюдают журнал вызовов, покрытие, статус и факты отчёта.

## Issue #17

| User story / критерий | Evidence | Result |
| --- | --- | --- |
| Устанавливаемый model-invoked skill и естественные триггеры | `a healthy API slice is conditionally ready, fully covered, and read-only`; `skills/a1-yandex-kit-launch-check/SKILL.md` | автоматизировано |
| Доступ к API и магазин проверяются, но наличие b2c URL не подменяет web-проверку | `a critical store read failure is a blocker but does not stop independent sections`; healthy scenario | автоматизировано |
| Здоровый API-срез не поднимается выше `CONDITIONALLY_READY` без витрины и checkout | `a healthy API slice is conditionally ready, fully covered, and read-only` | автоматизировано |
| Полное покрытие продуктов, вариантов, категорий, складов и активных подарков с количеством страниц | `launch check follows every catalog page and reports the complete coverage`; `active gifts use nested query pagination and preserve complete coverage` | автоматизировано |
| Критический каталог и доказательства по точным SKU/ID | `proven first-sale catalog blockers produce NOT_READY with exact object evidence` | автоматизировано |
| Публичный URL не считается доказательством доступности | Healthy scenario оставляет витрину в «Не проверено» | автоматизировано |
| Отсутствие промо не блокирует | Healthy scenario с пустыми discounts/promocodes/gifts | автоматизировано |
| Истёкшие, исчерпанные и пустые selected-промо остаются видимыми рисками | `expired, exhausted, and empty selected promotions remain factual launch risks` | автоматизировано |
| Вебхуки блокируют только при явной внешней обработке заказов | `webhooks block only when external order processing explicitly requires them` | автоматизировано |
| Пустая история заказов — отсутствие checkout evidence, не ошибка | Healthy scenario и отдельная строка «Не проверено» | автоматизировано |
| Обрыв пагинации запрещает полное покрытие и чистый вывод | `an interrupted catalog page stays visible and can never produce full readiness` | автоматизировано |
| Ошибка критического чтения не останавливает независимые проверки | `a critical store read failure is a blocker but does not stop independent sections` | автоматизировано |
| Статус и обязательные разделы отчёта вычисляются автоматически | Все scenario evals проверяют `status`, факты, покрытие и разделы отчёта | автоматизировано |
| Все API-only сценарии read-only | `FakeP1Mcp.writeCalls` | автоматизировано |
| Естественность приоритизации и отчёта | Прогон сценариев в model host с ручной рубрикой | manual acceptance pending |

## Issue #19

| User story / критерий | Evidence | Result |
| --- | --- | --- |
| Обычные check/show запросы остаются read-only | `ordinary launch-check requests stay read-only through the fix-capable skill` | автоматизировано |
| Точный остаток использует catalog/operator read-write-read и пересчитывает готовность | `an exact stock fix preserves sibling arrays and recomputes launch readiness` | автоматизировано |
| Точный promo-fix переиспользует lifecycle semantics и убирает фактический риск | `an exact promotion fix reuses lifecycle semantics and removes the factual risk` | автоматизировано |
| Неизвестная цена группируется в конкретный вопрос без записи | `an unknown price becomes one concrete question and never authorizes a write` | автоматизировано |
| «Исправь всё» применяет только известные действия и одним вопросом собирает неизвестные | `'Исправь всё' applies known fixes, groups unknown decisions, and reruns the check` | автоматизировано |
| Соседние stocks/media/categories/characteristics сохраняются | Полный `stocks` patch и state assertions в exact stock scenario | автоматизировано |
| Batch продолжает работу после локальной ошибки и timeout | `a batch continues after failure and timeout and keeps every outcome visible` | автоматизировано |
| Timeout не повторяет mutation и остаётся неоднозначным | Один `update_variant` на объект и outcome assertions в partial batch | автоматизировано |
| Backup/snapshot/restore/rollback и повторное подтверждение не создаются | Tool-journal assertions во всех mutation scenarios; контракт `SKILL.md` | автоматизировано |
| После исправлений launch-check перечитывается; checkout gaps остаются видимыми | Exact stock/promo/mixed/batch scenarios проверяют новый `launch.status` и «Не проверено» | автоматизировано |
| Ясность fix-отчёта и сгруппированного вопроса | Прогон exact/mixed/partial формулировок в model host | manual acceptance pending |

## Issue #20

| User story / критерий | Evidence | Result |
| --- | --- | --- |
| При доступном web/HTTP фактически запрашивается b2c URL | `an inaccessible public storefront is a proven blocker and NOT_READY`; available storefront scenarios | автоматизировано |
| Недоступная витрина — доказанный блокер и `NOT_READY` | `an inaccessible public storefront is a proven blocker and NOT_READY` | автоматизировано |
| Отсутствующий web-инструмент оставляет витрину непроверенной и ограничивает статус | `an absent web capability leaves the storefront unverified and caps readiness` | автоматизировано |
| Доступная витрина без checkout остаётся `CONDITIONALLY_READY` | `an available storefront without checkout evidence remains conditionally ready` | автоматизировано |
| Ограничение API по настройкам оплаты/доставки остаётся видимым | Assertions в available/no-checkout и order evidence reports | автоматизировано |
| Скилл не создаёт, не подтверждает и не оплачивает тестовый заказ | Write-journal assertions во всех web/checkout scenarios | автоматизировано |
| ID тестового заказа читается и даёт проверяемые order/payment/delivery statuses | `a paid test order is read by ID and can provide sufficient checkout evidence` | автоматизировано |
| Ручное подтверждение маркируется как owner-provided, не API | `explicit manual checkout proof is owner-provided evidence, not an API claim` | автоматизировано |
| `READY` требует полное API-покрытие, доступную витрину и достаточное evidence | Paid-order и manual-proof scenarios получают `READY`; остальные статусы ниже | автоматизировано |
| Отчёт разделяет automatic, web, checkout и remaining unknowns | Section assertions во всех web scenarios | автоматизировано |
| Web-adapter поддерживает available/unavailable/absent без host-specific API | `FakeLaunchWebAdapter` и три ветви scenario evals | автоматизировано |
| Ясность итогового launch verdict | Прогон unavailable/conditional/READY формулировок в model host | manual acceptance pending |

Запуск:

```bash
node --import tsx --test packages/mcp/src/scenarios/launch-check-skill-scenario.test.ts
node --import tsx --test packages/mcp/src/scenarios/launch-check-fix-scenario.test.ts
node --import tsx --test packages/mcp/src/scenarios/launch-check-web-scenario.test.ts
```
