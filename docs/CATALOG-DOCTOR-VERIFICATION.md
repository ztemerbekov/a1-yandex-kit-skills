# Проверка `a1-yandex-kit-catalog-doctor`

Матрица для issues #10–#11. Сценарии проверяют журнал MCP, аргументы чтения, покрытие,
классификацию и итоговый отчёт, а не посимвольное совпадение текста.

| Пользовательский сценарий / критерий | Доказательство | Результат |
| --- | --- | --- |
| Устанавливаемый model-invoked skill и русскоязычные триггеры | `skills/a1-yandex-kit-catalog-doctor/SKILL.md`; `quick_validate.py` | автоматизировано |
| Все страницы продуктов, вариантов, активных категорий и складов | `deep audit follows every page and separates blockers, risks and recommendations` | автоматизировано |
| Опубликованные и скрытые варианты; архивные склады по активным ссылкам | Аргументы `status` и вызовы `get_warehouse` в multi-page сценарии | автоматизировано |
| Явное число проверенных сущностей и страниц | Строки `Покрытие` и `Страниц` во всех трёх сценариях | автоматизировано |
| Обрыв пагинации не маскируется как здоровый каталог | `pagination interruption is explicit and never claims the whole catalog is healthy` | автоматизировано |
| Непрочитанный product не объявляется сломанной связью без точного `get_product` | `an unread product page is resolved with get_product instead of a false broken link` | автоматизировано |
| Цена, финальная цена и ручная скидка выше базовой | Multi-page фикстура `BROKEN-PRICE` / `BROKEN-RESERVE` | автоматизировано |
| Доступный остаток, резерв, отсутствующий и архивный склад | Multi-page фикстура и проверка фактов в отчёте | автоматизировано |
| Нет активной категории, ограничение скрытых архивных привязок, сломанная ссылка и дубли | Multi-page фикстура и проверка ID, slug и названия | автоматизировано |
| Изображение, связь с продуктом и `product_card_id` | Multi-page фикстура и проверка фактов в отчёте | автоматизировано |
| Здоровый каталог не получает выдуманных дефектов из необязательных полей | `a fully healthy catalog reports complete coverage without invented defects` | автоматизировано |
| Явный аудит архива расширяет status-фильтры и показывает риск архивации единственного пути | `an explicit archive audit includes archived entities and reports archive risk` | автоматизировано |
| Разделы «Блокеры», «Риски», «Рекомендации» | Все сценарии проверяют явные счётчики | автоматизировано |
| Любой сценарий остаётся read-only | `FakeCatalogDoctorMcp.writeCalls` во всех сценариях | автоматизировано |
| Группирующие значения, дубли комбинаций и неработающая группировка | `structural audit finds grouping, characteristic, media and collection defects from API facts` | автоматизировано |
| Архивные характеристики и сломанные ссылки на характеристики | Тот же структурный сценарий; ID проверяются только по полям API | автоматизировано |
| Характеристики не выводятся из названия товара | Структурная фикстура содержит «синий» в названии без значения; отчёт не создаёт значение | автоматизировано |
| Требование владельца, риск неполноты и опциональная рекомендация разделены | `card completeness separates owner requirements, incompleteness risks and optional advice` | автоматизировано |
| ID медиа, дубли, порядок и главное изображение | Структурный сценарий проверяет IMAGE/VIDEO, `(type, id)` и `display_sequence` | автоматизировано |
| Пустая активная коллекция, скрытые карточки и сломанная связь | Структурный сценарий и `GetVariantsByCollectionId` | автоматизировано |
| Бейджи, динамические фильтры, контекстные коллекции и похожие карточки читаются только по запросу | `owner-requested merchandising audit reads optional relations and reports only broken facts` | автоматизировано |
| Отсутствие опционального мерчандайзинга не объявляется дефектом | `optional merchandising entities are not defects and are not read without owner request` | автоматизировано |
| Структурное покрытие содержит характеристики, коллекции и запрошенные опциональные области | Проверки строки `Структурное покрытие` | автоматизировано |
| Обрыв списка характеристик восстанавливает используемое определение detail-read и не создаёт ложный blocker | `an interrupted characteristic list uses detail reads instead of inventing a broken reference` | автоматизировано |
| `OTHER` media не получает ложное требование `video_id` | `media OTHER does not require a video identifier` | автоматизировано |
| Архивный variant в связи коллекции разрешается через `get_variant`, а не объявляется сломанным | `a collection relation to an archived variant is resolved instead of called broken` | автоматизировано |

Запуск:

```bash
node --import tsx --test \
  packages/mcp/src/scenarios/catalog-doctor-scenario.test.ts \
  packages/mcp/src/scenarios/catalog-doctor-structure.test.ts
```
