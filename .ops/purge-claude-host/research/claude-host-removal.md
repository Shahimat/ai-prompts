# Отказ от Claude Code как хоста — инвентарь и план (research, 2026-11-03)

Записано оператором с отчёта researcher (субагент read-only). Источники — файлы репо и CLI машины.

## 0. Машина
- `opencode` → `/home/gevorg/.opencode/bin/opencode`, **v2.2.5** — установлен.
- `codex`, `claude` → обёртки ai-proxy, реально не установлены; codex локально проверить нечем.

## 1. Инвентарь вхождений «claude» (~80 файлов, ~491 строка, без dist/.ops)

### (a) Раннер ролей — 7 файлов / 25 строк
- `packages/ai-core/src/lib/claude.ts` (10, файл целиком): `ClaudeRunner`, `interactiveArgs`/`headlessArgs` (`-p`, `--output-format json/stream-json`, `--permission-mode dontAsk`, `--setting-sources`, `--disable-slash-commands`, `--json-schema`, `--max-turns`, `--mcp-config`, `--add-dir`, `--no-session-persistence`), `claudeBin()` + `HARNESS_CLAUDE`, `parseHeadless`.
- `packages/ai-core/src/lib/role.ts` (6): `spawnClaude`, `HARNESS_ROLE_TIMEOUT_MIN`, тексты «claude -p».
- `packages/ai-core/src/index.ts` (1), `packages/harness/src/harnesses/core/index.ts` (2): реэкспорты.
- `packages/harness/src/harnesses/plan-review/cli.ts` (2): `new ClaudeRunner()`.
- `packages/harness/src/harnesses/core/catalog.ts` (2), `packages/cli/src/cli.ts` (2): маркер проекта — каталог `.claude`.

### (b) Адаптер claude-code — 6 src-файлов / 26 строк + генерируемые
- `commands/adapters/sync.ts` (18), `render.ts` (3: `claudeMd()`, `claudeAgent()`), `shared/config.ts` (1: `KNOWN_ADAPTERS`), `expectations/schemas/ai-core-config.schema.json` (1: enum), `context/ai-core.yml` (1), `.gitignore` (2).
- Генерируемые: `CLAUDE.md`, `.claude/settings.json`, `.claude/skills/` (13 копий).

### (c) Hooks — 2 файла / 11 строк
- `commands/docs/index.ts` (3): `DOCS_FILES`/`DOCS_DIRS` включают CLAUDE.md/.claude, `GUARDED_TOOLS` — имена инструментов Claude Code.
- `commands/adapters/memory.ts` (8): `CLAUDE_SETTINGS`, `HOOK_SPECS` (docs-guard PreToolUse; ops-brief SessionStart), `claudeMemory()`, `statusLine`.
- ops-line (statusLine) существует только в формате Claude Code TUI.

### (d) Тесты — 11 файлов / 111 строк
ai-core: adapters (66), role (9), config (2), docs-guard (2), models (1 — нейтральный пример модели), fake-claude (1). harness: processes (8), docs-delta-roles (6), ops (5), plan-flow (1), fake-claude (1), fake-ops-claude (1). cli: cli.test (7). oc3: guards (1 — память `~/.claude/projects/*/memory`).
Fakes эмулируют контракт `claude -p` (`--mcp-config`, stream-json, `{type:'result', is_error, result, session_id, total_cost_usd}`).

### (e) Expectations — 9 замороженных заголовков
1. `harness.expect.ts:131` — «без --root harness ищет проект вверх от места вызова: первый каталог с .claude»
2. `harness.expect.ts:135` — «нет .claude в проекте — start любого harness не стартует…»
3. `harness.expect.ts:268` — «роль в job — отдельный процесс claude -p; полный stream-json прогона пишется в журнал job»
4. `harness.expect.ts:358` — «команда ai adapters sync — файлы под Claude Code и Codex из AGENTS.md и .agents/»
5. `harness.expect.ts:365` — «адаптеры под инструменты: claude-code и codex — других нет» (Check.adapters, KNOWN_ADAPTERS :913)
6. `harness.expect.ts:368` — warn «adapters sync выключает memory… в Claude Code… в Codex» (якорь @memory-off)
7. `harness.expect.ts:388` — «adapters sync с hooks: [docs-guard] ставит hook ai docs guard в .claude/settings.json…»
8. `roles.expect.ts:55` — «роль запускается изолированно: claude -p без настроек пользователя…»
9. `agent-operational-contract-v3.expect.ts:42` — warn «CLAUDE.md для Claude Code — импорт @AGENTS.md…» (якорь @claude-md-import :274)
Плюс: harness.expect ~32 строки кода проверок (blocked('CLAUDE.md'), settings.json, ARTIFACT_ENTRY `.claude/artifacts/plan-review/...` :2698, HARNESS_CLAUDE :3288, skip `/\.claude/` :2857, mkdir .claude в фикстурах); harness-plan-review.expect (ARTIFACTS :358, mkdir :454); .verdicts.json — 2 вердикта (@memory-off, @claude-md-import); schema enum.

### (f) prompts / skills / прочие слои
- `prompts/productivity/` — 7 файлов, 108 строк (v1/v2 целиком Claude-ориентированы; v3 — 16 строк в производных).
- `prompts/modules/` — 7 файлов, 11 строк (worktrees, ops, ticket-commits, analysis, safety-boundaries, external-context, book-corpus).
- `skills/` — cli (8), worktrees (3), librarian (2), contract-setup (1) + 2 копии: `.agents/skills/` (14), `.claude/skills/` (14).
- `agents/`, `presets/`, `patterns/` — 0.

### (g) README / CHANGELOG
- README корень (2), ai-core README (8), harness README (6); CHANGELOG ai-core (4) + harness (5) — исторические записи; корневой CHANGELOG и AGENTS.md — 0.

### (h) package.json: keywords `claude-code` в ai-core, harness, cli.

### (i) plan-review
- `prompts/planner.md` (2), `design/harness-plan-review.md` (8 — таблицы «Hook Claude Code → событие», «Проверенные факты Claude Code»), `hook.ts` парсит формат hook-событий Claude Code (tool_name, tool_input.*), артефакты `.claude/artifacts/plan-review`.
- Прочее: `.opencode/opencode.jsonc` (1 — deny `~/.claude/projects/*/memory/**`), `docs/pilot.md` (4 — «Claude Code и Codex — пауза, пилот только OpenCode»).

## 2. Кандидаты раннера
- **opencode v2.2.5**: `run --format json --auto --agent <name> --variant`, изоляция `OPENCODE_CONFIG_CONTENT`/`--pure`, агенты `.opencode/agent/<name>.md` (system prompt + tools + permissions), MCP/плагинный tool для submit_result. Нет: `--json-schema`, `--max-turns` (лимит через плагин/таймаут), statusLine.
- **codex**: не установлен, JSON-режим экспериментальный; адаптер в репо есть (`.codex/agents/*.toml`, config.toml memories=false), раннера нет.
- **Recommendation: opencode** — единственный установленный и уже интегрированный (oc3-плагин, opencode.jsonc, пилот по docs/pilot.md), plugin API закрывает hooks и канал результата.

## 3. Hooks → эквиваленты
- docs-guard: покрыт oc3 `permission.hook('evaluate')` (`docsGuard()`); доработка — генерируемые файлы (context/index.yml и будущие производные).
- ops-brief: oc3 event `session.created` + briefing-механика (см. parked-тикет oc3-first-input-briefing).
- ops-line (statusLine): эквивалента нет — снять hook или TUI-плагин.
- FSM-драйвер plan-review: мост на события opencode-плагина (`tool.execute.before` + event).

## 4. Адаптеры при opencode
Новый адаптер `opencode`: генерация `.opencode/agent/<role>.md` из `.agents/agents`, расширение opencode.jsonc; skills opencode читает нативно — копии не нужны. Удаление: `CLAUDE.md`, `.claude/`, claudeMd/claudeAgent/claudeMemory, ветка claude-code в sync, DOCS_FILES/DOCS_DIRS, schema enum, `adapters: [claude-code]`, .gitignore-записи.

## 5. CHANGELOG: журнал решений не переписывается — отказ фиксируется новыми записями ai-core/harness.

## 6. Разрезка на тикеты (тикет = один коммит)
1. `feat(oc3)`: канал submit_result — роль в opencode-прогоне возвращает валидный submit.
2. `feat(harness)`: OpenCodeRunner (`run --format json --auto --agent`, OPENCODE_CONFIG_CONTENT, таймаут/транскрипт) за `HARNESS_RUNNER`, fake-opencode; claude-путь не тронут.
3. `feat(ai-core)`: адаптер opencode — `.opencode/agent/*.md` из ролей, KNOWN_ADAPTERS+schema.
4. `feat(oc3)`: docs-guard поверх генерируемых + ops-brief на session.created.
5. `refactor(harness+cli)`: маркер корня без `.claude`, план-артефакты без `.claude/artifacts`.
6. `refactor(harness)`: plan-review на новом runner + FSM-драйвер из событий плагина.
7. `refactor(ai-core+harness)`: удаление claude-раннера/адаптера/fakes/`.claude/`/`CLAUDE.md`; `grep -ri claude packages/*/src packages/*/test` пуст, ci зелёный.
8. `test(expectations)`: 9 заголовков (правит пользователь) + проверки + свежие вердикты.
9. `docs`: README ×3, skills, prompts/modules, planner.md, design, keywords.
10. `docs(changelog)`: новые записи об отказе; старые не изменены.
Порядок: 1 → 2; 3 ∥ 4; 5 после 3; 6 после 2+4+5; 7 после 2+3+5; 8, 9 после 7; 10 после 7.
