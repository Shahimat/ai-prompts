---
key: safety-boundaries
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync, guardrail-dual-level]
title: Модуль safety-boundaries — агент не врач и не терапевт, red-flag → помощь
use_case: Возможность ядра v3 для проектов, где агент говорит с человеком о здоровье, теле или психике. Правило границ и red-flag эскалации — целиком в блоке AGENTS.md (всегда в контексте) и в skill safety-boundaries; при подключённом domain — обязательные behavior приложения по паттерну guardrail-dual-level.
tags: [safety-boundaries, personal, guardrail, agent-contract, module]
feature:
  summary: границы безопасности — агент не врач и не терапевт, red-flag → стоп и направление к помощи
  default: false
  requires: []
  conflicts: []
  asks:
    - key: scope
      question: Какие области red-flag покрывают behavior приложения?
      multi: true
      options: [physical, psyche]
    - key: app-behaviors
      question: Заводить behavior приложения по правилу сейчас или позже?
      multi: false
      options: [now, later]
---

# Модуль safety-boundaries — агент не врач и не терапевт

## Назначение

Приоритетное правило для проектов, где разговор касается здоровья, тела
или психики: агент помогает наблюдать и организовывать, но не ставит
диагнозы и не лечит; признаки острой опасности — стоп и направление к
профессиональной или экстренной помощи.

Применение паттерна `guardrail-dual-level`: правило агента — целиком в
блоке `AGENTS.md` (всегда в контексте), детали и inline-копия паттерна —
в skill; поведение приложения — обязательные behavior слоя `domain`.

## Вопросы при подключении

- `scope` — области, для которых заводятся behavior приложения:
  `physical` (острые физические симптомы), `psyche` (кризис психики).
  Правило агента в блоке покрывает обе области всегда, независимо от
  ответа.
- `app-behaviors`:
  - `now` — стартовые behavior заводятся при подключении; нужен
    `domain` и приложение в проекте. Нет `domain` — скажи и предложи
    `later`;
  - `later` — behavior не заводятся; отсутствие behavior поднимается в
    `report` (проверка паттерна), задача — в цель, если подключён
    `goals`.

## Что ставит

<!-- expect:safety-rule -->
```yaml
provides:
  layers: []
  files: [docs/behavior/safety-*.yml]   # только при app-behaviors: now
  skills: [safety-boundaries]
  agents_md_block: true
  harness_checks: []
```

Стартовые behavior (по `scope`: детекция, реакция, без медицинских
советов) — шаблоны в skill `safety-boundaries`.

Блок `AGENTS.md` — правило целиком, без сокращений:

```markdown
<!-- module:safety-boundaries -->
## safety-boundaries

- Агент — помощник для самоанализа и организации, не врач и не
  терапевт: не ставит диагнозы, не назначает лечение, препараты, дозы.
- Red-flag (острое физическое состояние, кризис психики, вред себе или
  другим) → стоп: не продолжать сценарий, не диагностировать, коротко
  направить к профессиональной помощи или экстренным службам.
- Сомнение — в пользу безопасности. Правило приоритетнее формата
  сценария; дополняет жёсткие правила ядра, не отменяет их.
<!-- /module:safety-boundaries -->
```

Категории, формулировки ответов и behavior — skill `safety-boundaries`.
<!-- /expect:safety-rule -->

## Установка

1. Поставь skill `safety-boundaries` в `.agents/skills/`.
2. Добавь блок в `AGENTS.md` дословно.
3. `app-behaviors: now` и подключён `domain` — план стартовых behavior
   по `scope` (шаблоны — skill), с entity, принимающей ввод человека;
   «да» → через docs-keeper. `verified: false`, пока не проверены.
4. `later` — задача «behavior safety-boundaries» в цель, если подключён
   `goals`; иначе — строка в итоговом отчёте.

## Миграция с personal-project

Переезжает:

- раздел «Границы и безопасность» — в блок `AGENTS.md` и skill; свои
  уточнения проекта (например, контакты помощи) — в
  `context/project.yml` → `external` или в протокол;
- `app/behavior/*.yml` про red-flag — остаются behavior слоя `domain`
  (путь — по миграции `domain` / `app-loop`); `verified` сохраняется;
- `app-behaviors` отмечается `now`, если такие behavior уже есть.

Выбрасывается:

- `context/conventions/safety-boundaries.yml` — копия правила
  контракта, в v3 не заводится;
- напоминание о безопасности в `CLAUDE.md` — его заменяет блок;
- hook и протокол `setup-safety-hooks` — по миграции ядра.

## Отключение

- Сначала предупреди: правило перестанет быть в контексте агента.
  Отключение — явное решение пользователя, запись через docs-keeper.
- Удаляются skill и блок `AGENTS.md`.
- Behavior из `provides.files` — вопрос: удалить или оставить обычными
  behavior `domain`.

## Синхронизация

Через обновление из источника (skill `source-sync`). Блок `AGENTS.md`
обновляется из модуля; skill — вместе с паттерном
`guardrail-dual-level` в источнике.
