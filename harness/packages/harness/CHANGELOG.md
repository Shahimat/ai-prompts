# Журнал @shahimat/harness

Свежее сверху. Одна версия — список новых команд и проверок.

## 0.4.0

- `harness outdated` — версия из `context/harness.yml` против последней в
  npm и записи этого журнала между ними.
- Якоря доказательств `@KEY`: `<!-- expect:KEY -->` (markdown),
  `# expect:KEY` (YAML), `// expect:KEY` (TS).
- Ключ вердикта судьи — заголовок + доказательства.

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
