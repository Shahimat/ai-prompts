# @shahimat/ai-core

Ядро для проектов на контракте
[`agent-operational-contract-v3`](https://github.com/Shahimat/ai-prompts/blob/main/prompts/productivity/agent-operational-contract-v3.md):
механические проверки и генерация, механизм ожиданий и роли, чтобы агент
не держал их в памяти. Библиотека без бинаря: команды запускает CLI `ai`
([`@shahimat/cli`](https://www.npmjs.com/package/@shahimat/cli)), автоматы
поверх них — [`@shahimat/harness`](https://www.npmjs.com/package/@shahimat/harness).

Node ≥ 24. macOS, Linux, Windows.

## Запуск

Пакет ставится в `devDependencies` проекта рядом с `@shahimat/cli`,
точные версии; команды — через `npx ai <команда>`.

## Устройство

Пакет делится на слои, зависимости идут только вниз:

- **команды** — атомарные операции: прочитали файлы, проверили или
  сгенерировали, вернули код. Друг друга не вызывают.

Скрипты (последовательности команд) — в `@shahimat/cli`.

Под ними — общий `shared` (guards, конфиг, проверка JSON Schema) и
библиотека `lib` (`@shahimat/ai-core/expect`, индекс промптов, роли).
Автоматы (`@shahimat/harness`) — слой выше: импортируют публичный API
`ai-core`, обратной зависимости нет.

У каждой команды и операции автомата объявлен эффект: **query** не
меняет файлов (кроме кэша по содержимому вне git), **mutation** пишет.
Эффект скрипта выводится из его шагов. CI и модель внутри состояния
автомата получают только query.

## Команды

Mutation — `memory build`, `adapters sync`, `delta close`,
`expect init`, `expect judge`, `expect report --html`, `index build`,
`role run`, `role channel`; остальные — query.

- `ai secrets scan [--file <path>]` — секреты (ключи API, токены,
  пароли, приватные ключи) в отслеживаемых git файлах проекта или в
  одном файле по пути; в выводе — путь, строка и тип, без значения. В
  `ai check` включена по умолчанию.
- `ai changelog lint` — `CHANGELOG.md`: строка
  `- YYYY-MM-DD · [tag] суть · почему` до 120 символов, тег из списка,
  порядок дат.
- `ai context check` — проверка слоёв документации (entities, behavior,
  manuals, conventions, слои модулей): `id`, namespace, `summary`
  без записи.
- `ai tree check` — валидация плоского дерева `.oc3/` по JSON Schema
  (draft 2020-12): ядро контракта плюс расширения из `manifest.json`
  (`data`, `files`, `layout`); каждая ошибка — поручение librarian.
- `ai memory build | check` — сборка и проверка полного generated file-set
  в `.oc3/bundles/`: compact inline weight 0, каталоги, реальные file
  projections и bounded pages/parts. Schema-valid вложенность, типы,
  Unicode и пустые значения сохраняются; schema validation и seal не
  ослабляются. Check отвергает missing/tamper/stale, не пересобирая память.
  Формат, freshness и ограничения —
  [бандлы памяти](../../design/memory-bundles.md).
- `ai adapters sync` — файлы под Codex и OpenCode из `AGENTS.md` и
  `.agents/`: субагенты `.opencode/agents/*.md` (при `codex` —
  `.codex/agents/*.toml`) и выключенная memory агента
  (`.opencode/opencode.jsonc` с deny memory-MCP; у codex —
  `config.toml`); чужой файл на месте производного sync не трогает и
  сообщает: содержимое перенести в источник.
- `ai adapters check` — сверка файлов адаптеров с `AGENTS.md` и
  `.agents/` без записи.
- `ai expect init` — каркас ожиданий в проекте: точка входа
  `expectations/index.expect.ts`, пример файла с бюджетом, npm-скрипты,
  `.gitignore`.
- `ai expect report | lint | judge [--apply | --run] <file>` — ожидания в
  форме vitest: дерево со статусами, проверка заголовков, пакетная
  смысловая проверка с input-bound proofs. `report`/`lint` не вызывают агента;
  `judge` готовит delta tasks, `judge --apply` применяет bound answers без
  producer. Только `judge --run` выбирает explicit producer path, но текущий
  production `askRole` context incomplete: needs-review до dispatch даже с
  `--run`. `--run`/`--apply` несовместимы и не поддержаны report/lint.
  `<file>` — одна
  точка входа `*.expect.ts`; остальные файлы ожиданий попадают в прогон
  только через `import` в ней. Конфиг vitest — из пакета, проекту свой
  не нужен. Отчёт, бюджет и проверка заголовков — по модулю, где
  объявлено ожидание. Typed resolver назначает tasks/bundles через
  `expectHelperDir(entry)` в `.oc3/reports/expect/<entry-key>/`, compact store
  через `expectCacheFile(entry)` в `.oc3/verdicts/expect/<entry-key>/verdicts.json`;
  entry-key — SHA-256 нормализованного project-relative entry.
  Legacy reasons/quotes/history сохраняются как unverified/needs-review,
  query не переписывает versioned store. Proof/force/run/apply и ограничения —
  [инкрементальная верификация](../../design/incremental-verification.md).
  Помощники для
  проверок — `@shahimat/harness/expect` (нужен vitest в проекте):
  `crit` / `warn` / `note` / `budget`, `describe`, `expectAtMost` (info
  при > 90% порога), зонды по репозиторию, `judged`, проверка JSON
  Schema (`expectSchema`, `dataFiles`, `frontmatters`). Общий блок
  ожиданий вне `*.expect.ts` объявляет разделы через `describe` из
  `@shahimat/harness/expect`: так ожидания приписываются файлу, который
  блок применил. `pattern(key, apply)` — паттерн ожиданий: функция с
  параметрами, которая регистрирует ожидания для переданных целей (цели
  — в заголовке, якоря доказательств — параметром); ожидания
  приписываются применившему файлу, в HTML у них виден ключ паттерна.
  Паттерны для любых проектов — `@shahimat/expectations`, для одного
  репозитория — его `expectations/shared/`.
  `report <file> --html <out>` — тот же отчёт HTML-файлом,
  `serve <file> [--port <n>]` — с локального сервера (см. «План в форме
  ожиданий»).
- `ai delta check | close` — дельта проектной документации в
  `.oc3/.delta/*.yml` (пункты `add` / `refine` / `revise`). `check`
  сверяет слои документации с `HEAD`: удалённое или изменённое знание
  без пункта `revise` — нарушение; дельта не прошла схему — её ошибка
  первой, производные нарушения по её целям свёрнуты. `close` после
  приёмки (check чист, пункты выполнены) удаляет дельту и печатает
  строки `revise` для тела коммита. `--name <дельта>` сужает обе
  команды до одной дельты: нарушения чужих и «без `revise`» в файлах вне
  целей своей дельты — предупреждение, по своим целям — нарушение. Дельта,
  попавшая в коммит, — предупреждение; её пункт засчитывается, если цель
  изменена в коммитах с появления дельты.
- `ai role run <name> --file <задание> [--out <ответ>]` — роль из
  `.agents/agents/<name>.md` (в источнике — `agents/<name>.md`)
  headless: текст задания — на stdin, итог — сообщением протокола в
  `--out` или stdout (см. «Роли»).
- `ai role channel <message> --out <файл>` — MCP-сервер (stdio)
  канала роли с одним инструментом `submit_result`: проверяет ответ по
  схеме сообщения, невалидный возвращает модели ошибкой с путём к полю,
  валидный пишет в `--out`. Запускает его `role run`, не человек.
- `ai outdated` — версии `@shahimat/ai-core` и `@shahimat/harness` из
  `package.json` проекта против последних в npm и записи их журналов
  между ними (код 1 — есть новее).
- Guards контракта — плагин `@shahimat/oc3` (подключается в
  `opencode.jsonc`): `permission.hook` отклоняет правку документации
  (корневой `CHANGELOG.md`, sealed canonical в `.oc3/`) и генерируемых файлов
  (`.opencode/agents/` с меткой «generated») любым
  агентом кроме librarian — с подсказкой править источник и про
  `ai docs-delta`; запись в память инструмента вне репозитория —
  отклонена.
- `ai index build | check --raw-base <url>` — индекс
  `prompts/index.yml` репозитория промптов.

## Публичный consumer подготовленного плана

Корневой export `@shahimat/ai-core` предоставляет
`expectPlanConsumer(root, entryPath, now: Date)` и типы
`ExpectPlanConsumer`, `ExpectConsumerTask`. После отдельного prepare consumer
возвращает `tasks` (`task`, `kind`, `text`), `produce(task, callback)` и `apply()`.
Он использует только default capture: caller не задаёт completeness/context,
нет env/CLI trust switch. Immutable v2 bindings, current revalidation
до/после producer и перед atomic apply, explicit coverage и границы полномочий —
[контракт consumer](../../design/incremental-verification.md#consumer-подготовленного-плана).
Этот API не аттестует реального producer: incomplete context блокирует dispatch.

## План в форме ожиданий

План — тот же файл ожиданий, а не отдельный документ. Файл описывает
конечное состояние; чтобы его изменить, в файл добавляются блоки — `fsm`,
`steps` и другие. План переходит в трекинг (заглушки сменяются
проверками), трекинг — в новое конечное состояние. Вид страницы задают
блоки: нет блока — нет его диаграммы.

```ts
plan({ name: 'plan-review: стол и оркестратор' });

const planReview = fsm('plan-review', {
  initial: 'draft',
  limits: { fix: 3 },
  states: {
    draft: { actor: 'model', on: { questions: 'clarify', plan: 'review' } },
    clarify: { actor: 'user', on: { answered: 'draft' } },
    review: { actor: 'model', on: { pass: 'approved', fail: [{ to: 'draft', count: 'fix' }, 'approved'] } },
    approved: { final: true },
  },
});

steps(() => {
  step('T1', { title: 'Headless draft', why: 'нет TTY' }, () => {
    planReview.state('draft', () => {
      crit.wip('ответ планера — план или вопросы по схеме', () => Check.draftAnswer());
    });
  });
  step('T2', { title: 'Вопросы', after: ['T1'] }, () => {
    planReview.transition('draft', 'questions', () => {
      crit.todo('вопросы нумерованы, у каждого дефолт с обоснованием');
    });
  });
});

planReview.whole(() => {
  crit('из любого состояния достижимо approved', () => Graph.canReach(planReview, ['approved']));
});
```

- `plan({ name })` — имя плана: сессия plan-review и вкладка браузера.
  Шапка страницы — только `info.title`; без неё `expect report`
  просит её добавить.
- Заглушки задают статус ожидания: `crit.todo(title)` / `warn.todo` — не
  взято; `crit.wip(title, fn?)` / `warn.wip` — в работе: проверка
  исполняется, если она есть, провал виден (`◐`), но не блокирует;
  без заглушки проверка блокирует.
- `steps(() => { step(id, { title, after, why }, body) })` — шаги плана;
  ожидания шага — его DoD, `step` вне `steps` — ошибка. Статус шага
  выводится из ожиданий: все `todo` — не начат, все без заглушек и
  зелёные — готов, иначе — в работе. Нарушение плана (crit): готовый
  шаг раньше шагов из `after`, неизвестный шаг в `after`, цикл, повтор
  id. На странице — UML-диаграмма активностей: старт, шаги, развилки и
  слияния по `after`, финал.
- `fsm(name, { initial, limits, states })` — автомат данными. Имена
  состояний и событий выводятся из литерала: опечатка в `state`,
  `transition`, переходе или `initial` — ошибка typecheck. `state`,
  `transition` и `whole` привязывают ожидания к узлу, переходу и
  автомату целиком; на странице — схема Graphviz.
- Блоки и ожидания из импортированных файлов попадают на страницу в
  разделе своего модуля; у ожидания из общего блока видно, где оно
  определено.
- Зонды: `Graph.sameAs(m, def)` — граф совпадает с `harness.yaml`
  (`def` — результат `parseMachine`); `Graph.canReach(m, targets)` — из
  каждого состояния достижима цель; `Graph.onlyVia(m, target, via)` — в
  `target` из `initial` не попасть в обход `via`.
- `ai expect report <file> --html <out>` — HTML без сети
  и без JS: диаграммы блоков — SVG Graphviz (wasm, при генерации); узел и переход ведут к карточке, цвет — статус ожиданий;
  новые, изменённые и удалённые относительно HEAD ожидания отмечены.
  Файл — производный вид, источник — файл ожиданий.
- `ai expect serve <file> [--port <n>]` — та же страница
  с `http://127.0.0.1:<port>/` (по умолчанию 4173): собирается при
  каждом запросе. Needs-review даёт HTTP 503, render failure — 500;
  source revision сверяется заново, HTTP 200 не заменяет acceptance proof.
  Runtime outputs не создают watch feedback loop; semantic `.oc3` inputs
  остаются источниками инвалидации. Артефакт плана — файл ожиданий, не HTML.

## Роли

Перед запуском роли общий `ensureMemory` валидирует и при необходимости
пересобирает память, затем проверяет её полный file-set. Инъекция не
использует отсутствующий или устаревший payload; memory markers обозначают
только logical nodes, не каталоги файловых проекций. Запись защищена lease,
но не объявляется atomic rename транзакцией.

Роль — субагент из `agents/<name>.md` источника (в проекте —
`.agents/agents/`): промпт, `tools`, `model` (дефолт —
`zai-coding-plan/glm-5.3#max`, у judge — `zai-coding-plan/glm-5.3-flash#low`;
override проекта — любая модель каталога OpenCode, см. `models set`)
и `output` — сообщение
протокола, которым роль
возвращает итог. Одна и та же роль работает субагентом в сессии агента
(адаптеры генерируют `.opencode/agents/`, `.codex/agents/`) и
headless-исполнителем в harness.

- Протокол — JSON Schema сообщений: `result` (итог работы: статус,
  изменённое, не прошедшее, вопросы, отчёт), `verdict` (ответ судьи:
  вердикты пакета или проверка заголовков), `question` (блокирующий
  вопрос человеку; канала для него пока нет). Схемы — `PROTOCOL` из
  пакета.
- Запуск — `opencode run --format json --auto --agent <роль>
  --model <модель>`: launcher передаёт конфиг через
  `OPENCODE_CONFIG_CONTENT`, instruction file с промптом роли,
  memory/preflight и задание на stdin. Это переданные inputs, не
  аттестация effective inherited/system/tool context или closed isolation.
  Список `tools` роли не доказывает effective allowlist. Основной ответ —
  `submit_result` плагина `@shahimat/oc3`; `askRole` также имеет
  file/session/text fallback с проверкой схемы, не удостоверяющей producer.
- Вход роли librarian — схема `INTENTS_SCHEMA`: намерения `kind`
  (`decision`, `fact`, `rule`, `behavior-change`, `task`, `manual`),
  `summary`, `evidence`; пересмотр — `kind: revise` с обязательными
  `target`, `was`, `why`, `evidence`. Вход не по схеме — `InputError`
  (подкласс `UsageError`) с ожидаемой формой `INTENTS_SHAPE`: CLI
  печатает короткое сообщение без полной справки, код `2`. Ответ судьи о документации — `verdict` с полем
  `conflicts` (`file_a`, `quote_a`, `file_b`, `quote_b`, `reason`).
- Роли пакета используют: `expect judge --run` (роль `judge`),
  `docs-delta` (роль `librarian` в `apply` с `--file`, роль `judge` в
  `review`).

Коды выхода: `0` — ok, `1` — нарушения, `2` — ошибка вызова или
конфигурации.

## `.oc3/ai-core.yml`

```yaml
adapters: [codex, opencode]
checks:
  changelog:
    max_line: 120
    tags: [arch, stack, dep, milestone]
  context: {}
  adapters: {}
  secrets:
    allow:
      - path: docs/aws.md
        line: 12
        reason: пример ключа из документации AWS
```

`secrets` включена, даже если ключа нет; `secrets: false` — выключить.
Исключение без `reason` — ошибка конфига.

## Тестирование исходников

Нужны Node ≥ 24, установленные workspace dependencies (`npm ci` из
корня репозитория) и включённые npm lifecycle hooks: `ignore-scripts`
не является поддержанным подготовленным путём.

Из корня репозитория:

```bash
npm test -w @shahimat/ai-core
```

Из `packages/ai-core` — `npm test`. В обоих случаях `pretest` сначала
делает clean build текущих исходников, затем Vitest собирает и запускает
тесты. Cross-run reuse ограничен reviewed bounded guards contract;
остальная область исполняется run-only с реальным exit и полным selected
scope. Incomplete repeat требует нового run, без второго launch.
[Контракт reuse/force](../../design/incremental-verification.md) не отменяет
pretest preparation. Source resolution сохраняется;
`helper-leaves` и `artifacts` также проверяют compiled runtime и публичный JS.
Build и процессы, читающие общий `dist`, запускаются последовательно,
в том числе если CI уже выполнил build.

`prepublishOnly` выполняет source typecheck → `npm test` (его `pretest`
clean build → тесты). Свежий output проверяется до публикации; отдельной
сборки после тестов нет. Сам `npm run prepublishOnly -w @shahimat/ai-core`
ничего не публикует.

Прямой Vitest не выполняет `pretest`: перед ним нужен
`npm run build -w @shahimat/ai-core`. Preparation regression следует
запускать через npm, например
`npm test -w @shahimat/ai-core -- test/preparation.test.ts`: ему нужен
активный `npm_execpath`.

Общий test-only setup изолирует inherited `FAKE_*`, relevant HARNESS
timeout/expect и Git controls. System/global Git config, hooks и signing
отключаются, synthetic identity задаётся только окружением тестового
процесса, без переписывания реальных configs. Первым в `PATH` стоит Node
текущего процесса; `NODE_OPTIONS` и instrumentation сохраняются.
`expect-cli` создаёт и очищает полный fixture на каждый тест, без
обязательного предшествующего test case.

Controlled missing/stale-dist, dirty-env и order-regressions проверены
в текущем macOS runtime и synthetic альтернативных cwd/env. Это не
cross-machine гарантия.

Обычные package tests и publish hooks не требуют работающего OpenCode/model:
controlled fakes допустимы, но не доказывают production semantic reuse.
Проверка distribution без `src` использует обычные public exports/compiled CLI,
без dev `source` condition; successful collection с semantic needs-review
отличается от module-resolution failure. Границы evidence —
[релиз пакетов](../../design/packages.md#релиз).

## Лицензия

MIT
