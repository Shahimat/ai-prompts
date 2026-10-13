---
key: data-access
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль data-access — каналы к внешним данным
use_case: Возможность ядра v3 для проектов, где агенту нужны живые данные вне репозитория — API приложения, MCP-сервер (например, корпус-хранилище книг), локальный экспорт. Заводит реестр каналов context/data-access.yml (что отдаёт, свежесть, где взять секрет — без самих секретов) и правила чтения — свежесть, недоступность, минимальный срез.
tags: [data-access, mcp, api, agent-contract, module]
feature:
  summary: каналы к живым данным вне репозитория (MCP, API, экспорт) — свежесть, недоступность, секреты вне git
  default: false
  requires: []
  conflicts: []
  asks:
    - key: kinds
      question: Какие виды каналов к данным будут в проекте?
      multi: true
      options: [mcp, api, local-export]
---

# Модуль data-access — каналы к внешним данным

## Назначение

Сырьё — снаружи, дистиллят — в git. Живые данные (значения из
приложения, корпус книг, выгрузки сервисов) агент читает из объявленного
канала, а не из заметок, памяти или собственной догадки. Канал — запись
в реестре: где, что отдаёт, насколько свежее, где взять секрет.

Не нужен проекту, у которого вся правда — в коде и документах
репозитория.

## Вопросы при подключении

- `kinds` — виды каналов: `mcp` (MCP-сервер), `api` (HTTP API),
  `local-export` (файл или каталог выгрузки на машине). Ограничивает
  допустимые `kind` в реестре; новый вид — повторный вопрос через
  `contract-setup`.

## Что ставит

```yaml
provides:
  layers: []
  files: [context/data-access.yml]
  skills: [data-access]
  agents_md_block: true
  harness_checks: []
```

`context/data-access.yml` — собственный файл модуля, не блок в
`context/project.yml`:

```yaml
# Каналы к данным вне репозитория. Правила — skill data-access.
# Секреты здесь не хранятся: только указатель, где их взять.
kinds: [<из ответа kinds>]
channels:
  - name: <kebab-case, стабильный>
    kind: mcp | api | local-export
    endpoint: <имя MCP-сервера / базовый URL / путь к экспорту>
    provides: <одна строка — какие данные отдаёт>
    freshness: <как часто обновляется и с какого возраста данные устарели>
    secret: <где взять: env NAME / keychain item / менеджер паролей; none>
    on_unavailable: <запасной путь: ручной ввод, команда экспорта; необязательно>
```

Пример (синтетический):

```yaml
kinds: [mcp, api]
channels:
  - name: corpus
    kind: mcp
    endpoint: books-nas
    provides: тексты книг по handle и главе
    freshness: статично; новые книги — по загрузке
    secret: env CORPUS_TOKEN
  - name: app
    kind: api
    endpoint: http://localhost:8080/api
    provides: агрегаты сигналов по дням
    freshness: ежедневно; старше 2 суток — устарело
    secret: keychain app-api-token
    on_unavailable: ручной ввод значений пользователем
```

Блок `AGENTS.md`:

<!-- expect:agents-md-readonly -->
```markdown
<!-- module:data-access -->
## data-access

- живые данные вне репозитория → канал из `context/data-access.yml`, не заметки и не догадка;
- канал недоступен или данные устарели — скажи прямо, чисел не выдумывай;
- секреты — только вне репозитория; свежесть, минимальный срез → skill `data-access`.
<!-- /module:data-access -->
```
<!-- /expect:agents-md-readonly -->

## Установка

1. Создай `context/data-access.yml` с `kinds` из ответа и пустым
   `channels`.
2. Поставь skill `data-access`, добавь блок в `AGENTS.md`.
3. Спроси, какие каналы уже есть: для каждого — запись по формату,
   план → «да» → через docs-keeper. Секрет в ответе пользователя — не
   записывай, спроси, где он хранится.
4. Проверь доступность каждого канала минимальным запросом; результат —
   в отчёт, не в файл.
5. `.gitignore`: проверь, что локальные файлы с секретами (`.env` и
   т.п.) игнорируются; нет — предложи правку.

## Миграция с personal-project / analytical-project

Переезжает сюда:

- блок `data_access` из `context/project.yml` → `channels` в
  `context/data-access.yml` (`corpus`, `app` → `name`; `auth` →
  `secret` как указатель); блок из `project.yml` удаляется;
- правила «Канала живых данных» (свежесть, недоступность) — в skill
  `data-access`.

Не сюда:

- многопроходная загрузка книг (`book-ingestion`) — модуль `book-corpus`;
  здесь только канал `corpus`;
- провенанс и «транспорт ≠ провенанс» — модули домена и `app-loop`;
- приватность прочитанных значений — модуль `privacy`.

Выбрасывается: копии разделов в `context/conventions/` — правила в
skill.

## Отключение

Реестр каналов — вопрос пользователю: удалить или оставить как обычный
файл. Skill и блок удаляются. Секреты вне репозитория модуль не трогает.

## Синхронизация

Через обновление из источника (skill `source-sync`): модуль и skill
`data-access` — по своим SHA.
