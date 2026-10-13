---
key: domain
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль domain — entities и behavior с верификацией
use_case: Возможность ядра v3. Заводит слой общей правды docs/entities/ (что есть) и docs/behavior/ (как должно работать, BDD-сценарии, verified с датой и способом проверки). Связь с кодом — поле paths у entity, автоматическая проверка — поле check у behavior.
tags: [docs-as-code, bdd-verification, agent-contract, module]
feature:
  summary: entities и behavior — что есть и как должно работать, verified по свежей проверке
  default: true
  requires: []
  conflicts: []
---

# Модуль domain — entities и behavior с верификацией

## Назначение

Формальная модель проекта, которую читают и человек, и агент:

- **entity** — что это за штука, из чего состоит, от чего зависит;
- **behavior** — как должно работать (given / when / then) и проверено
  ли (`verified`, `verified_at`, `verified_note`).

Нужен проектам с инфраструктурой, API, интеграциями — всем, где
«работает ли X» проверяется и забывается. Маленькому скрипту не нужен.

## Что ставит

```yaml
provides:
  layers: [docs/entities/, docs/behavior/]
  files: []
  skills: [domain]
  agents_md_block: true
  harness_checks: []
```

Skill `domain` — правила слоя: форматы entity и behavior, верификация,
namespace, проверки. Берётся из индекса источника.

Блок `AGENTS.md`:

```markdown
<!-- module:domain -->
## domain

- как сейчас устроено X → `docs/entities/<id>.yml`, затем код;
- как X должно себя вести и проверено ли → `docs/behavior/<id>.yml`;
- правила слоя и `verified` → skill `domain`.
<!-- /module:domain -->
```

## Установка

1. Создай `docs/entities/` и `docs/behavior/`.
2. Поставь skill `domain` в `.agents/skills/domain/`.
3. Добавь блок в `AGENTS.md`.
4. Предложи пользователю 1–3 стартовые entity по коду: план → «да» →
   через docs-keeper.

## Миграция с v2

Слои уже есть — файлы не переносятся. Добавь в каждую entity
`summary` (однострочные описания обычно есть в ручном
`context/index.yml`) и, где очевидно, `paths`. `check` у behavior —
по мере появления команд.

## Отключение

Слои с содержимым — отдельный вопрос: удалить или оставить как обычные
файлы. Skill и блок `AGENTS.md` удаляются.

## Синхронизация

Через обновление из источника (skill `source-sync`): модуль и skill
`domain` — по своим SHA.
