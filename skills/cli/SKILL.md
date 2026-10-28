---
name: cli
metadata:
  runs: refresh
description: Как пользоваться CLI ai в проекте — refresh и check, команды, автоматы и свои расширения в .agents/, конфиг context/ai-core.yml. Загружай перед завершением задачи, при правке сгенерированных файлов, при ошибках ai check и при работе со своими командами, скриптами и автоматами.
---

# cli

Механическую часть контракта делает CLI `ai`. Пакеты — в
`devDependencies` проекта (`package.json`, точные версии):

- `@shahimat/cli` — бинарь `ai` и скрипты (`check`, `refresh`); ядро;
- `@shahimat/ai-core` — команды: проверки, генерация, роли; ядро;
- `@shahimat/harness` — автоматы `docs-delta`, `source-sync`,
  `plan-review`; модуль harness. Без него `ai` автоматов не знает.

Конфиг команд — `context/ai-core.yml`.

## Свои расширения

`ai` подхватывает расширения проекта из `.agents/`:

- `.agents/agents/<name>.md` — свои роли, формат тот же, что у ролей
  контракта;
- `.agents/commands/<name>.ts` — своя команда:
  `export default { path: [...], effect: 'query' | 'mutation', run }`;
- `.agents/scripts/<name>.yml` — свой скрипт: `path` и `steps`
  (`command: [...]`), только последовательность команд;
- `.agents/harnesses/<name>/` — свой автомат: `harness.yaml` по схеме
  автомата и `handlers/*.ts` (`export default { actions, guards }`);
  нужен модуль harness.

Расширения видны в справке `ai`; их можно объявлять в
`metadata.runs` skills. Имя, занятое встроенным, — ошибка. Обновление из
источника свои файлы не трогает.

## Запуск

Из корня проекта, локальные пакеты:

```bash
npx ai <команда>
npx ai <автомат> start | open <id> | …
```

Версия — в `package.json`; обновление — правка `devDependencies` и
`npm install` после «да»; что нового — команда `outdated` (ниже).

Коды выхода: `0` — ok, `1` — нарушения, `2` — ошибка вызова или
конфига.

## Команды

<!-- expect:skill-runs -->
<!-- metadata.runs: refresh -->
Сам skill запускает одно: `ai refresh` в конце каждой задачи и
после записи docs-keeper — пересобрать производные файлы и проверить
проект. Остальное — справка: что делает команда и кто её запускает.

- `ai refresh` — `context index` и `adapters sync` (если включены в
  `checks`), затем шаги `ai check`.
- `ai check` — все проверки из `checks` в `context/ai-core.yml`:
  `changelog lint`, `context check`, `adapters check`, `secrets scan`.
- `ai secrets scan` — секреты (ключи API, токены, пароли,
  приватные ключи) в отслеживаемых файлах; в `ai check` включена
  по умолчанию. `--file <path>` — один файл, в том числе вне проекта:
  её запускает skill `source-feedback` перед тем, как артефакт уходит
  наружу. В выводе — путь, строка и тип, без значения.
- `ai changelog lint` — формат `CHANGELOG.md`: строка до
  `max_line`, три части через ` · `, тег из списка, дата, порядок.
- `ai context index` — пересобрать `context/index.yml` из слоёв,
  включая слои модулей из `provides.index_layers` их manifest'ов; шаг
  `ai refresh`.
- `ai adapters sync` — пересобрать файлы под инструменты
  (`CLAUDE.md`, `.claude/`, `.codex/`) из `AGENTS.md` и `.agents/` и
  выключить memory агента: `autoMemoryEnabled: false` в
  `.claude/settings.json` (остальные ключи файла сохраняются),
  `.codex/config.toml` с выключенными memories. Ручной
  `.codex/config.toml` не трогает — только сообщает, каких ключей не
  хватает. С `hooks: [docs-guard]` ставит в `.claude/settings.json`
  hook `PreToolUse` на `Edit` / `Write` — `ai docs guard`. Шаг
  `ai refresh`.
- `ai docs guard` — hook, его запускает Claude Code перед каждой
  правкой файла в основной сессии: правка документации или
  генерируемого файла — отказ с подсказкой передать намерения
  `ai docs-delta`. Роли harness hooks проекта не грузят.
- `ai outdated` — версии пакетов из `package.json` против
  последних в npm и записи их журналов между ними (код 1 — есть новее);
  первый шаг `ai source-sync`.
- `ai delta check` и `ai delta close` — сверка слоёв
  документации с `HEAD` (знание без пункта `revise` — нарушение) и
  удаление принятой дельты; шаги `ai docs-delta`.
- `ai docs-delta start` и `ai source-sync start` — harness
  skills `docs-keeper` и `source-sync`: в состоянии агента harness
  останавливается с заданием, `ai <имя> open <id>`
  продолжает.
- `ai plan-review start <file>` — план в файле ожиданий: диалог с
  планером в терминале, ревью судьёй по бюджету файла, правки до лимита
  циклов. Сессия живёт в `~/.config/harness`, планер меняет только файл
  ожиданий; смотреть — `ai expect serve <file>`. Команда user scope:
  запускает пользователь из глобальной установки
  (`npm i -g @shahimat/cli @shahimat/harness`), не агент из задачи.
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

## `context/ai-core.yml`

```yaml
adapters: [claude-code, codex]
hooks: [docs-guard]                # запрет правки документации в основной сессии
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
- `context/index.yml: устарел` — `ai refresh`.
- `notes.md:3: секрет: токен GitHub` — значение убрать, вместо него
  указатель на хранилище; секрет уже в истории git — сказать
  пользователю: его нужно отозвать. Ложное срабатывание — исключение в
  `checks.secrets.allow` с `reason`, только после «да».
- `… отсутствует или устарел: запусти ai adapters sync` —
  `ai refresh`; если копию правили руками — правку перенести в
  источник.
<!-- /expect:skill-runs -->
