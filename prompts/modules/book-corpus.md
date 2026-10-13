---
key: book-corpus
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль book-corpus — многопроходная загрузка книг из внешнего корпуса
use_case: Возможность ядра v3 поверх analysis. Книга не коммитится и целиком в контекст не читается — сырой текст живёт во внешнем корпус-хранилище (MCP, API или локальная выгрузка) и читается по каналу из context/data-access.yml; в git — только производное знание (source с картой map и извлечённые тезисы с локаторами). Проходы 0–3 от дешёвого к дорогому.
tags: [book-ingestion, knowledge-base, attribution-integrity, retrieval-loop, agent-contract, module]
feature:
  summary: книги из внешнего корпуса — проходы 0–3, карта map и тезисы с локаторами, сырой текст вне git
  default: false
  requires: [analysis, data-access]
  conflicts: []
  asks:
    - key: corpus-kind
      question: Где живёт корпус книг и как агент его читает?
      multi: false
      options: [mcp, api, local-export]
---

# Модуль book-corpus — загрузка книг из внешнего корпуса

## Назначение

Книга не влезает в контекст, а чтение целиком убивает скорость и
верифицируемость. Модуль превращает книгу в сущности слоя `analysis`
за несколько проходов — от дешёвого к дорогому — и даёт `inquiry`
спуститься в нужную главу по требованию.

- Сырой текст в git не коммитится (объём, копирайт, приватность): он
  во внешнем корпус-хранилище, доступ — по каналу `corpus` модуля
  `data-access`.
- В git — производное: `source` книги с картой `map`, тезисы с
  локаторами.

Своих слоёв нет: модуль пишет в `analysis/sources/` и
`analysis/claims/` и добавляет в источники поле `map`.

## Вопросы при подключении

- `corpus-kind` — вид канала к корпусу:
  - `mcp` — MCP-сервер хранилища (например, приложение на NAS);
  - `api` — HTTP API хранилища;
  - `local-export` — локальная выгрузка вне репозитория (каталог,
    путь в `.gitignore` или за пределами проекта).

## Что ставит

```yaml
provides:
  layers: []
  files: []
  skills: [book-corpus]
  agents_md_block: true
  harness_checks: []
  extends:
    analysis: [map]
```

Канал: в `context/data-access.yml` → `channels` заводится запись
`name: corpus`, `kind` — ответ `corpus-kind` (он же должен быть в
`kinds`), `provides` — «тексты книг по handle и главе». Формат и
правила — skill `data-access`; секретов в репозитории нет.

Блок `AGENTS.md`:

```markdown
<!-- module:book-corpus -->
## book-corpus

- книга → проходы 0–3 по skill `book-corpus`; канал `corpus` → `context/data-access.yml`;
- сырой текст книги не коммитится и целиком в контекст не читается: `map` и тезисы, глава — через канал по требованию;
- канал недоступен → цитата остаётся `verified: false`, не по памяти.
<!-- /module:book-corpus -->
```

## Установка

1. Проверь, что подключены `analysis` и `data-access`.
2. Канал `corpus` в `context/data-access.yml` по ответу `corpus-kind`
   (план → «да»); проверь доступность пробным запросом оглавления.
3. Поставь skill `book-corpus` в `.agents/skills/book-corpus/`.
4. Добавь блок в `AGENTS.md`.
5. Есть книги, лежащие в репозитории, — план: перенести в корпус,
   удалить из git (история — решение пользователя), зарегистрировать
   проходом 0.

## Миграция с analytical-project

Переезжает:

- `context/project.yml` → `data_access.corpus` — в канал `corpus`
  `context/data-access.yml` (вместе с миграцией модуля `data-access`);
- `analysis/sources/*` с `type: book` и `map` — на месте; `map` с
  разделами глубже глав — сжать до уровня глав;
- `locator_base: corpus://<handle>` — остаётся.

Выбрасывается:

- `context/conventions/book-ingestion.yml` — копия правила, теперь в
  skill;
- упоминания `data_access` в старом `CLAUDE.md` и `context/workflow.md`
  — заменены блоком модуля.

## Отключение

- Канал `corpus` в `context/data-access.yml` — вопрос пользователю.
- Поле `map` в источниках — вопрос: удалить или оставить как обычное
  поле (без модуля его никто не ведёт).
- Skill и блок `AGENTS.md` удаляются. Тезисы и источники книг остаются
  в `analysis`.

## Синхронизация

Через «сверь всё» проекта (skill `source-sync`): модуль и skill
`book-corpus` — по своим SHA.
