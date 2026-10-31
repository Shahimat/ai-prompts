---
key: watchers
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль watchers — наблюдатели за PR и проверками, один планировщик на машину
use_case: Возможность ядра v3 для проекта на ops. Наблюдатель следит за PR или проверками через провайдер review или checks по лестнице L0 код → L1 haiku → L2 sonnet и шлёт запрос в job задачи. Тик — один системный планировщик на машину (launchd, systemd или свой провайдер schedule) для всех проектов из реестра; общий кэш опроса, общий поток событий, общий лимит моделей. Наблюдатель гаснет сам по until или по команде оператора.
tags: [watchers, scheduler, providers, ops, agent-contract, module]
feature:
  summary: наблюдатели за PR и проверками по лестнице код → haiku → sonnet; один планировщик на машину
  default: false
  requires: [ops]
  conflicts: []
  asks:
    - key: review
      question: Через какой провайдер наблюдатель смотрит PR?
      multi: false
      options: [none, project-provider, machine-provider]
    - key: checks
      question: Через какой провайдер наблюдатель смотрит проверки (merge checks, CI)?
      multi: false
      options: [none, project-provider, machine-provider]
---

# Модуль watchers — наблюдатели и планировщик

## Назначение

Трекеры, PR и проверки сами не сообщают об изменениях, локального
вебхука нет: нужен таймер. Постоянный демон — нет.

- **Наблюдатель** — запись `.ops/watches/<id>.yml`: интерфейс (`review`
  или `checks`), запрос провайдеру, интервал (по умолчанию 5 минут,
  минимум 1), `until` (`merged`, `closed`, `done`, `job-done`) и job, к
  которому привязан.
- **Лестница моделей**: L0 — код сравнивает статусы с прошлым тиком,
  без изменений — ноль токенов; L1 — роль `watch-triage` (haiku):
  `ignore`, `notify` или `act`; L2 — роль `watch-request` (sonnet):
  запрос в job задачи (событие `feedback`, job возвращается в правку)
  и действия строками `act:` — `review.comment`, `checks.start` — по
  политике автономии.
- **Внешнее событие job**: job в `awaiting` ставит наблюдателей
  `checks` и `review` по опубликованному изменению сам; наблюдатель
  `review` с `until: merged` при влитии снимается и продолжает job
  (событие `external`).
- **Один планировщик на машину**: реестр проектов
  `~/.config/harness/ops/projects.yml`, один unit (провайдер
  `schedule`: `launchd` на macOS, `systemd` на Linux, свой — на другой
  ОС) раз в минуту запускает диспетчер; тот вызывает тик только в
  проектах, где наблюдателю подошло время, — своей версией пакетов
  проекта.
- **Общее на машину**: кэш опроса (десять проектов, которые следят за
  одними PR, опрашивают систему один раз за интервал), поток событий с
  полем `project`, лимит моделей (`~/.config/harness/ops/limits.yml`:
  jobs — 4, из них opus — 2; наблюдатели — 1).

Установка и снятие планировщика — действие наружу: только после «да»
пользователя, `schedule` в `never` политики запрещает его совсем.

## Вопросы при подключении

- `review`, `checks` — провайдер: `none` (не следить),
  `project-provider` (`.agents/providers/<интерфейс>/<имя>.ts`) или
  `machine-provider` (`~/.config/harness/providers/…` — общий для всех
  проектов машины). Интерфейс: `poll(запрос) → { items: [{ id, state,
  summary, url? }], done? }`, у `review` — ещё `comment(id, текст)` и
  `approve(id, текст)`.

## Что ставит

```yaml
provides:
  layers: []
  files: [.agents/agents/watch-triage.md, .agents/agents/watch-request.md]
  skills: []
  agents_md_block: true
  harness_checks: []
```

Роли — из группы `agents` индекса, SHA — в `parts.agents`. Имена
провайдеров — в `context/ops.yml` → `providers.review`,
`providers.checks`, `providers.schedule` (`auto` — по ОС).

Блок `AGENTS.md`:

<!-- expect:agents-md-readonly -->
```markdown
<!-- module:watchers -->
## watchers

- наблюдатель — `npx ai ops watch add review|checks <запрос>`, снять — `npx ai ops watch stop <id>`;
- планировщик — `npx ai ops schedule on | off`, предложение — `npx ai ops act`: только после «да».
<!-- /module:watchers -->
```
<!-- /expect:agents-md-readonly -->

## Установка

1. Проверь `ops` (иначе `contract-setup` добавит).
2. Поставь роли `watch-triage` и `watch-request`, впиши провайдеры в
   `context/ops.yml`.
3. Провайдер ещё не написан — помоги написать по интерфейсу выше (план
   → «да»); общий для нескольких проектов — на машину.
4. Добавь блок в `AGENTS.md`. Планировщик не ставь: это решение
   пользователя, команда — в блоке.

## Отключение

Наблюдатели проекта и роли удаляются; проект убирается из реестра
машины, unit снимается, только если реестр пуст (после «да»).

## Синхронизация

Через обновление из источника (skill `source-sync`): модуль и роли — по
своим SHA.
