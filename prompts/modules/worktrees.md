---
key: worktrees
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль worktrees — параллельные сессии в git worktree
use_case: Возможность ядра v3. Правила параллельной работы агентов в отдельных git worktree — каталог, .worktreeinclude, установка зависимостей, горячие файлы при слиянии (CHANGELOG merge=union, пересборка индексов, goals вручную).
tags: [worktrees, parallel-sessions, workflow, agent-contract, module]
feature:
  summary: параллельные сессии в git worktree — каталог, .worktreeinclude, слияние горячих файлов
  default: false
  requires: []
  conflicts: []
---

# Модуль worktrees — параллельные сессии в git worktree

## Назначение

Несколько сессий агентов работают одновременно, каждая — в своём
worktree. Модуль задаёт, где они живут, что в них копируется и как
сливать файлы, которые правят все ветки.

## Что ставит

```yaml
provides:
  layers: []
  files: [.worktreeinclude]
  skills: [worktrees]
  agents_md_block: true
  harness_checks: []
  gitignore: [.claude/worktrees/]     # или каталог из ответа
```

Строка `.gitignore` — каталог worktrees; при отключении убирается, если
её не объявляет другой модуль.

`.worktreeinclude` — по ответу пользователя, какие локальные файлы
нужны в каждом worktree:

```
# игнорируемые git файлы, которые копируются в новый worktree
.claude/settings.local.json
```

Блок `AGENTS.md`:

```markdown
<!-- module:worktrees -->
## worktrees

- одна задача — одна ветка — один worktree; правила и горячие файлы →
  skill `worktrees`.
<!-- /module:worktrees -->
```

## Установка

1. Спроси: какие игнорируемые файлы нужны в каждом worktree; каталог —
   по умолчанию `.claude/worktrees/`.
2. Создай `.worktreeinclude`, добавь каталог в `.gitignore`.
3. Каталог не по умолчанию и подключён harness — `worktrees.dir` в
   `context/harness.yml`.
4. Поставь skill `worktrees`, добавь блок в `AGENTS.md`.

`merge=union` для `CHANGELOG.md` уже стоит в `.gitattributes` ядра.

## Синхронизация

Через обновление из источника (skill `source-sync`).
