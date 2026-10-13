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
- `harness index build | check --raw-base <url>` — индекс
  `prompts/index.yml` репозитория промптов.

Коды выхода: `0` — ok, `1` — нарушения, `2` — ошибка вызова или
конфигурации.

## `context/harness.yml`

```yaml
version: 0.1.0
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
