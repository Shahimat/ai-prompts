---
key: analysis
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync, guardrail-dual-level]
title: Модуль analysis — источники, тезисы, взгляды и противоречия с целостностью атрибуции
use_case: Возможность ядра v3 для аналитического проекта (политические процессы, философские тексты, идеологии). Заводит слой analysis/ — источники и тезисы с провенансом и локаторами, свои позиции, посты и разборы, противоречия как сущности первого класса. Целостность атрибуции — приоритетное правило в блоке AGENTS.md (guardrail-dual-level), диалектика развития взглядов, сценарий inquiry «сначала своя база, потом внешний поиск».
tags: [political-analysis, philosophy, knowledge-base, provenance, attribution-integrity, dialectic, retrieval-loop, agent-contract, module]
feature:
  summary: analysis/ — источники, тезисы, позиции, посты, разборы, противоречия; целостность атрибуции и inquiry
  default: false
  requires: []
  conflicts: []
  asks:
    - key: namespaces
      question: Какие области анализа завести как namespaces?
      multi: true
      options: [ideology, philosophy, process]
---

# Модуль analysis — источники, тезисы, взгляды и противоречия

## Назначение

Слой обработки информации и собственных взглядов. Внешнее и своё — в
одних сущностях, различаются провенансом, а не папками:

- `sources` — откуда материал и насколько ему доверяем;
- `claims` — что сказано и где именно (цитата + локатор);
- `positions` — во что я верю; `posts` — мой цельный взгляд на тему;
- `analyses` — оценка конкретного внешнего объекта на фактуре;
- `tensions` — где столкнулись стороны и как система развилась.

Приоритетное правило модуля — целостность атрибуции: ни одной
выдуманной цитаты или приписывания. Правило держится в двух уровнях
(паттерн `guardrail-dual-level`): строками в блоке `AGENTS.md` и
behavior приложения, если оно есть.

Не для проектов без анализа текстов и взглядов. Книги — возможность
`book-corpus`; приложение-агрегатор и провенанс `app-telemetry` —
возможность `app-loop`.

## Вопросы при подключении

- `namespaces` — стартовые области анализа. Каждая выбранная —
  namespace в `context/project.yml` с описанием в одну строку:
  - `ideology` — мои идеологические позиции и посты;
  - `philosophy` — философские источники и тезисы;
  - `process` — политические процессы: речи, обещания, разборы;
    при росте дробится на `process-<name>` (с «да»).

## Что ставит

<!-- expect:attribution-rule -->
```yaml
provides:
  layers: [analysis/sources/, analysis/claims/, analysis/positions/,
           analysis/tensions/, analysis/posts/, analysis/analyses/]
  files: []
  skills: [analysis]
  agents_md_block: true
  harness_checks: []
  index_layers:
    - {section: sources, dir: analysis/sources, format: yml}
    - {section: claims, dir: analysis/claims, format: yml}
    - {section: positions, dir: analysis/positions, format: yml}
    - {section: tensions, dir: analysis/tensions, format: yml}
    - {section: posts, dir: analysis/posts, format: md}
    - {section: analyses, dir: analysis/analyses, format: md}
```

Требования индекса: в yml-файле — `id` (путь внутри слоя без
расширения, `/` → `-`), `namespace`, `summary` в одну строку; в md —
frontmatter `id`, `namespace` и первый заголовок `# …`. Форматы
сущностей, провенанс, `verified` / `reconciled`, диалектика, `inquiry` —
skill `analysis`.

`changelog_tags` модуль не добавляет: эволюция взглядов живёт в
`tensions` (`status: synthesized` + `synthesis`), крупные вехи — в
`CHANGELOG.md` ядра с тегом `[milestone]`.

Блок `AGENTS.md`:

```markdown
<!-- module:analysis -->
## analysis

Целостность атрибуции — приоритетно в работе с анализом; дополняет правила ядра, не отменяет:
- ни одной выдуманной цитаты: дословно — только сверенное с оригиналом, иначе пересказ с пометкой;
- всё приписанное (чужое и моё) — с локатором; оригинал недоступен — `verified: false`, не догадка;
- сказал (`primary`) / написали (`secondary`) / думаю (`own`) не смешивать; оценка — как оценка, свою позицию агент не протаскивает;
- сомнение в атрибуции → «не сверено» и вопрос пользователю; правило не ослабляется ради сценария.

- вопрос по существу → сценарий `inquiry`: сначала `context/index.yml` → `analysis/*`, на пробеле — внешний поиск;
- противоречие не стирать: `tension` + синтез; форматы, провенанс, `reconciled` → skill `analysis`.
<!-- /module:analysis -->
```
<!-- /expect:attribution-rule -->

## Установка

1. Создай шесть каталогов `analysis/*/`.
2. Добавь выбранные namespaces в `context/project.yml` (план → «да»).
3. Поставь skill `analysis` в `.agents/skills/analysis/`.
4. Добавь блок в `AGENTS.md`.
5. Подключён harness с `context-index` — `harness context index`.
6. Подключён `domain` и в проекте есть приложение — предложи стартовые
   behavior уровня приложения (раздел «Правило в двух уровнях» skill
   `analysis`): детекция непроверенной атрибуции, реакция «не выдавать
   за факт, показать статус сверки», хранение локатора.

## Миграция с analytical-project

Слой `analysis/` остаётся на месте; меняются поля.

Переезжает:

- `sources` — добавить `summary`;
- `claims` — `statement` → `summary` (одна строка);
- `positions` — `statement` → `summary`, `rationale` остаётся;
- `tensions` — `summary` сжать до одной строки, подробности — в
  `note`;
- `posts`, `analyses` — frontmatter `id` = имя файла (без `name`),
  заголовок `# …`;
- `serves` / `automated_by` в `analysis/*` — по модулю `app-loop`; без
  него — удалить пустые;
- `map` у книг — по модулю `book-corpus`;
- записи `CHANGELOG-analysis.md`: синтез противоречия — в `synthesis`
  его `tension` (нет `tension` — завести); крупная веха — строка
  `[milestone]` в `CHANGELOG.md` ядра; остальное — удалить (есть в
  git log).

Выбрасывается (план — пользователю, удаление после «да»):

- `CHANGELOG-analysis.md` — после разбора записей;
- копии правил в `context/conventions/`: `attribution-integrity`,
  `dialectic`, `verification` — правила теперь в блоке и skill;
- `context/workflow.md` — сценарии в skill `workflow` ядра, `inquiry` —
  в skill `analysis`;
- раздел о приоритете атрибуции в старом `CLAUDE.md` — заменён блоком
  модуля;
- hook `block-memory-write-for-analytical-project.sh` и memory по
  проекту — по разделу «Memory агента» ядра;
- ручной `context/index.yml` — генерируется harness или не ведётся.

`CHANGELOG-app.md`, `app/*`, `data_access`, `privacy`, `book-ingestion`,
цели с `domain: analysis | app` — миграция модулей `app-loop`,
`data-access`, `privacy`, `book-corpus`, `goals` и ядра.

## Отключение

- `book-corpus` подключён — сначала он: требует `analysis`.
- Слои с содержимым — отдельный вопрос: удалить или оставить как
  обычные файлы проекта.
- Skill `analysis` и блок `AGENTS.md` удаляются; namespaces в
  `context/project.yml` — вопрос пользователю.
- Behavior приложения про атрибуцию остаются в слое `domain` до решения
  пользователя.

## Синхронизация

Через обновление из источника (skill `source-sync`): модуль и skill
`analysis` — по своим SHA. Inline-раздел «Правило в двух уровнях» в
skill обновляется вместе с паттерном `guardrail-dual-level`; отстал —
план миграции.
