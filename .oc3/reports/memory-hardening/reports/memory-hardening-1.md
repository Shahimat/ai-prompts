# memory-hardening — отчёт executor (прогон 1)


```yaml
done:
  - checkMemory: вес файла вне 0..9 — crit «<файл>: вес N вне 0..9 — вес — кольцо графа, не важность; назначь 0 общим фактам (инлайн в старт), 1 — старт-файлам веера, 2..9 — кольца» (packages/ai-core/src/lib/memory.ts, проверка после loadManifest; веса 20/85/100 проходят схему — integer minimum 0 без максимума — и ловятся здесь)
  - checkMemory: все файлы манифеста с весом >1 — crit «оперативная память пуста: назначь вес 0 общим фактам, 1 — старт-файлам» (пустой files не триггерит — валидный набор из тестов остаётся зелёным)
  - Рендер index узла — каталог: nodeBody больше не инлайнит текст факта, строка одна — «- [rel](../doc/rel) — пояснение»; пояснение = summary факта, обрезается по байтовому cap budgets.summary (новое поле MemoryBudgets, дефолт 200, парс из budgets.summary с fallback); многобайтовая обрезка безопасна (utf8), хвост «…»; полей в схему манифеста кода не добавлял — install-скелет (packages/oc3/src/install.ts) пишет прежние 4 бюджета, чтобы не падать на развёрнутых схемах
  - Unit-тесты: вес 100 → crit «кольцо графа»; веса 3+2 → crit «оперативная память пуста»; длинный факт при budgets.summary=80 → пояснение ≤80 байт с «…», полный текст отсутствует, ссылка на файл ровно одна; обновлены DEFAULT_BUDGETS-проверка и тест «renderGraph renders» (узел — каталог, тело manuals не инлайнится)
checks:
  - npm test по всем 4 пакетам — зелёные (237+136+37+78)
  - npm run ci (format, build, typecheck, lint, тесты, packages:check, index:check, memory:check, expect) — exit 0, crit 0, лог /tmp/opencode/ci-memory-hardening.log
  - Живой смоук CLI на /tmp/opencode/mh-smoke: weight 100 → memory check code=1 с обоими crit; веса 3/2 → crit «оперативная память пуста»; каталог-узел рендерится одной строкой на файл, memory check ok
left:
  - budgets.summary отклоняется реальной схемой .oc3/doc/data/__schemas/manifest.schema.json (budgets.additionalProperties: false) — поле не добавлено в схему: .oc3/doc/ вне скоупа тикета; docs_request librarian: добавить summary: integer minimum 1 в properties.budgets манифест-схемы (и в развёрнутые проекты), после этого cap можно задавать в манифесте; до тех пор действует дефолт 200
risks:
  - Смена рендера меняет sha узлов → при первом build у потребителей все узлы перезапишутся под новыми каталогами (writeGraph удаляет стухшие) — ожидаемое поведение, но первый прогон покажет «стух» на чужих бандлах до build
  - Веса вне 0..9 блокируют и memory build (checkMemory входит в build) — манифесты пилота с весами 20–100 не соберутся, пока веса не приведены к 0..9: это и есть цель харденинга
refs:
  - Worktree .opencode/worktrees/memory-hardening-2, diff: packages/ai-core/{src/lib/memory.ts,src/lib/memory-graph.ts,test/memory.test.ts,test/memory-graph.test.ts} (4 файла, +132/−11)
  - Отчёт .oc3/reports/memory-hardening/reports/memory-hardening-1.md
```

Сообщение коммита (одно, на пользователя):

```
feat(memory): ring weights 0..9 and catalog node index

- checkMemory rejects file weights outside 0..9 with ring-graph hint
- checkMemory flags manifests with no files of weight <=1 as empty RAM
- node index is a catalog: file link plus one-line summary capped by budgets.summary (new budget, default 200), no full fact text inlined
- unit tests for weight-100 crit, empty-start crit, long-fact capping, no duplication
```

# Фоллоуап: дефолт cap старта 10240 → 24576

```yaml
done:
  - DEFAULT_BUDGETS.start = 24576 (packages/ai-core/src/lib/memory.ts) — единственный источник кода; packages/oc3/src/install.ts значения не содержит (берёт DEFAULT_BUDGETS.start), не менялся
  - Значения в тестах: memory.test.ts ×5 (включая assert DEFAULT_BUDGETS), memory-graph.test.ts ×4, memory-skeleton.test.ts ×1, migrate.test.ts ×1; ключ budgets.start не менялся
checks:
  - grep 10240 по packages/scripts/expectations — 0 вхождений в исходниках (dist пересобран ci, ignored)
  - npm run ci — exit 0, crit 0 (лог /tmp/opencode/ci-start-cap.log)
  - живой смоук CLI: без budgets в манифесте сообщение о превышении показывает cap 24576; явный start: 10240 продолжает резать по 10240 — обратная совместимость сохранена
left:
  - judge повторно не запускал: правка не входит в формулировки .oc3/goals/memory-hardening.expect.ts; формулировку crit про 24576 в memory-graph.expect.ts и поле summary в manifest.schema.json обновил оператор (staged правки оператора в worktree, не мои)
risks:
  - начальных проектов со стартом 10–24 КБ, собранных со стухшим cap, первый build уведомит о превышении уже по 24576 — поведение согласовано с новой формулировкой цели
refs:
  - diff: packages/ai-core/src/lib/memory.ts + 4 тест-файла (6 файлов против прошлого прогона, суммарно с фоллоуапом)
