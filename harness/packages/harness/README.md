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
`expect init`, `expect judge`, `index build`; остальные — query.

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
- `harness expect init` — каркас ожиданий в проекте: конфиг vitest,
  пример файла с бюджетом, npm-скрипты, `.gitignore`.
- `harness expect report | lint | judge [--apply]` — ожидания в форме
  vitest (`expectations/*.expect.ts`): дерево со статусами, проверка
  заголовков, пакетная смысловая проверка судьёй-агентом с кэшем
  вердиктов. Помощники для проверок — `@shahimat/harness/expect`
  (нужен vitest в проекте): `crit` / `warn` / `note` / `budget`,
  `expectAtMost` (info при > 90% порога), зонды по репозиторию,
  `judged`, проверка JSON Schema (`expectSchema`, `dataFiles`,
  `frontmatters`).
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

## Процессы агента: `docs/delta` и `source/sync`

Работу в них делает агент, вызвавший harness: в его состоянии процесс
останавливается с заданием, `harness session <сессия> resume`
продолжает со следующего состояния. Сессии — как у `plan/iter`, в
`~/.config/harness/`.

- `harness docs delta start --name <дельта> | validate | graph` —
  запись в документацию (skill docs-keeper): `apply` (агент собирает и
  применяет `context/.delta/<дельта>.yml`) → `verify` (`context index`,
  `adapters sync`, `delta check`, шаги `check`) → `close`
  (`delta close`). Провал `verify` или `close` возвращает в `apply` не
  больше 3 раз, затем `failed`; `session <сессия> retry` — снова `apply`.
- `harness source sync start | validate | graph` — синхронизация с
  источниками (skill source-sync): `outdated` (версия harness и журнал,
  без `version` в конфиге — пропуск) → `update` (агент обновляет файлы)
  → `refresh`. Провал `refresh` возвращает в `update` не больше 3 раз.

## Процесс `plan/iter`

Команды user scope: ставятся глобально (`npm i -g @shahimat/harness`),
сессии — в `~/.config/harness/` (`--home <dir>` или `HARNESS_HOME`).

- `harness plan iter start [--name <название>] [--request <запрос>]` —
  интерактивный `claude` с ролью планера в каталоге проекта → проверка
  структуры (1a) → ревью: дешёвая модель без сети (1b) и сильная с
  проектом и сетью (2) → правки до 3 на цикл → меню: согласовать,
  вернуть всё или по пунктам, переработать, уточнить.
- `harness plan list`, `harness plan iter validate | graph` — определения,
  проверка `harness.yaml` и Mermaid автомата.
- `harness session list`, `harness session <сессия> status | resume |
  retry | check [--hook] | render [--out] | read | clone * | clone md
  [--out]`. Query — `list`, `validate`, `graph`, `status`, `check`,
  `read`; `check --hook` (Stop-hook ведёт счётчик блокировок) и
  остальные — mutation.
- Без аргументов в терминале `harness` открывает оболочку: вход в
  уровень по имени, `..`, `list` и `help` на каждом уровне.

Определение — `harnesses/plan/iter/` пакета: `harness.yaml` (автомат,
лимиты, бюджет, модели), `criteria.yaml` (критерии ревью), `prompts/`.
Файлы `~/.config/harness/harnesses/plan/<имя>/` перекрывают встроенные;
`handlers/*.{js,mjs,ts}` — свои действия и guards
(`export default { actions, guards }`). Модели запускаются с
`--setting-sources ""`: settings, hooks и `CLAUDE.md` пользователя и
проекта в прогоны не попадают.

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
