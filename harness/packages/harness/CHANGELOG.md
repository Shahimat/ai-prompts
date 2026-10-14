# Журнал @shahimat/harness

Свежее сверху. Одна версия — список новых команд и проверок.

## 0.4.0

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
