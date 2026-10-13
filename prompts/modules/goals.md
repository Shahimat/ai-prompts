---
key: goals
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync, goals]
title: Модуль goals — цели и программы как очередь работы
use_case: Возможность ядра v3. Заводит очередь работы проекта в context/views/ — цели и программы с приоритетами, зависимостями, жизненным циклом без статуса done и кросс-целевой проверкой goal-consistency. Правила — skill goals (inline-копия паттерна goals).
tags: [goals-programs, workflow, agent-contract, module]
feature:
  summary: очередь работы — цели и программы с приоритетами и goal-consistency
  default: true
  requires: []
  conflicts: []
---

# Модуль goals — цели и программы как очередь работы

## Назначение

Очередь работы проекта вместо плоского todo: у каждого направления —
файл с `why`, `description`, задачами по приоритету и `depends_on`.
Крупные инициативы — программы с подцелями. Решённое удаляется: история
живёт в git и `CHANGELOG.md`.

Применение паттерна `goals`: inline-копия живёт в skill `goals`, который
модуль ставит в проект. Копии правил в `context/conventions/`
(`goals.yml`, `goal-consistency.yml`) в v3 не заводятся.

## Что ставит

```yaml
provides:
  layers: [context/views/]
  files: [context/views/goals.yaml]
  skills: [goals]
  agents_md_block: true
  harness_checks: []
```

Стартовый `context/views/goals.yaml`:

```yaml
# Порядок записи = приоритет цели. Правила — skill goals.
goals: []
```

Блок `AGENTS.md`:

```markdown
<!-- module:goals -->
## goals

- что делать дальше → `context/views/goals.yaml`, затем `goal--<key>.yaml`;
- правила очереди, `goal-consistency`, отчёт о статусе → skill `goals`.
<!-- /module:goals -->
```

## Установка

1. Создай `context/views/goals.yaml`.
2. Поставь skill `goals` в `.agents/skills/goals/`.
3. Добавь блок в `AGENTS.md`.
4. Спроси, есть ли уже очередь (todo-файл, roadmap, трекер). Есть —
   план переноса живых задач по целям; закрытые не переносятся.

## Миграция с v2

`context/views/` остаётся как есть. Удали `context/conventions/goals.yml`
и `goal-consistency.yml`, если они дословно повторяют v2: правила
теперь в skill.

## Отключение

Цели с содержимым — вопрос пользователю: удалить или оставить.

## Синхронизация

Через «сверь всё» проекта (skill `source-sync`). Skill `goals` меняется
вместе с паттерном `goals` в источнике.
