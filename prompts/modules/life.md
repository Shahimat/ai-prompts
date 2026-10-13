---
key: life
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль life — домен жизни (факты, сигналы, протоколы)
use_case: Возможность ядра v3 для личного проекта самоанализа и саморазвития. Заводит домен жизни life/ — устойчивые факты о человеке, определения отслеживаемых сигналов и протоколы-рутины, все с провенансом. Решения о жизни идут в общий CHANGELOG.md с тегом [life]. Требует privacy.
tags: [personal, self-analysis, provenance, agent-contract, module]
feature:
  summary: домен жизни — факты о человеке, отслеживаемые сигналы и протоколы-рутины с провенансом
  default: false
  requires: [privacy]
  conflicts: []
  asks:
    - key: areas
      question: Какие области жизни ведём? Выбранные станут namespaces в context/project.yml.
      multi: true
      options: [health, sport, psyche, routine, nutrition, sleep]
---

# Модуль life — домен жизни (факты, сигналы, протоколы)

## Назначение

Правда о человеке, которую читают и он сам, и агент:

- **факт** — что про человека устойчиво верно (ограничение, стабильное
  предпочтение, подтверждённая особенность);
- **сигнал** — что отслеживается во времени и откуда берутся данные;
  сами значения здесь не хранятся;
- **протокол** — рутина, которую человек выполняет руками.

У факта и сигнала — провенанс: `self-report`, `external` или
`app-telemetry`. Нужен личному проекту про здоровье, спорт, психику,
распорядок.

Требует `privacy`: данные интимные, правила их хранения и показа — там.
Связь с приложением (`automated_by`, `app-telemetry`) — модуль
`app-loop`; живые значения сигналов — модуль `data-access`.

## Вопросы при подключении

- `areas` — области жизни. Каждая выбранная становится namespace в
  `context/project.yml` с описанием в одну строку (`health: здоровье и
  восстановление`); выбор и есть «да» на эти namespaces. Новые области
  позже — по обычному правилу ядра.

## Что ставит

```yaml
provides:
  layers: [life/facts/, life/signals/, life/protocols/]
  files: []
  skills: [life]
  agents_md_block: true
  harness_checks: []
  changelog_tags: [life]
  index_layers:
    - {section: facts, dir: life/facts/, format: yml}
    - {section: signals, dir: life/signals/, format: yml}
    - {section: protocols, dir: life/protocols/, format: yml}
```

Файлы слоёв — YAML: `id` (путь внутри слоя без `.yml`, `/` → `-`),
`namespace`, `summary` в одну строку, дальше поля вида. Форматы,
провенанс и `verified` — skill `life`.

Блок `AGENTS.md`:

```markdown
<!-- module:life -->
## life

- что верно обо мне / что отслеживаю / что делаю руками →
  `life/facts/`, `life/signals/`, `life/protocols/` по namespace;
- формат, провенанс, `verified`, тег журнала `[life]` → skill `life`;
- тон о жизни человека — поддерживающий, без осуждения и морали.
<!-- /module:life -->
```

## Установка

1. Создай `life/facts/`, `life/signals/`, `life/protocols/`.
2. Добавь namespaces из `areas` в `context/project.yml`.
3. Поставь skill `life` в `.agents/skills/life/`, добавь блок в
   `AGENTS.md`.
4. Подключён harness — тег `life` в `checks.changelog.tags`
   `context/harness.yml`.
5. Спроси, с чего начать: 1–3 факта или сигнала со слов человека —
   план → «да» → через docs-keeper. Значений в файлы не пишем.

## Миграция с personal-project

Переезжает:

- `life/facts/*.yml`, `life/signals/*.yml` — на месте; добавить
  `summary` (у сигналов — из `title`), проверить `id` по правилу пути;
- `life/protocols/*.md` → `life/protocols/<id>.yml`: «Когда
  использовать», «Шаги», «Если сбился» — в поля `when`, `steps`,
  `if_off`; `.md` удалить после «да»;
- `automated_by` — остаётся, только если подключается `app-loop`;
  иначе удалить. `serves` в файлах life — удалить: это поле стороны
  приложения (`app-loop`), связь с целью живёт в цели;
- `CHANGELOG-life.md` → строки в `CHANGELOG.md` с `[life]`, до 120
  символов, без значений и диагнозов; WIP и подробности — выбросить;
- namespaces жизни в `context/project.yml` — остаются; `areas`
  отмечаются по ним.

Выбрасывается:

- второй журнал `CHANGELOG-life.md` (судьба `CHANGELOG-app.md` — по
  миграции `app-loop`);
- копия `context/conventions/verification.yml`: часть про провенанс —
  в skill `life`, часть про код — в skill `domain`;
- копии `safety-boundaries.yml` и `privacy.yml` — заменяются модулями
  `safety-boundaries` и `privacy`;
- `context/workflow.md`, hook `block-memory-write-for-personal-project.sh`
  и протокол `setup-safety-hooks` — по миграции ядра (раздел «Memory
  агента»).

Brownfield (заметки, дневники, трекеры) — классификация каждого куска:
факт, сигнал, протокол, задача (в цель, если подключён `goals`),
решение (в журнал с `[life]`), источник данных (подключить через
`data-access`, содержимое не копировать), шум. Реальные значения в
документацию не переносятся — только определения и провенанс. Шаги:
факты и сигналы → протоколы → журнал; после каждого — отчёт.

## Отключение

- `life/` с содержимым — вопрос: удалить или оставить обычными файлами;
- namespaces из `areas` — вопрос: убрать или оставить;
- skill, блок `AGENTS.md`, тег в `context/harness.yml` удаляются;
  записи `[life]` в `CHANGELOG.md` остаются.

## Синхронизация

Через обновление из источника (skill `source-sync`): модуль и skill `life` —
по своим SHA.
