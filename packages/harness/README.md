# @shahimat/harness

CLI для проектов на контракте
[`agent-operational-contract-v3`](https://github.com/Shahimat/ai-prompts/blob/main/prompts/productivity/agent-operational-contract-v3.md):
механические проверки и генерация, чтобы агент не держал их в памяти.

Node ≥ 24. macOS, Linux, Windows.

## Запуск

```bash
npx -y @shahimat/harness@<version> <команда> --root .
```

Версия проекта — `version` в `context/harness.yml`.

## Устройство

Пакет делится на слои, зависимости идут только вниз:

- **команды** — атомарные операции: прочитали файлы, проверили или
  сгенерировали, вернули код. Друг друга не вызывают;
- **скрипты** — только последовательность команд, без своей логики;
- **процессы (harness)** — автомат с состояниями: переходами управляет
  скрипт, модель и человек работают внутри состояний.

Под ними — общий `shared` (guards, конфиг, проверка JSON Schema) и
библиотека `lib` (`@shahimat/harness/expect`, индекс промптов).

У каждой команды и операции процесса объявлен эффект: **query** не
меняет файлов (кроме кэша по содержимому вне git), **mutation** пишет.
Эффект скрипта выводится из его шагов. CI и модель внутри состояния
процесса получают только query.

## Скрипты

- `harness check` — все проверки, включённые в `context/harness.yml`:
  `changelog lint`, `context check`, `adapters check`, `secrets scan`.
  Каждая печатает свой итог; код выхода — худший из кодов шагов.
- `harness refresh` — пересобрать производные файлы (`context index`,
  `adapters sync` — если включены в `checks`) и затем шаги `check`.

## Команды

Mutation — `context index`, `adapters sync`, `delta close`,
`expect init`, `expect judge`, `expect report --html`, `index build`;
остальные — query.

- `harness secrets scan [--file <path>]` — секреты (ключи API, токены,
  пароли, приватные ключи) в отслеживаемых git файлах проекта или в
  одном файле по пути; в выводе — путь, строка и тип, без значения. В
  `harness check` включена по умолчанию.
- `harness changelog lint` — `CHANGELOG.md`: строка
  `- YYYY-MM-DD · [tag] суть · почему` до 120 символов, тег из списка,
  порядок дат.
- `harness context index` — генерация `context/index.yml` из слоёв
  документации (entities, behavior, manuals, conventions, слои модулей).
- `harness context check` — сверка `context/index.yml` со слоями
  документации без записи.
- `harness adapters sync` — файлы под Claude Code и Codex из
  `AGENTS.md` и `.agents/`: `CLAUDE.md`, копии skills, субагенты,
  выключенная memory агента.
- `harness adapters check` — сверка файлов адаптеров с `AGENTS.md` и
  `.agents/` без записи.
- `harness expect init` — каркас ожиданий в проекте: точка входа
  `expectations/index.expect.ts`, пример файла с бюджетом, npm-скрипты,
  `.gitignore`.
- `harness expect report | lint | judge [--apply] <file>` — ожидания в
  форме vitest: дерево со статусами, проверка заголовков, пакетная
  смысловая проверка судьёй-агентом с кэшем вердиктов. `<file>` — одна
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
- `harness delta check | close` — дельта проектной документации в
  `context/.delta/*.yml` (пункты `add` / `refine` / `revise`). `check`
  сверяет слои документации с `HEAD`: удалённое или изменённое знание
  без пункта `revise` — нарушение. `close` после приёмки (check чист,
  пункты выполнены) удаляет дельту и печатает строки `revise` для тела
  коммита.
- `harness outdated` — версия из `context/harness.yml` против последней
  в npm и записи `CHANGELOG.md` пакета между ними (код 1 — есть новее).
- `harness index build | check --raw-base <url>` — индекс
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
- `harness expect report <file> --html <out>` — HTML без сети
  и без JS: диаграммы блоков — SVG Graphviz (wasm, при генерации); узел и переход ведут к карточке, цвет — статус ожиданий;
  новые, изменённые и удалённые относительно HEAD ожидания отмечены.
  Файл — производный вид, источник — файл ожиданий.
- `harness expect serve <file> [--port <n>]` — та же страница
  с `http://127.0.0.1:<port>/` (по умолчанию 4173): собирается при
  каждом запросе, правка файла ожиданий видна после перезагрузки, на
  диск ничего не пишется. Так артефакт плана — только файл ожиданий.

## Harness

Harness — автомат с сессией; его команды — под его именем:

```
harness <имя> start [опции]     # новая сессия, печатает короткий id
harness <имя> open <id>         # продолжить: заново выполнить действие текущего состояния
harness <имя> list              # сессии этого harness
harness <имя> status <id>
harness <имя> validate | graph  # определение и Mermaid автомата
```

- Проект для команд harness — первый каталог с `.claude` вверх от места
  вызова (домашний каталог с `~/.claude` проектом не считается) или
  `--root <путь>`. Без `.claude` в проекте `start` не стартует и ничего
  не создаёт. Проектные команды (`check`, `context index` и др.) берут
  текущий каталог.
- id сессии — sha256, в выводе 7 символов; `open` и `status`
  принимают уникальный префикс от 4 символов.
- Пауза — выход: каждый переход сразу на диске
  (`~/.config/harness/sessions/<id>/`, `--home <dir>` или
  `HARNESS_HOME`). В состоянии агента `open` — приём задания, из `failed`
  — повтор со сбросом счётчиков.
- Определение — `src/harnesses/<имя>/harness.yaml` пакета рядом с кодом
  (в сборке — `dist/harnesses/<имя>/`). Файлы
  `~/.config/harness/harnesses/<имя>/` перекрывают встроенные;
  `handlers/*.{js,mjs,ts}` — свои действия и guards
  (`export default { actions, guards }`).
- Модели запускаются с `--setting-sources ""` и
  `--disable-slash-commands`: settings, hooks, `CLAUDE.md` и skills
  пользователя и проекта в прогоны не попадают.
- Без аргументов в терминале `harness` открывает оболочку: вход в
  уровень по имени, `..`, `list` и `help` на каждом уровне.

### `docs-delta` и `source-sync`

Работу в них делает агент, вызвавший harness: в его состоянии harness
останавливается с заданием, `harness <имя> open <id>` продолжает.

- `harness docs-delta start --name <дельта>` — запись в документацию
  (skill docs-keeper): `apply` (агент собирает и применяет
  `context/.delta/<дельта>.yml`) → `verify` (`context index`,
  `adapters sync`, `delta check`, шаги `check`) → `close`
  (`delta close`). Провал `verify` или `close` возвращает в `apply` не
  больше 3 раз, затем `failed`.
- `harness source-sync start` — синхронизация с источниками (skill
  source-sync): `outdated` (версия harness и журнал, без `version` в
  конфиге — пропуск) → `update` (агент обновляет файлы) → `refresh`.
  Провал `refresh` возвращает в `update` не больше 3 раз.

### `plan-review`

Команда user scope: ставится глобально (`npm i -g @shahimat/harness`).

- `harness plan-review start <file> [--request <запрос>]` — план в файле
  ожиданий `<file>` (путь от корня проекта): существующий файл — план
  изменения его состояния, нового нет — создаётся каркас с
  `plan({ name })`. Имя плана — из `plan({ name })`, для нового файла —
  из имени файла. План смотрится командой `harness expect serve <file>`.
  Дальше — интерактивный `claude` с ролью планера в каталоге проекта:
  без `--request` запрос пишется в этой сессии (текст, файлы,
  картинки), с `--request` текст уходит планеру первым сообщением. Без
  терминала `start` встаёт на паузу, `open <id>` продолжает (`--resume`
  той же сессии планера). Вместе с сессией планера поднимается страница
  плана — `expect serve <file>` на свободном порту: адрес печатается,
  страница открывается в браузере (`BROWSER`; `BROWSER=none` — не
  открывать), сервер гаснет с сессией; адрес — в промпте планера и в
  ответе чистого ревью.
- Автомат: `awaiting_input` → `gathering` → `composing` (↔
  `clarify_form`) → `review` → `analyze` → `composing` или
  `awaiting_input`; ход без записи файла — `gathering` → `replied` →
  `awaiting_input`; `exit` → `finished`. Схема — блок `fsm` в
  `expectations/harness-plan-review.expect.ts`, `harness.yaml` с ней
  совпадает (`Graph.sameAs`).
- События выводит `harness plan-review hook <id> <hook>` из hooks сессии
  планера, модель их не объявляет: `prompt` (UserPromptSubmit) в
  `awaiting_input` — `request`; `edit` (PreToolUse Edit/Write) —
  `gathered`, правка другого файла или правка вне
  `gathering`/`composing` блокируется; `bash` (PreToolUse Bash)
  пропускает только `expect report` своего файла при любом режиме
  разрешений; `ask` и `answer` (AskUserQuestion) — `unclear` и
  `answered`; `stop` в `gathering` — `replied`, в `composing` (ответ
  планеру — JSON `decision: block`) — сборка
  файла (сбор ожиданий и `tsc` ближайшего `tsconfig.json`; не собирается
  — блок не больше `limits.build` раз), затем ревью судьёй и разбор;
  `prompt` со словом «выход» в `awaiting_input` — `exit`; флаг
  `[plan-review: exit]` последней строкой ответа планера читается на
  `stop` после стадии: чистое ревью — `exit`, иначе выход отложен; `end`
  (SessionEnd: Ctrl+C, `/exit`) — пауза в любом состоянии: автомат на
  месте, `open <id>` продолжает ту же сессию через `--resume`.
- Ревью: `expect judge` по файлу плана, задания отвечает `models.judge`
  headless без сети и без записи (ответ — по `--json-schema`), затем
  `--apply` и прогон по бюджету файла. Сверх бюджета — `remarks`, планер
  получает замечания и правит; после `limits.cycles` циклов — к
  пользователю с объяснением; чисто — `clean`, планер поясняет итог.
- Определение: `harness.yaml` (автомат, лимиты `cycles` и `build`,
  модели `planner` и `judge`), `prompts/` (`planner`, `judge`). Состояние
  ревью — `plan-review.json` и `review/<n>.json` в каталоге сессии.

Коды выхода: `0` — ok, `1` — нарушения, `2` — ошибка вызова или
конфигурации.

## `context/harness.yml`

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
