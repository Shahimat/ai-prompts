---
key: app-loop
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль app-loop — петля «домен ↔ приложение»
use_case: Возможность ядра v3 для проектов, где в одном репозитории живут предметный домен (жизнь или анализ) и приложение, которое его автоматизирует. Связывает их двусторонней трассой serves ↔ automated_by, вводит провенанс app-telemetry (доверие = verified behavior-источника), поле domain у целей и планов goals/ и проверку выравнивания петли.
tags: [docs-as-code, app-loop, provenance, agent-contract, module]
feature:
  summary: петля домен ↔ приложение — serves ↔ automated_by, провенанс app-telemetry, выравнивание планов
  default: false
  requires: [domain]
  conflicts: []
  asks:
    - key: counterpart
      question: С каким предметным доменом приложение образует петлю?
      multi: false
      options: [life, analysis]
    - key: plan-domain-field
      question: Помечать цели и планы goals/ полем domain (app или предметный домен)?
      multi: false
      options: ["yes", "no"]
---

# Модуль app-loop — петля «домен ↔ приложение»

## Назначение

Два домена в одном репозитории связаны замкнутой петлёй:

- **мотивация течёт `<counterpart> → app`**: у каждой фичи приложения
  есть трасса к потребности предметного домена (`serves`);
- **данные текут `app → <counterpart>`**: приложение измеряет или
  собирает данные, на которые опираются записи домена (провенанс
  `app-telemetry`).

Связь — сущность первого класса: двусторонние ссылки, общая модель
доверия, проверка выравнивания. Приложение описывается слоем `domain`
(entities и behavior), предметный домен — модулем `life` или
`analysis`.

Не нужен проекту без приложения или без предметного домена: обычный
кодовый проект обходится `domain`.

## Вопросы при подключении

- `counterpart` — предметный домен петли: `life` или `analysis`.
  Соответствующий модуль должен быть подключён (см. «Установка»).
- `plan-domain-field` — помечать ли цели и планы в `goals/` полем
  `domain` (`app | <counterpart>`). `yes` — по умолчанию: программа,
  цель и тикет читаются проще с меткой домена.

## Что ставит

```yaml
provides:
  layers: []
  files: []
  skills: [app-loop]
  agents_md_block: true
  harness_checks: []
  extends:
    domain: [serves]
```

Поле `domain` у целей и планов `goals/` модуль не объявляет через
`extends`: goals не модуль и не YAML-слой. Метка — правило skill
`app-loop`, включается ответом `plan-domain-field: yes`.

Поле `automated_by` модуль не объявляет: его заводят сами модули
`life` / `analysis` в своих форматах как необязательное поле «при
подключённом app-loop». Семантику пары `serves ↔ automated_by` задаёт
skill `app-loop`.

Блок `AGENTS.md` (`<counterpart>` — из ответа):

<!-- expect:agents-md-readonly -->
```markdown
<!-- module:app-loop -->
## app-loop

- зачем фича → `serves` у entity/behavior; что автоматизирует → `automated_by` в `<counterpart>`;
- доверие `app-telemetry` = `verified` у behavior-источника;
- serves, automated_by, поле domain у целей и планов → skill `app-loop`.
<!-- /module:app-loop -->
```
<!-- /expect:agents-md-readonly -->

## Установка

1. Модуль `<counterpart>` не подключён → стоп: предложи подключить его
   через `contract-setup` (вместе с app-loop или раньше).
2. Поставь skill `app-loop` в `.agents/skills/app-loop/`, добавь блок в
   `AGENTS.md`, manifest с фактическим `extends`.
3. Пройди entities и behavior приложения: план проставления `serves`
   и встречных `automated_by` в домене → «да» → через librarian.
   Привязку, которую не вывести из кода и документов, не выдумывай —
   список «фичи без serves» пользователю.
4. `plan-domain-field: yes` → план разметки целей и планов `goals/`
   полем `domain`.
5. Прогони проверки петли из skill (включая выравнивание), находки —
   отчётом.

## Миграция с personal-project / analytical-project

Переезжает сюда:

- раздел «Петля жизнь ↔ приложение» / «Петля анализ ↔ приложение» —
  в skill `app-loop`: `serves`, `automated_by`, `app-telemetry`,
  «транспорт ≠ провенанс», выравнивание;
- «Расширение под два домена» из системы целей — поля `domain` /
  `serves` у целей и шестая проверка;
- значения `serves` в `app/entities|behavior/*.yml` и `automated_by` в
  домене сохраняются; сами файлы `app/entities|behavior` переезжают в
  `docs/entities|behavior` по миграции модуля `domain`, ссылки
  приводятся к формату skill.

Выбрасывается:

- копия «Правила верификации и провенанса» в
  `context/conventions/verification.yml` — верификация в skill
  `domain`, провенанс `app-telemetry` в skill `app-loop`, остальные
  провенансы — в модуле домена;
- «Канал живых данных» и блок `data_access` в `context/project.yml` —
  в модуль `data-access`;
- раздельные журналы `CHANGELOG-life|analysis.md` / `CHANGELOG-app.md` —
  один `CHANGELOG.md` по правилам ядра (теги доменов — в их модулях).

## Отключение

Поля `serves` в entities / behavior и `domain` / `serves` у целей —
вопрос пользователю: удалить или оставить как обычные поля (без
проверок). Встречные `automated_by` в домене — то же решение, в рамках
модуля домена. Skill и блок удаляются.

## Синхронизация

Через обновление из источника (skill `source-sync`): модуль и skill
`app-loop` — по своим SHA.
