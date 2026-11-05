# отчёт executor: oc3-manifest

## done

- install.ts: `ensureMemorySkeleton(root)` — собирает файлы фактов под `.oc3/doc/`
  (project.yml, autonomy.yml, glossary/**, conventions/**, data/<структура>/**,
  manuals/**, knowledge/**; `__schemas` исключён), пишет `.oc3/manifest.json`:
  namespace: [], data: [структуры из `.oc3/doc/data/<name>/`], budgets из
  `DEFAULT_BUDGETS` ai-core (notes 4096, start 10240, node 16384, optional_field 3),
  files с дефолтными весами: `common.*`, project.yml, autonomy.yml → 0, остальные → 2;
  namespace записей пустой (заполняет librarian; memory-graph собирает их в «общие» узлы).
- install.ts: merge при повторном прогоне — существующие веса/namespace записей и
  namespace верхнего уровня сохраняются, добавляются только новые файлы фактов и
  структуры; невалидный JSON / не-объект — merge пропущен, файл не тронут.
- install.ts: `.oc3/NOTES.md` — создаётся с заголовком
  `# NOTES — неформальные факты до формализации`, существующий не перетирается.
- init.ts: вызов в greenfield-ветке (после `ensureContextSkeleton`, чтобы autonomy.yml
  успел попасть в перечень); v3-ok ветка не менялась.
- migrate.ts: вызов в конце `migrateLayout` (после переноса, prune и scanLegacy);
  строки в отчёте с префиксом `layout: память: …`.
- Схему `manifest.schema.json` дополнять не пришлось: budgets и files уже в ней,
  NOTES.md в схему не входит (checkMemory проверяет его размер отдельно) — ai-core не менялся.

## checks

- `npm run build` (oc3) — ok; `npx prettier --write` по изменённым файлам — ok.
- Тесты oc3: 13 файлов / 136 тестов — зелёные (новый `test/memory-skeleton.test.ts`:
  greenfield-перечень и веса, NOTES, прохождение схемы `compileSchema` + `checkMemory`
  без замечаний к манифесту, merge с сохранением пользовательских весов/namespace,
  невалидный JSON, NOTES пользователя).
- `npm run ci`: format:check, 4 сборки, 4 typecheck — зелёные; упал на шаге `lint`
  только из-за `goals/oc3-manifest.expect.ts` (4 ошибки no-comments — это untracked
  файл цели оператора, вне моего скоупа, «goals/ не трогать»); в `packages/**` ошибок
  lint 0. Остальные шаги ci прогнаны вручную и зелёные: тесты ai-core 234, harness 78,
  cli 37, oc3 136; packages-check (критичных 0); index:check (up to date);
  memory:check (ok); `npm run expect` — 331 ожиданий, crit 0.
- CLI-смоук на /tmp: migrate старой раскладки → манифест с перенесёнными файлами
  (data: [entities], веса по правилу) + NOTES.md; повторный migrate — записи сохранены;
  init greenfield → скелет (project.yml/autonomy.yml, вес 0); повторный init — «на месте»;
  правка веса вручную (9) переживает повторные прогоны.
- crit 4 цели: на смоук-каталог с реальными схемами контракта `ai memory check` — ok,
  `ai memory build` — ok (2 бандла: index.md + узел).

## отступления от плана (с Reasons)

- Бриф задаёт ключи бюджетов `notes_bytes/start_bytes/node_bytes/optional_field_min_files`,
  но `checkMemory` и `manifest.schema.json` читают `notes/start/node/optional_field` —
  скелет записывает ключи схемы (значения те же), иначе манифест не проходил бы валидацию.
- Бриф просит отчёт в `.ops/oc3-manifest/reports/` — в worktree раскладка v3, `.ops/` нет;
  отчёт здесь: `.oc3/reports/oc3-manifest/oc3-manifest.md` (создание `.ops/` сломало бы
  миграционный инвариант).
- Цель (crit 1) говорит «namespace: [домены из путей]», бриф — «namespace пустой»;
  следовал брифу (librarian заполняет по смыслу). Вопрос к judge/оператору: если нужен
  вывод доменов из путей — это отдельная доработка.

## judge

- run 1 — **pass** (5/5 crit): `.oc3/verdicts/oc3-manifest/1.yml`, run записан в
  `goals/oc3-manifest.expect.json`. Замечаний к доработке нет — повторный прогон
  не требовался. Judge подтвердил: ci красен только на lint файла цели (вне дельты);
  заголовок crit 1 цели приведён к брифу («namespace пустой»).

## left

- `npm run ci` целиком останется красным на lint, пока в untracked
  `goals/oc3-manifest.expect.ts` есть комментарии-шапка (строки 3–6) — убирать их
  должен оператор (goals/ вне моего скоупа).
- Версии/пины не тронуты (0.1.6 не публиковалась) — публикация после приёмки, как в брифе.

## risks

- Merge не удаляет записи манифеста по удалённым файлам (по скоупу: только добавление);
  удалённый файл даст диагностику checkMemory «файл из манифеста не существует» —
  это поведение по дизайну манифеста.
- Greenfield без схем форм (`__schemas` приходит через source-sync) даст диагностику
  «нет схемы формы» — вне скоупа тикета.

## refs

- diff: packages/oc3/src/install.ts, src/init.ts, src/migrate.ts, test/migrate.test.ts,
  новый test/memory-skeleton.test.ts (ветка worktree `.opencode/worktrees/oc3-manifest`).
- смоук: /tmp/opencode/oc3-smoke-a (migrate), /tmp/opencode/oc3-smoke-b (init).
