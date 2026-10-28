---
name: domain
metadata:
  runs: check
description: Правила слоя domain — entities (что есть) и behavior (как должно работать и проверено ли, verified). Загружай, когда читаешь или пишешь docs/entities/ и docs/behavior/, ставишь verified или делаешь audit.
---

# domain

Общая правда проекта для человека и агента:

- `docs/entities/<id>.yml` — «что это за штука, из чего состоит, от
  чего зависит»;
- `docs/behavior/<id>.yml` — «как это должно работать и проверено ли».

## Маршруты

- как сейчас устроено X → `docs/entities/<id>.yml`, затем код;
- какие документы касаются файла F → поиск `paths` в entities;
- как X должно себя вести и проверено ли → `docs/behavior/<id>.yml`;
- список id по namespace → `context/index.yml`.

Читай entities и behaviors только нужного namespace.

## Entity

```yaml
id: <kebab-case, совпадает с именем файла>
kind: entity
namespace: <из context/project.yml → namespaces>
summary: <одна строка — для индекса>
paths: [<glob кода, который описывает entity>]
version: <если применимо>
<поля предметной области>
features_enabled: []
features_disabled: []
manuals: [<имена manuals>]
behaviors: [<id behaviors>]
```

- `paths` — связь кода с документацией: по ним находится entity для
  изменённого файла;
- другие модули могут добавлять поля в entity и behavior
  (`provides.extends.domain` в их manifest'ах) — правила этих полей в
  skills тех модулей;
- `manuals` и `behaviors` — ссылки в обе стороны: entity ссылается на
  behavior ⇔ behavior перечисляет entity в `entities`.

## Behavior

```yaml
id: <kebab-case>
kind: behavior
namespace: <namespace>
entities: [<id entities>]
title: <одна строка — для индекса>
scenarios:
  - given: <условие>
    when: <действие>
    then: <ожидание>
check: <команда, которая проверяет сценарии; необязательно>
verified: true | false
verified_at: <YYYY-MM-DD или null>
verified_note: <чем проверено или что мешает>
```

## Верификация

`verified: true` — самое дорогое поле: ему можно доверять. Поэтому:

1. Изменилась **семантика** поведения (публичный API, конфиг, схема
   данных, зависимость, то, что записано в `scenarios`) — `verified:
   false` на затронутых behavior. Рефакторинг без изменения поведения,
   переименования, форматирование `verified` не сбрасывают.
2. Есть `check` — выполни его. Прошёл — `verified: true`, `verified_at` — сегодня,
   `verified_note` — чем проверено.
3. `check` нет, но проверить можно (`curl`, `grep`, тест, чтение кода) —
   проверь и проставь так же. Можно автоматизировать — предложи `check`.
4. Проверить сейчас нельзя — `verified: false` и в `verified_note`, что
   мешает («ждём nightly», «ручной smoke по manual X»).
5. Спецификация впереди кода (behavior описан до реализации) —
   `verified: false`, `verified_note: "спецификация до кода: <задача>"`.

Никогда не ставь `verified: true` без свежей проверки.

## Namespace

- новый namespace — только с «да» пользователя, сначала в
  `context/project.yml`;
- больше ~7 entities или ~12 behaviors в namespace — сигнал к
  дроблению (`<area>-<subarea>` или отдельная область), поднять в
  отчёте;
- namespace — класс задачи, а не узел или площадка.

## Проверки

Перед сохранением:

- `id` совпадает с именем файла, `namespace` объявлен;
- ссылки entity ↔ behavior двусторонние, на существующие файлы;
- `verified: true` → `verified_at` заполнен;
- `features_enabled` отражён хотя бы в одной behavior;
- manual из `manuals` существует.

<!-- expect:skill-runs -->
<!-- metadata.runs: check -->
С harness часть проверяет `ai check` (`context-index`): `id`,
namespace, `summary` / `title` — запусти его после правки.
<!-- /expect:skill-runs -->
