# Единый project manifest моделей: delta-разведка

## Коротко
Нужен один resolver в ai-core и детерминированное применение к производным; одного adapter sync недостаточно: plan-review имеет два обходных входа, а проектный expectations-скрипт — третий. Consumer defaults и fixtures сохраняются; manifest включает новый режим только для проекта, в котором присутствует.
Запрошенный путь `.oc3/research/project-role-models/unified-model-manifest.md` заменён на `.ops/project-role-models/research/unified-model-manifest.md`: прямые инструкции researcher разрешают запись артефакта только в `.ops/<ticket>/research/<id>.md`.

## Новые находки: полный дополнительный маршрут

| Точка | Доказательство | Класс / изменение |
| --- | --- | --- |
| `expect judge --run` | `packages/ai-core/src/commands/expect/index.ts:486–514`: `askRole(args.root, 'judge', …)` | Общий путь role runner; отдельного model literal здесь нет. Если нужен отдельный helper `expect.judge`, передать контекст назначения, не новую роль с другим prompt. |
| Проектный expectations shortcut | `scripts/expect-judge-opencode.ts:94–101`: прямой `opencode run --standalone --agent judge --model zai-coding-plan/glm-5.3-flash#low`; `package.json`, script `expect:judge:opencode` | Именно project-owned независимый literal. Подключить resolver для `expect.judge` либо делегировать общей команде с сохранением текущего JSON-контракта, не оставить скрытый GLM. |
| plan-review planner | `packages/harness/src/harnesses/plan-review/actions.ts:233–246`, `:110–122`: `ctx.def.models.planner` → `StageSpec.model` → `spawnOpenCode`; `:36`: ID `planner` | Обход `askRole`. Resolve ДО `ctx.stage.run`, чтобы injected StageRunner тоже получил effective model. |
| plan-review judge | `packages/harness/src/harnesses/plan-review/review.ts:185–203`: `input.def.models.judge` → `input.runner.headless` | Второй обход. Resolve ДО injected ModelRunner. `packages/ai-core/src/lib/opencode.ts:252–263` по умолчанию использует agent `judge`; helper-назначение не равно agent ID. |
| FSM defaults | `packages/harness/src/harnesses/core/fsm/machine.ts:30–37,84–97`: `models.planner/judge`, GLM-defaults, YAML поверх них; `packages/harness/src/harnesses/plan-review/harness.yaml:15–17`: ещё два GLM | Это package/consumer defaults, НЕ проектная ручная настройка. Не менять значения; при активном manifest они только legacy fallback, который не должен достигаться. |
| ticket-work | `packages/harness/src/harnesses/ticket-work/index.ts:119–131`: `opsRole` с `root: s.data.project` | Собственного model literal нет. Исправление общего resolver/ops покрывает этот путь, не нужно размножать resolver по состояниям. |
| docs-delta/source-sync и общие процессы | `packages/harness/src/harnesses/core/process.ts:97–117`: `opsRole`, корень берётся из session project | Тот же общий путь. Manifest ищется в project root, не home автомата и не cwd процесса. |
| Watch ladder | `packages/harness/src/harnesses/core/ops/watches.ts:228–255`: два `opsRole` (`TRIAGE_ROLE`, `REQUEST_ROLE`) | Общий resolver покрывает оба запуска; не менять business-решения observe/notify/act. |
| Ops quota classification | `packages/harness/src/harnesses/core/ops/runner.ts:169–172,216–234`: `(role.model ?? 'opus') === 'opus'` решает отдельный слот, потом новый `askRole` | `opus` здесь НЕ fallback запуска модели, а legacy scheduler classifier. Нужно классифицировать по effective model, иначе квота и реальный запуск разойдутся. Не расширять тикет до переделки всех квот. |
| Общий fallback и low-level spawn | Уже известные `packages/ai-core/src/lib/role.ts:56–57,218–225`; `packages/ai-core/src/lib/opencode.ts:43–44,141–175` | GLM остаётся consumer fallback без manifest. Не прятать resolver исключительно в spawn: mocks и ops-классификация тогда видят старую модель. |
| Install templates | `packages/oc3/src/templates.ts:75,152,190,258,319` | `roles.models: {}` и GLM в поставляемых ролях — consumer defaults. Не заменять на OpenAI в шаблонах. |
| Tests / examples | `packages/harness/test/ops.test.ts:53`; `packages/ai-core/test/models.test.ts:31–59`; `packages/ai-core/test/role.test.ts:135`; `packages/ai-core/test/adapters.test.ts:281–292` | Fixtures и проверки legacy-поведения, не ещё один project источник. Не делать глобальный search/replace моделей. |

Поиск по source `.ts/.yaml` в packages (без dist/node_modules) нашёл выборы выше; дополнительные независимые запуски проверены по `spawnOpenCode`, `headless`, `opencodeArgs`. Проектный скрипт вне packages включён намеренно: иначе обещание «все пути» неверно.

## Namespace manifest и место файла

- Корневого `manifest.json` при проверке нет (`ls manifest.json` → `No such file or directory`). Рекомендация — **`<root>/manifest.json`**, именно запрошенная одна ручная точка; не `.oc3/manifest.json`.
- `.oc3/manifest.json` уже занят памятью: `packages/ai-core/src/shared/layout.ts:2`; загрузка schema `manifest.schema.json` в `packages/ai-core/src/lib/memory.ts:250–269`; tree назначает этому имени значение «манифест памяти» (`packages/ai-core/src/commands/tree/index.ts:51`). Не расширять его моделями и не менять namespace sealed memory.
- Source module manifests — `.oc3/modules/<key>.yml`, SHA/parts и source-sync (`skills/source-sync/SKILL.md:44–55,140–142`); package manifest — `package.json` (например, `packages/build.ts:16–20` читает package manifest TypeScript). Корневой `manifest.json` имеет другой полный путь; resolver назвать `project-models` / `loadModelManifest`, не переиспользовать memory `loadManifest`.
- При source-sync project manifest не включать в source parts и не копировать из канона потребителям: свои файлы не входят в обновление (`design/packages.md:69–70`). Добавление root manifest в источник этого проекта — не добавление нового consumer default.

## Предложение схемы и приоритета (дизайн, не существующий API)

```json
{
  "version": 1,
  "default": "openai/gpt-6.1-sol-fast",
  "roles": {}
}
```

- `version` строго поддерживаемое целое; `default` обязателен; `roles` — map ID → строка `provider/model[#variant]`. Отдельная сущность variants не нужна: существующий `ROLE_MODEL_PATTERN` уже принимает `#variant` (`packages/ai-core/src/lib/agent.ts:6–7`). Пустая map означает все назначения через default, без копирования одного model literal на каждую роль.
- Базовые IDs: operator, executor, external-executor, judge, librarian, researcher, watch-request, watch-triage; native build, plan, general, explore, compaction, title, summary; semantic planner. Дополнительные source roles — по реально найденным файлам, без жёсткого запрета пользовательских IDs.
- Контекстные helper keys: `expect.judge`, `plan-review.planner`, `plan-review.judge`. Это назначения resolver, не новые агенты; mapping в коде соответственно → judge, planner, judge. Не генерировать для helper keys фиктивные Markdown-агенты и не менять prompts/modes.
- При manifest: **точный helper override → базовый role override → manifest.default**. Ни `.oc3/project.yml`, ни frontmatter, ни harness YAML, ни встроенный fallback не могут перебить manifest.default. Иначе единая точка не выполняется.
- Без manifest: сохранить прежний путь и consumer defaults. Невалидный существующий manifest — ошибка до spawn/записи, а не «отсутствует». Legacy `roles.models` поддерживать по прежней механике в legacy-режиме; при manifest это только migration input, не второй живой источник. Конфликт отобразить диагностикой, не молча объединять.
- Явная модель, выбранная человеком в уже существующей native-сессии или переданная сторонним `opencode --model`, не подчиняется project defaults. Это не скрытый выбор кода; абсолютный запрет таких overrides потребовал бы отдельной policy, не обещать его в этом тикете.

## Минимальная карта реализации

1. **ai-core lib**: чистая валидация + загрузка `manifest.json` + общий resolver с возвращаемым provenance. Export через `packages/ai-core/src/index.ts`; shared содержит только низкоуровневые пути/guards. Один план effective models для runner/generator/list/check; сортировка и стабильная сериализация.
2. **models list/set/apply/check**: в manifest-режиме list показывает effective value и origin; set обновляет только manifest `roles[ID]` и применяет производные; apply никогда не меняет `agents/` или `.agents/agents`. Командные имена set/apply сохранить. Legacy-ветку без manifest оставить совместимой; миграция — явная, одноразовая, с диагностикой конфликтов. Существующая реализация и тесты: `packages/ai-core/src/commands/models/index.ts:60–75,141–153,182–229`, `packages/ai-core/test/models.test.ts:31–59,137–149`. Не добавить скрытую вторую запись models в project.yml.
3. **Adapters compute/apply/check**: использовать тот же план в `packages/ai-core/src/commands/adapters/sync.ts:52–76,102–131,146–155`. Generated `.opencode/agents/*.md` получать effective model через копию AgentDef, не запись канона (`opencode.ts:6–15`). Generated `.opencode/opencode.jsonc` расширить root model и native `agents.<id>.model`, сохранить memory deny (`memory.ts:94–106,136–145`). Обе генерации должны совпадать: это устраняет зависимость от спорного приоритета Markdown/JSON. Базовый operator prompt/mode не пересоздавать: `packages/oc3/src/operator-agent.ts:22–51`. Builtin IDs override лишь модели, не mode/system/permissions.
4. **Не удалять роли**: существующий sync удаляет stale generated agents (`sync.ts:85–98,130`). Manifest roles — map моделей, НЕ whitelist файлов. Изменение/удаление override не удаляет роль; новые default overrides не создают конфликтов с пользовательским operator/planner. Generated Codex renderer сейчас НЕ переносит модель (`render.ts:19–28`): не считать его покрытым автоматически и не записывать OpenCode provider IDs в Codex без отдельной проверки формата; текущие реальные spawns используют OpenCode.
5. **Role/ops**: resolver до `runRole`/`spawnOpenCode`; ops classifier и запуск должны использовать одно effective решение. Не потерять project root при worktree/session home; `run.root` и `s.data.project` — уже существующие точки передачи.
6. **Harness**: два явных call sites plan-review resolve перед injectable runners; `MachineDef.models`/YAML остаются legacy fallback. Semantic contexts передавать явно, чтобы helper overrides не применялись к обычному judge.
7. **Project script**: `scripts/expect-judge-opencode.ts` получает model через тот же exported resolver (async load до синхронного ask); не сканирует JSON по собственной упрощённой схеме. Детерминированное apply/check — отдельная команда/тонкий Node script без AI; refresh/check вызывают общий lib/command plan, не дублируют model literals.
8. **CLI/OC3 integration**: `packages/cli/src/scripts/refresh.ts:4–6` уже sync→check; `packages/cli/src/scripts/check.ts:3–12` включает adapters check. Manifest validation и derived drift должны проверяться независимо от отключённых adapters (отдельный models check в check). Текущие OC3 wrappers — `packages/oc3/src/tree.ts:21–33,39–51`, tool descriptions — `packages/oc3/src/tools.ts:77–94`: синхронизировать семантику set/apply, не оставлять обещание изменения канона для manifest-режима.

## Границы пакетов и документации

- Параллельно появился `design/project-models.md`: строки 9–18 подтверждают принятое намерение и оставляют схему/путь открытыми; строки 36–40 фиксируют уже проверенную временную root-конфигурацию (15 native overrides), но прямо исключают вывод о миграции harness/adapter. Не повторять эту проверку вместо тестирования новой генерации.
- `design/packages.md:10–25`: ai-core не импортирует harness/cli; harness/cli зависят от ai-core. Resolver в harness или project script как единственная реализация создал бы неправильную зависимость.
- `design/packages.md:19–20,27–35,71–72`: команды атомарны, не зовут друг друга; общий compute/apply вынести в lib, не `models apply` → `adapters sync` → `models apply`. Scripts только последовательность команд. Нельзя добавлять генерацию через AI/harness.
- `design/packages.md:82–95`: затронутые package versions/pins и packages-check согласовать при реализации; consumer defaults не требуют массового изменения templates/fixtures.
- `design/packages.md:97–104` и `skills/cli/SKILL.md` описывают ограничения guards/generated; документацию записывает librarian, а не executor. Известное расхождение: формулировка «конфиг проекта не грузят» требует сверки с текущим `spawnOpenCode` (`lib/opencode.ts:148–158` задаёт config env); не использовать её как доказательство реального native config precedence.

## Минимум regression tests (без LLM)

1. Resolver: отсутствующий manifest сохраняет legacy; битый JSON/version/model не даёт silent fallback; exact helper > role > default; `#variant` сохраняется; project roots A/B не смешиваются; произвольная добавленная роль получает default.
2. models: set/apply/list/check работают с native/helper IDs без source role file; manifest — единственный источник записей; source `agents/` и `.agents/agents` byte-identical; legacy tests без manifest по-прежнему проходят. Не сбрасывать существующий coverage `models.test.ts`.
3. Generator: apply дважды byte-identical; check read-only и видит drift; sync/check совпадают с apply/check; все source role prompts/tools/modes сохранены; operator/builtins только model overrides; удаление override НЕ удаляет роль; memory deny и чужие config keys сохранены; source-sync (замена canonical model) + refresh не сбивает manifest default.
4. Role/expectations spawns: actual `--model` из manifest, а не frontmatter; judge `--run` и проектный shortcut не держат GLM; fail-fast до spawn. Готовый mock: `packages/ai-core/test/fake-opencode.ts:7–26` пишет model/args/config в FAKE_ARGS; `role.test.ts:49–52`, `expect-cli.test.ts:93–103` используют HARNESS_OPENCODE.
5. Plan-review: StageRunner и ModelRunner получают resolved planner/judge/helper отдельно. Сквозной mock `packages/harness/test/fake-opencode.ts:5–19` записывает model/session/config; `plan-flow.test.ts:154–174,296` уже использует fake binary. Проверить также resume: сохранённая plannerSession не означает сохранение старой модели после manifest update.
6. Ticket/process/watch: `packages/harness/test/fake-opencode-roles.ts:16–18` записывает role/model; расширить `ops.test.ts`, `processes.test.ts`, `docs-delta-roles.test.ts`: jobs + обе watch роли + classifier используют effective model. Отсутствие manifest оставляет consumer behavior, включая fixtures.

## Проверки исполнителя

- Изолированно: `npm test -w @shahimat/ai-core -- models.test.ts role.test.ts adapters.test.ts expect-cli.test.ts`; `npm test -w @shahimat/harness -- plan-flow.test.ts ops.test.ts processes.test.ts docs-delta-roles.test.ts`.
- Затем `npm run build`; новые models apply/check; adapters check; повтор apply с проверкой отсутствия diff; `npm run ci` по принятому скоупу. Researcher эти mutations не выполнял.
- Runtime smoke — отдельный `agent/{id}` с правильным location; envelope/model сверять по фактической V2 форме. Проверить operator, judge, executor, planner, general/explore и hidden helper agents; не делать выводы из обрезанного общего списка.
- Перед завершением сравнить `git diff -- agents/` и consumer templates; не затереть уже существующие пользовательские изменения `opencode.jsonc` (при старте исследования этот файл был modified).

## Выводы, неизвестное, уверенность

- Минимальный полный скоуп: shared resolver + models/adapter plan + role/ops + два plan-review call sites + проектный expectations shortcut. Удаление только package literals или только правка OpenCode configs не покрывают перечисленные пути (таблица выше).
- Defaults в пакетах и fixtures сохраняются для отсутствующего manifest; в данном проекте при активном manifest ни один из них не влияет на выбор модели.
- Открытых блокирующих вопросов: **0**. Риск вне доказанной карты: локальная native-конфигурация и сохранённая модель существующей сессии требуют runtime smoke, а не догадки о merge. Формат модели Codex — не исследован; нельзя заявлять покрытие Codex моделью OpenAI provider string.
- Уверенность высокая по source call graph и границам; средняя по runtime native merge до smoke. Все пункты «предложение/карта реализации/tests» — рекомендации, не утверждение об уже существующем API.
