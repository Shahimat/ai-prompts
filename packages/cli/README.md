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

- `ai check` — проверки из `.oc3/ai-core.yml` и обязательные `tree check`,
  `memory check`. Установленная память проверяется целиком; missing,
  tamper или stale дают отказ, check не выполняет repair.
- `ai refresh` — `adapters sync` (если включён), `memory build`, затем CHECK.

CHECK обозначает последовательность `ai check`. Внутренний runtime script
DOCS_VERIFY автомата `docs-delta`: `adapters sync` (если включён) →
`delta check` → `memory build` → CHECK. Это не новая публичная команда
`ai docs verify` и не отдельный пользовательский entrypoint.

Отдельного `checks.memory` нет. Без установленной canonical memory
runtime явно пропускает только точные шаги `memory build`/`memory check`.
Pending-only проект не считается установленной памятью; inbox
`pending/enqueue/batch` этим skip не фильтруются. Частично утраченная
установленная память должна дать отказ, а не skip.
Формат и границы — [бандлы памяти](../../design/memory-bundles.md).

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
