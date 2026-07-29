# Проверка `a1-yandex-kit-operator`

Матрица для issue #7. Сценарии проверяют наблюдаемое поведение: журнал инструментов,
аргументы, итоговый отчёт и состояние fake MCP, а не посимвольное совпадение ответа.

| Пользовательский сценарий / критерий | Доказательство | Результат |
| --- | --- | --- |
| Естественные запросы и устанавливаемое имя навыка | `the operator skill is installable and declares the supported Russian requests` | автоматизировано |
| Полный разбор: все страницы, детали и addons проблемных заказов | `full review follows every page, expands risky orders, and records a read-only report` | автоматизировано |
| Только срочное | `urgent view excludes a non-critical new order but keeps overdue delivery` | автоматизировано |
| Период не скрывает текущую нерешённую угрозу | `a requested period filters routine orders but never hides an unresolved current threat` | автоматизировано |
| Недоступные детали и addons остаются видимыми в частичном отчёте | `detail and addon read failures remain visible as missing data in a partial report` | автоматизировано |
| «Как дела?» без контекста не перехватывает разговор | `short 'Как дела?' needs KIT context and never invokes a tool without it` | автоматизировано |
| Отсутствие любых записей во всех read-only сценариях | `FakeOperatorMcp.writeCalls` в каждом сценарии | автоматизировано |
| Факты оплаты, отмены/возврата, доставки и порядок отчёта | Явные правила в `skills/a1-yandex-kit-operator/SKILL.md`; фикстуры содержат ожидающее подтверждения, просроченную доставку и возврат | полуавтоматизировано |
| Качество приоритизации и естественного отчёта в конкретном MCP-хосте | Запуск пяти формулировок из issue с подключённым навыком и сверка фактов с журналом fake MCP | ручная приёмка |

Запуск: `npm test`.
