# @shahimat/oc3

Лицо контракта v3 (operator-centric) в проекте-потребителе под OpenCode:
плагин и CLI `oc3`. Инструмент источника — `ai` (`@shahimat/cli`); harness и
утилиты репозитория остаются на нём.

## Установка

```bash
npm i -D @shahimat/ai-core @shahimat/oc3
```

В `opencode.jsonc` (в конце установки контракта):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@shahimat/oc3"]
}
```

Плагин активируется только при `sync.contract.edition: operator-centric` в
`.oc3/project.yml`; проект без маркера не затрагивается.

## Плагин

- **docs guard** — правки sealed canonical в плоской `.oc3/` и корневого
  `CHANGELOG.md` разрешены только агенту `librarian`;
- **memory seal** — non-librarian роли читают `.oc3/` по whitelist,
  полные факты доступны через `bundles/`, не через sealed canonical;
- **memory guard** — запись в memory-пути вне репозитория отклоняется;
- **гейт прогонов** — запуск judge при двух run'ах в `goals/*.expect.json` без
  `retry: true` (и при трёх с ним) отклоняется с указанием файла;
- **tools `oc3_*`** — цели, модели и проверки как инструменты агента.

## Память сессии

Native context использует общий core `ensureMemory` перед инъекцией,
в том числе для seen sessions: проверяет полный file-set, восстанавливает
missing/stale и заменяет изменившийся start. Ошибка validation/budget/lease
не считается успешной загрузкой. Canonical seal не расширяется:
агент идёт по реальным проекциям и страницам внутри `.oc3/bundles/`.
Формат и границы — [бандлы памяти](../../design/memory-bundles.md).

## Границы сессии

Плагин и правила контракта действуют в корне своего проекта. Сессия не
переезжает в другие проекты — ни `session_move`, ни сменой рабочего
каталога: работа в другом проекте ведётся в отдельной сессии, открытой
в его корне. Механический запрет — на стороне ai-config; до него
правило дисциплинарное.

## CLI

```bash
npx oc3 init                        # проверка маркера, пакетов и plugin-записи
npx oc3 briefing                    # режим работы сессии из project.yml
npx oc3 briefing set cheap          # пресеты: cheap | roles, custom — с полями
npx oc3 models                      # роль → модель, override и расхождения
npx oc3 models set judge deepseek/deepseek-v4-pro
npx oc3 models apply                # вернуть override после source-sync
npx oc3 goals status
npx oc3 goals check goals/a.expect.ts --ticket a
npx oc3 operator state check
npx oc3 roles check
npx oc3 skills check
npx oc3 adapters check
npx oc3 expect report goals/a.expect.ts
```

`oc3 expect report <file> [--force]` использует общий core query contract:
без provider, без переписывания versioned semantic store; `--run`/`--apply`
не поддержаны. Force обходит baseline, не freshness/permissions; legacy или
неполное coverage остаётся needs-review/nonzero. Historical sidecar/80% не
заменяют current acceptance proof цели. Матрица и typed `.oc3` locators —
[инкрементальная верификация](../../design/incremental-verification.md).

Смена модели правит `model` в `.agents/agents/<role>.md` и синхронно в
производной `.opencode/agents/<role>.md`, а также пишет override в
`context/project.yml` → `roles.models` — он переживает source-sync,
восстановление после синка — `oc3 models apply`. Допустима любая модель
каталога OpenCode вида `provider/model[#variant]`, включая бесплатные.
