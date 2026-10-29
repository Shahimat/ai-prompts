---
key: dashboard
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль dashboard — HTML-доска jobs и ответы из браузера
use_case: Возможность ядра v3 для проекта на ops. ai ops serve поднимает локальную HTML-доску - jobs и их состояния, вопросы ролей, журналы хода, прогоны ролей, наблюдатели и события; с --all — все проекты машины из реестра. Ответ на вопрос или решение по плану можно дать в браузере - он записывается в job, оператор получает событие и продолжает работу.
tags: [dashboard, ops, html, agent-contract, module]
feature:
  summary: локальная HTML-доска jobs, журналов и событий; ответы на вопросы из браузера
  default: false
  requires: [ops]
  conflicts: []
---

# Модуль dashboard — доска jobs

## Назначение

Сводка оператора в чате — до 10 строк. Подробности — на доске:

- jobs проекта (или всех проектов машины с `--all`): состояние, кто
  ждёт ответа;
- страница job: вопросы ролей, план и готовность с формой ответа,
  артефакты (`task.md`, `research.md`, `plan.md`, `diff`, `review.md`),
  прогоны ролей (полный stream-json), журнал хода;
- наблюдатели и последние события.

Доска локальная (`127.0.0.1`), страница обновляется сама. Ответ из
браузера записывается в job и событие `answered`; работу продолжает
оператор — так ответ проходит тот же путь, что и в чате.

## Что ставит

```yaml
provides:
  layers: []
  files: []
  skills: []
  agents_md_block: true
  harness_checks: []
```

Блок `AGENTS.md`:

<!-- expect:agents-md-readonly -->
```markdown
<!-- module:dashboard -->
## dashboard

- доска и ответы — `npx ai ops serve` (`--all` — вся машина); событие `answered` — продолжи job.
<!-- /module:dashboard -->
```
<!-- /expect:agents-md-readonly -->

## Установка

1. Проверь `ops` (иначе `contract-setup` добавит).
2. Добавь блок в `AGENTS.md`.

## Отключение

Удаляется блок; данные доски — файлы рантайма `ops`, они остаются.

## Синхронизация

Через обновление из источника (skill `source-sync`). Версия доски —
версия `@shahimat/harness` в `package.json`.
