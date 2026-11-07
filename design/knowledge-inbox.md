# Knowledge inbox и гейты завершения

Авторитетное описание реализации и обслуживания P1–P6/K/L/C в этом
репозитории. Решение по inbox одобрено в
`/Users/shahimat/ai-gen/workflow-knowledge-inbox.md`, финальная раскладка
артефактов — в `/Users/shahimat/ai-gen/oc3-artifact-layout.md` (A1–A8).
Текущие scope, owners и budgets: [task packet](../.oc3/reports/artifact-layout/task-packet.json).
Фактический срез: [code-stable](../.oc3/reports/artifact-layout/code-stable.md)
и [передача владельцам](../.oc3/reports/artifact-layout/next-owners.md).
Это локальные execution evidence, не обязательные versioned deliverables;
исторический research — план, не описание реализованного API.

## Рабочий цикл целиком

1. Оператор готовит bounded task packet: авторитетный DoD с digest и IDs
   критериев, scope/exclusions, prerequisites, owners, launch inputs/areas,
   проверки argv/cwd, repair budget и классификацию файлов. Preflight
   проверяет пакет и среду без AI и сборки; отсутствие owner, prerequisite
   или авторитетного DoD не становится PASS.
2. Роли доводят обычные ошибки своего ownership в текущем запуске.
   Для этого тикета бюджет — три ordinary attempts, два одинаковых сбоя
   без новой диагностики означают возврат владельцу; более строгие FSM
   limits сохраняются. Critical/security конфликт и выход за scope — стоп.
3. Один verification owner выполняет managed проверки на real worktree.
   Lease связан с caller/run/owner/root; другой worktree независим,
   release/recovery проверяют token, одного PID/таймера недостаточно.
4. Порядок барьеров: **code/source stable → один canonical docs/derived
   batch → full CI → независимый judge → ready**. Docs-review и
   expect-helper не требуют будущего full CI; ticket-acceptance требует.
5. Оператор остаётся доступен, роли работают background. Старт, реальный
   blocker, полезный milestone и итог достаточны: callback не требует
   отдельной реплики или raw micro-report. Self-repair и attention —
   source contracts, не гарантия поведения реальной LLM и не новый scheduler.

Receipts фиксируют content fingerprints до/после, HEAD/root/worktree,
toolchain, команду, owner/run, безопасный log digest и generated outputs.
Snapshot учитывает tracked/staged/untracked inputs, удаления и режимы,
DoD/packet, source/docs/config/tests и объявленные launch artifacts.
Изменение входа во время успешной команды делает receipt stale.
Evidence/runtime/live inbox исключены только по явной классификации:
результат CI не должен инвалидировать сам себя. Generated outputs
проверяются по producer binding, а не служат разрешением менять source.

Ready — read-only проверка актуального full receipt, criterion-bound
acceptance и всего inventory: source/generated/runtime/durable-evidence
с owner. Unknown cache, stale ledger, пустой бессмысленный sidecar,
critical pending и невыполненный DoD блокируют готовность; query ничего
не чистит. Произвольные «80%» из research-чеклиста не заменяют DoD.
Judge использует свежие receipts и адресные проверки, не конкурирующий build.

## Knowledge intake — не запись канона

Optional `knowledge_delta` добавлен к runtime result и формальному report;
старые payloads и пустой список совместимы. Runtime protocol по-прежнему
содержит только `result/verdict/question`, а `result.report` — строка.
Item — закрытый объект `subject/property/value/kind/evidence`:
`kind` равен `observation`, `decision` или `candidate`; `value` — bounded
JSON, включая скаляры, объекты и списки. Размер, глубина, известные secret
patterns и попытка передать runtime metadata проверяются до публикации.

Observation требует проверки; decision не доказывает применение;
candidate не создаёт поле схемы, rule или verified. Runtime назначает
provenance, snapshot и receipt, producer не подменяет actor/project/run.
Managed submit/session/text, native submit и ручной ingress используют
общий API. Неуспешный result не выдаётся за normal durable intake;
при ошибке store нет ложного подтверждения. Receipt означает **pending**.

Durable project store — `.oc3/inbox/knowledge/`: identity проекта,
immutable submissions, frozen batches и resolutions. Поддержанные связанные
Git worktrees используют общий project store, сохраняя отдельные scopes;
неоднозначная/недоступная topology не заменяется молча другой очередью.
Atomic publication и idempotent retry защищают от проверенных process-crash
сценариев. Scope, provenance и content hashes не дают wall-clock LWW:
разные scopes/значения нельзя склеивать по порядку доставки или branch name.

Текущее компактное ring-1 представление доступно managed и native readers;
оно перечитывает durable pending, а не доверяет старому cache.
Материализация — `.oc3/bundles/pending/index.md`, с caps/overflow,
kind/count и conflict/critical flags, без raw values/evidence в каждом prompt.
Вес/кольцо — доступность, не confidence. Raw inbox, receipts, leases и
проекция runtime-owned; прежний memory read seal сохраняется.

Ordinary jobs оставляют durable pending без librarian на каждый факт;
legacy intents импортируются совместимо, не как applied knowledge.
Deferred intake не обходит обязательный applied-docs DoD. Critical не
скрывается: известные policy patterns маркируются runtime, неизвестная
семантика требует явной эскалации producer/operator, универсального
детектора нет.

## Команды и явная консолидация

Из корня репозитория используй стабильный локальный CLI
`node packages/cli/dist/bin.js` (ниже сокращённо `ai`):

```text
ai memory inbox enqueue --file <json|->
ai memory inbox pending
ai memory inbox pending --file <selection.json>
ai memory inbox batch --file <selection.json>
ai docs-delta start --batch <id>
ai operator preflight --file <task-packet.json>
ai operator verify <name> --file <task-packet.json>
ai operator ready --file <task-packet.json>
```

Enqueue принимает только `{ "knowledge_delta": [...] }`. Selection для
детального pending/batch: `{ "subject": "synthetic topic", "scope":
"<64 hex из pending>", "limit": 8 }`; обязательны все три поля,
limit 1–32, batch также ограничен байтами. Никакого «весь журнал» по умолчанию.
Native tools вызывают тот же lib API без скрытого AI/network.
Для operator-команд альтернативой `--file` служит `--ticket <ticket>`.

Batch фиксирует exact IDs/hashes, scope и canonical base. Один librarian
читает этот срез и нужный веер и применяет обычную delta. Proposed
dispositions лежат **вне** runtime store:
`.oc3/reports/docs-proposals/<session>/dispositions.json`: applied с canonical
locator, rejected с reason/evidence, superseded с replacement ID.
Это предложение, не ack. Только успешный связанный
apply → verify → review → close и проверка membership/hash/locator/snapshot
разрешают runtime exact-ID resolution. No-op applied тоже требует locator.
Failed/stale/paused batch не ack, новые arrivals остаются pending;
accepted-cache сам по себе ack не разрешает. Без поддержанного verified
lifecycle автоматический ack не обещается; публичного ack-all нет.

Для обычного native docs_request применяется один canonical batch с local
verify/close; не нужен nested librarian на каждый факт. `docs verify`
сохраняет штатную последовательность adapters sync → delta check → check.
Это script definition; текущий локальный dist не экспортирует `docs verify`
как CLI-команду. Для local verify штатно выполняются эти три команды явно,
дополнительно `memory build`/`memory check` и проверка формата/ссылок.
Delta checker охватывает свои docRoots (`.oc3`-слои и CHANGELOG), а не
произвольные README/design: эти документы дополнительно проверяются по
diff/ссылкам/формату; неприменимые refine entries не дают покрытия.
В текущем artifact-layout batch локальная проверка документации отделена
от генерации adapters/index и full CI: их выполняет назначенный owner
после stable callbacks документации и semantic helper, без nested roles.
Owner связывает завершённое доказательство batch с `docs-derived`, затем
запускает `full`. Финальные CI/verdict остаются durable evidence, не поводом
для второго canonical batch ради строки PASS.

## Accepted ledger и обслуживание

V2 accepted-cache — ignored `.oc3/locks/delta-accepted.json`: exact
project root/worktree/HEAD, file, before/after content и digest delta.
Новое изменение того же target не авторизовано старым принятием.
V1 target-only cache не даёт authorization. Close публикует cache атомарно
до удаления delta, поддерживает безопасный повтор после process crash;
tracked `.oc3/.delta/.accepted.json` retired точечно. Historical archives,
inbox и чужие изменения не удаляются; никаких blanket ignore/cleanup.

Карта кода: `ai-core/lib/knowledge.ts` — intake/view/batch/resolution,
`local-store.ts` — topology/atomic storage/leases, `task-gates.ts` —
packet/snapshot/check/ready; команды — тонкие adapters над lib.
Harness docs-delta управляет консолидацией, OC3 — native ingress и guards.
Обратного импорта ai-core → harness/CLI или вызова command из command нет;
слои — [packages](packages.md).

## Раскладка execution artifacts

Общее определение — `packages/ai-core/src/lib/artifacts.ts`, публичный
ai-core API: `artifactRelative`, `artifactPath`, `validateArtifactOutput`,
`expectHelperDir`, `expectCacheFile`, `expectStateFile`. Тип `ArtifactKind`
назначает root, key — ticket/session или SHA-256 нормализованного entry.
`ArtifactScope` явно связывает root/worktree; `MachineArtifactScope` и
`machineArtifactPath` отделяют machine storage (например, `~/.config/harness`).
Project source, docs, исходные `*.expect.ts` и необходимые provider
definitions/adapters не execution outputs; runtime bridge внутри adapter
такого исключения не получает.

Identity/scope/namespace проверяются **до** classification и hash:
separators/segments нормализуются, absolute/traversal, symlink ancestors
и final target отвергаются. Пометки source/durable-evidence и wildcard
не разрешают внешний namespace. Это общий invariant managed/native/manual
writers, helper/sidecar/HTML, proposals/proofs, packet gates и runtime guards,
не OS-shell sandbox и не новая возможность внешнего export.

| Kind / назначение | Project locator |
| --- | --- |
| run / checks / role report | `.oc3/reports/<ticket>/` |
| research | `.oc3/research/<ticket>/` |
| verdict запуска | `.oc3/verdicts/runs/<ticket>/<run>.yml` |
| docs-proof / knowledge-proof | `.oc3/reports/docs-batches/`, `.oc3/reports/knowledge-batches/` |
| proposal | `.oc3/reports/docs-proposals/<session>/` |
| expect-helper | `.oc3/reports/expect/<entry-key>/` |
| expect-cache | `.oc3/verdicts/expect/<entry-key>/verdicts.json` |
| bridge / events | `.oc3/sessions/plan-review/` |

`entry-key = SHA-256(normalizedProjectPath(entry))`: разные entry изолированы,
эквивалентные separators/`.` дают одну identity. Tasks/answers/drafts и HTML
лежат в helper root; файловый `--html` принимает относительный путь именно
внутри helper directory данного entry. `--html -` выводит в stdout.
`expectStateFile` оставляет intentional `.oc3/goals/*.expect.json` рядом
с goal source, для остальных entry возвращает
`.oc3/verdicts/expect/<entry-key>/state.json`. Reset/run counters, serve и
plan readers используют эту раскладку; исходные expectations не переносятся.
Plan-review bridge — `.oc3/sessions/plan-review/bridge.json`, события — в
scoped session directory; root identity не смешивается с source plan.

### Durable не означает commit

Локально сохраняются и игнорируются по назначению `.oc3/reports/`,
`.oc3/research/`, `.oc3/verdicts/runs/`, `.oc3/locks/`, `.oc3/submit/`,
`.oc3/sessions/`, `.oc3/jobs/`, `.oc3/watches/`, `.oc3/baseline/`,
`.oc3/operator/`. Это retry/resume/audit: packets, logs, check receipts,
preflight/stage/acceptance, transcripts, reports, proofs, proposals и history,
а не весь task-run в каноне. Короткоживущий OS tmp subprocess очищается
и не заменяет durable project storage.

Versioned отдельно: compact semantic store `.oc3/verdicts/expect/` для
воспроизводимого no-AI CI, intentional goal results, canonical knowledge
и durable inbox. Нет blanket-ignore `.oc3/`, goals или inbox. Source,
schemas, docs и обязательные adapters также не локальный execution churn.
Перед фиксацией состава различают эти deliverables и local-only evidence:
ignore не отменяет уже staged entries и не меняет пользовательский index.

### Миграция и исторические locators

`oc3 migrate` использует `artifact-migration.ts`: lease, предварительная
проверка collisions, byte-preserving publication и manifest перед удалением
старого output; изменённый source или несовпадающий target — ошибка, не overwrite.
Повтор безопасен; сохранённые aliases проверяются и при retry.
Manifest `.oc3/reports/artifact-history/manifest.json` хранит old→new,
bytes/hash, root/worktree/HEAD/snapshot. `historicalArtifactPath(root, locator)`
даёт только read-only alias с проверкой scope/hash, не symlink или второй writer.
Исторические bytes и вложенные ссылки не переписываются.

Фактически перенесены 55 файлов / 392419 байт: 50 knowledge-inbox,
4 project-role-models и semantic cache; alias hashes проверены, повтор
перенёс ноль. Cache имеет отдельный mutable versioned seed; исходный cache
и предыдущая ревизия manifest архивированы. Старые `.ops` и adjacent cache
отсутствуют в filesystem. По stable evidence в пользовательском index ещё
54 старых `.ops` entries и старый staged cache: ignore их не снимает.
Active navigation/defaults используют новые пути или read-only resolver;
архивный PASS не recertified и не доказывает свежесть нового snapshot.

## Evidence и границы приёмки

На artifact-layout code/source stable подтверждены 613 unit tests и адресные
build/typechecks/lint/format/index/models/adapters checks; immutable receipt и
safe log указаны в code-stable. Это **не** итоговая приёмка: на этом срезе
настоящие full CI и независимый ticket judge ещё pending.
Актуальные результаты искать в `.oc3/reports/artifact-layout/checks/` и
`.oc3/verdicts/runs/artifact-layout/`, не выводить PASS из research,
historical acceptance, targeted receipt или этого текста.

Тесты используют synthetic repos/fake runners. Нет обещания реального
LLM end-to-end, универсального OS-shell interception, physical power-loss,
distributed filesystem/security guarantees. Generic native launches без
trusted task context остаются operator-controlled; legacy standalone
совместимость не создаёт ticket-ready receipt. Нет новых scheduler/UI/ролей,
замены FSM, моделей или внешнего транспорта; секреты в примеры не включаются.
