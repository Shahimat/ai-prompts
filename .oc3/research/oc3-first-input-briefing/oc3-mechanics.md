# research: механика oc3 и hooks для «брифинг при первом вводе»

Источники — файлы репо (уверенность высокая, если не указано иное). Записано оператором с отчёта researcher (субагент read-only, артефакт восстановлен дословно по отчёту).

## Ответы

1. **oc3-tools**: `packages/oc3/src/tools.ts:65-171` (TOOLS-массив), регистрация — плагин `Plugin.define({id:'oc3'})` в `packages/oc3/src/index.ts:5-13`; активен при `sync.contract.edition === 'operator-centric'` (`guards.ts:25-37`); подключён через `opencode.jsonc:11` → `"plugins": ["@shahimat/oc3"]`, namespace `oc3` (`tools.ts:177-187`); CLI-дерево — `packages/oc3/src/tree.ts`.
2. **hooks** — Claude Code hooks (не OpenCode): `context/ai-core.yml:2` → `ai adapters sync` ставит в `.claude/settings.json` по `HOOK_SPECS` (`packages/ai-core/src/commands/adapters/memory.ts:51-67`); `KNOWN_HOOKS = ['docs-guard','ops-brief','ops-line']` (`shared/config.ts:32`); docs-guard = PreToolUse на Edit/Write, команда читает stdin (`commands/docs/index.ts:71-86`). Для OpenCode эквивалент — in-process `permission.hook` oc3-плагина (`guards.ts:104-129`).
3. **briefing (mode: roles)**: единственный код-потребитель — `packages/oc3/src/briefing.ts` (CLI `oc3 briefing [set]` + tools `oc3_briefing_show/set`, `tools.ts:95-119`); в harness — ничего; для агента это только текст (skills/workflow, contract-setup, промпт контракта) + judged-ожидание `Check.briefing` (`expectations/skills.expect.ts:102-105`, warn).
4. **Новая oc3-проверка**: логика в `packages/ai-core/src/commands/<область>/` (Diagnostic[] + `report()`, паттерн `roles/index.ts:104-162`) → `registry.ts` → `oc3/src/tree.ts` (OC3_COMMANDS+NODES) → tool в `tools.ts`; тесты `ai-core/test/*.test.ts` + `oc3/test/briefing.test.ts` (готовый пример); пересборка `npm run build` (ai-core → oc3), затем `npm run ci`.
5. **Старт сессии**: единственный автоматический механизм — hook `ops-brief` (SessionStart на startup|resume|compact, `memory.ts:66`); плюс `oc3 init` (ручная проверка установки) и гейт `runGate` (`guards.ts:65-73`) — готовый паттерн deny-subagent.

## Неизвестное

- Инжект сообщения в сессию OpenCode из плагина через `event.subscribe('session.created'|'session.first')` — API подписки есть (`@opencode/plugin/dist/promise/event.d.ts`), канал инжекции текста не найден. Уверенность низкая.

## Рекомендация researcher

- Основная скоба — enforcement в `registerGuards` (`oc3/src/guards.ts`): deny `subagent` executor/judge/researcher, пока нет маркера проведённого брифинга (паттерн runGate).
- Дополнительная — oc3-check фиксации брифинга (паттерн `briefing.ts`).
- Опционально — Claude Code hook по образцу `ops-brief`.
- Hook-вариант один не sufficient: напоминание, не запрет, и не покрывает OpenCode.
