# memory-roles — отчёт 1 (сверка, без правок)

## done

- manifest.json — единственная ручка: проверено. Состав графа, веса, namespace и бюджеты читаются только из `.oc3/manifest.json` (renderGraph/loadManifest); `files` манифеста — единственное место связи файла с namespace/весом; build/check пишут только в `.oc3/bundles/` (writeGraph), файлы фактов при мутациях памяти не меняются. checkMemory покрывает: манифест по схеме (включая files), существование заявленных файлов, namespace ∈ списка, NOTES-бюджет, optional-field, схемы фактов.
- Librarian-процессы (формализация NOTES в data-структуры, «NOTES пишет librarian», переполнение → понижение весов) — процессные обязательства ролей, механизмы под них в коде есть: крит NOTES сверх бюджета с подсказкой «формализуй в data-структуры», крит cap старта с подсказкой «понизь веса в манифесте» — исполнителю (librarian) команду сообщают диагностики.
- manuals агент-читаемые: manuals рендерятся в узлы бандлов (в живом репо — узел `docs:1` содержит manuals/pilot.md и knowledge/tooling.md); seal разрешает агентам читать только bundles — «дай инструкцию как X» решается загрузкой узла, namespace/вес manuals — в манифесте (`files`). Тест: session-brief «холодный старт…» проверяет manuals в узле.
- Маршрут AGENTS.md — сверен с операторской правкой: «Любой запрос — сначала оперативная память (`.oc3/bundles/index.md`)», маршруты на `.oc3/doc/*`, `.oc3/goals/`, `.oc3/skills.yml` — на месте, упоминаний context/index.yml в маршрутах нет.
- `context/index.yml упразднён` — ЧАСТИЧНО: маршрута в AGENTS.md больше нет, генератор бандлов игнорирует `.oc3/doc/index.yml` (walkDoc skip), но сам файл ещё лежит в запечатанном слое. Удаление — librarian/оператор (executor запечатанный слой не трогает). Команда `ai context index` и `ai context check` продолжают работать (не ломаю потребителей).
- npm run ci зелёный (memory check в составе) — шаг `memory:check` добавлен после `index:check`; полный ci прогон в отчёте ниже; версии и пины не тронуты, packages:check без crit.

## checks

- Полный `npm run ci` в worktree: format, build, typecheck, lint, тесты (ai-core/harness/cli/oc3), packages-check, index:check, memory:check, expect — crit 0 (см. лог ci в журнале сессии; expect-гейт держат ? 31 без вердикта — фаза judge).

## left

- Удаление устаревшего `.oc3/doc/index.yml` из запечатанного слоя — librarian (факт для docs_request).
- Живые вердикты judge по цели memory-graph.

## risks

- `.oc3/doc/index.yml` пока валидируется старой командой `ai context check` — если её вызовет оператор, файл пересоздастся; после удаления файла командам `context index/check` не останется входа (следующее место чистки — отдельное решение).

## refs

- Сверка без правок кода; evidence: packages/ai-core/src/lib/memory.ts, memory-graph.ts, packages/oc3/src/guards.ts (OC3_READABLE), AGENTS.md, package.json (memory:check).
