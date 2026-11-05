# layout-move — отчёт 1

## done
- Мигратор `oc3 migrate` (packages/oc3/src/migrate.ts): карта FILE_MAP/DIR_MAP/OPS_FLAT
  (context/→.oc3/doc/..., docs/→.oc3/doc/data|manuals|knowledge, goals→.oc3/goals,
  .ops/*→.oc3/* плоско, per-тикет research/reports/verdicts/baseline), перенос
  байт-в-байт через rename, механическая замена префиксов внутри .oc3/ai-core.yml /
  .oc3/skills.yml / .oc3/ops.yml, перезапись .gitignore, prune пустых каталогов,
  legacy-хвосты — строками в отчёт; занятая цель — legacy без перетирания.
- `oc3 init` детектит старую раскладку (detectOldLayout по контрактовым подписям:
  context/project.yml, context/ai-core.yml, context/skills.yml, .ops/operator/state.yml,
  .ops/locks/install) и мигрирует перед detectState; пустой goals/ без контракта —
  не повод для миграции (безопасно для посторонних проектов).
- Потребители путей обновлены: ai-core (layout.ts — 30 констант .oc3, config, operator
  state, models, delta docRoots/NOT_DOCS, context-index слои, roles, goals+baseline,
  role.ts submit), harness (ops/paths PROJECT_OPS=.oc3, ops.yml, autonomy.yml, watches,
  jobs, suggest, ticket-work, docs-delta, source-sync), oc3 (guards DOCS_AREAS,
  briefing, session-brief, briefing-gate, submit, tools, init, install, tree, templates).
- templates.ts: маршрут/правила/сценарии/оператор/skills/ролевые шаблоны выровнены с
  целевым текстом контракта оператора (bundles-маршрут, .oc3/goals, artifacts
  .oc3/research|reports|verdicts/<тикет>/); GITIGNORE_LINES → .oc3/operator|locks|
  submit|sessions|bundles.
- presets/external.yml: artifacts → .oc3/reports/<ticket>/ (согласовано с
  expectations/presets.expect.ts).
- Репозиторий перенесён: context/, docs/, goals/, .ops/ → .oc3/ по карте (goals с
  *.expect.json, включая незакоммиченный memory-graph.expect.ts →
  .oc3/goals/memory-graph.expect.ts); .gitignore переписан; .oc3/bundles/ создан
  (gitignore). Интерпретации вне карты: docs/pilot.md → .oc3/doc/manuals/pilot.md
  (руководство для человека), docs/tooling.md → .oc3/doc/knowledge/tooling.md
  (заметки-наблюдения), context/ops.yml → .oc3/ops.yml (механика, как ai-core.yml),
  context/.delta → .oc3/.delta (выбор из обновлённого канона оператора — таблица
  владельцев в skill librarian), .ops/watches|jobs|suggest → .oc3/watches|jobs|suggest
  (принцип «артефакты процессов плоско»), context/index.yml → .oc3/doc/index.yml
  (генерат context-index; упразднение — тикет memory-roles).
- Grep-критерий по коду/тестам/конфигам: старые пути остались только в карте
  миграции (migrate.ts — источник переезда), v2-детекте install.ts (context/workflow.md,
  context/views — легаси-детект), именах команд ai (context index, goals check —
  команды, не файлы) и исторических цитатах вердиктов (.oc3/verdicts/** — история).

## checks
- npm run build / typecheck — зелёные.
- vitest ai-core 209/210, harness 78/78, oc3 117/117 (включая новые 8 тестов
  migrate.test.ts), cli 35/35 — зелёные; единственный красный — repo.test
  «совпадает с закоммиченным prompts/index.yml»: незавершённая параллельная правка
  оператора в prompts/ (index.yml ещё не пересобран под свежие источники).
- npm run lint, format:check, packages-check — зелёные.
- npm run expect: в моей зоне чисто; красные пункты вне тикета:
  presetBudget analytical 8364>8192 (текст шаблона оператора вырос),
  «skill knowledge-external-gui совпадает с разделами модуля» (рассинхрон
  skills/↔prompts/ у оператора), docs-flow owners — строка «.oc3/bundles/ — build |
  ai memory build» ссылается на команду тикета memory-generator (появится в тикете 4).

## left
- Красные пункты выше — зона оператора (prompts/, skills/, presets-текст) и тикета
  memory-generator (команда ai memory build); к layout-move не относятся.
- AGENTS.md самого репо не трогал (параллельная правка оператора).

## risks
- Установщик мигрирует потребителя при первом init без отдельного подтверждения —
  детект намеренно консервативный (только контрактовые подписи), но на проекте с
  кастомным context/project.yml это молчаливый перенос файлов (по карте, с отчётом).
- Интерпретации вне карты (pilot/tooling/ops.yml/watches/jobs) — моё решение, не
  буквальный текст тикета; judge может скорректировать.

## refs
- Worktree: .opencode/worktrees/memory-graph (ветка memory-graph)
- Новые: packages/oc3/src/migrate.ts, packages/oc3/test/migrate.test.ts
- Миграция репо: git status покажет delete+add по .oc3/ (rename-детект при add -A)
