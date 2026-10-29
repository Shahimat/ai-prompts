---
key: roles
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль roles — роли oracle, researcher, implementer, reviewer
use_case: Возможность ядра v3 для любого проекта. Ставит роли с чистым контекстом — быструю справку по документации (oracle), глубокий разбор (researcher), исполнителя (implementer) и независимого ревьюера по DoD (reviewer). Основная сессия отдаёт им тяжёлую работу и получает короткий итог, а не тела файлов и сырые ответы систем. Первая ступень оператора; работает без рантайма.
tags: [roles, subagents, delegation, agent-contract, module]
feature:
  summary: роли oracle, researcher, implementer, reviewer — тяжёлая работа вне основной сессии, короткий итог
  default: false
  requires: []
  conflicts: []
---

# Модуль roles — роли с чистым контекстом

## Назначение

Ядро уже выносит запись в документацию в роль `docs-keeper`. Этот модуль
переносит тот же принцип на остальную тяжёлую работу: основная сессия
тратит контекст на намерение пользователя, а чтение, правку и проверку
делают роли. Цена делегирования для основной сессии — бриф и итог в
несколько сотен токенов; та же работа на месте — тысячи токенов, которые
остаются в контексте до конца сессии.

Роли нейтральны к агенту: в сессии — субагенты (адаптеры генерируют
`.claude/agents/`, `.codex/agents/`), в рантайме `ops` — исполнители в
состояниях job.

- `oracle` (sonnet, только документация) — быстрый ответ; не нашёл —
  промах и черновик вопроса для `researcher`;
- `researcher` (opus, чтение и каналы на чтение) — структурный разбор с
  доказательствами, полный отчёт — файлом;
- `implementer` (opus) — план или правка в выданной копии репозитория,
  без git-записи;
- `reviewer` (sonnet) — вердикт по каждому пункту DoD с дословной
  цитатой, рассуждений исполнителя не видит.

## Что ставит

```yaml
provides:
  layers: []
  files: [.agents/agents/oracle.md, .agents/agents/researcher.md, .agents/agents/implementer.md, .agents/agents/reviewer.md]
  skills: []
  agents_md_block: true
  harness_checks: []
  gitignore: [.ops/]
```

Роли — из группы `agents` индекса источника, байт в байт, SHA каждой —
в `parts.agents` manifest'а. `.ops/` — каталог отчётов ролей и рантайма:
состояние работ, не документация.

Блок `AGENTS.md`:

<!-- expect:agents-md-readonly -->
```markdown
<!-- module:roles -->
## roles

- вопрос по доке → `oracle`; разбор «что где и почему» → `researcher`; проверка по DoD → `reviewer`;
- роли не видят разговор: бриф — указатели, итог — короткий, отчёт — файлом.
<!-- /module:roles -->
```
<!-- /expect:agents-md-readonly -->

## Установка

1. Поставь роли из индекса в `.agents/agents/`, SHA — в manifest.
2. Добавь блок в `AGENTS.md`, строку `.ops/` — в `.gitignore`.
3. `ai refresh` — адаптеры раскладывают роли под инструменты.

## Отключение

Роли, блок и строка `.gitignore` удаляются. Отчёты в `.ops/` —
вопрос пользователю: удалить или оставить.

## Синхронизация

Через обновление из источника (skill `source-sync`): модуль и каждая
роль — по своим SHA.
