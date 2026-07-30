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

Запуск:

```bash
node --import tsx --test packages/mcp/src/scenarios/launch-check-skill-scenario.test.ts
```
