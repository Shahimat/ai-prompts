# Бандлы памяти: полные факты и ограниченные страницы

Реализация подготовленных ai-core 0.1.9 / cli 0.1.6 / harness 0.5.2 /
oc3 0.1.7. Это формат памяти контракта v3, не новый major контракта.
Команды — в [CLI README](../packages/cli/README.md#скрипты),
execution artifacts и pending — в [knowledge inbox](knowledge-inbox.md).

## Источник и представление

Канон остаётся в плоской `.oc3/`: `project.yml`, `data/`, `manuals/`,
`conventions/` и других объявленных слоях. Источник допустимой формы —
действующая JSON Schema. `checkMemory`/AJV выполняются перед materialization;
renderer не ослабляет схемы и не подменяет validation приведением типов.
Conventions/glossary остаются плоскими по своим схемам; schema-valid
вложенные domain entities/behavior, включая BDD, не уплощаются.

Проекция — рекурсивная типизированная проза, не raw YAML/JSON.
Объекты обходятся по отсортированным фактическим ключам, списки — в исходном
порядке. Поэтому разрешённые схемой `$ref`, composition и union-поля
не теряются из-за whitelist верхнего `properties`.
Числа, строки, boolean и null различаются; отсутствие поля не равно
явным `null`, `false`, нулю, пустой строке, списку или объекту.

У каждого значения payload есть ordinal identity, родитель и, для
элемента списка, индекс. Ключи и строки представлены последовательными
фрагментами с позициями, в `<pre>`; Unicode, пробелы и переводы строк
сохраняются. HTML numeric entities экранируют служебные символы без
изменения декодированного значения. Большие строки делятся по Unicode
boundaries, а не обрезаются. Компактная inline-проза кольца 0 сохраняет
те же типы и вложенность отступами и экранированными кавычками,
без склейки ключей через точку.

## Физические файлы и чтение

Все generated navigation links разрешаются относительно содержащего их
файла и ведут внутрь agent-readable `.oc3/bundles/`:

```text
.oc3/bundles/
  index.md                          старт, inline weight 0 и веер
  <node-sha12>/index.md              каталог logical node
  <node-sha12>/page-000001.md         продолжение каталога при необходимости
  files/<source-rel-sha256>/index.md каталог частей полной проекции
  files/<source-rel-sha256>/page-000001.md  продолжение каталога частей
  files/<source-rel-sha256>/part-000001.md  типизированные полные факты
  pending/index.md                  отдельная runtime-проекция, не канон
```

`source-rel-sha256` — SHA-256 относительного пути источника, не его
содержимого. Shared facts имеют одну проекцию, даже если принадлежат
нескольким namespace. Logical node indexes содержат ссылки и короткие
пояснения, не полный факт. Агент идёт от старта через каталог узла к
`files/.../index.md`, читает части и ссылки «Продолжение»; за полным
текстом не требуется открывать sealed canonical.

`page-000001.md` и далее — физическое продолжение того же каталога,
не новый namespace, вес или кольцо. File projection directories
не являются logical nodes и не принимаются как memory markers ролей.
Tree validator допускает именно generated layout, не произвольные файлы.

## Бюджеты и границы

Используются действующие byte budgets manifest: start отдельно,
node — для каталогов/страниц/частей, summary — для коротких пояснений.
Packing резервирует заголовок и ссылку продолжения; summary ограничивается
отдельно от полного payload. Невместимый обязательный frame/элемент каталога
или переполненный start дают адресный отказ до записи новой сборки.

Генератор не меняет canonical, schema, budgets, namespace или weights.
Weight 0 остаётся inline; бесконечный рост weight 0, стартового веера,
skills/goals в фиксированном start cap не гарантируется. Пагинация
не служит скрытым повышением cap или автоматическим reweight.
Seal прежний: non-librarian роли читают бандлы, не запечатанный канон.

## Freshness, публикация и запуск

`MemoryGraph.files` — единый expected file-set относительно bundles,
используемый build/check/ensure. Check заново валидирует входы и
материализует ожидаемые bytes **всех** файлов: start, indexes, pages,
parts и навигации. Отсутствие, tamper, stale payload даже при неизменном
summary, лишние owned outputs и отсутствие pending index означают FAIL.
Fingerprint входов в старте учитывает источники, схемы и manifest.
`memory check` ничего не чинит.

Build детерминирован и идемпотентен. После validation и cap-check запись
выполняется под runtime lease `memory-build`: сначала payload/pages,
затем pending view и start, затем prune стухших owned файлов и пустых
каталогов. Pending subtree не удаляется; его view обслуживает существующий
pending lifecycle. Confinement/symlink guard не позволяет обойти seal
ссылкой на canonical. Это защищённая последовательность, **не обещание
atomic rename транзакции** или rollback при произвольном I/O-сбое.

Общий `ensureMemory` валидирует память, строит отсутствующий/устаревший
file-set и повторно проверяет результат перед role/native injection.
Одновременные ensure в процессе объединяются; занятый внешний lease
даёт явный отказ. Role ensure выполняется до spawn; unknown markers
отклоняются с актуальными logical IDs. Native context проверяет память
и у seen sessions, заменяет изменившийся start; неуспешная загрузка
не считается success-seen и не выдаёт старую память за свежую.

## CLI и границы evidence

- CHECK: обязательные `tree check` и `memory check`, плюс настроенные проверки.
- REFRESH: `adapters sync` → `memory build` → CHECK.
- DOCS_VERIFY: `adapters sync` → `delta check` → `memory build` → CHECK.
  Это внутренний runtime script автомата, не новая публичная команда.

Adapters сохраняют своё config gating. Отдельного `checks.memory` нет.
В проектах без установленной canonical memory явно пропускаются только
точные шаги `memory build`/`memory check`; pending-only overlay не означает
её установку. `memory inbox pending/enqueue/batch` этим skip не фильтруются.
Частично утраченная установленная память не становится non-memory проектом.

Synthetic target-like RED→GREEN и targeted tests покрывают round-trip,
бюджеты, достижимость частей, freshness/prune, seal и launch orchestration;
inbox pending отдельно проверен в non-memory/pending-only runtime scripts.
Это не проверка factorio-modding, опубликованного tarball, живого provider
или реального consumer/source-sync. Итоговые release CI/pack выполняются
владельцем проверки после source/docs stable; прежний release-only PASS
не доказывает готовность изменённого memory snapshot.
