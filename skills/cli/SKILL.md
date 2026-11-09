---
name: cli
metadata:
  runs: refresh
description: Как пользоваться CLI ai в проекте — refresh и check, команды, автоматы и свои расширения в .agents/, конфиг .oc3/ai-core.yml. Загружай перед завершением задачи, при правке сгенерированных файлов, при ошибках ai check и при работе со своими командами, скриптами и автоматами.
---

# cli

Механическую часть контракта делает CLI `ai`. Пакеты — в
`devDependencies` проекта (`package.json`, точные версии):

- `@shahimat/cli` — бинарь `ai` и скрипты (`check`, `refresh`); ядро;
- `@shahimat/ai-core` — команды: проверки, генерация, роли; ядро;
- `@shahimat/harness` — автоматы `docs-delta`, `source-sync`,
  `plan-review`; модуль harness. Без него `ai` автоматов не знает.

Пакеты ставятся из npm-реестра по версиям, не из локальных архивов
(`file:*.tgz`): с архивами `npm ci` в CI падает, а `outdated` читает
только `dependencies` и `devDependencies`.

Конфиг команд — `.oc3/ai-core.yml`.

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
после записи librarian — пересобрать производные файлы и проверить
проект. Остальное — справка: что делает команда и кто её запускает.

- `ai refresh` — `adapters sync` (если включён в `checks`), затем
  `memory build` и шаги `ai check`.
- `ai check` — проверки из `checks` в `.oc3/ai-core.yml` плюс обязательные
  `tree check` и `memory check`: `changelog lint`, `tree check`,
  `memory check`, `context check`, `adapters check`, `secrets scan`.
  `tree check` валидирует плоское дерево `.oc3/` по JSON Schema ядра и
  расширениям `manifest.json`. `check` не пересобирает память: отсутствие,
  порча или устаревание обязательного бандла — отказ, а не зелёная проверка.
  Установленная память проверяется без отдельного ключа `checks.memory`;
  если компонент памяти не установлен, только его build/check явно
  пропускаются. Knowledge inbox от этого skip не зависит.
- `ai secrets scan` — секреты (ключи API, токены, пароли,
  приватные ключи) в отслеживаемых файлах; в `ai check` включена
  по умолчанию. `--file <path>` — один файл, в том числе вне проекта:
  её запускает skill `source-feedback` перед тем, как артефакт уходит
  наружу. В выводе — путь, строка и тип, без значения.
- `ai changelog lint` — формат `CHANGELOG.md`: строка до
  `max_line`, три части через ` · `, тег из списка, дата, порядок.
- `ai memory build` — пересобрать бандлы `.oc3/bundles/` из слоёв,
  включая слои модулей из `provides.index_layers` их manifest'ов; шаг
  `ai refresh`. Каталоги ссылаются на полные человекочитаемые проекции
  внутри `bundles/`, а не на запечатанный канон. Большие каталоги и
  проекции имеют страницы-продолжения в тех же байтовых бюджетах;
  namespace, веса и исходные данные генератор не меняет.
- `ai memory check` — проверить исходные схемы, полный набор проекций,
  страниц и ссылок, актуальность и бюджеты; обязательный шаг `ai check`.
  Данные сохраняются по действующей JSON Schema, включая вложенные BDD,
  `false`, `null` и пустые значения. Успех не подменяется усечением фактов.
- `ai adapters sync` — пересобрать файлы под инструменты
  (`.opencode/`, `.codex/`) из `AGENTS.md` и `.agents/` и выключить
  memory агента: `.opencode/opencode.jsonc` с deny memory-MCP,
  `.codex/config.toml` с выключенными memories. Ручной
  `.codex/config.toml` не трогает — только сообщает, каких ключей не
  хватает. Шаг `ai refresh`.
- Guards контракта (плагин `@shahimat/oc3`) — работают в основной
  opencode-сессии проекта: правка документации или генерируемого файла —
  отказ с подсказкой передать намерения `ai docs-delta`. Роли harness
  конфиг проекта не грузят.
- `ai outdated` — версии пакетов из `package.json` против
  последних в npm и записи их журналов между ними (код 1 — есть новее);
  первый шаг `ai source-sync`.
- `ai delta check` и `ai delta close` — сверка слоёв
  документации с `HEAD` (знание без пункта `revise` — нарушение) и
  удаление принятой дельты; шаги `ai docs-delta`.
- `ai docs-delta start` и `ai source-sync start` — harness
  skills `librarian` и `source-sync`: в состоянии агента harness
  останавливается с заданием, `ai <имя> open <id>`
  продолжает.
- `ai plan-review start <file>` — план в файле ожиданий: диалог с
  планером в терминале, ревью судьёй по бюджету файла, правки до лимита
  циклов. Сессия живёт в `~/.config/harness`, планер меняет только файл
  ожиданий; смотреть — `ai expect serve <file>`. Команда user scope:
  запускает пользователь из глобальной установки
  (`npm i -g @shahimat/cli @shahimat/harness`), не агент из задачи.
<!-- /expect:skill-runs -->

## Инкрементальная проверка

`--force` поддержан у `ai check|refresh`, `changelog lint`,
`expect report|lint|judge`, `operator verify` и `oc3 expect report`.
Он обходит baseline, но не freshness/permissions, не удаляет fixtures/snapshots
и не повторяет достаточный current-run результат, включая FAIL. Неполные или
изменённые inputs требуют нового run. Unsupported controls — ошибка вызова.

Proof связывает checker, dependencies, config, membership и окружение.
Unknown inputs не дают reusable PASS. Ordinary tests выполняются run-only
с реальным exit и полным scope; повтор incomplete node — STALE без второго
launch. Native gates требуют свои current receipts, не leaf/sidecar/HTTP 200.

В источнике ai-prompts npm test/ci обёртки принимают `--force`, например
`npm run ci -- --force`. Это не флаг любого npm-script/Vitest и не смысл
`npm publish --force`. Ordinary baseline ограничен reviewed bounded guards,
scripted — registered changelog; warm сохраняет preparation и hashing.

Report/lint/check/refresh/tests/CI при miss не вызывают агента. `expect judge`
готовит delta tasks; отдельный `--run` выбирает producer, `--apply` применяет
ответы без producer. Они несовместимы. Force и inherited allowJudge не дают
query прав; unattested askRole context — needs-review даже с `--run`.

Implementation inputs включают intent, тело и dependencies; title unary/pair —
формулировки и policy, не тело. Дельта содержит misses и immutable peer context.
Duplicate/dynamic scope — group review, без higher-order guarantee.

Legacy сохраняется как unverified/needs-review, не upgraded PASS; query не
переписывает semantic store. Apply проверяет root/entry/plan/run, актуальные
inputs/policy и immutable evidence до цитат. Executed/reused/needs-review/failed
различаются. Смысловой needs-review может оставить CI nonzero — не писать
вердикт руками ради PASS.

## Расположение и сохранность артефактов

Все project execution outputs OC3 назначает общий resolver внутри `.oc3/`
по виду и ticket/session/нормализованному entry с явным scope. Отчёты,
checks, proposals, helper tasks/cache/sidecars/HTML и plan-review bridge —
не исключения. Classification и wildcard не разрешают внешний namespace.
Исходные expectations, код, project docs и обязательные provider adapters
не являются execution outputs; runtime внутри каталога adapter исключения
не получает. Короткоживущий OS tmp subprocess очищается и не заменяет storage.

Durable — сохранность для retry/resume/audit, не требование commit. Run packets,
логи, промежуточные reports/proofs/drafts/history локальны и игнорируются по
назначению. Не игнорируется вся `.oc3/`: canonical knowledge, goals и inbox
не одноразовый cache. Компактный semantic verdict store для no-AI CI может
версионироваться отдельно от сырых материалов запуска. Legacy locators читаются
через проверяемый migration manifest; новых внешних writes/двойного cache нет.
Миграция сохраняет historical bytes/hashes, но не делает старый PASS актуальным.

## Проектный манифест моделей

Корневой `manifest.json` моделей — единственная ручная декларация,
если он есть в проекте. Не путай его с `.oc3/manifest.json` памяти,
manifest'ами модулей или `package.json`.

```json
{
  "version": 1,
  "default": "provider/model",
  "roles": {}
}
```

`default` задаёт модель всех ролей; `roles` содержит только исключения
по ID роли или назначения. Приоритет: исключение назначения
(`expect.judge`, `plan-review.planner`, `plan-review.judge`), затем
исключение базовой роли, затем `default`. Список исключений — не
список разрешённых ролей: снятие исключения не удаляет роль.

<!-- expect:skill-runs -->
Команды ниже — справка по явному управлению моделями, не
дополнительные автоматические запуски skill; его `metadata.runs`
по-прежнему задаёт только завершающий `refresh`.

- `ai models` — эффективные модели и их источник.
- `ai models set <роль> <provider/model[#variant]>` — сохранить
  исключение и применить производные.
- `ai models apply` — детерминированно синхронизировать производные,
  без AI и без изменения исходных определений ролей.
- `ai models check` — без записи проверить декларацию и рассинхрон.

После ручной правки manifest запускаешь `apply`, затем `check`.
В ai-prompts отдельный `npm run models:check` включён в CI независимо
от адаптеров; жёсткий перечень шагов `ai check` этим не расширяется.
Запуск ролей использует ту же декларацию, а не отдельную таблицу
моделей. Битый manifest — ошибка, не повод незаметно вернуться к
старой модели. Не поддерживай параллельно старые `roles.models`:
их перенос — явная одноразовая миграция.

Без manifest сохраняется legacy-режим с `.oc3/project.yml` →
`roles.models` и прежним применением к файлам ролей. Локальный
manifest не поставляется другим проектам через source-sync.
Явно выбранная человеком модель уже существующей OpenCode-сессии
или внешний `--model` — не проектный дефолт и не меняются автоматически.
<!-- /expect:skill-runs -->

## Inbox и гейты процесса

<!-- expect:skill-runs -->
Это справка по явным действиям оператора/verification owner, не новые
автоматические запуски skill; его `metadata.runs` остаётся `refresh`.

- `ai memory inbox enqueue --file <json|->` — сохранить optional
  knowledge_delta и durable receipt без AI и canonical writes.
- `ai memory inbox pending` — компактный bounded срез pending, не весь журнал.
- `ai memory inbox batch --file <selection.json>` — frozen topic/scope batch.
- `ai docs-delta start --batch <id>` — явная консолидация существующим процессом;
  успешный связанный close разрешает только exact-ID dispositions этого batch.
- `ai operator preflight --file <packet.json>` — проверить готовность пакета.
- `ai operator verify <name> --file <packet.json>` — назначенный owner запускает
  объявленную проверку под worktree lease и получает snapshot-bound receipt.
- `ai operator ready --file <packet.json>` — query DoD/freshness/hygiene,
  без уборки, git write и самодельного scoring.

Не запускай build параллельно чтению общего dist. Full CI — после code/source
stable и необходимого docs/derived batch; judge не повторяет доказанный CI.
Receipt inbox означает pending, не canonical applied. Secrets не сохраняются;
decision/candidate не становятся фактами. Вес 1 — кольцо доступа, не confidence.
Raw inbox runtime-owned; читать через bounded query/проекцию, не править руками.
Новый accepted-cache локален в `.oc3/locks/delta-accepted.json`, действует лишь
для exact root/worktree/HEAD/content. Старый `.oc3/.delta/.accepted.json`
не даёт authorization и не должен попадать в deliverable.
<!-- /expect:skill-runs -->

## Сгенерированное не правится руками

<!-- expect:docs-readonly -->
`.oc3/bundles/`, `.opencode/agents/*` (метка «generated … do not
edit» в файле), `.codex/agents/*`, сгенерированный `.codex/config.toml`
— производные. Правишь источник,
затем генерация. Ручную правку копии ловит проверка `adapters`.

Файл без метки harness на месте генерируемого (например, свой агент в
`.opencode/agents/`) — sync его не трогает и сообщает: содержимое
перенести в `AGENTS.md` или `.agents/`, файл удалить.
<!-- /expect:docs-readonly -->

## `.oc3/ai-core.yml`

```yaml
adapters: [codex, opencode]
checks:
  changelog:
    max_line: 120
    tags: [arch, stack, dep, milestone]
  context: {}
  adapters: {}
  secrets:                         # есть всегда; false — выключить
    allow:
      - path: .oc3/manuals/aws.md
        line: 12
        reason: пример ключа из документации AWS
```

Неизвестный ключ — ошибка конфига: опечатка не выключает проверку
молча.

## Нарушения

<!-- expect:skill-runs -->
- `CHANGELOG.md:12: длина 180 символов > 120` — переписать строку через
  librarian: решение одной фразой, детали — в git log.
- `.oc3/data/entities/x.yml: нет поля summary` — добавить однострочный
  `summary`, пересобрать индекс.
- `.oc3/bundles/: устарел` — `ai refresh`.
- `notes.md:3: секрет: токен GitHub` — значение убрать, вместо него
  указатель на хранилище; секрет уже в истории git — сказать
  пользователю: его нужно отозвать. Ложное срабатывание — исключение в
  `checks.secrets.allow` с `reason`, только после «да».
- `… отсутствует или устарел: запусти ai adapters sync` —
  `ai refresh`; если копию правили руками — правку перенести в
  источник.
<!-- /expect:skill-runs -->
