# @shahimat/ai-core

CLI `ai-core` для проектов на контракте
[`agent-operational-contract-v3`](https://github.com/Shahimat/ai-prompts/blob/main/prompts/productivity/agent-operational-contract-v3.md):
механические проверки и генерация, механизм ожиданий и роли, чтобы агент
не держал их в памяти. Автоматы поверх этих команд — пакет
[`@shahimat/harness`](https://www.npmjs.com/package/@shahimat/harness).

Node ≥ 24. macOS, Linux, Windows.

## Запуск

```bash
npx -y @shahimat/ai-core@<version> <команда> --root .
```

Версия проекта — `version` в `context/ai-core.yml`.

## Устройство

Пакет делится на слои, зависимости идут только вниз:

- **команды** — атомарные операции: прочитали файлы, проверили или
  сгенерировали, вернули код. Друг друга не вызывают;
- **скрипты** — только последовательность команд, без своей логики.

Под ними — общий `shared` (guards, конфиг, проверка JSON Schema) и
библиотека `lib` (`@shahimat/ai-core/expect`, индекс промптов, роли).
Автоматы (`@shahimat/harness`) — слой выше: импортируют публичный API
`ai-core`, обратной зависимости нет.

У каждой команды и операции автомата объявлен эффект: **query** не
меняет файлов (кроме кэша по содержимому вне git), **mutation** пишет.
Эффект скрипта выводится из его шагов. CI и модель внутри состояния
автомата получают только query.

## Скрипты

- `ai-core check` — все проверки, включённые в `context/ai-core.yml`:
  `changelog lint`, `context check`, `adapters check`, `secrets scan`.
  Каждая печатает свой итог; код выхода — худший из кодов шагов.
- `ai-core refresh` — пересобрать производные файлы (`context index`,
  `adapters sync` — если включены в `checks`) и затем шаги `check`.

## Команды

Mutation — `context index`, `adapters sync`, `delta close`,
`expect init`, `expect judge`, `expect report --html`, `index build`,
`role run`, `role channel`; остальные — query.

- `ai-core secrets scan [--file <path>]` — секреты (ключи API, токены,
  пароли, приватные ключи) в отслеживаемых git файлах проекта или в
  одном файле по пути; в выводе — путь, строка и тип, без значения. В
  `ai-core check` включена по умолчанию.
- `ai-core changelog lint` — `CHANGELOG.md`: строка
  `- YYYY-MM-DD · [tag] суть · почему` до 120 символов, тег из списка,
  порядок дат.
- `ai-core context index` — генерация `context/index.yml` из слоёв
  документации (entities, behavior, manuals, conventions, слои модулей).
- `ai-core context check` — сверка `context/index.yml` со слоями
  документации без записи.
- `ai-core adapters sync` — файлы под Claude Code и Codex из
  `AGENTS.md` и `.agents/`: `CLAUDE.md`, копии skills, субагенты,
  выключенная memory агента.
- `ai-core adapters check` — сверка файлов адаптеров с `AGENTS.md` и
  `.agents/` без записи.
- `ai-core expect init` — каркас ожиданий в проекте: точка входа
  `expectations/index.expect.ts`, пример файла с бюджетом, npm-скрипты,
  `.gitignore`.
- `ai-core expect report | lint | judge [--apply | --run] <file>` — ожидания в
  форме vitest: дерево со статусами, проверка заголовков, пакетная
  смысловая проверка судьёй-агентом с кэшем вердиктов. `judge` пишет
  задания в `.judge/` для субагента-судьи, `--apply` применяет ответы;
  `--run` отвечает на задания ролью `judge` (см. «Роли») и сразу
  применяет. `<file>` — одна
  точка входа `*.expect.ts`; остальные файлы ожиданий попадают в прогон
  только через `import` в ней. Конфиг vitest — из пакета, проекту свой
  не нужен. Отчёт, бюджет и проверка заголовков — по модулю, где
  объявлено ожидание; вердикты и задания судьи — рядом с точкой входа
  (`<каталог>/.verdicts.json`, `<каталог>/.judge/`). Помощники для
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
- `ai-core delta check | close` — дельта проектной документации в
  `context/.delta/*.yml` (пункты `add` / `refine` / `revise`). `check`
  сверяет слои документации с `HEAD`: удалённое или изменённое знание
  без пункта `revise` — нарушение. `close` после приёмки (check чист,
  пункты выполнены) удаляет дельту и печатает строки `revise` для тела
  коммита.
- `ai-core role run <name> --file <задание> [--out <ответ>]` — роль из
  `.agents/agents/<name>.md` (в источнике — `agents/<name>.md`)
  headless: текст задания — на stdin, итог — сообщением протокола в
  `--out` или stdout (см. «Роли»).
- `ai-core role channel <message> --out <файл>` — MCP-сервер (stdio)
  канала роли с одним инструментом `submit_result`: проверяет ответ по
  схеме сообщения, невалидный возвращает модели ошибкой с путём к полю,
  валидный пишет в `--out`. Запускает его `role run`, не человек.
- `ai-core outdated` — версия из `context/ai-core.yml` против последней
  в npm и записи `CHANGELOG.md` пакета между ними (код 1 — есть новее).
- `ai-core index build | check --raw-base <url>` — индекс
  `prompts/index.yml` репозитория промптов.

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
- `ai-core expect report <file> --html <out>` — HTML без сети
  и без JS: диаграммы блоков — SVG Graphviz (wasm, при генерации); узел и переход ведут к карточке, цвет — статус ожиданий;
  новые, изменённые и удалённые относительно HEAD ожидания отмечены.
  Файл — производный вид, источник — файл ожиданий.
- `ai-core expect serve <file> [--port <n>]` — та же страница
  с `http://127.0.0.1:<port>/` (по умолчанию 4173): собирается при
  каждом запросе, правка файла ожиданий видна после перезагрузки, на
  диск ничего не пишется. Так артефакт плана — только файл ожиданий.

## Роли

Роль — субагент из `agents/<name>.md` источника (в проекте —
`.agents/agents/`): промпт, `tools`, `model` (`opus` по умолчанию,
`sonnet`, `haiku`) и `output` — сообщение протокола, которым роль
возвращает итог. Одна и та же роль работает субагентом в сессии агента
(адаптеры генерируют `.claude/agents/`, `.codex/agents/`) и
headless-исполнителем в harness.

- Протокол — JSON Schema сообщений: `result` (итог работы: статус,
  изменённое, не прошедшее, вопросы, отчёт), `verdict` (ответ судьи:
  вердикты пакета или проверка заголовков), `question` (блокирующий
  вопрос человеку; канала для него пока нет). Схемы — `PROTOCOL` из
  пакета.
- Запуск — `claude -p` из Claude Code пользователя (его вход):
  `--setting-sources ""`, `--strict-mcp-config`, единственный MCP —
  канал `role channel` с `submit_result`, права — `tools` роли и
  `submit_result`, режим `dontAsk`, задание — на stdin. Ответ текстом
  harness не читает: нет вызова `submit_result` с валидным ответом —
  ошибка роли.
- Вход роли docs-keeper — схема `INTENTS_SCHEMA`: намерения `kind`
  (`decision`, `fact`, `rule`, `behavior-change`, `task`, `manual`),
  `summary`, `evidence`. Ответ судьи о документации — `verdict` с полем
  `conflicts` (`file_a`, `quote_a`, `file_b`, `quote_b`, `reason`).
- Роли пакета используют: `expect judge --run` (роль `judge`),
  `docs-delta` (роль `docs-keeper` в `apply` с `--file`, роль `judge` в
  `review`).

Коды выхода: `0` — ok, `1` — нарушения, `2` — ошибка вызова или
конфигурации.

## `context/ai-core.yml`

```yaml
version: 0.4.0
adapters: [claude-code, codex]
checks:
  changelog:
    max_line: 120
    tags: [arch, stack, dep, milestone]
  context-index: {}
  adapters: {}
  secrets:
    allow:
      - path: docs/aws.md
        line: 12
        reason: пример ключа из документации AWS
```

`secrets` включена, даже если ключа нет; `secrets: false` — выключить.
Исключение без `reason` — ошибка конфига.

## Лицензия

MIT
