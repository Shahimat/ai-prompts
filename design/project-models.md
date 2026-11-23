# Проектные модели: standalone v2 и исторический manifest-mode

## Локальная схема ai-prompts

Единственная ручная декларация — корневой `manifest.json`; его значения
и структура не поддерживаются второй копией в документации.
Локальный ai-prompts работает обычным build без OC3-плагина,
обязательных ролей, брифинга и генерации `.opencode/agents`.

Обслуживание выполняет repo-native скрипт `scripts/project-models.ts`:
`npm run models:apply`, затем `npm run models:check`, без AI и без
OC3 refresh/adapters sync. Скрипт обслуживает root `model` и native
overrides конфигурации OpenCode, не генерирует роли и инструкции,
не меняет shared `agents/`, глобальные настройки и дефолты потребителей.
Снятие override записывает resolved default, не удаляет native агента.
Явная модель уже открытой сессии и внешний `--model` не project default.
Mapping Codex не обещается.

Проекция хранится только в корневом `opencode.jsonc`: `model` и `agents`
встроенных build, plan, general, explore, compaction, title, summary.
Уже объявленные в этом конфиге агенты сохраняют инструкции; меняется только
их модель. Новые роли из source `agents/` или overrides manifest не создаются.
Default с `#variant` сохраняется у агентов; root `model` содержит базовую
модель, поскольку OpenCode не сохраняет variant у root default.
JSONC-комментарии и посторонние настройки сохраняются. `check` ничего
не пишет, повторный `apply` не меняет даже mtime при неизменной проекции.

`models:check` и `models:test` — отдельные стадии `npm run ci`; канон
скриптов и стадий — `package.json` и `scripts/verification.ts`.
Targeted Node tests проверяют fixtures, не продуктовые defaults потребителей.
Старый PASS ниже относится только к прежнему срезу, не доказывает свежий CI.

Локальное правило — `context/conventions/project-models.yml`.
Пакетный resolver, CLI `ai models …`, harness/helper paths и adapters
остаются продуктом v3, не способом настройки этого checkout.

## Историческое устройство 2026-11-07

Пользователь одобрил единый root manifest вместо project.yml roles.models.
В том срезе `roles` был overrides, не whitelist; приоритет resolver —
точный helper context → base role → default. Реализация:
`packages/ai-core/src/lib/project-models.ts`, `model-plan.ts` и adapters.
Без manifest сохранялись legacy defaults потребителей; `set` в
manifest-mode не менял source agents.

Исторические скрытые launch paths: `lib/role.ts`, `commands/expect/index.ts`
(`expect.judge`), harness plan-review planner/judge, core/ops runner и
`scripts/expect-judge-opencode.ts`. Общий resolver и native GET не
доказывали фактический LLM-вызов каждого пути или переключение открытой
сессии. В прежнем обслуживании `ai refresh` делал adapters sync → check,
а models:check был отдельной стадией. Это история, не локальная процедура v2.

## Миграционный шаг 2026-11-07

Из `.oc3/project.yml` удалена только subsection `roles.models` с четырьмя
GLM overrides для researcher, librarian, external-executor и executor.
Было: локальные проектные overrides в `project.yml`. Стало: прежние
overrides удалены для перехода к одной ручной точке в root
`manifest.json` без конфликтующих старых настроек. Остальные поля
`project.yml`, включая `roles.exceptions`, сохранены.

Evidence: отдельный docs_request оператора на одноразовую миграцию,
одобрение пользователя «Погнали» и выбранная схема root manifest.
Сам по себе этот шаг не подтверждал готовность кода или путей запуска.
Их последующее устройство описано выше по новому evidence; исторический
baseline ниже сохранён без переноса его ограничений на manifest-mode.

## Исторический baseline до миграции

Зафиксирован по evidence оператора, а не как описание будущей реализации:

- `.oc3/project.yml` → `roles.models` читается только `models list/apply`.
  `set/apply` переписывают `.agents/agents`, shared `agents/` и derived
  `.opencode/agents`: `packages/ai-core/src/commands/models/index.ts`,
  строки 60–75, 141–150, 182–219. Для ai-prompts shared `agents/` —
  источник для потребителей, поэтому применять этот путь для локальной
  смены моделей небезопасно.
- Harness: `findRole` читает markdown, `runRole` передаёт
  `role.model` либо default явно, не проектный override:
  `packages/ai-core/src/lib/role.ts`, строки 61–76, 218–225;
  `packages/ai-core/src/lib/opencode.ts`, строки 43–44, 168–174.
- Adapter берёт `model` из markdown, не из overrides:
  `packages/ai-core/src/commands/adapters/source.ts`, строки 79–95.
- Временная native-схема: корневой `opencode.jsonc` уже содержит root
  `model` и 15 agent overrides `openai/gpt-6.1-sol-fast`. По отчёту
  executor индивидуальные API GET для operator, executor, judge и
  general проверены. Это не единый источник и не свидетельство
  миграции harness или адаптера.

## Runtime-диагностика

Проверенный в evidence запрос с явной директорией проекта:

```sh
opencode api get '/api/agent/<id>?location%5Bdirectory%5D=%2FUsers%2Fshahimat%2Fprj%2Fai-prompts'
```

Без `location` CLI возвращал `/Users/shahimat`; общий agent list
обрезается на 256k. Для проверки отдельных агентов использовать
индивидуальные запросы с явным `location`, не обрезанный общий список.

## Маршрут обслуживания и реализации

- `manifest.json` → `npm run models:apply` / `npm run models:check` —
  ручная декларация и штатный путь обслуживания.
- `context/conventions/project-models.yml` — действующее локальное правило.
- `design/packages.md` — границы пакетов для скрипта и launch paths.
- `design/operator-centric-v3.md`, §0 и §2.8 — дизайн ролей, source
  frontmatter и разграничение manifest-mode с legacy defaults.
- `design/roles.md` — историческое объяснение harness и runner;
  текущая модель ролей вынесена в operator-centric-v3.
- `context/conventions/index-rebuild.yml` — при будущей правке
  prompts, patterns, skills, agents или presets пересобирается индекс;
  текущая фиксация эти источники не меняет.

## Финальная приёмка — run 2

Независимый judge принял пользовательский DoD: **PASS**, run 2,
`.ops/project-role-models/verdicts/2.yml`. Это качественная приёмка
одобренного DoD, не искусственный scoring отсутствующего ticket-block.
Run 2 заменяет прежний предварительный `paused` run 1.

Успешный серийный pipeline:
`refresh` → `npm run models:check` → `npm run ci` → `git diff --check`.
Полный лог:
`/Users/shahimat/.local/share/opencode/shell/7a5a2e292dbd84f1990d5127deeb51deedd2ce29/sh_1b3560e54001uBf9Cr5iTNGl60.out`.

В логе 506 тестов: 250 ai-core + 79 harness + 38 CLI + 139 oc3.
Format/build/typechecks/lint/packages/index/memory/models — PASS.
330 expectations: 0 crit, 0 pending, 1 прежний plan-review warn в бюджете.
Три stale semantic verdicts пересмотрены штатно judge; новый skill-runs
warn устранён по существу. Analytical 8108/8192 и private 8053/8192
подтверждены финальным логом, заголовки и пороги не менялись.

Сохранены consumer defaults и source agents; native/runner/CLI/helper
пути согласованы по resolver, тестам и индивидуальным native GET.
Явная модель существующей сессии и внешний `--model` не переключаются
manifest автоматически. Codex mapping не обещан и не проверен.
Реальный внешний source-sync end-to-end и LLM-вызов каждого скрытого
пути не выполнялись: проверены код, локальная симуляция обновления source,
fake spawn tests и native agent API. Эти границы не объявляются PASS.

## История предварительной приёмки — run 1

Прямые запросы пользователя и подтверждение «Погнали»; docs_request
оператора об устройстве реализации и независимый предварительный judge:
`.ops/project-role-models/verdicts/1.yml`, `status: paused`.

По evidence judge подтверждены два детерминированных apply, неизменность
SHA и mtime 476 файлов при check, сохранение source roles и custom config,
36 ai-core + 44 harness + 33 CLI целевых теста и все 16 индивидуальных
native моделей GPT без variant.

Последующий report executor: 506 package tests, build/typecheck/lint/
format/index — PASS; целевые наборы 72 + 59 + 38, models/adapters check
и девять индивидуальных runtime GET — PASS. Канонические role trees и
consumer templates не изменены. На том этапе эти проверки ещё не
заменяли финальный общий серийный CI и semantic-приёмку.

По evidence основной сессии source contract направляет модели в manifest,
а legacy — в `project.yml` → `roles.models`; `npm run index:build` — PASS.
Механика и budgets targeted expect контракта — PASS: analytical
8108/8192, private 8053/8192. Прежние 8294/8239 относились к HEAD inputs;
тот же текст уплотнён в существующие бюджеты без изменения правил,
заголовков или порогов. На предварительном этапе три pending semantic
verdicts оставляли targeted report с exit 1; последующий успешный итог
и снятие pending зафиксированы отдельно в run 2 выше.

Сохранение legacy проверено локально, но реальный внешний source-sync
end-to-end и LLM-вызов каждого пути этим не подтверждены.

Loader-сбой объяснён read-vs-build гонкой: build удаляет dist, наблюдалось
отсутствие `packages/cli/dist/scripts/index.js`. Это не свидетельство
новой скрытой модели. После завершения executor dist стабилен;
финальные проверки выполняются последовательно, без параллельного build.
Успешный серийный прогон не доказывает отсутствия будущих параллельных
read-vs-build гонок.

Решение о прежнем составе `ai check` и отдельной стадии `models:check`
передано оператором после предварительного judge; замечание judge о
безусловном models check не является текущей принятой схемой.

Наблюдение при закрытии этой docs delta: `delta check` прошёл, но
`delta close --name project-models-implemented` не засчитал три refine
для `README.md`, `design/operator-centric-v3.md` и `.oc3/ai-core.yml`.
Эти пути не входят в текущие `docRoots` CLI. По отдельному разрешению
оператора удалены только их служебные entries из управляемой дельты;
изменения файлов и знания сохранены и проверяются отдельно.
Пункт `add` для этого нового design-документа подтверждает наличие
файла, но не расширяет покрытие diff-анализатора на `design/`.
Это наблюдение о текущей механике приёмки, не новая общая политика;
`docRoots`, checker, kind оставшихся пунктов и source-models revise
не изменены.
