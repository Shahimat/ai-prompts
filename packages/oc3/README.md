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
`context/project.yml`; проект без маркера не затрагивается.

## Плагин

- **docs guard** — `edit`/`write` в `docs/`, `context/`, `CHANGELOG.md` разрешены
  только агенту `librarian`;
- **memory guard** — запись в memory-пути вне репозитория отклоняется;
- **гейт прогонов** — запуск judge при двух run'ах в `goals/*.expect.json` без
  `retry: true` (и при трёх с ним) отклоняется с указанием файла;
- **tools `oc3_*`** — цели, модели и проверки как инструменты агента.

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

Смена модели правит `model` в `.agents/agents/<role>.md` и синхронно в
производной `.opencode/agents/<role>.md`, а также пишет override в
`context/project.yml` → `roles.models` — он переживает source-sync,
восстановление после синка — `oc3 models apply`. Допустима любая модель
каталога OpenCode вида `provider/model[#variant]`, включая бесплатные.
