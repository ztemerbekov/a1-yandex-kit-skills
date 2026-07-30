# Проверка `a1-yandex-kit-catalog-doctor`

Матрица для issue #10. Сценарии проверяют журнал MCP, аргументы чтения, покрытие,
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

Запуск:

```bash
node --import tsx --test packages/mcp/src/scenarios/catalog-doctor-scenario.test.ts
```
