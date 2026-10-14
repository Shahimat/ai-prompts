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

### Планер `plan/iter`

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
  [--out]`.
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
```

## Лицензия

MIT
