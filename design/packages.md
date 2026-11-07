# Пакеты и расширения проекта

Дата: 2026-10-28. Документ проектирования: в `prompts/index.yml` не
попадает. Проверяемые правила — в ожиданиях `[harness] common` и
`[harness] layers`, здесь — решения и их причины.

## Пакеты

```
@shahimat/cli       точка входа: бинарь ai, скрипты, загрузка harness и расширений проекта
@shahimat/ai-core   ядро-библиотека: shared → lib (ожидания, роли, протокол, дерево команд) → commands
@shahimat/harness   автоматы-библиотека поверх ai-core (модуль harness)
```

- **`cli`** — одна точка входа на всё: `npx ai <команда | скрипт |
  автомат> …`. Знает скрипты (`check`, `refresh`, `docs verify`),
  собирает дерево из команд `ai-core`, автоматов `harness` (если пакет
  установлен) и расширений проекта.
- **`ai-core`** — ядро контракта: без него контракт не работает. Команды
  — атомарные операции, друг друга не вызывают. Бинаря нет.
- **`harness`** — автоматы. Ставится модулем `harness`, и только им.

Зависимости: `harness` → `ai-core` (статически), `cli` → `ai-core`
(статически), `cli` → `harness` (динамически, если установлен).
`ai-core` не знает ни `cli`, ни `harness`.

### Runtime вместо обратного импорта

Автоматам нужны скрипты (`docs verify`, `refresh`), а ролям — команда
самого CLI (MCP-канал `role channel` запускается как `ai role channel`).
Скрипты живут в `cli`, а `cli` сам загружает `harness`: прямой импорт дал
бы цикл. Поэтому в `ai-core` — `runtime`: `cli` при старте задаёт
исполнитель скриптов по пути и команду самого себя, автоматы и роли
берут их оттуда. Без `cli` (`runtime` не задан) — ошибка «запусти через
ai».

## Ядро контракта ставит `cli` и `ai-core`

`ai-core` — это и есть ядро, поэтому Node ≥ 24 и `package.json` нужны
любому проекту на v3; ручной путь установки без Node уходит. Пакеты — в
`devDependencies` с точными версиями, версии — только в `package.json`,
`ai outdated` сверяет их с npm. Конфиг — `context/ai-core.yml`
(`adapters`, `hooks`, `checks`).

Модуль `harness` только добавляет `@shahimat/harness`: проверки,
адаптеры, индекс, hook `docs-guard` — ядро.

## Расширения проекта

Контракт даёт им место в нейтральном каталоге `.agents/`, рядом с
skills:

```
.agents/
  agents/<name>.md               роли: из источника и свои
  commands/<name>.ts             свои команды: export default CommandNode
  scripts/<name>.yml             свои скрипты: ScriptDef (path, steps)
  harnesses/<name>/              свои автоматы
    harness.yaml                 автомат по схеме harness-fsm
    handlers/*.ts                действия и guards (export default { actions, guards })
```

- **Обнаружение.** `ai` подхватывает расширения проекта при каждом
  запуске: они видны в справке и оболочке, их можно объявлять в
  `metadata.runs` skills и использовать в состояниях автоматов. Своя
  роль зовётся так же, как роль из источника.
- **Имена.** Совпадение со встроенной командой, скриптом или автоматом —
  ошибка, а не тихая подмена.
- **Своё против источника.** `source-sync` обновляет только записанное в
  `parts` контракта и модулей; свои файлы не трогает и не удаляет.
- **Модель слоёв та же.** Своя команда — атомарная операция, скрипт —
  только последовательность команд, автомат — состояния поверх них.
- **Свои автоматы** требуют модуля `harness`: без пакета `ai` сообщает,
  что каталог `.agents/harnesses/` есть, а исполнять его нечем.

Пользовательские плагины `~/.config/harness/harnesses/<name>/handlers/`
остаются: это расширение на уровне машины, `.agents/harnesses/` — на
уровне проекта.

## Релиз

- Версии и пины поднимаются одним тикетом: точные пины `@shahimat/*`
  в зависимостях пакетов равны публикуемой версии. Расхождение ловит
  `node scripts/packages-check.ts` — строка `npm run ci`: crit — пин не
  равен версии или в npm новее, чем в репозитории; warn — «требуется
  публикация», недоступный npm проверку не роняет.
- Порядок публикации: `packages/ai-core`, затем `packages/oc3` (он
  зависит от ai-core); `npm publish` в каталоге пакета —
  `prepublishOnly` сам гоняет typecheck, тесты и сборку.
- После publish предупреждение «требуется публикация» может держаться
  несколько минут — CDN-кэш реестра. Контрольный признак, что версия
  на месте, — `EPUBLISHCONFLICT` («cannot publish over …») при
  повторном publish. Query-параметрами кэш реестра не обходится.
- `cli` и `harness` публикуются при собственных изменениях; их пины на
  ai-core поднимаются в том же тикете, что и версия ai-core.

## Guards документации

Durable knowledge intake, managed verification gates и exact-snapshot
accepted ledger: [реализация и обслуживание](knowledge-inbox.md).
Общие primitives живут в ai-core lib, CLI/native adapters используют
один API, harness добавляет lifecycle консолидации без обратного импорта.
Runtime-owned inbox/receipts/проекция не являются canonical слоями.

### Общий artifact resolver

`ai-core/lib/artifacts.ts` — единый typed resolver kinds/scopes и validator
для managed/native/manual writes; публичные `artifactRelative`, `artifactPath`,
`validateArtifactOutput`, `expectHelperDir`, `expectCacheFile`, `expectStateFile`
используют нормализованный entry и independent namespace gate перед
classification/hash. First-party project outputs confined в `.oc3/`;
source expectations и обязательные provider definitions/adapters — не outputs.
Machine storage имеет отдельный explicit scope, а не project-path exception.

`ai-core/lib/artifact-migration.ts` сохраняет historical bytes/provenance,
проверяет collisions/retry и предоставляет read-only `historicalArtifactPath`.
CLI и OC3 adapters вызывают общий API, harness — тот же resolver для helper,
proof/proposal и bridge, без обратного импорта или отдельной раскладки.
Durable runtime не равен versioned deliverable: compact semantic store для
no-AI CI отделён от ignored run evidence. Полные locators, retention и
границы гарантий — [artifact layout](knowledge-inbox.md#раскладка-execution-artifacts).

Guards контракта — плагин `@shahimat/oc3` (подключается в
`opencode.jsonc`): правка документации и генерируемых файлов основной
сессией — отказ с подсказкой передать
намерения `ai docs-delta`. Роли запускаются с конфигом из
`OPENCODE_CONFIG_CONTENT` и плагинов проекта не грузят. Запись через
Bash guard не видит — её держит правило 4 `AGENTS.md`.
