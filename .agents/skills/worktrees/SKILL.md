---
name: worktrees
metadata:
  runs: refresh
description: Параллельная работа в git worktree — где живут worktrees, что копируется, горячие файлы (CHANGELOG, индексы, goals) и как сливать. Загружай, когда работаешь не в основном checkout или готовишь слияние ветки.
---

# worktrees

Параллельные сессии агентов — каждая в своём git worktree: одна задача,
одна ветка, один worktree.

## Где и как

- Каталог — `worktrees.dir` из `context/ai-core.yml` или
  `.opencode/worktrees/<name>` по умолчанию (совпадает с настройкой
  `worktree.directory` в `opencode.jsonc`). Каталог в `.gitignore`.
- Создание: режим Worktree в OpenCode, режим Worktree в
  Codex app, или `git worktree add <dir>/<name> -b <branch>`.
- `.worktreeinclude` в корне — игнорируемые git файлы, которые
  копируются в новый worktree (локальные настройки, `.env`). Только
  такие: tracked-файлы и так есть в checkout.
- Зависимости (`node_modules`, `.venv`) не копируются — ставятся в
  каждом worktree заново.
- После слияния ветки worktree удаляется (`git worktree remove`).

## Горячие файлы

Их правят параллельные ветки — правила, чтобы слияние не было болью:

- `CHANGELOG.md` — `merge=union` в `.gitattributes`: обе строки
  сохраняются. После слияния проверь порядок дат.
- `context/index.yml`, `prompts/index.yml` и другие генерируемые — при
  конфликте не правь руками: возьми любую сторону и пересобери
  генератором.
- `goals/*.expect.ts` — TypeScript; union не работает: конфликт
  импортов и тикетов решай руками, правку тикета сверь с baseline.
- Адаптеры (`.opencode/`, `.codex/`) — пересобрать.

<!-- expect:skill-runs -->
<!-- metadata.runs: refresh -->
С harness после слияния — `ai refresh`: пересоберёт адаптеры и
`context/index.yml` и проверит проект, в том числе порядок дат журнала.
<!-- /expect:skill-runs -->

## Чего не делать

- не выкатывать в общие окружения из ветки worktree то, что не
  слито: следующий запуск из основной ветки откатит;
- не держать два worktree на одну задачу;
- не делить один ресурс (порт, тестовая БД, удалённый узел) между
  worktree без явной блокировки — договорённость об этом — convention
  проекта.
