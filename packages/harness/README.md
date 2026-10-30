# @shahimat/harness

Автоматы (harness) для проектов на контракте
[`agent-operational-contract-v3`](https://github.com/Shahimat/ai-prompts/blob/main/prompts/productivity/agent-operational-contract-v3.md):
`docs-delta`, `source-sync`, `plan-review`, `ticket-work` и рантайм
оператора `ops`. Команды, скрипты, механизм
ожиданий и роли, на которых они построены, — пакет
[`@shahimat/ai-core`](https://www.npmjs.com/package/@shahimat/ai-core).

Node ≥ 24. macOS, Linux, Windows.

## Запуск

Пакет ставится в `devDependencies` проекта (модуль harness) рядом с
`@shahimat/cli` и `@shahimat/ai-core`; своего бинаря нет — автоматы
запускает `ai`:

```bash
npx ai <автомат> start | open <id> | list | status <id> | validate | graph
```

## Harness

Harness — автомат с сессией; его команды — под его именем:

```
ai <имя> start [опции]     # новая сессия, печатает короткий id
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
останавливается с заданием, `ai <имя> open <id>` продолжает.

- `ai docs-delta start --name <дельта> [--file <намерения | ->]` —
  запись в документацию (skill docs-keeper): `apply` (с `--file` —
  роль `docs-keeper` headless; намерения — из файла или stdin, по
  схеме `intents`, хранятся в сессии; без `--file` или при провале роли
  — пауза с заданием агенту; собирается и применяется
  `context/.delta/<дельта>.yml`) → `verify` (`context index`,
  `adapters sync`, `delta check` своей дельты — нарушения в дельтах
  прошлых сессий только предупреждение, шаги `check`) → `review` (роль
  `judge`: противоречия изменённых файлов с остальной документацией,
  цитаты сверяются дословно, без цитаты находка отклоняется) → `close`
  (`delta close`). Провал `verify`, противоречия в `review` или провал
  `close` возвращают в `apply` (находки судьи — в задании) не больше 3
  раз, затем `failed`.
- `ai source-sync start` — синхронизация с источниками (skill
  source-sync): `outdated` (версия harness и журнал, без `version` в
  конфиге — пропуск) → `update` (агент обновляет файлы) → `refresh`.
  Провал `refresh` возвращает в `update` не больше 3 раз.

### `ticket-work` и `ops`

Рантайм оператора (модули `ops`, `watchers`, `dashboard` контракта):
работа по задаче идёт вне сессии оператора, роли — отдельные процессы
`claude -p`.

- `ai ticket-work start <ref>` — job по задаче: `intake` (карточка из
  провайдера `tasks`) → `research` → `plan` → `plan-gate` (ждёт «да») →
  `implement` (копия от провайдера `vcs`) → `verify` (команды
  `context/ops.yml` → `verify`) → `review` (DoD, дословные цитаты) →
  `ready` (ждёт «готово»; git-запись — пользователь) → `docs` → `done`.
  `ai ticket-work answer <id> <текст>` — ответ на вопрос роли, план или
  готовность. Журнал — `.ops/jobs/<id>/`: `log.md`, `events.jsonl`,
  артефакты, `runs/<состояние>-<n>.jsonl` — полный stream-json
  прогонов и `progress.log` — ход роли по шагам; оба пишутся по мере
  работы. Роль дольше таймаута (30 мин, правка — 60;
  `HARNESS_ROLE_TIMEOUT_MIN`) останавливается с причиной. `docs-delta`
  ведёт такие же журналы в каталоге своей сессии.
- `ai ops status` — работающие роли (job, минуты, последний шаг, путь
  журнала), jobs и наблюдатели; `ai ops brief` — сводка до 20 строк (hook `ops-brief` подставляет её
  на старте сессии); `ai ops status`; `ai ops wait [--all]
  [--timeout <с>]` — ждёт важного события и выходит.
- `ai ops watch add review|checks <запрос> [--every <мин>] [--until
  merged|closed|done|job-done] [--job <id>]`, `watch list`,
  `watch stop <id>`; `ai ops tick [--all]` — проверка наблюдателей:
  код сравнивает статусы, роль `watch-triage` (haiku) решает, нужна ли
  реакция, `watch-request` (sonnet) пишет запрос в job и действия в PR.
- `ai ops schedule on | off | status` — один планировщик на машину
  (`launchd`, `systemd` или свой провайдер `schedule`) для всех
  проектов реестра `~/.config/harness/ops/projects.yml`.
- `ai ops act <интерфейс> <метод> <цель> [--file <текст>]` — действие
  наружу по политике `context/autonomy.yml` (`never` не обходится).
- `ai ops serve [--port <n>] [--all]` — локальная HTML-доска jobs,
  журналов и событий с ответами из браузера.

Провайдер — `export default { interface, name, …методы }` в
`.agents/providers/<интерфейс>/<имя>.ts` проекта или
`~/.config/harness/providers/<интерфейс>/<имя>.ts` машины; встроенные —
`tasks/local`, `vcs/git`, `schedule/launchd`, `schedule/systemd`.
`context/ops.yml`:

```yaml
providers:
  tasks: local
  vcs: git
  review: none
  checks: none
  schedule: auto
repo: .
verify: [npm test]
```

Лимиты моделей машины — `~/.config/harness/ops/limits.yml` (`jobs: 4`,
`opus: 2`, `watchers: 1`): очередь по приоритету (ответ пользователя →
review → implement → plan → research), пауза при rate limit.

### `plan-review`

Заморожен: работает как есть, не развивается (дизайн —
`design/harness-plan-review.md`). Роли и протокол (см. «Роли») его
пока не касаются: судья плана — свой промпт и `--json-schema`.

Команда user scope: ставится глобально (`npm i -g @shahimat/harness`).

- `ai plan-review start <file> [--request <запрос>]` — план в файле
  ожиданий `<file>` (путь от корня проекта): существующий файл — план
  изменения его состояния, нового нет — создаётся каркас с
  `plan({ name })`. Имя плана — из `plan({ name })`, для нового файла —
  из имени файла. План смотрится командой `ai expect serve <file>`.
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
- События выводит `ai plan-review hook <id> <hook>` из hooks сессии
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
  `stop` после стадии: чистое ревью — `exit`, иначе выход отложен; после
  `exit` harness сам закрывает сессию планера (SIGTERM); `end`
  (SessionEnd: Ctrl+C, Ctrl+D) — пауза в любом состоянии: автомат на
  месте, `open <id>` продолжает ту же сессию через `--resume`.
  Слэш-команды в сессии планера отключены, `/exit` в том числе.
- Ревью: `expect judge` по файлу плана, задания отвечает `models.judge`
  headless без сети и без записи (ответ — по `--json-schema`), затем
  `--apply` и прогон по бюджету файла. Сверх бюджета — `remarks`, планер
  получает замечания и правит; после `limits.cycles` циклов — к
  пользователю с объяснением; чисто — `clean`, планер поясняет итог.
- Определение: `harness.yaml` (автомат, лимиты `cycles` и `build`,
  модели `planner` и `judge`), `prompts/` (`planner`, `judge`). Состояние
  ревью — `plan-review.json` и `review/<n>.json` в каталоге сессии.

## Паттерны ожиданий

`@shahimat/harness/expect` — паттерны для проектов, которые проверяют
свои автоматы (механизм — `@shahimat/ai-core/expect`):

- `harnessCommands({ harness })` — у автомата есть команды `start |
  open | list | status | validate | graph`;
- `harnessChain({ harness, chain, fails, back, limit })` — автомат —
  цепочка состояний с возвратом при провале и лимитом.

## Лицензия

MIT
