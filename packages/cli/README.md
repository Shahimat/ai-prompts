# @shahimat/cli

CLI `ai` — единая точка входа для проектов на контракте
[`agent-operational-contract-v3`](https://github.com/Shahimat/ai-prompts/blob/main/prompts/productivity/agent-operational-contract-v3.md):
команды ядра [`@shahimat/ai-core`](https://www.npmjs.com/package/@shahimat/ai-core),
скрипты, автоматы [`@shahimat/harness`](https://www.npmjs.com/package/@shahimat/harness)
(если пакет установлен) и расширения проекта.

Node ≥ 24. macOS, Linux, Windows.

## Запуск

Пакеты — в `devDependencies` проекта с точными версиями, вызов — из корня:

```bash
npx ai <команда | скрипт | автомат> … [--root <dir>]
npx ai --help                 # дерево всего, что видно в этом проекте
npx ai                        # оболочка с переходом по уровням
```

## Скрипты

- `ai check` — все проверки, включённые в `context/ai-core.yml`.
- `ai refresh` — `context index`, `adapters sync` (если включены), затем
  шаги `check`.

Скрипт — только последовательность команд, без своей логики. Скрипт
`docs verify` — шаг автомата `docs-delta`, в справке не виден.

## Расширения проекта

`ai` подхватывает их при каждом запуске:

- `.agents/commands/<name>.{ts,mjs,js}` — своя команда:
  `export default { path: [...], effect: 'query' | 'mutation', options?, run }`;
- `.agents/scripts/<name>.yml` — свой скрипт: `path` и `steps`
  (`command: [...]`);
- `.agents/harnesses/<name>/` — свой автомат: `harness.yaml` и
  `handlers/*.ts`; нужен `@shahimat/harness`;
- `.agents/agents/<name>.md` — свои роли (их запускает `ai role run` и
  автоматы).

Имя, занятое встроенной командой, скриптом или автоматом, — ошибка. Своя
команда — атомарная операция; скрипт — последовательность команд.

## Runtime

При старте `ai` задаёт `runtime` из `@shahimat/ai-core`: исполнитель
скриптов по пути и команду самого себя. Через него автоматы зовут
скрипты (`docs verify`, `refresh`), роли поднимают MCP-канал
(`ai role channel`), `expect serve` рендерит отчёт. Без `ai` runtime не
задан — ошибка.

## Лицензия

MIT
