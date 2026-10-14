---
key: harness
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль harness — проверки и генерация через @shahimat/harness
use_case: Возможность ядра v3. Подключает CLI @shahimat/harness (Node ≥ 24) — проверка CHANGELOG, поиск секретов, генерация context/index.yml, генерация адаптеров под Claude Code и Codex, общий harness check. Конфиг — context/harness.yml.
tags: [harness, automation, agent-contract, module]
feature:
  summary: "@shahimat/harness — проверки CHANGELOG, генерация индекса и адаптеров (нужен Node ≥ 24)"
  default: true
  requires: []
  conflicts: []
  asks:
    - key: checks
      question: Какие проверки включить в harness check?
      multi: true
      options: [changelog, context-index, adapters]
    - key: adapters
      question: Под какие инструменты генерировать файлы?
      multi: true
      options: [claude-code, codex]
---

# Модуль harness — проверки и генерация через @shahimat/harness

## Назначение

Всё, что можно проверить или сгенерировать механически, делает CLI, а
не память агента: формат CHANGELOG, индекс `context/index.yml`, файлы
под инструменты. Агенту остаётся смысловая часть.

Требование к машине — Node ≥ 24. Работает на macOS, Linux, Windows.

## Вопросы при подключении

- `checks` — проверки `harness check`. По умолчанию все три:
  - `changelog` — формат `CHANGELOG.md`;
  - `context-index` — `context/index.yml` актуален, у слоёв есть `id`,
    `namespace`, `summary` / `title`;
  - `adapters` — сгенерированные файлы совпадают с источниками.

  `secrets` — поиск ключей, токенов, паролей и приватных ключей в
  отслеживаемых файлах — в вопрос не входит: включена всегда.
  Выключается только явно, `secrets: false` в `context/harness.yml`.
- `adapters` — инструменты, под которые генерировать файлы. По
  умолчанию — те, что назвал пользователь при установке ядра.

## Что ставит

```yaml
provides:
  layers: []
  files: [context/harness.yml, context/index.yml]
  skills: [harness]
  agents_md_block: true
  harness_checks: [<из ответа checks>]
```

`context/index.yml` ставится, только если выбран `context-index`.

`context/harness.yml`:

```yaml
version: <последняя версия @shahimat/harness>
adapters: [<из ответа adapters>]
checks:
  changelog: {}
  context-index: {}
  adapters: {}
```

Блок `AGENTS.md`:

<!-- expect:agents-md-readonly -->
```markdown
<!-- module:harness -->
## harness

- карта id по namespace → `context/index.yml` (генерируется);
- в конце задачи — `harness refresh`; команды и конфиг → skill `harness`;
- сгенерированные файлы руками не правятся.
<!-- /module:harness -->
```
<!-- /expect:agents-md-readonly -->

## Установка

1. Проверь `node --version` ≥ 24. Нет — скажи пользователю, модуль не
   подключай.
2. Версию возьми из npm: `npm view @shahimat/harness version`.
3. Создай `context/harness.yml` по ответам.
4. Поставь skill `harness`, добавь блок в `AGENTS.md`.
5. Выбран `context-index` — `harness context index`; нарушения
   (`нет поля summary` и т.п.) — план правок через docs-keeper.
6. Выбран `adapters` — `harness adapters sync`. Файлы, которые агент
   создал вручную при установке ядра, sync узнаёт по метке и
   перезаписывает.
7. `harness check`. Нарушения — отчёт пользователю с планом.

## Отключение

Удаляются `context/harness.yml`, skill и блок. `context/index.yml` —
вопрос пользователю: удалить или вести дальше руками. Адаптеры
остаются; их актуальность — снова на агенте.

## Синхронизация

Через обновление из источника (skill `source-sync`). Версия CLI обновляется
отдельно: правкой `version` в `context/harness.yml` после «да».
