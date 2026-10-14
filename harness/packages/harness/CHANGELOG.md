# Журнал @shahimat/harness

Свежее сверху. Одна версия — список новых команд и проверок.

## 0.4.0

- `harness context check` и `harness adapters check` — сверка
  `context/index.yml` и файлов адаптеров без записи: то же, что проверяет
  `harness check`, отдельной командой.
- Проверка `secrets` и команда `harness secrets scan [--file <path>]`:
  ключи API, токены, пароли, приватные ключи в отслеживаемых файлах или
  в файле по пути. В `harness check` включена по умолчанию, выключается
  `secrets: false`; исключения — `checks.secrets.allow` с `reason`.
- Планер `plan/iter`: `harness plan list | <harness> start | validate |
  graph`, `harness session list | <сессия> status | resume | retry |
  check [--hook] | render | read | clone * | clone md`. Автомат из
  `harness.yaml` (схема `harness-fsm`), критерии `criteria.yaml`,
  плагины `handlers/`, сессии в `~/.config/harness`. Модель в любом
  состоянии, включая интерактивного планера, — без skills
  (`--disable-slash-commands`) и только с перечисленными инструментами
  (`--tools`).
- `list` и `help` на каждом уровне дерева команд; без аргументов в
  терминале — оболочка с переходом по уровням.
- `harness delta check | close` — дельта документации `context/.delta/`:
  удаление или изменение знания без пункта `revise` — нарушение; `close`
  удаляет принятую дельту. `context index` не читает `context/.delta/`.
- Справка и разбор команд — из декларативного дерева `COMMANDS`.
- `harness outdated` — версия из `context/harness.yml` против последней в
  npm и записи этого журнала между ними.
- Якоря доказательств `@KEY`: `<!-- expect:KEY -->` (markdown),
  `# expect:KEY` (YAML), `// expect:KEY` (TS).
- Ключ вердикта судьи — заголовок + доказательства.
- `expect judge` удаляет из `.verdicts.json` вердикты, которые не нужны
  ни одному текущему ожиданию: кэш не растёт с историей правок.
- `expect` работает строго от `--root`: кэш вердиктов и доказательства не
  читаются из текущей папки.
- `skill(name).description` — пустая строка, если `description` во
  frontmatter не строка (раньше `[object Object]`); `index_layers` с
  нестроковым `format` — значение в диагностике как JSON.
- Данные извне (`.verdicts.json`, `plan.json`, ответы судьи, отчёт vitest,
  npm registry, `answers` модулей и поля пресетов) проверяются по форме:
  неверная форма — ошибка с путём к полю, а не молча принятое значение.

## 0.3.0

- `harness expect init | report | lint | judge [--apply]`: ожидания в форме
  vitest, уровни crit / warn / info, бюджет, судья с кэшем вердиктов.
- Помощники `@shahimat/harness/expect`: зонды, `judged`, JSON Schema.

## 0.2.0

- `index_layers` с `format: yml`; группа `presets` и поле `deprecated` в
  индексе источника.

## 0.1.0

- `harness check`, `changelog lint`, `context index`, `adapters sync`,
  `index build | check`.
