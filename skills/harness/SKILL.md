---
name: harness
description: Как пользоваться @shahimat/harness в проекте — команды check, changelog lint, context index, adapters sync, конфиг context/harness.yml. Загружай перед завершением задачи, при правке сгенерированных файлов и при ошибках harness check.
---

# harness

`@shahimat/harness` — CLI, который делает механическую часть контракта:
проверки и генерацию. Конфиг — `context/harness.yml`.

## Запуск

```bash
npx -y @shahimat/harness@<version> <команда> --root .
```

`<version>` — из `context/harness.yml` → `version`. В проекте на Node
можно поставить пакет в `devDependencies` той же версии и звать
`npx harness`.

Коды выхода: `0` — ok, `1` — нарушения, `2` — ошибка вызова или
конфига.

## Команды

- `harness check` — все проверки из `checks` в `context/harness.yml`.
  Запускай в конце каждой задачи и после записи docs-keeper.
- `harness changelog lint` — формат `CHANGELOG.md`: строка до
  `max_line`, три части через ` · `, тег из списка, дата, порядок.
- `harness context index` — пересобрать `context/index.yml` из слоёв,
  включая слои модулей из `provides.index_layers` их manifest'ов.
  Запускай после создания, удаления или переименования entity,
  behavior, manual, convention и после правки `summary` / `title`.
- `harness outdated` — версия из `context/harness.yml` против последней
  в npm и записи журнала пакета между ними (код 1 — есть новее). Её
  вызывает обновление из источника (skill `source-sync`).
- `harness delta check` — сверка слоёв документации с `HEAD`: удалённое
  или изменённое знание без пункта `revise` в дельте `context/.delta/`
  — нарушение. Её запускает docs-keeper при приёмке.
- `harness delta close` — после приёмки (check чист, пункты выполнены)
  удаляет дельту и печатает строки `revise` для тела коммита.
- `harness adapters sync` — пересобрать файлы под инструменты
  (`CLAUDE.md`, `.claude/`, `.codex/`) из `AGENTS.md` и `.agents/` и
  выключить memory агента: `autoMemoryEnabled: false` в
  `.claude/settings.json` (остальные ключи файла сохраняются),
  `.codex/config.toml` с выключенными memories. Ручной
  `.codex/config.toml` не трогает — только сообщает, каких ключей не
  хватает. Запускай после правки `AGENTS.md`, skills или субагентов.

## Сгенерированное не правится руками

<!-- expect:docs-readonly -->
`context/index.yml`, `CLAUDE.md`, `.claude/skills/*` с файлом
`.harness-generated`, `.claude/agents/*`, `.codex/agents/*`,
сгенерированный `.codex/config.toml` — производные. Правишь источник,
затем генерация. `harness check` ловит ручную правку копии.

Файл без метки harness на месте генерируемого (например, свой
`CLAUDE.md`) — sync его не трогает и сообщает: содержимое перенести в
`AGENTS.md` или `.agents/`, файл удалить.
<!-- /expect:docs-readonly -->

## `context/harness.yml`

```yaml
version: <точная версия @shahimat/harness>
adapters: [claude-code, codex]
checks:
  changelog:
    max_line: 120
    tags: [arch, stack, dep, milestone]
  context-index: {}
  adapters: {}
```

Неизвестный ключ — ошибка конфига: опечатка не выключает проверку
молча.

## Нарушения

- `CHANGELOG.md:12: длина 180 символов > 120` — переписать строку через
  docs-keeper: решение одной фразой, детали — в git log.
- `docs/entities/x.yml: нет поля summary` — добавить однострочный
  `summary`, пересобрать индекс.
- `context/index.yml: устарел` — `harness context index`.
- `… отсутствует или устарел: запусти harness adapters sync` — так и
  сделать; если копию правили руками — правку перенести в источник.
