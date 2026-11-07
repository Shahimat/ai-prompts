# Тулинг сессий

Заметки о среде, в которой работают сессии репозитория.

## oc3-инструменты

Сессионные oc3-инструменты приходят из глобальной установки
`@shahimat/oc3`, а не из пакетов этого репозитория: при расхождении
версий поведение инструментов отличается от кода в `packages/`.

Наблюдение 2026-11-03: глобальная `@shahimat/oc3` 0.1.1
(`npm ls -g @shahimat/oc3`) старее репозиторной и содержит гейт
«платного семейства glm-5.3», убранный из исходников. Симптом —
`oc3 models_set` отказывал на `glm-5.3-flash` («модель вне платного
семейства glm-5.3») при отсутствии этой строки в
`packages/ai-core/src/commands/models` и `packages/oc3/src`.

## Адаптеры и роли

У plan-review нет канонической роли planner: адаптер генерирует агентов
из ролей (`agents/*.md`), planner среди них отсутствует, и в
репозитории-источнике планер не запускается (judge при этом
генерируется). Зафиксировано 2026-11-03: воспроизводится
`ai adapters sync` в репозитории-источнике.

## Knowledge inbox и гейты

Реализация и обслуживание полного цикла P1–P6/K/L/C —
`design/knowledge-inbox.md`: task packet/preflight, managed owner lease,
snapshot receipts, один docs/derived batch до full CI, judge и ready.
CLI: `memory inbox enqueue|pending|batch`, `operator preflight|verify <name>|ready`;
native tools используют общий ai-core API. Optional delta даёт durable
pending, не canonical applied; консолидация — существующий docs-delta
с exact-ID lifecycle, не librarian на каждый факт.
Raw `.oc3/inbox/knowledge/` runtime-owned; компактная текущая ring-1
проекция не канон. V2 accepted-cache в ignored
`.oc3/locks/delta-accepted.json` связан с exact root/worktree/HEAD/content;
старый target-only cache не authorization.
Текущий packet — `.oc3/reports/artifact-layout/task-packet.json`, stable
evidence — `.oc3/reports/artifact-layout/{code-stable,next-owners}.md`.
Full CI и независимая A1–A8 acceptance на этом срезе pending; исторические
receipts не становятся свежим PASS. Реализация в checkout не означает
обновления глобально установленного CLI.

## Project execution artifacts

Общий typed resolver — `packages/ai-core/src/lib/artifacts.ts`: kind + key
(ticket/session/нормализованный entry) + explicit root/worktree scope;
machine scope отделён. Namespace/identity проверяются до classification/hash,
пометка source или wildcard не разрешает внешний project output.
Managed/native/manual/helper/sidecar/HTML, bridge и proposals/proofs пишутся
в `.oc3/`; source expectations и обязательные adapters не execution outputs.
Точные roots/API и retention — `design/knowledge-inbox.md`, раздел раскладки.

Локальные ignored reports/research/verdicts/runs и прочие run roots — не
обязательный commit. Compact `.oc3/verdicts/expect/<entry-key>/` versioned
для no-AI CI; canonical knowledge/goals/inbox не blanket-ignore.
Миграция: 55 файлов / 392419 байт, manifest —
`.oc3/reports/artifact-history/manifest.json`; исторические bytes/hash сохранены,
старые locators читаются через `historicalArtifactPath`, не новые writes.
Старых `.ops`/adjacent cache в filesystem нет; по stable evidence в user index
ещё 54 старых `.ops` entries и старый staged cache. Ignore их не снимает;
состав deliverables сверяется отдельно, без переписывания history/index.

## Открытые задачи

- harness: `repoSources` в expectations исключает gitignored-каталоги
  (`.opencode` и прочие); смежный фикс (нормализация цитат
  containsQuote) вошёл в коммит b6e9ab9, этот — нет.
- обновить глобальную установку `@shahimat/oc3` после следующего релиза
  пакетов — снимет симптом с гейтом «платного семейства glm-5.3».
- docs-delta: либо фолбэк через перезапуск роли, либо guard явно пускает
  staging-запись `context/.delta/` не-librarian'у (tension
  воспроизведён дважды: субагент general и основная сессия).
- добавить каноническую роль planner или другой источник агента планера
  для адаптеров.
