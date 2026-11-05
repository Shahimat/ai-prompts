# memory-schema — отчёт 1

## done
- Схемы форм в .oc3/doc/data/__schemas/ (additionalProperties: false):
  conventions.schema.json (корень — плоский список правил области:
  key/summary/rule/reason), glossary.schema.json (term/definition),
  entities.schema.json (id/namespace/summary/manuals), behavior.schema.json
  (id/namespace/title/steps), manifest.schema.json (namespace: [], data: [],
  budgets: notes/start/node/optional_field).
- Нормализация фактов ai-prompts: 4 конвенции-файла → одна область
  .oc3/doc/conventions/common.yml (плоский список; из rule/reason убраны
  перекрёстные ссылки на файлы — «открытая задача в docs/tooling.md» и
  устаревший путь context/.delta в reason); создан .oc3/doc/glossary/common.yml
  (пустой список); создан .oc3/NOTES.md с заголовком (инбокс свободного текста);
  создан .oc3/manifest.json (namespace: [] — в project.yml namespaces пуст,
  data: [entities, behavior], бюджеты — дефолты явно).
- Валидатор checkMemory в packages/ai-core/src/lib/memory.ts: манифест по своей
  схеме (нет файла/схемы/битый JSON/нарушение схемы — crit), каждый файл
  data-структуры и области conventions/glossary — по своей jsonschema,
  orphan-структуры в data/ вне манифеста — crit, перекрёстные упоминания
  («см. …», «see …») в значениях — crit, NOTES сверх бюджета — crit,
  опциональное поле схемы сверх порога (по файлам) — WARN; дефолты бюджетов
  4096/10240/16384/3 применяются при отсутствии budgets.
- context-index (conventions) понимает форму «область = список»; репо-индекс
  .oc3/doc/index.yml пересобран командой ai context index (генерат, не руками).
- ai-config не трогал (другой проект — вне корня сессии); пункт crit
  «существующие слои ai-prompts и ai-config…» для ai-config у следующей сессии
  или отдельной задачи в его репо.
- Валидатор экспортирован из @shahimat/ai-core; в CLI и ci НЕ включён — полное
  включение проверки (ai memory check в npm run ci) — тикет memory-generator.

## checks
- vitest ai-core 219/220 (новых: memory.test.ts 9, area-список context-index 1;
  единственный красный — repo.test «совпадает с закоммиченным
  prompts/index.yml» — незавершённая правка оператора в prompts/), harness
  78/78, oc3 124/124, cli 35/35.
- Проверка репо-фактов живым валидатором: diagnostics 0, warnings 0.
- npm run build, typecheck, lint, format:check, packages-check — зелёные.
- npm run expect — в моей зоне чисто; красные пункты вне тикетов 1–3:
  presetBudget analytical 8364>8192 (шаблон оператора вырос),
  docs-flow owners — строка канона «.oc3/bundles/ — build | ai memory build»
  ждёт команду тикета memory-generator, «skill knowledge-external-gui
  совпадает с разделами модуля» — рассинхрон параллельной правки оператора.

## left
- Включение checkMemory в CLI/схему ai check и npm run ci — тикет
  memory-generator (бюджеты старта/узла считаются на бандлах).
- Слой ai-prompts для pilot.md — manual без entity-ссылки даёт диагностик в
  ai context index (вне ci); уходит с упразднением индекса (memory-roles).

## risks
- Порог optional_field считается по файлам, не по записям списка: одна область
  с N правилами с reason не даст WARN. Буквально по тикету («3 файла»);
  если намерение — по записям, поправлю по замечанию judge.
- Схемы в .oc3/doc/data/__schemas/ — запечатанный слой: правка только через
  librarian + source-sync (guard это обеспечивает, не я).

## refs
- Worktree: .opencode/worktrees/memory-graph
- packages/ai-core/src/lib/memory.ts, packages/ai-core/test/memory.test.ts,
  .oc3/doc/data/__schemas/*.schema.json, .oc3/manifest.json, .oc3/NOTES.md,
  .oc3/doc/conventions/common.yml, .oc3/doc/glossary/common.yml
