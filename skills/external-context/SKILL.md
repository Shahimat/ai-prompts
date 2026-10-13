---
name: external-context
description: Правила репозитория-оверлея над чужим живым проектом — type и поля entity, canonical-vs-cached, свежая проверка фактов вне кода, audit ссылок, glossary, тег [org]. Загружай, когда пишешь или проверяешь entity/behavior систем, оргправил и процессов или делаешь audit.
---

# external-context

Репозиторий описывает чужой живой проект и своего кода не держит.
Источник реальности — системы из `context/project.yml` → `reality`
(ключи `external`). Форматы entity и behavior, `verified`, namespace —
skill `domain`; здесь только то, что добавляет этот модуль.

## Режим работы

- cwd — репозиторий-оверлей; пишешь только в него.
- Живой код цели — по пути из `context/local.yml` → `checkouts.<key>`;
  файла или ключа нет — по URL из `external`; нет и URL — `unknown`,
  спроси.
- Клон может отставать: в `verified_note` пиши коммит, по которому
  читал (`git -C <path> log -1 --format=%h`). `pull` и прочие
  git-операции в клоне делает пользователь.
- `context/local.yml` машинно-зависим и не коммитится: факты из него в
  слои не переносятся.

## Entity: справочник `type`

- `system` — прочая внешняя система: wiki, support, мониторинг;
- `repo` — репозиторий кода;
- `tracker` — учёт задач;
- `board` — доска, колонки которой значимы для процесса;
- `form` — обязательная форма (заявка, approval);
- `env` — среда: prod, stage, стенд;
- `org-rule` — оргправило как объект: оценка, ownership,
  коммуникации, ограничения;
- `process` — процесс как справочник: intake, delivery, review,
  release, hotfix, escalation.

Нового значения нет в списке — не изобретай: блокирующий вопрос, затем
convention проекта.

Типы external-project-context-v2: `doc_source`, `support_system` →
`system`; `environment` → `env`; `estimation_rule`, `ownership_rule`,
`communication_rule`, `constraint` → `org-rule`.

## Entity: дополнительные поля

```yaml
type: <из справочника>
canonical_source: <URL живой системы | путь manual | "внутренняя договорённость команды">
owner: <человек или команда>
access: <как получить доступ; ограничения>
related_entities: [<id>]
target: <ключ external или URL целевого репозитория/системы>
deprecated: false
legacy: false
```

- `canonical_source` — где правда; обязателен. Договорённость без
  URL — так и пиши, плюс где зафиксирована (manual, протокол).
- `owner` — кого спрашивать при проверке; неизвестен — `unknown`.
- `target` — вместо `paths` из `domain`: своего кода нет, связь — с
  целевым репозиторием или системой. Для `repo` — ключ `external`,
  чей клон ищется в `context/local.yml`.
- `related_entities` — без обязательной обратной ссылки, но ссылка на
  несуществующий id — ошибка.
- `deprecated: true` — система или правило больше не актуальны, запись
  хранит историю ссылок; `legacy: true` — ещё живо, но выводится.

## Canonical-vs-cached

- Запись — summary + ссылка на canonical + `verified_at`, не копия
  содержимого wiki, формы, трекера.
- Запись и живая система расходятся — права система, запись
  обновляется через docs-keeper.
- Копировать можно только то, что нужно для решения без похода в
  систему: обязательные поля формы, колонки доски, шкала. Остальное —
  ссылкой.
- Release notes, тикеты, содержимое чужих wiki не мигрируют сюда.

## Link-hygiene

- Не удаляй запись молча, если canonical пропал или переехал: новый
  URL известен — план правки `canonical_source`; неизвестен —
  `deprecated: true` и `verified: false` на её behavior с причиной в
  `verified_note`.
- URL без пояснения не бывает: рядом `summary` или `access`.
- Ссылка на deprecated-entity из актуальной записи — ошибка (см.
  «Проверки»).

## Свежая проверка вне кода

Расширяет шаг «проверить можно» из skill `domain`. Допустимые способы:

- HEAD по URL — `curl -fsSLI "<url>"`: 2xx без редиректа на логин;
- чтение живой wiki по `canonical_source` — summary совпадает;
- подтверждение owner — ответ owner из entity;
- тестовый тикет или форма — попытка без обязательного поля
  получает отказ (только с «да» пользователя: действие во внешней
  системе);
- свежий тикет или PR в трекере — описанный процесс реально
  применяется;
- код или конфиг цели — по `context/local.yml` или URL.

Авторизация или JS делают `curl` бесполезным — проверку делает
пользователь в браузере и сообщает результат.

`verified_note` — способ, дата, кто, на чём:

- «HEAD 200 2026-07-10»;
- «owner @team-lead подтвердил на планинге 2026-07-10»;
- «тестовый тикет без формы отклонён 2026-07-10»;
- «wiki обновлена 2026-06-30, summary совпадает»;
- «конфиг ci/release.yml в target-repo@a1b2c3d, 2026-07-10».

`check` у behavior — `curl -fsSLI <url>` везде, где факт сводится к
доступности URL.

## Audit

Расширяет сценарий `audit` skill `workflow`.

1. Область — namespace, `type` или весь репозиторий. Порядок —
   блокирующие системы первыми: основной `repo`, `tracker`, форма
   release, затем остальное.
2. По каждому behavior области:
   - есть `check` — выполни;
   - нет, но у entity URL в `canonical_source` — `curl -fsSLI`;
   - редирект на логин, 401/403 — не «битая», а «требует ручной
     проверки»;
   - нужен ручной шаг (авторизация, owner, тестовый тикет) — в список
     «требует ручной проверки» с тем, что именно сделать;
   - `verified_at` моложе 6 месяцев — только smoke ссылки;
   - старше 6 месяцев — кандидат на переверификацию, даже если факт не
     менялся.
3. Отчёт:
   - сколько проверено автоматически, прошло / упало;
   - «требует ручной проверки» — список с действием и owner;
   - кандидаты на переверификацию;
   - битые `canonical_source` и расхождения entity ↔ behavior;
   - где `verified: false` остаётся и почему;
   - доля `verified: true` по namespace.
4. Правки — только через `plan`: новые `verified` / `verified_at` /
   `verified_note` по тому, что проверено сам, и правки записей
   (`canonical_source`, `owner`, `deprecated`) — план → «да» →
   docs-keeper. Сам ничего не правишь.

## Проверки

К проверкам skill `domain` перед сохранением:

- `type` из справочника, `canonical_source` заполнен;
- `verified: true`, а `canonical_source` битый (`curl` 4xx/5xx) —
  противоречие;
- актуальная entity (`related_entities`) или behavior (`entities`)
  ссылается на `deprecated: true` как на действующую — противоречие;
- `target` указывает на ключ, которого нет в `external`;
- `reality` содержит ключ, которого нет в `external`;
- термин в glossary ссылается на несуществующую entity.

## Glossary

`context/glossary.yml` — один файл, не дробится:

```yaml
tracker:
  definition: система учёта задач проекта
  related_entities: [tracker-main]
```

- ключ — термин как его говорят в проекте; `definition` — одна строка;
- определение термина — здесь, описание системы — в entity; не
  дублируй;
- читай только при непонятном термине.

## Тег журнала `[org]`

Оргрешение: смена owner или команды ключевой зоны, смена или отказ от
процесса, ввод или отмена обязательной формы, смена шкалы оценки,
переезд трекера или wiki (если не `dep`). Формат строки — skill
`docs-keeper`. Точечная смена URL — не решение.

## Легаси v1

Только при `answers.legacy-v1: yes` в `context/modules/external-context.yml`:

- `registry/project.yaml`, `navigation.yaml`, `sources-of-truth.yaml`
  → `context/project.yml` (`external`, `reality`, `namespaces`);
- `registry/glossary.yaml` → `context/glossary.yml`;
- `assets/links/*.yaml` → entity `namespace: systems`; `repos` →
  `repo`, `trackers` → `tracker`, `boards` → `board`, `forms` →
  `form`, `environments` → `env`, `docs` и `support-systems` →
  `system`;
- `assets/org/*.yaml` → entity `type: org-rule` + behavior,
  `namespace: org`;
- `assets/processes/*.yaml` → entity `process-<name>` (`type:
  process`) + behavior, `namespace: processes`;
- `knowledge/nuances.yaml`, `pitfalls.yaml` → мелкие behavior,
  `namespace: knowledge`;
- `knowledge/decisions.yaml` → `CHANGELOG.md` (строка с тегом) или
  выбросить;
- `knowledge/faq.yaml`, `onboarding.md`, `procedures/playbooks/*.md` →
  `docs/manuals/`;
- `procedures/templates/*.yaml` — выбросить: схемы в skills.

Перенесённое — `verified: false`, кроме проверенного сразу. После
переноса легаси-каталоги удаляются (с «да»), в manifest —
`legacy-v1: no`.
