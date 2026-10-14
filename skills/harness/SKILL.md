---
name: harness
description: Как пользоваться @shahimat/harness в проекте — команды check, changelog lint, secrets scan, context index, adapters sync, конфиг context/harness.yml. Загружай перед завершением задачи, при правке сгенерированных файлов и при ошибках harness check.
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
- `harness secrets scan` — секреты (ключи API, токены, пароли,
  приватные ключи) в отслеживаемых файлах; в `harness check` включена
  по умолчанию. `--file <path>` — один файл, в том числе вне проекта:
  запускай перед тем, как артефакт уходит наружу. В выводе — путь,
  строка и тип, без значения.
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
- `harness plan iter start` — план большой задачи: диалог с планером,
  ревью в два уровня, правки, решение пользователя в терминале. Сессия
  живёт в `~/.config/harness`, проект не меняется; план в проект —
  `harness session <сессия> clone md --out <path>`. Команда user scope:
  запускает пользователь из глобальной установки
  (`npm i -g @shahimat/harness`), не агент из задачи.

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
  secrets:                         # есть всегда; false — выключить
    allow:
      - path: docs/manuals/aws.md
        line: 12
        reason: пример ключа из документации AWS
```

Неизвестный ключ — ошибка конфига: опечатка не выключает проверку
молча.

## Нарушения

- `CHANGELOG.md:12: длина 180 символов > 120` — переписать строку через
  docs-keeper: решение одной фразой, детали — в git log.
- `docs/entities/x.yml: нет поля summary` — добавить однострочный
  `summary`, пересобрать индекс.
- `context/index.yml: устарел` — `harness context index`.
- `notes.md:3: секрет: токен GitHub` — значение убрать, вместо него
  указатель на хранилище; секрет уже в истории git — сказать
  пользователю: его нужно отозвать. Ложное срабатывание — исключение в
  `checks.secrets.allow` с `reason`, только после «да».
- `… отсутствует или устарел: запусти harness adapters sync` — так и
  сделать; если копию правили руками — правку перенести в источник.
