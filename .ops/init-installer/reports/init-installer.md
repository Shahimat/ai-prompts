# report: init-installer (run 1)

```yaml
done:
  - runInit расширен до установщика: первая строка вывода — состояние громко (nothing / «v2 detected: …» / «v3 partial: не хватает — …» / v3 ok), детект по маркерам: context/workflow.md, context/views/, sync.contract (key+edition) в project.yml, module-маркеры AGENTS.md, плагин в конфиге, devDeps, лок-маркер .ops/locks/install
  - установку/миграцию пишет из шаблонов ПАКЕТА (src/templates.ts, без сети): AGENTS.md по шаблону контракта v3 с append-only merge (пользовательские секции и module-блоки сохраняются, недостающее дописывается с пометкой), context/ каркас (project.yml с плейсхолдерами, autonomy.yml, skills.yml), package.json devDeps точными пинами (пины читаются из собственного package.json oc3: ai-core 0.1.6, oc3 0.1.3), opencode.jsonc из тикета 2 (+ensurePluginEntry: plugins), .gitignore/.gitattributes (merge без дублей), лок .ops/locks/install
  - v2-перенос содержимого — отчёт миграции на stdout (по файлу: context/views/<name> → goals/<base>.expect.ts, «НЕ конвертируется молча»; workflow.md → skill workflow), без молчаливой конверсии
  - вопросы человеку — нумерованным списком на stdout (name/summary, reality, реквизиты sync.index_source, модели ролей через oc3 models set)
  - runtime в context/project.yml: full — дефолт (по research cold-start: плагин ставится opencode-ом без node/npm); degraded — только при недоступном реестре npm (probe registry ping), с пояснением и шагами возврата в full. ОТСТУПЛЕНИЕ от старой формулировки crit («нет node/npm → degraded») — по дополнению оператора в брифе и research .ops/contract-entry/research/cold-start-plugins.md; отсутствие node/npm даёт подсказки в выводе (ai CLI и harness-проверки недоступны), проверено empty-PATH прогоном
  - повторные запуски идемпотентны (проверено: шаблон — «без изменений», правки пользователя и чужой default_agent — «не перетираю», v3-partial из-за лок-маркера)
checks:
  - npm run ci (format, build, typecheck x4, lint, тесты x4, packages-check, index-check, expectations) — зелёный, «в бюджете»
  - vitest oc3: 83 теста x 10 файлов; новые install.test.ts (детект 4 состояний, runtime, AGENTS-merge, project.yml-merge, пины, git-файлы, миграционный отчёт, вопросы, каркас)
  - дымовые прогоны dist/bin.js init: nothing → установка (exit 1, вопросы+лок); повтор → v3-partial по лок-маркеру; v2 → миграция с отчётом; v3-ok → проверка ok (exit 0); empty PATH → подсказки node/npm, runtime: full
left:
  - приёмка judge: счётчик run'ов goals/contract-entry.expect.json общий по файлу цели и исчерпан (2/2 после тикетов 1–2) — запуск judge тикета 3 механически блокируется гейтом до сброса файла или retry оператором
risks:
  - goal-файл ещё не обновлен оператором (критерий runtime в worktree-копии старый) — judge может сверить со старой формулировкой; расхождение объяснено здесь и в брифе judge
  - JSONC/YAML-merge текстовый append/insert-only; экзотические конструкции (ключи с escape-кавычками, аncорные дубли) не разбираются
refs:
  - git diff в worktree contract-entry (файлы: packages/oc3/src/{install.ts,templates.ts,init.ts,operator-agent.ts}, packages/oc3/test/install.test.ts)
```
