# memory-generator — отчёт 1

## done

- `ai memory build` строит `.oc3/bundles/`: стартовый `index.md` (вес-0 файлы инлайном; веер узлов — одна строка: ключ, SHA12, число файлов; каталог skills — одна строка на skill; заголовки goals — describe/it одной строкой через AST-парсер `parseGoal` + it-заголовки) и узлы `.oc3/bundles/<sha12>/index.md` с рендерами файлов узла — packages/ai-core/src/lib/memory-graph.ts, packages/ai-core/src/commands/memory/index.ts, registry.ts (`memory build` / `memory check`).
- Группировка по парам (namespace из массива файла, вес): вес 0 — инлайн старта; узел = (namespace, вес ≥1); файл с несколькими namespace попадает в узел каждого; файлы без namespace с весом ≥1 — общий узел `common:<N>`; разные namespace одного веса — соседние узлы одного кольца. Источник связи — только манифест (`files` в manifest.schema.json + manifest.json).
- index узла: ссылки на файлы (`../doc/...`) с пояснением «что получишь при загрузке» (сумма-первая-строка рендера; для manuals/knowledge — «инструкция:/карта: <заголовок>») + рёбра на узлы веса N+1 своего namespace; глубина ссылками, вложенных директорий нет; в теле узла — рендеры фактов (sealed-слой агентам недоступен, поэтому узел несёт содержание, ссылки — провенанс).
- Имя директории узла — sha256-префикс (12) рендера без SHA-строки; полный SHA и ключ — в шапке узла; check перечисляет стухшие каталоги диагностиками, build удаляет и создаёт актуальные (writeGraph с prune).
- Выход без разметки данных: рендер полей по известным ключам jsonschema → предложения (known-keys: key/term/id — лид, rule → «Правило:», reason → «Причина:», steps → «Шаги: 1)…», manuals → «Manuals:», namespace → «домен»); project/autonomy — flatten «путь — значение»; YAML/JSON-фрагментов нет (тесты: `not.toMatch(/^- key: /m)` и др.).
- `ai memory check`: SHA входов vs файлы (сравнение ожидаемого рендера с существующими index.md и каталогами), cap старта/узла из манифеста (крит «что формализовать, что уезжает в долговременную»), NOTES-бюджет, optional-field WARN, валидация манифеста по схеме (всё это checkMemory + checkBundles); шаг `memory:check` вшит в `npm run ci`.
- Повторный build идемпотентен и удаляет стухшие каталоги — тесты `повторный build идемпотентен…`, cli.test `ai memory build`.
- Закрытые красные: docs-flow owners (команда `ai memory build` существует), harness runsDeclared (`metadata.runs: memory build` резолвится в команду) и prerequisite — knowledge-external-gui (модуль `prompts/modules/knowledge-external-gui.md`: якорь skill-runs на «memory build»; тело skills/knowledge-external-gui/SKILL.md сведено с секциями модуля — проверка knowledgeCopy зелёная; `npm run index:build` сделан). Зеркальная копия `.agents/skills/knowledge-external-gui/` в этом репозитории не существует — `.agents/skills/` хранит только host-skills, копии ролей развёртываются потребителям по SHA через source-sync, поэтому зеркалить нечего (канон обновлён). Механическая регистрация в harness.expect.ts: composition (группа `memory`), DECLARED_COMMANDS, юнит-тесты CLI.
- Живой репозиторий: манифест дополнен (`namespace: [docs]`, files для manuals/pilot.md и knowledge/tooling.md → узел `docs:1`; остальное вес 0); `.oc3/doc/index.yml` (стухший context-индекс) генератором игнорируется — на удаление из запечатанного слоя нужен librarian.

## checks

- vitest ai-core — 10 новых тестов memory-graph + 4 теста памяти role + 2 CLI-теста memory build/check — все зелёные; весь workspace ai-core 240/240.
- typecheck ai-core/oc3/cli/harness — 0 ошибок; oxlint --type-aware --deny-warnings — чисто; prettier — чисто.
- `npm run expect` — crit 0 (было 3: owners, runsDeclared, knowledge-external-gui — закрыты).
- Живой прогон: `ai memory build` → `wrote 2 бандлов`, `ai memory check` → ok, повторный build → без изменений.
- vitest knowledgeCopy — зелёный (тело skill == вырезка секций модуля, алгоритм проверки skills.expect).

## left

- Живая проба вшивания и judge-прогон — вне зоны executor.

## risks

- `sync.contract.parts` и пустые ветки project.yml не попадают в рендер (пустые списки/объекты пропускаются) — это осмысленно, но librarian может захотеть видеть их явно.
- Старт живого репо ~9 КБ из cap 10240 — близко к порогу; рост conventions → крит check (по дизайну: librarian понижает веса или бюджет).

## refs

- Diff worktree `.opencode/worktrees/memory-graph` (ветка не создавалась, правки поверх рабочей копии оператора): packages/ai-core/src/{lib/memory.ts,lib/memory-graph.ts,commands/memory/index.ts,registry.ts,index.ts}, packages/ai-core/test/{memory-graph.test.ts,role.test.ts,fake-opencode.ts}, packages/cli/test/cli.test.ts, expectations/harness.expect.ts, package.json, .oc3/manifest.json, .oc3/doc/data/__schemas/manifest.schema.json, .oc3/bundles/ (некоммитится).
