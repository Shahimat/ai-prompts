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

## Команды

- `harness check` — все проверки, включённые в `context/harness.yml`.
- `harness changelog lint` — `CHANGELOG.md`: строка
  `- YYYY-MM-DD · [tag] суть · почему` до 120 символов, тег из списка,
  порядок дат.
- `harness context index` — генерация `context/index.yml` из слоёв
  документации (entities, behavior, manuals, conventions, слои модулей).
- `harness adapters sync` — файлы под Claude Code и Codex из
  `AGENTS.md` и `.agents/`: `CLAUDE.md`, копии skills, субагенты,
  выключенная memory агента.
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
- `harness outdated` — версия из `context/harness.yml` против последней
  в npm и записи `CHANGELOG.md` пакета между ними (код 1 — есть новее).
- `harness index build | check --raw-base <url>` — индекс
  `prompts/index.yml` репозитория промптов.

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
```

## Лицензия

MIT
