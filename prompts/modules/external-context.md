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

<!-- expect:external-reality -->
- Источник реальности ядра (`reality` в `.oc3/doc/project.yml`) — ключи
  `external` целевых систем, не `this-repo`. Маршрут «как сейчас» ядра
  уже ведёт туда; модуль ядро не меняет.
<!-- /expect:external-reality -->
- Слои — `.oc3/doc/data/entities/` и `.oc3/doc/data/behavior/` модуля `domain`,
  `.oc3/doc/manuals/` модуля `manuals` (если подключён). Модуль добавляет
  поля entity через `extends`, словарь, тег журнала и skill.
- Не для проекта со своим кодом: там `reality: [this-repo]` и хватает
  `domain`.

## Вопросы при подключении

- `namespaces` — стартовые области в `.oc3/doc/project.yml` (ответ —
  это «да» на новые namespace). По умолчанию `systems`, `processes`:
  - `systems` — репозитории, трекеры, доски, wiki, формы, среды;
  - `org` — оценка, ownership, коммуникации, ограничения;
  - `processes` — intake, delivery, review, release, hotfix, escalation;
  - `knowledge` — устойчивые нюансы и pitfalls.
- `starter-manuals` — заготовки в `.oc3/doc/manuals/`. Вопрос задаётся,
  только если выбран `manuals`; иначе пропускается. По умолчанию
  `onboarding`, `create-ticket`.
- `target-access` — по умолчанию `url-only`:
  - `url-only` — код цели читается по URL из `external`;
  - `local-checkout` — есть локальные клоны, пути в `.oc3/local.yml`;
  - `none` — кода цели не видно, правда только в живых системах.
- `legacy-v1` — есть ли каталоги первой версии. По умолчанию `no`.

## Что ставит

```yaml
provides:
  layers: []                          # слои domain и manuals
  files: [.oc3/glossary/common.yml]       # + .oc3/local.yml при local-checkout
  skills: [external-context]
  agents_md_block: true
  harness_checks: []
  changelog_tags: [org]
  extends:
    domain: [type, canonical_source, owner, access, related_entities, deprecated, legacy, target]
  gitignore: [.oc3/local.yml]      # только при local-checkout
```

`org` — оргрешения: смена owner или команды, процесса, обязательной
формы, шкалы оценки. Смысл полей и тега — skill `external-context`.

`.oc3/glossary/common.yml`:

```yaml
# Словарь терминов проекта. Формат — skill external-context.
<term>:
  definition: <одна строка>
  related_entities: [<id>]
```

`.oc3/local.yml` — только при `target-access: local-checkout`;
машинно-зависимый, строка `.oc3/local.yml` добавляется в
`.gitignore`, файл не коммитится:

```yaml
# Локальные клоны целевых репозиториев. Не коммитится.
checkouts:
  <external-key>: <абсолютный путь>
```

`.oc3/doc/project.yml` — что ставит модуль (остальное — ядро):

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

<!-- expect:agents-md-readonly -->
```markdown
<!-- module:external-context -->
## external-context

- своего кода нет: «как сейчас» → системы из `reality`, код цели → `.oc3/local.yml`, иначе URL из `external`;
- система, оргправило, процесс X → `.oc3/doc/data/entities/<id>.yml` (`type`, `canonical_source`, `target`);
- термин → `.oc3/glossary/common.yml`;
- формат записей, verified вне кода, audit ссылок → skill `external-context`.
<!-- /module:external-context -->
```
<!-- /expect:agents-md-readonly -->

## Установка

1. Проверь, что `domain` подключён (иначе — `contract-setup` добавит).
2. Собери у пользователя целевые системы: ключ, URL, какие из них —
   источник реальности. План правки `.oc3/doc/project.yml` (`reality`,
   `external`, `namespaces` из ответа) → «да» → через librarian.
3. Создай `.oc3/glossary/common.yml` по шаблону.
4. `local-checkout` — создай `.oc3/local.yml` с путями пользователя,
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

- `.oc3/doc/data/entities`, `.oc3/doc/data/behavior`, `.oc3/doc/manuals` — как есть; `title`
  entity сливается в `summary`; `type` v2 → справочник skill (маппинг
  там же);
- поля `canonical_source`, `owner`, `access`, `related_entities`,
  `deprecated`, `legacy` — без изменений, теперь через `extends`;
- карта canonical из `.oc3/doc/project.yml` → `external`; целевые
  системы → `reality`;
- `.oc3/glossary/common.yml` — как есть; очередь `views` — в модуль
  `goals`;
- `CHANGELOG.md` — по шагу 6 миграции ядра; оргрешения получают `[org]`.

Выбрасывается:

- копии правил в `.oc3/doc/conventions/`: `verification`,
  `entity-schema`, `behavior-schema`, `manual-schema`,
  `canonical-vs-cached`, `link-hygiene`, `goals`, `goal-consistency` —
  теперь skills `domain`, `external-context`, `manuals`, `goals`;
- `context/workflow.md` (skill `workflow`), содержимое старой точки  входа → `AGENTS.md` по шаблону ядра;
- фазы с обязательным порядком `docs → fix → refactor` и инъекция
  подфазы `docs` — в v3 тикет из шагов-коммитов (skill `workflow`);
- ручной `context/index.yml` — упразднён: каталог — в бандле;
- hook `block-memory-write-for-*.sh` и `.oc3/doc/manuals/setup-safety-hooks.md`
  — memory выключается настройкой (раздел ядра «Memory агента»);
- `sync.contract.key: external-project-context-v2` → ядро v3 и manifest
  этого модуля.

Миграция — тикет из шагов-коммитов, после каждого шага — отчёт.

## Отключение

Удаляются skill, блок `AGENTS.md`, `.oc3/local.yml` и строка в
`.gitignore`. `.oc3/glossary/common.yml` и поля `extends` в entities —
вопрос пользователю: удалить или оставить как обычные файлы и поля
(тогда их не объявляет ни один слой — нужен свой модуль или
convention). `reality` возвращать в `this-repo` — только если в
репозитории появился свой код. Записи `[org]` в CHANGELOG остаются.

## Синхронизация

Через обновление из источника (skill `source-sync`): модуль и skill
`external-context` — по своим SHA.
