---
key: manuals
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль manuals — ручные процедуры для человека
use_case: Возможность ядра v3. Заводит слой docs/manuals/ — пошаговые чек-листы того, что делает человек руками. Требует domain — manual привязывается к entity, по ней определяется его область.
tags: [docs-as-code, manuals, agent-contract, module]
feature:
  summary: docs/manuals — пошаговые ручные процедуры для человека
  default: true
  requires: [domain]
  conflicts: []
---

# Модуль manuals — ручные процедуры для человека

## Назначение

Человек включается там, где его нельзя заменить: ручной релиз, доступы,
железо. Manual — короткий чек-лист с командами и проверками, который
человек открывает, когда нужно сделать что-то руками.

Требует `domain`: manual упоминается в поле `manuals` entity, по нему
определяется его namespace в индексе.

## Что ставит

```yaml
provides:
  layers: [docs/manuals/]
  files: []
  skills: [manuals]
  agents_md_block: true
  harness_checks: []
```

Блок `AGENTS.md`:

<!-- expect:agents-md-readonly -->
```markdown
<!-- module:manuals -->
## manuals

- как сделать руками X → `docs/manuals/<name>.md`;
- формат и связи → skill `manuals`.
<!-- /module:manuals -->
```
<!-- /expect:agents-md-readonly -->

## Установка

1. Создай `docs/manuals/`.
2. Поставь skill `manuals` в `.agents/skills/manuals/`.
3. Добавь блок в `AGENTS.md`.
4. В `README.md` — строка «ручные процедуры — `docs/manuals/`».

## Миграция с v2

Файлы остаются на месте. Проверь: первая строка — заголовок `# …`,
каждый manual упомянут в какой-нибудь entity.

## Отключение

Manuals с содержимым — вопрос пользователю: удалить или оставить.

## Синхронизация

Через обновление из источника (skill `source-sync`).
