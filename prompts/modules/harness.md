---
key: harness
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль harness — автоматы через @shahimat/harness
use_case: Возможность ядра v3. Добавляет в devDependencies проекта @shahimat/harness — автоматы docs-delta (запись в документацию ролями docs-keeper и judge) и source-sync (обновление из источника), а также исполнение своих автоматов проекта из .agents/harnesses/. Запуск — через CLI ai ядра.
tags: [harness, automation, agent-contract, module]
feature:
  summary: "@shahimat/harness — автоматы docs-delta и source-sync, свои автоматы проекта в .agents/harnesses/"
  default: true
  requires: []
  conflicts: []
---

# Модуль harness — автоматы

## Назначение

Автомат — последовательность состояний, где переходами управляет
скрипт, а роли и агент работают внутри состояний. Модуль добавляет пакет
`@shahimat/harness`, после чего CLI `ai` ядра знает автоматы:

- `ai docs-delta` — запись в документацию: роль `docs-keeper` пишет,
  `ai` проверяет, роль `judge` ищет противоречия, дельта закрывается;
- `ai source-sync` — обновление из источника;
- свои автоматы проекта из `.agents/harnesses/<name>/`.

Без модуля всё остальное работает: команды и скрипты `ai` — ядро,
запись в документацию — через субагента `docs-keeper`.

## Что ставит

```yaml
provides:
  layers: []
  files: [package.json]
  skills: []
  agents_md_block: true
  harness_checks: []
```

`package.json` — только строка `@shahimat/harness` в `devDependencies`,
точная версия.

Блок `AGENTS.md`:

<!-- expect:agents-md-readonly -->
```markdown
<!-- module:harness -->
## harness

- запись в документацию — `npx ai docs-delta start --file -` (правило 4);
- обновление из источника — `npx ai source-sync start`;
- свои автоматы → `.agents/harnesses/`, справка — skill `cli`.
<!-- /module:harness -->
```
<!-- /expect:agents-md-readonly -->

## Установка

1. Версию возьми из npm: `npm view @shahimat/harness version`.
2. Добавь `@shahimat/harness` в `devDependencies` `package.json` с
   точной версией; `npm install` — после «да».
3. Добавь блок в `AGENTS.md`.
4. `npx ai docs-delta validate` — автомат виден и пригоден.

## Отключение

Удаляются строка `@shahimat/harness` из `devDependencies` и блок.
Свои автоматы в `.agents/harnesses/` остаются — без модуля `ai`
сообщает, что исполнять их нечем.

## Синхронизация

Через обновление из источника (skill `source-sync`). Версия пакета
обновляется правкой `devDependencies` и `npm install` после «да»; что
нового — `npx ai outdated`.
