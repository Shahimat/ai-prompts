# Инкрементальная верификация

Поддержанный контракт общего proof runner (T2) и expectation consumers (T3).
Подготовка compiled output и test isolation остаются в
[README ai-core](../packages/ai-core/README.md#тестирование-исходников), размещение
артефактов — в [artifact layout](knowledge-inbox.md#раскладка-execution-artifacts).
Это не обещание кэшировать любой Vitest, subprocess или полный CI.

## Proof runner: inputs, baseline и current run

`packages/ai-core/src/lib/proof/` содержит typed declarations, input resolver,
runner, transport и зарегистрированные adapters. `ProofDeclaration` описывает
files/optionalFiles, implementation, membership, config, допустимое окружение,
полноту и cacheability. Manifest связывает фактические bytes/modes, наличие
inputs, checker/policy, loaded implementation и runtime compatibility
(Node, executable, platform, architecture). Missing/ambiguous dependencies,
unknown environment и secret-dependent поведение не дают reusable PASS.
Секреты, raw env и хэши secret values не служат proof inputs.

Canonical keys принимают только поддержанное дерево обычных JSON data values.
Порядок maps нормализуется, массивов — сохраняется; отсутствие config отлично
от explicit null. Unsupported runtime graphs отклоняются до lookup/execute:
sparse arrays, signed zero, symbol/accessor/nonstandard properties, proxies,
custom/null prototypes, frozen/non-extensible objects, aliases/cycles и non-JSON
values. Getter/proxy execution не нужен для вычисления key. Это не универсальный
serializer произвольных JavaScript objects.

Два независимых условия:

| Поле | Значение |
| --- | --- |
| `ProofInputs.cacheable` | Cross-run baseline разрешён только для `runtime-bound` и достаточной compatibility |
| `ProofInputs.currentReusable` | Inputs/runtime достаточны для reuse результата текущего run независимо от baseline policy |
| `ProofInputs.generationValid` | Текущие checker files совпадают с seal загруженной реализации |
| `ProofReceipt.currentReusable` | Достаточность inputs до/после исполнения; отсутствие поля не означает true |

Baseline хранит только совместимый успешный proof. `run-only, complete:true`
может переиспользовать достаточный current PASS/FAIL, но не baseline.
`complete:false` не получает fresh current reuse даже при одинаковом частичном
key. Первый actual execution такого node — observation с реальным exit;
повтор — STALE/nonzero с требованием нового run, без второго launch и без
повторной выдачи старого PASS как свежего доказательства.

Один logical node исполняется не больше одного раза в generation run.
Достаточные matching current results, включая FAIL, и in-flight executions
разделяются между callers. Неполный in-flight waiter не получает fresh PASS.
Mutation inputs делает run stale, а не запускает скрытый retry.
`--force` обходит baseline выбранной области, но не sufficient current result,
freshness, permissions или failures. Fixtures/snapshots он не удаляет и не
обновляет.

Зарегистрированный checker захватывает loaded implementation seal. Смена
checker bytes/dependencies/membership на диске не аттестуется старым callback:
generation mismatch блокирует execution/новый PASS и требует fresh process,
не только новый run старого процесса. Полнота generic callback определяется
его reviewed adapter contract, не автоматически выводится runner'ом.

Transport root-bound: одного env run ID недостаточно для join. Проверяются
token/owner/root/scope/force/allowJudge bindings; subprocess single-flight,
leases и atomic publication используют общие primitives. Recovery не выводит
смерть владельца из догадки. Leaf proof не заменяет native gate receipt:
preflight, authority, owners, barriers, snapshot, output/log freshness,
acceptance и hygiene остаются обязательными.

## Реальная область ordinary/scripted reuse

Scripted baseline поддержан у зарегистрированного `changelog lint`.
Ordinary baseline ограничен reviewed `test/bounded-guards.test.ts`: три
production guard tests для `isRecord`, `isStringArray`, `isOneOf`. Contract
включает approved test/helper/config/package/tsconfig inputs, root config и lock,
установленную Vitest dependency closure с optional/peer/native dependencies,
membership и actual hashes, runtime и loaded checker seal. Dedicated bounded
config использует source resolution и `envDir:false` для attestation.

В достаточном modeled context default core npm test выделяет bounded leaf,
а remainder исполняет run-only, исключив ровно этот файл. Явный выбор bounded
файла использует тот же adapter. Новый SHA изменённого approved source/config
сам по себе не становится reviewed complete contract.

При unknown loader/env, inherited `NODE_OPTIONS`, unreviewed source/config или
недоступной attestation выбирается **actual opaque execution через existing
Vitest config**. Default invocation исполняет весь selected scope, включая
remainder, без предварительного bounded-only прохода; explicit selector
исполняет выбранную область. Passing observation возвращает 0, failing —
реальный nonzero. Диагностика сообщает run-only fallback, а не semantic review
как условие запуска ordinary tests. Inherited guards/environment не снимаются.
Incomplete repeat того же selected logical node — STALE/nonzero без второго
launch; смена полноты context не создаёт второй node.

Arbitrary tests/configs/effects не объявлены cacheable. Default invocation
в целом — incomplete node, даже когда внутри него reusable bounded leaf.
Raw Vitest не рекурсирует через npm adapter. T1 pretest clean build сохраняется
перед каждым actual npm invocation, включая warm/current hit; остаётся и input
hashing. Warm — не zero wall time и не пропуск preparation/всего CI.

## Criterion identity и implementation inputs

TS parser/resolver в `lib/expect/inventory.ts` выделяет selected callback и
relevant helper/import/fixture/config/registration closure, membership.
`lib/expect/proof.ts` добавляет evidence selectors, effective declared producer
instructions и schema/checker/producer bindings. Это не аттестует полноту
production context. Portable content input
не равен local lineage: reconciliation допускает только однозначное
сопоставление, не гарантирует individual continuity duplicates или полного
одновременного rename. Content proof отдельно от root-local answer/run authority.
Поддержанные независимые static methods не зависят от тела pure sibling.

Полнота ограничена явно, а не выводится из whole-file SHA:

- **A1, effects:** entry writes/updates/deletes и opaque calls/new закрывают
  affected scope как incomplete. Callable type signature не заменяет runtime
  implementation body; разрешено только известное подмножество primitives.
- **A2, registration:** dispatch/control expressions и referenced declarations
  имеют отдельный registration input. Conditional/expression suites,
  `.skip`/`.only` и dynamic control учитываются в membership/group review.
- **A3, callbacks:** named/alias/method callback разрешается до implementation;
  runtime parameters, fixtures, `this`/`super`, bound/dynamic receivers не
  аттестуются одной TypeScript signature.
- **A4, multiplicity:** factories, неизвестная invocation provenance и repeated
  raw collection locations образуют incomplete group с factual count, без
  ordinal aliases. Один AST range не доказывает одну runtime registration.

Unresolved imports, TS/runtime resolution conflicts, hooks, mutable state,
decorators/initializers/inheritance и неизвестные IO/env также требуют
консервативного scope с diagnostic. Универсальный JS purity/effect/dataflow
proof не заявляется. Inventory memo повторно сверяет observed inputs,
negative lookups, config/resolution, membership, root и generation; возвращает
clones, а не eternal mutable Program result.

## Title-only coverage и delta

`lib/expect/title-proof.ts` отделяет unary измеримость отображаемого intent
от противоречивости canonical unordered pair в известном file scope.
Title inputs содержат intents/scope и checker/schema/producer policy,
**не body, implementation digest или registration digest**. Title content
identity не обещает постоянную registration lineage.

Answer перечисляет `evaluated: [{id, problem, reason}]` для всех запрошенных
checks, включая explicit negative `problem:false`. Missing/duplicate/foreign
IDs, пустая причина и повреждённая integrity отклоняются. Scope membership и
coverage агрегируются отдельно, без вставки полного membership hash в каждый
сохранившийся pair key.

| Изменение | Инвалидация |
| --- | --- |
| Body-only при прежнем intent | Implementation отдельно; title inputs прежние |
| Rename одного title | Его unary, affected peer pairs и собственная implementation |
| Insertion/deletion | Новые/удалённые relations и текущее coverage, не все старые pairs |
| Reorder | Canonical keys прежние |
| Instructions/checker/producer change | Старое policy-bound coverage не trusted |
| Duplicate/dynamic/unknown title scope | Incomplete group review, не individual PASS |

Delta содержит только misses/stale checks и необходимый immutable peer context;
batch grouping не меняет individual proof identity. Pairwise contract не
означает higher-order completeness.

## Immutable prepare / run / apply и legacy

`lib/expect/bundle.ts` сохраняет immutable all-ref text snapshots и JSON bundle.
Source generation связывает inventory/membership/evidence/policy. Plan/answer
envelopes связывают root, normalized entry, run, plan, item, input и policy;
payload включает sanitized execution policy `{run, force, allowJudge}`.
Prepare/apply защищены entry lease, active generation pointer и atomic merge.
Текущие inputs/generation проверяются до answer/quote acceptance и повторно
перед publication. Stale/concurrent/cross-entry/foreign answers отвергаются;
новый prepare делает прежний plan foreign.

Manual apply из нового run может сохранить допустимый baseline answer, но
не создаёт current force marker нового run. Current marker требует совпадения
authenticated prepare/apply run и policy. Checksums проверяют corruption,
а не являются подписью producer или защитой от writer с доступом к store.

Legacy verdicts, lint, reasons, quotes и history сохраняются как
legacy-unverified/needs-review при отсутствии v2 bindings/integrity. Пустые
legacy lint arrays не доказывают explicit negative title coverage. Report/lint
не переписывают versioned semantic store, не prune-ят историю и не фабрикуют
trusted migration. Production `askRole` не аттестует effective inherited/system/
tool context: producer остаётся incomplete **даже с `--run`**, даёт needs-review
до dispatch. Controlled fake producer conformance не доказывает работающий
production semantic reuse.

Typed resolver назначает locators, не каталоги рядом с entry:

- `expectHelperDir(entry)` → `.oc3/reports/expect/<entry-key>/` для tasks,
  bundles и runtime материалов;
- `expectCacheFile(entry)` → `.oc3/verdicts/expect/<entry-key>/verdicts.json`
  для compact semantic store;
- `expectStateFile(entry)` → `.oc3/goals/<goal>.expect.json` для goal entry,
  иначе `.oc3/verdicts/expect/<entry-key>/state.json`.

`entry-key` — SHA-256 нормализованного project-relative entry. Новые writes в
legacy `.judge/`/`.verdicts.json` не поддержаны; historical readers используют
проверяемый migration manifest. Durable runtime evidence не равно commit.

## Consumer подготовленного плана

Корневой public export `@shahimat/ai-core`:
`expectPlanConsumer(root, entryPath, now: Date): Promise<ExpectPlanConsumer>`.
Тип `ExpectConsumerTask` содержит `task`, `kind: 'batch' | 'lint'`, `text`;
consumer предоставляет `tasks`, `produce(task, callback)` и `apply()`.
Он использует только default `semanticGeneration`: caller-controlled capture,
complete context, env trust switch и отдельный CLI флаг не предусмотрены.
`SemanticGeneration` с controlled context не реэкспортируется этим API.

Consumer сверяет payload с immutable bound plan, confined task/answer paths,
уникальность member tasks, active/stored bundle и exact prepared task texts.
Current inputs/evidence/policy перепроверяются до и после callback, затем
перед apply; core независимо выполняет validate-before-commit/lease/generation
checks. Принимается полный v2 envelope, а не legacy raw array/lint object;
title coverage требует всех IDs, включая `problem:false` с непустой причиной.
Foreign/missing/duplicate answers и rejected batch не дают accepted task.
`apply()` доступен лишь после принятия всех member tasks. Это гарантия
consumer, не аттестация producer или универсальная физическая неизменяемость JS.

Harness review сохраняет свой `ModelRunner` и `plan-review.judge`, не переходит
на core `expect.judge`. Incomplete default producer блокирует dispatch/apply;
любой rejected/error/rollback исключает PASS. Fake context проверяет consumer
plumbing, а не production semantic reuse или финальные tools/instructions.

## Ресурсный профиль integration tests

По явному выбору пользователя timeout 30000 ms назначен ровно семи existing
expanded cases: трём registered adapter invalidation (`changelog/lint.ts`,
`shared/frontmatter.ts`, `yaml/dist/index.js`), двум memory corpus caps
16384/24576 и двум authoritative/full ticket acceptance cases.
Global 5000 ms, остальные 514 case options, исходные explicit budgets,
workers/scheduling/isolation, guards, corpus и assertions не изменены.
Это пересмотр прежнего 5s профиля только для этих семи случаев, не доказательство
его прохождения. Исторические raw 5s FAIL сохраняются; actual run counts и
elapsed statistics — execution evidence, не новое canonical правило.
Authority и exact registrations —
`.oc3/reports/incremental-verification-final/timeout-profile-approval-v12.md`
и `integration-timeouts-v12.md` в том же report root.

## Команды и полномочия

| Entry | Поддержанный контракт |
| --- | --- |
| Root `npm test`, `npm run ci` с `-- --force` | Общий authenticated run и force policy, не blind forwarding последней stage/Vitest |
| Core `npm test -- test/bounded-guards.test.ts [--force]` | Reviewed bounded reuse либо actual opaque fallback по достаточности context |
| `ai check`, `ai refresh [--force]` | Общий run script steps; modeled leaf reuse, не whole-script PASS-cache |
| `ai expect report|lint <file> [--force]` | Query/coverage без producer; lint дополнительно строго проверяет scripted violations |
| `ai expect judge <file> [--force]` | Prepare delta и bound plan без agent |
| `ai expect judge <file> --run [--force]` | Explicit producer path; incomplete production context остаётся needs-review до dispatch |
| `ai expect judge <file> --apply [--force]` | Bound revalidation/lease/atomic apply без producer |
| `oc3 expect report <file> [--force]` | Общий query contract, без run/apply |
| `ai operator verify <name> … [--force]` | Native owner/gate path с собственными snapshot-bound receipts |
| `operator ready`, `goals status`, `expect serve` | Freshness query, не agent permission и не поддержка force |

Default queries, tests и CI не запускают provider при miss, даже при inherited
`allowJudge=true`. Force не даёт agent permission. `--run` и `--apply`
взаимоисключающие; на report/lint/check/refresh они unsupported. Unsupported
controls дают usage error (exit 2), а не молча игнорируются. `npm publish
--force` не относится к этому API.

Core wrapper принимает positional filters, `-t/--testNamePattern`, `--reporter`,
`--outputFile`, `--exclude`, `--config` с отдельным value и booleans `--silent`,
`--no-file-parallelism`, `--passWithNoTests`. Остальные flags отклоняются.
Query/prepare collection — отдельный incomplete/run-only node: один physical
execution за run, повтор — needs-review/new-run без скрытого Vitest pass.

## Freshness в отчётах и границы evidence

Отчёт различает executed / reused / needs-review / failed. Pending semantic
coverage не обходится permissive crit/warn budget; scripted lint также строг
независимо от report budget. Historical sidecar, 80% или последний run не
дают цели «достигнута» без current acceptance proof. Leaf proof и HTTP 200
не заменяют native readiness.

Serve строит report на каждый HTTP request: needs-review/нет explicit pass
marker → 503, render failure → 500. Изменение source revision во время render
отклоняет ответ; failed regeneration вызывает reload, не сохраняет молча
старый green экран. Designated runtime outputs/locks/cache events исключаются
из watch feedback, включая directory events. Canonical `.oc3/goals`, project,
semantic inputs и versioned expect store не blanket-ignore; watch notification
сама по себе не acceptance proof.

Source review T2/T3 и bounded counters не равны aggregate acceptance.
Исторический root full с 20 FAIL сохраняется; это не «root CI никогда не
запускался». Новый final full/all-four и refresh/check остаются отдельными
стадиями verification owner. Ограниченный cold core PASS на user-approved
seven-case 30s profile не доказывает final all-four/root full PASS; прежние
три cold GREEN относятся к прежнему snapshot. Intercepted stages и fake
producer tests не являются full PASS. Full-entry performance и второй
компьютер не доказаны; исходные T1 2/21 FAIL и resource-conditioned результаты
сохранены в историческом evidence, не объявлены диагностированными этим batch.
Legacy-needs-review может честно оставить no-agent CI nonzero: это не основание
написать trusted upgrade вручную или включить live judge.

Raw exits, manifests, counters и historical negative outcomes находятся отдельно
от канона: `.oc3/reports/verification-proof-runner/source-stable-v2.md` и
`source-review-v2.md`; `.oc3/reports/incremental-expectations-cli/` —
`source-stable-a-v2.md`, `source-stable-b.md` вместе с superseding
`source-stable-b-v2.md`, `source-review-b-v2.md`; T1 —
`.oc3/reports/test-reproducibility/final-verification-v2.md`.
B1 v2 заменяет прежний guarded first-pass nonzero claim только для ordinary
fallback, не ограничение incomplete semantic producer. Final integration
receipts ведёт отдельный verification owner, без нового canonical PASS batch.
