# memory-seal — отчёт 1

## done
- Гвард чтения `memorySeal` в packages/oc3/src/guards.ts: любой путь под .oc3/ —
  deny по умолчанию; librarian — полный доступ к памяти; остальным ролям разрешён
  только белый список OC3_READABLE (bundles/, goals/, research/, reports/,
  verdicts/, operator/, locks/, sessions/, submit/, skills.yml, ai-core.yml);
  .oc3/doc/** и .oc3/manifest.json — отдельное сообщение seal «читает только
  librarian; агентам — бандлы».
- Seal подключён в registerGuards на действия read/grep/glob (до write-гвардов);
  пути вне .oc3/ не затрагиваются; абсолютные/относительные пути нормализуются.
- Белый список — экспортированная константа OC3_READABLE: расширение — явная
  правка гварда; тест фиксирует состав списка (молчаливое расширение ловится).
- Write-сторона согласована: .oc3/manifest.json добавлен в DOCS_AREAS (правит
  librarian, как и .oc3/doc/, .oc3/modules/, .oc3/.delta, skills.yml, ai-core.yml,
  ops.yml).
- Тесты на каждую роль (guards.test.ts): librarian — факты/манифест/modules/NOTES
  доступны; executor/judge/researcher/main/безымянный — факты и манифест deny,
  белый список allow, modules//feedback//NOTES.md deny «вне белого списка»;
  .oc3x не матчится; grep/glob-действия под тем же seal.

## checks
- vitest oc3 124/124 (новых 7), ai-core 209/210 (красный — только
  prompts/index.yml оператора), harness 78/78, cli 35/35.
- npm run build, typecheck, lint, format — зелёные.

## left
- Ничего в скоупе тикета; общий красный хвост prompts/index.yml — вне тикета
  (параллельная правка оператора).

## risks
- Роли без имени (undefined) подпадают под seal — намеренно (консервативнее).
- .oc3/.delta, .oc3/modules, .oc3/feedback, .oc3/watches, .oc3/jobs,
  .oc3/baseline, NOTES.md не в белом списке: librarian читает их как хранитель
  памяти, остальные — нет; если оператору нужен прямой чит доступ (например
  feedback) — явная правка OC3_READABLE с обоснованием.

## refs
- Worktree: .opencode/worktrees/memory-graph
- packages/oc3/src/guards.ts (memorySeal, OC3_READABLE, registerGuards),
  packages/oc3/test/guards.test.ts
