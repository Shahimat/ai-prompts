---
key: ops
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль ops — jobs по задачам вне сессии оператора
use_case: Возможность ядра v3 для проекта, где оператор ведёт много параллельных работ. Работа по задаче — job, автомат ticket-work пакета @shahimat/harness - карточка задачи из провайдера tasks, исследование, план с «да» пользователя, правка в копии от провайдера vcs, проверки, ревью по DoD, готовность к коммиту. Роли — отдельные процессы claude -p, журнал хода — в .ops/jobs/<id>/, сводка оператору — ai ops brief на старте сессии. Рантайм — только Claude Code.
tags: [ops, jobs, harness, providers, agent-contract, module]
feature:
  summary: jobs по задачам вне сессии оператора — карточка, план с «да», правка в копии, проверки, ревью, журнал хода
  default: false
  requires: [harness]
  conflicts: []
  asks:
    - key: tasks
      question: Откуда берутся задачи для jobs?
      multi: false
      options: [local, project-provider]
    - key: vcs
      question: Как создаётся изолированная копия репозитория на job?
      multi: false
      options: [git, project-provider]
---

# Модуль ops — jobs по задачам

## Назначение

Субагенты сессии не подходят для параллельных долгих работ: умирают
вместе с процессом, итоги копятся в контексте, журнала нет. Поэтому
работа по задаче — **job**: сессия автомата `ticket-work` на диске,
роли — отдельные процессы. Оператор запускает job, получает события и
пересказывает их пользователю; рестарт оператора job не останавливает.

Рантайм запускает роли через `claude -p` — только Claude Code. Роли
ядра и протокол оператора нейтральны к агенту. Модуль добавляет роль
`implementer` — правку в копии репозитория; `researcher` и `reviewer` —
из ядра.

### Путь job

1. `intake` — провайдер `tasks` даёт карточку `task.md` (заголовок,
   DoD, ссылки, текст).
2. `research` — роль `researcher`, отчёт `research.md`.
3. `plan` → `plan-gate` — роль `implementer` пишет `plan.md`; пауза до
   «да» пользователя, замечание — новый план.
4. `implement` — роль `implementer` правит копию от провайдера `vcs`.
5. `verify` — команды из `context/ops.yml` → `verify` в копии.
6. `review` — роль `reviewer` по DoD; карточка перечитывается из
   источника, смена DoD — вопрос пользователю. Провал — назад в
   `implement`, лимит кругов.
<!-- expect:job-git -->
7. `ready` — diff и сообщение коммита; git-запись делает пользователь,
   «готово» закрывает job, текст — доработка.
<!-- /expect:job-git -->
8. `docs` → `done` — намерения из job уходят в `docs-delta`; копия
   удаляется, статус в источник — по политике автономии.

Вопрос роли из любого состояния — пауза и событие оператору; ответ
продолжает job.

### Провайдеры

Внешние точки — провайдеры с интерфейсом в harness: `tasks` (`fetch`,
`update`) и `vcs` (`create`, `diff`, `remove`). Встроенные — `local`
(markdown-файл задачи в проекте) и `git` (`git worktree` в каталоге
машины). Свои — `.agents/providers/<интерфейс>/<имя>.ts` (проект) или
`~/.config/harness/providers/…` (машина, общий для всех проектов):
`export default { interface, name, …методы }`. Одно имя на двух
уровнях — ошибка. Конкретные системы компании живут только там, в
источнике их нет.

### Граница: рантайм — не знание

`.ops/` — состояние работ, а не документация и не memory. Устойчивое
из job попадает в документацию только через `docs-delta`. Роли и
оператор не опираются на старые журналы как на источник правды.

## Вопросы при подключении

- `tasks` — `local` (задача — markdown-файл проекта) или
  `project-provider` (свой провайдер в `.agents/providers/tasks/`);
- `vcs` — `git` или `project-provider` (своя изоляция копий).

## Что ставит

```yaml
provides:
  layers: []
  files: [context/ops.yml, .agents/agents/implementer.md]
  skills: []
  agents_md_block: true
  harness_checks: []
  gitignore: [.ops/]
```

`context/ops.yml`:

```yaml
# Провайдеры и проверки рантайма ops. Формат — блок ops в AGENTS.md.
providers:
  tasks: local          # или имя своего провайдера
  vcs: git
repo: .                 # репозиторий кода для копий; путь от корня проекта
verify: []              # команды проверки в копии: сборка, тесты, линт
```

В `context/ai-core.yml` модуль добавляет hook `ops-brief`: сводка
`ai ops brief` на старте сессии, после `resume` и чистки контекста.

Блок `AGENTS.md`:

<!-- expect:agents-md-readonly -->
```markdown
<!-- module:ops -->
## ops

- задача → `npx ai ticket-work start <ref>`; ответ — `npx ai ticket-work answer <id> <текст>`;
- сводка — `npx ai ops brief`; события — фоном `npx ai ops wait`;
- журнал — `.ops/jobs/<id>/`, настройки — `context/ops.yml`; `.ops/` — рантайм, не знание.
<!-- /module:ops -->
```
<!-- /expect:agents-md-readonly -->

## Установка

1. Проверь `harness` (иначе `contract-setup` добавит); поставь роль
   `implementer` из индекса, SHA — в `parts.agents`.
2. Создай `context/ops.yml` по ответам; спроси команды `verify` и путь
   `repo`, если код не в этом репозитории.
3. `project-provider` — помоги написать провайдер в
   `.agents/providers/<интерфейс>/<имя>.ts` по интерфейсу выше (план →
   «да»).
4. Добавь `ops-brief` в `hooks` в `context/ai-core.yml`, блок — в
   `AGENTS.md`, строку `.ops/` — в `.gitignore`.
5. `ai refresh` — hook появляется в настройках инструмента;
   `ai ticket-work validate` — автомат пригоден.

## Отключение

Удаляются блок, hook `ops-brief`, `context/ops.yml` (вопрос
пользователю) и строка `.gitignore`, если её не объявляет другой
модуль. Незакрытые jobs — сначала список пользователю. Модули
`watchers` и `dashboard` требуют `ops` — сначала они.

## Синхронизация

Через обновление из источника (skill `source-sync`). Версия рантайма —
версия `@shahimat/harness` в `package.json`.
