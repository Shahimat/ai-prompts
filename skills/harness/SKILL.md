---
name: harness
metadata:
  runs: refresh
description: Как пользоваться @shahimat/harness в проекте — refresh и check, команды и процессы, конфиг context/harness.yml. Загружай перед завершением задачи, при правке сгенерированных файлов и при ошибках harness check.
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

<!-- expect:skill-runs -->
<!-- metadata.runs: refresh -->
Сам skill запускает одно: `harness refresh` в конце каждой задачи и
после записи docs-keeper — пересобрать производные файлы и проверить
проект. Остальное — справка: что делает команда и кто её запускает.

- `harness refresh` — `context index` и `adapters sync` (если включены в
  `checks`), затем шаги `harness check`.
- `harness check` — все проверки из `checks` в `context/harness.yml`:
  `changelog lint`, `context check`, `adapters check`, `secrets scan`.
- `harness secrets scan` — секреты (ключи API, токены, пароли,
  приватные ключи) в отслеживаемых файлах; в `harness check` включена
  по умолчанию. `--file <path>` — один файл, в том числе вне проекта:
  её запускает skill `source-feedback` перед тем, как артефакт уходит
  наружу. В выводе — путь, строка и тип, без значения.
- `harness changelog lint` — формат `CHANGELOG.md`: строка до
  `max_line`, три части через ` · `, тег из списка, дата, порядок.
- `harness context index` — пересобрать `context/index.yml` из слоёв,
  включая слои модулей из `provides.index_layers` их manifest'ов; шаг
  `harness refresh`.
- `harness adapters sync` — пересобрать файлы под инструменты
  (`CLAUDE.md`, `.claude/`, `.codex/`) из `AGENTS.md` и `.agents/` и
  выключить memory агента: `autoMemoryEnabled: false` в
  `.claude/settings.json` (остальные ключи файла сохраняются),
  `.codex/config.toml` с выключенными memories. Ручной
  `.codex/config.toml` не трогает — только сообщает, каких ключей не
  хватает. Шаг `harness refresh`.
- `harness outdated` — версия из `context/harness.yml` против последней
  в npm и записи журнала пакета между ними (код 1 — есть новее); первый
  шаг `harness source-sync`.
- `harness delta check` и `harness delta close` — сверка слоёв
  документации с `HEAD` (знание без пункта `revise` — нарушение) и
  удаление принятой дельты; шаги `harness docs-delta`.
- `harness docs-delta start` и `harness source-sync start` — harness
  skills `docs-keeper` и `source-sync`: в состоянии агента harness
  останавливается с заданием, `harness <имя> open <id>`
  продолжает.
- `harness plan-review start <file>` — план в файле ожиданий: диалог с
  планером в терминале, ревью судьёй по бюджету файла, правки до лимита
  циклов. Сессия живёт в `~/.config/harness`, планер меняет только файл
  ожиданий; смотреть — `harness expect serve <file>`. Команда user scope:
  запускает пользователь из глобальной установки
  (`npm i -g @shahimat/harness`), не агент из задачи.
<!-- /expect:skill-runs -->

## Сгенерированное не правится руками

<!-- expect:docs-readonly -->
`context/index.yml`, `CLAUDE.md`, `.claude/skills/*` с файлом
`.harness-generated`, `.claude/agents/*`, `.codex/agents/*`,
сгенерированный `.codex/config.toml` — производные. Правишь источник,
затем генерация. Ручную правку копии ловит проверка `adapters`.

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

<!-- expect:skill-runs -->
- `CHANGELOG.md:12: длина 180 символов > 120` — переписать строку через
  docs-keeper: решение одной фразой, детали — в git log.
- `docs/entities/x.yml: нет поля summary` — добавить однострочный
  `summary`, пересобрать индекс.
- `context/index.yml: устарел` — `harness refresh`.
- `notes.md:3: секрет: токен GitHub` — значение убрать, вместо него
  указатель на хранилище; секрет уже в истории git — сказать
  пользователю: его нужно отозвать. Ложное срабатывание — исключение в
  `checks.secrets.allow` с `reason`, только после «да».
- `… отсутствует или устарел: запусти harness adapters sync` —
  `harness refresh`; если копию правили руками — правку перенести в
  источник.
<!-- /expect:skill-runs -->
