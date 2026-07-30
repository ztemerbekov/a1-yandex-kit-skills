# Проверка `a1-yandex-kit-operator`

Матрица для issues #7–#9. Автоматические сценарии исполняют детерминированную
reference-model реализацию с fake MCP и проверяют журнал инструментов, аргументы,
итоговый отчёт и состояние. Они не исполняют `SKILL.md` через LLM-хост, поэтому
end-to-end соответствие навыка подтверждается отдельной ручной приёмкой ниже.

| Пользовательский сценарий / критерий | Доказательство | Результат |
| --- | --- | --- |
| Естественные запросы и устанавливаемое имя навыка | `the operator skill is installable and declares the supported Russian requests` | автоматизировано |
| Полный разбор: все страницы, детали и addons проблемных заказов | `full review follows every page, expands risky orders, and records a read-only report` | автоматизировано |
| Только срочное | `urgent view excludes a non-critical new order but keeps overdue delivery` | автоматизировано |
| Период не скрывает текущую нерешённую угрозу | `a requested period filters routine orders but never hides an unresolved current threat` | автоматизировано |
| Недоступные детали и addons остаются видимыми в частичном отчёте | `detail and addon read failures remain visible as missing data in a partial report` | автоматизировано |
| Обрыв страницы заказов не завершает весь разбор и запрещает чистый вывод | `an interrupted order page returns a partial report instead of throwing` | автоматизировано |
| Ошибка одного storefront-чтения видна, независимые разделы продолжаются | `an unavailable storefront list remains visible while other sections continue` | автоматизировано |
| «Как дела?» без контекста не перехватывает разговор | `short 'Как дела?' needs KIT context and never invokes a tool without it` | автоматизировано |
| Отсутствие любых записей во всех read-only сценариях | `FakeOperatorMcp.writeCalls` в каждом сценарии | автоматизировано |
| Факты оплаты, отмены/возврата, доставки и порядок отчёта | Явные правила в `skills/a1-yandex-kit-operator/SKILL.md`; фикстуры содержат ожидающее подтверждения, просроченную доставку и возврат | полуавтоматизировано |
| Качество приоритизации и естественного отчёта в конкретном MCP-хосте | Запуск пяти формулировок из issue с подключённым навыком и сверка фактов с журналом fake MCP | ручная приёмка |

## Issue #8

| Пользовательский сценарий / критерий | Доказательство | Результат |
| --- | --- | --- |
| Смешанный разбор объединяет каталог, промо и вебхуки | `mixed store combines catalog, promotion and webhook signals without a write` | автоматизировано |
| Здоровые данные не создают ложных объективных сигналов | `healthy operational data reports no objective store signals` | автоматизировано |
| Возможное пересечение промо и отсутствие покрытия вебхуков не объявляются ошибкой без правила | Проверка `Требует проверки` в смешанном сценарии и правила в `SKILL.md` | полуавтоматизировано |
| Усечённая автопагинация каталога не маскируется как полное покрытие | `truncated catalog read is visible instead of claiming complete coverage` | автоматизировано |
| Полный состав оперативного разбора и граница с catalog doctor | `skills/a1-yandex-kit-operator/SKILL.md` и README | ручная приёмка |

## Issue #9

| Пользовательский сценарий / критерий | Доказательство | Результат |
| --- | --- | --- |
| Точное подтверждение: чтение → одна запись → повторное чтение | `an exact confirmation reads, writes once, and re-reads without another question` | автоматизировано |
| Точная отмена с причиной и честной границей API | `an exact cancellation keeps the owner-provided reason in the MCP log and verifies the result`; `cancel_order documents owner reason as log context that KIT does not store` | автоматизировано |
| Точная отмена без причины выполняется: причина — необязательный контекст | `an exact cancellation does not require a reason the API cannot store` | автоматизировано |
| Неоднозначное «Обработай заказы» не пишет и задаёт конкретный вопрос | `an ambiguous order command asks whether to confirm or cancel and performs no write` | автоматизировано |
| Пакет продолжается после локальной ошибки и сохраняет результаты | `an exact confirmation batch continues after a local error and reports both outcomes` | автоматизировано |
| Пакетная отмена с общей причиной продолжает обработку после локальной ошибки | `an exact cancellation batch continues after a local error and retains the shared reason` | автоматизировано |
| Точная цена SKU не додумывается, работает для HIDDEN и проверяется повторным чтением | `an exact SKU price change reads, writes the stated value once, and verifies it`; `an exact HIDDEN SKU remains addressable like the real list_variants contract`; `a price repair without a stated value asks for that value and performs no write` | автоматизировано |
| Timeout mutation не повторяется и остаётся неоднозначным | `confirmation, cancellation and price timeouts are attempted once, re-read, and ambiguous`; `a confirmation batch separates failed and ambiguous items and continues`; unit-тесты безопасных ретраев issue #6 | автоматизировано |
| «Проверь», «покажи», «разбери», «найди» остаются read-only | `review, show, inspect and find intents stay read-only while actually reading the store` | автоматизировано |
| Точный остаток сохраняет соседние склады | `an exact stock change preserves other warehouses and verifies the stated quantity` | автоматизировано |
| Проверка остатка сравнивает полный массив, включая соседние склады и `reserved` | `a stock change is ambiguous when verification loses a sibling warehouse` | автоматизировано |
| Точные лимит и статус промокода не додумываются и проверяются повторным чтением | `an exact promocode limit change reads, writes once, and verifies it`; `an exact promocode status change uses the owner-stated status` | автоматизировано |
| Точные значение скидки и привязка промокода используют заданные владельцем данные | `an exact discount value is written with its stated unit and verified`; `an exact promocode binding reads current IDs, writes once, and verifies the SKU` | автоматизировано |
| Одинаковые названия акций требуют точного ID и не выбираются произвольно | `duplicate discount titles require an exact ID and perform no write` | автоматизировано |
| Дубли номера заказа, SKU и кода промокода требуют ID и не выбираются через первый результат | `duplicate order numbers require an ID and perform no write`; `duplicate exact SKU matches require an ID and perform no write`; `duplicate promocode codes require an ID and perform no write` | автоматизировано |
| Усечённый поиск не доказывает уникальность альтернативного ключа; явный ID имеет приоритет и читается напрямую | `a truncated SKU lookup cannot prove uniqueness and performs no write`; `an explicit variant ID wins over a coincidentally matching SKU`; `an explicit UUID bypasses a failed list lookup and uses its detail read` | автоматизировано |
| Точная валидация и активация вебхука проверяется повторным чтением | `an exact webhook validation and activation is verified by a final read`; `standalone exact webhook activation authorizes validation with activate=true` | автоматизировано |
| Успешный ответ записи без подтверждения состояния остаётся неоднозначным | `a successful mutation response with a mismatching re-read is ambiguous` | автоматизировано |
| 5xx после одной мутации остаётся неоднозначным и не повторяется | `a mutation 5xx is ambiguous and is never retried` | автоматизировано |
| HTTP 408 без слова timeout остаётся неоднозначным | `HTTP 408 after a mutation is ambiguous even without a timeout word` | автоматизировано |
| Ошибка exact lookup превращается в outcome каждого элемента и не обрывает batch исключением | `an order lookup error becomes a per-target batch outcome` | автоматизировано |
| Неподдерживаемые операции с заказом/оплатой/доставкой/возвратом не обещаются | Явная граница в `skills/a1-yandex-kit-operator/SKILL.md` | ручная приёмка |

## Ручная end-to-end приёмка навыка

В реальном MCP-хосте подключить `a1-yandex-kit-operator`, подать подготовленные данные и
для каждого случая сверить итоговый ответ с фактическим журналом tool calls:

1. «Как дела в магазине?» при ошибке второй страницы заказов — ответ содержит точное
   частичное покрытие, независимые разделы прочитаны, записей нет.
2. «Поставь цену 100 для DUP» при двух точных SKU `DUP` — запись не вызывается, навык
   просит ID.
3. «Установи остаток 5 для SKU-42 на складе warehouse-1» — одна запись содержит полный
   сохранённый `stocks`, а успех объявлен только после совпадения полного массива.
4. «Отмени заказы 211, 212, причина: клиент попросил» при локальной ошибке второго —
   вызвано не более одной отмены на заказ, отчёт сохраняет оба результата.
5. Ответ 5xx/timeout на мутацию — повторной записи нет, результат
   «Неоднозначно: результат неизвестен, нужна проверка».

Запуск: `npm test`.
