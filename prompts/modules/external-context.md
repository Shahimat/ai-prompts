---
key: external-context
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль external-context — репозиторий-оверлей поверх живого проекта
use_case: Возможность ядра v3 для репозитория, который описывает чужой живой проект (системы, оргправила, процессы, устойчивые знания) и своего кода не держит. Источник реальности — целевые системы из reality; entity получают type, canonical_source, owner, target и др.; verified ставится по свежей проверке вне кода; audit сверяет записи с живыми системами. Заменяет external-project-context-v2.
tags: [external-context, docs-as-code, bdd-verification, agent-contract, module]
feature:
  summary: репозиторий-оверлей над чужим проектом — системы, оргправила и процессы как entity со ссылкой на canonical, audit живых ссылок
  default: false
  requires: [domain]
  conflicts: []
  asks:
    - key: namespaces
      question: Какие стартовые namespaces завести?
      multi: true
      options: [systems, org, processes, knowledge]
    - key: starter-manuals
      question: Какие стартовые manuals завести (нужен модуль manuals)?
      multi: true
      options: [onboarding, create-ticket, request-access, prepare-release, hotfix-intake, escalation, faq]
    - key: target-access
      question: Как агент добирается до кода целевого проекта?
      multi: false
      options: [url-only, local-checkout, none]
    - key: legacy-v1
      question: Есть ли легаси первой версии (registry/, assets/, knowledge/, procedures/)?
      multi: false
      options: ["yes", "no"]
---

# Модуль external-context — репозиторий-оверлей поверх живого проекта

## Назначение

Отдельный репозиторий — дешёвая операционная карта чужого живого
проекта: репозитории, трекеры, доски, формы, среды, оргправила,
процессы. Живая система — canonical; запись здесь — summary, ссылка и
`verified_at`, не копия.

- Источник реальности ядра (`reality` в `context/project.yml`) — ключи
  `external` целевых систем, не `this-repo`. Маршрут «как сейчас» ядра
  уже ведёт туда; модуль ядро не меняет.
- Слои — `docs/entities/` и `docs/behavior/` модуля `domain`,
  `docs/manuals/` модуля `manuals` (если подключён). Модуль добавляет
  поля entity через `extends`, словарь, тег журнала и skill.
- Не для проекта со своим кодом: там `reality: [this-repo]` и хватает
  `domain`.

## Вопросы при подключении

- `namespaces` — стартовые области в `context/project.yml` (ответ —
  это «да» на новые namespace). По умолчанию `systems`, `processes`:
  - `systems` — репозитории, трекеры, доски, wiki, формы, среды;
  - `org` — оценка, ownership, коммуникации, ограничения;
  - `processes` — intake, delivery, review, release, hotfix, escalation;
  - `knowledge` — устойчивые нюансы и pitfalls.
- `starter-manuals` — заготовки в `docs/manuals/`. Вопрос задаётся,
  только если выбран `manuals`; иначе пропускается. По умолчанию
  `onboarding`, `create-ticket`.
- `target-access` — по умолчанию `url-only`:
  - `url-only` — код цели читается по URL из `external`;
  - `local-checkout` — есть локальные клоны, пути в `context/local.yml`;
  - `none` — кода цели не видно, правда только в живых системах.
- `legacy-v1` — есть ли каталоги первой версии. По умолчанию `no`.

## Что ставит

```yaml
provides:
  layers: []                          # слои domain и manuals
  files: [context/glossary.yml]       # + context/local.yml при local-checkout
  skills: [external-context]
  agents_md_block: true
  harness_checks: []
  changelog_tags: [org]
  extends:
    domain: [type, canonical_source, owner, access, related_entities, deprecated, legacy, target]
  gitignore: [context/local.yml]      # только при local-checkout
```

`org` — оргрешения: смена owner или команды, процесса, обязательной
формы, шкалы оценки. Смысл полей и тега — skill `external-context`.

`context/glossary.yml`:

```yaml
# Словарь терминов проекта. Формат — skill external-context.
<term>:
  definition: <одна строка>
  related_entities: [<id>]
```

`context/local.yml` — только при `target-access: local-checkout`;
машинно-зависимый, строка `context/local.yml` добавляется в
`.gitignore`, файл не коммитится:

```yaml
# Локальные клоны целевых репозиториев. Не коммитится.
checkouts:
  <external-key>: <абсолютный путь>
```

`context/project.yml` — что ставит модуль (остальное — ядро):

```yaml
reality: [<target-repo>, <tracker>]   # ключи external, не this-repo
namespaces:
  systems: репозитории, трекеры, доски, wiki, формы, среды
  processes: intake, delivery, review, release, hotfix, escalation
external:
  <target-repo>: https://git.example.com/<org>/<repo>
  <tracker>: https://tracker.example.com/projects/<slug>
```

Блок `AGENTS.md`:

```markdown
<!-- module:external-context -->
## external-context

- своего кода нет: «как сейчас» → системы из `reality`, код цели → `context/local.yml`, иначе URL из `external`;
- система, оргправило, процесс X → `docs/entities/<id>.yml` (`type`, `canonical_source`, `target`);
- термин → `context/glossary.yml`;
- запись — summary + ссылка на canonical, не копия; verified вне кода, audit ссылок → skill `external-context`.
<!-- /module:external-context -->
```

## Установка

1. Проверь, что `domain` подключён (иначе — `contract-setup` добавит).
2. Собери у пользователя целевые системы: ключ, URL, какие из них —
   источник реальности. План правки `context/project.yml` (`reality`,
   `external`, `namespaces` из ответа) → «да» → через docs-keeper.
3. Создай `context/glossary.yml` по шаблону.
4. `local-checkout` — создай `context/local.yml` с путями пользователя,
   добавь строку в `.gitignore`.
5. Поставь skill `external-context`, добавь блок в `AGENTS.md`.
6. `starter-manuals` — заготовки manuals по формату skill `manuals`,
   каждая упомянута в entity (план → «да»).
7. Предложи 1–3 стартовые entity блокирующих систем (основной
   репозиторий, трекер) с behavior «доступен» и `check` по skill.
8. Подключён `goals` — предложи задачу «≥70% behavior в `systems` и
   `processes` с `verified: true`».

## Миграция с external-project-context-v2

Развилка ядра — brownfield; слои v2 остаются на месте.

Переезжает:

- `docs/entities`, `docs/behavior`, `docs/manuals` — как есть; `title`
  entity сливается в `summary`; `type` v2 → справочник skill (маппинг
  там же);
- поля `canonical_source`, `owner`, `access`, `related_entities`,
  `deprecated`, `legacy` — без изменений, теперь через `extends`;
- карта canonical из `context/project.yml` → `external`; целевые
  системы → `reality`;
- `context/glossary.yml` — как есть; `context/views/` — в модуль
  `goals`;
- `CHANGELOG.md` — по шагу 6 миграции ядра; оргрешения получают `[org]`.

Выбрасывается:

- копии правил в `context/conventions/`: `verification`,
  `entity-schema`, `behavior-schema`, `manual-schema`,
  `canonical-vs-cached`, `link-hygiene`, `goals`, `goal-consistency` —
  теперь skills `domain`, `external-context`, `manuals`, `goals`;
- `context/workflow.md` (skill `workflow`), содержимое `CLAUDE.md` →
  `AGENTS.md` по шаблону ядра;
- фазы «один тип», дефолтный порядок `docs → fix → refactor`, инъекция
  подфазы `docs` — в v3 фазы по связности;
- ручной `context/index.yml` — генерируется harness или удаляется;
- hook `block-memory-write-for-*.sh` и `docs/manuals/setup-safety-hooks.md`
  — memory выключается настройкой (раздел ядра «Memory агента»);
- `sync.contract.key: external-project-context-v2` → ядро v3 и manifest
  этого модуля.

Фазы — по связности, каждая с точкой согласования.

## Отключение

Удаляются skill, блок `AGENTS.md`, `context/local.yml` и строка в
`.gitignore`. `context/glossary.yml` и поля `extends` в entities —
вопрос пользователю: удалить или оставить как обычные файлы и поля
(тогда их не объявляет ни один слой — нужен свой модуль или
convention). `reality` возвращать в `this-repo` — только если в
репозитории появился свой код. Записи `[org]` в CHANGELOG остаются.

## Синхронизация

Через «сверь всё» проекта (skill `source-sync`): модуль и skill
`external-context` — по своим SHA.
