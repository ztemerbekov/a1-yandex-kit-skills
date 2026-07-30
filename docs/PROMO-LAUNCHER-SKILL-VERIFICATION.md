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

Запуск:

```bash
node --import tsx --test packages/mcp/src/scenarios/promo-launcher-skill-scenario.test.ts
```
