# CHANGELOG

## 0.1.7

- Миграция плоской `.oc3/`: runtime и guards используют
  `.oc3/project.yml`, `.oc3/data/`, `.oc3/manuals/` и
  `.oc3/conventions/` вместо `.oc3/doc/*`. Это изменение раскладки,
  не новый major контракта: контракт остаётся v3.
- `oc3 migrate` поддерживает прежнюю `.oc3/doc/` и более старые
  `context/`, `docs/`, `goals/`, `.ops/`; удаляет упразднённый
  `index.yml`, обновляет пути и ключ проверки `context-index` → `context`.
  Коллизии переноса не перетираются, а попадают в legacy-отчёт.
- `init` и миграция создают скелет манифеста памяти и NOTES без
  перезаписи существующих пользовательских данных; seal и стартовая
  память сессии согласованы с плоскими путями и pending-проекцией.
- Tools моделей поддерживают проектный `manifest.json` и `models check`;
  без manifest остаётся legacy-режим. Knowledge tools и `submit_result`
  принимают knowledge delta через общий inbox, без прямой записи в канон.
- Execution artifacts, включая plan-review bridge и результаты ролей,
  размещаются через общий resolver в `.oc3/`; миграция сохраняет
  историческое evidence, не превращая старый PASS в актуальный.
- Пины установщика: `@shahimat/ai-core` 0.1.9, `@shahimat/oc3` 0.1.7.
- Native context использует общий validated memory ensure полного file-set
  и для seen sessions: обновляет изменившийся start, восстанавливает
  missing/stale projections/pages. Failed injection не отмечается как
  success-seen; memory seal, namespace, weights и budgets сохраняются.

## 0.1.6

- Память-сезл: чтение под `.oc3/` — deny по умолчанию; librarian —
  полный доступ, остальным ролям — белый список (bundles, goals,
  research, reports, verdicts, operator, locks, sessions, submit,
  skills.yml, ai-core.yml); `.oc3/doc/**` и manifest — сообщение
  «читает только librarian; агентам — бандлы».
- `.oc3/manifest.json` — ручка графа памяти: namespace и веса файлов,
  data-разделы, бюджеты notes/start/node/optional_field; манифест
  правит librarian, граф собирается только из него.
- `oc3 migrate`: переезд старой раскладки в `.oc3/` (context/ → doc,
  docs/ → data|manuals|knowledge, goals, .ops — плоско) — rename
  байт-в-байт, префиксы в ai-core/skills/ops.yml, .gitignore, отчёт
  legacy-хвостов; `oc3 init` детектит старую раскладку и мигрирует
  перед проверкой состояния.
- Оператор-агент и брифинг на новых путях: режим проекта —
  `.oc3/doc/project.yml`, ack брифинга —
  `.oc3/sessions/<sessionID>.briefing`; после строки брифинга сессии
  вшивается стартовый граф памяти (build-if-stale, один экземпляр
  на сессию).

## 0.1.5

- Окно ролей: `oc3 init --roles <список>` валидирует роли встроенного
  набора (researcher, executor, judge, librarian), пишет
  `.agents/agents/<роль>.md` — снимки канона, повторный запуск не
  перетирает — и `context/skills.yml` с пресетом привязок
  operator-centric; без флага — вопрос в установщике с дефолтом и
  точной командой повтора; watch-request/watch-triage — отказ с
  подсказкой подключить watchers.
- Merge skills.yml без перетирания: недостающее дописывается,
  нетронутое пресетное обновляется при расширении списка, правки
  пользователя не трогаются, битый YAML не переписывается;
  SKILLS_YML исправлен — валидный скелет `skills: []` вместо битого
  `roles: {}`.
- Детект конфигурации плагина: ключ `plugin` (вместо `plugins`) и
  `plugins` без пакета переводят состояние из v3-ok с пояснением
  («плагин не загрузится»); ensurePluginEntry отличает ключи и
  дописывает корректный `plugins`; разбор конфигов — JSONC
  (комментарии, `$schema`).
- Манифест ядра в отчёте установщика: CORE_MANIFEST — 11 skills,
  4 агента, с пометкой, что SHA заполнят первые source-sync.
- Шаблоны AGENTS.md синхронизированы с каноном: фразы-маршруты
  сценариев с маршрутом целей, брифинг-буллет с «"быстро" и "просто
  глянь" не отменяют».
- Пины шаблонов: `OC3_FALLBACK_PIN` — 0.1.5,
  `AI_CORE_FALLBACK_PIN` — 0.1.7.

## 0.1.4

- Гейт брифинга: до вызова `oc3.briefing_done` плагин запрещает сессии
  bash/edit/write/subagent с подсказкой спросить схему работы;
  проведённый брифинг — state-файл
  `.ops/sessions/<sessionID>.briefing`; чтение не блокируется,
  сабагентные сессии не режутся, сбой RPC — fail-open.
- Оператор-агент: `oc3 init` создаёт `.opencode/agents/operator.md`
  (mode: primary, маршрутизирующий промпт) и пишет `"default_agent":
  "operator"` в opencode.json(c) — merge текстом JSONC сохраняет
  комментарии, `$schema` и чужой default_agent (подсказка о ручном
  переключении); повторный запуск идемпотентен.
- Установщик-мигратор: `oc3 init` называет состояние — nothing, v2
  detected, v3 partial, v3 ok — и пишет установку из шаблонов пакета,
  без сети: AGENTS.md append-only merge, каркас `context/`, devDeps
  точными пинами, конфиг с плагином, git-файлы без дублей, лок
  `.ops/locks/install`; вопросы человеку — нумерованным списком;
  перенос v2 — отчёт миграции на stdout, без молчаливой конверсии;
  `runtime: full|degraded` в `context/project.yml`, degraded — только
  при недоступном npm.
- Фолбэк установщика `OC3_FALLBACK_PIN` — 0.1.4.

## 0.1.3

- `submit_result` (tool oc3-плагина): роль в opencode-прогоне возвращает
  итог — сообщение протокола (result, verdict, question) валидируется по
  схеме и пишется в файл результата роли.
- `ops-brief`: стартовая сводка `ai ops brief` дописывается к первому
  запросу сессии — раз на сессию.
- `plan-bridge` и `plannerGuard`: события FSM plan-review из событий
  плагина пишутся в `.opencode/artifacts/plan-review/bridge.json`,
  правки планера в чужие файлы отклоняются.
- `generatedGuard`: правка сгенерированного (`context/index.yml`,
  `.opencode/agents/`) отклоняется — правь источник и пересобери.
- `@shahimat/ai-core` 0.1.6.

## 0.1.2

- `oc3 models apply` и tool `oc3_models_apply`: применяют
  `roles.models` из `context/project.yml` к файлам ролей и производным —
  восстановление override после source-sync.
- `oc3 models set` / `oc3_models_set`: любая модель каталога OpenCode
  (`provider/model[#variant]`, включая бесплатные); override сохраняется
  в `context/project.yml` → `roles.models`.

## 0.1.1

- `oc3 briefing` и `oc3 briefing set` + tools `oc3_briefing_show`/
  `oc3_briefing_set`: режим работы сессии из `context/project.yml` →
  `briefing` (cheap | roles | custom с полями).
- docs guard: маркер установки `.ops/locks/install` снимает охрану;
  охраняется только корневой `CHANGELOG.md`; docs-области — по префиксу,
  без вложенных совпадений; `oc3 init` предупреждает о незакрытом маркере.

## 0.1.0

- первый выпуск: плагин OpenCode (активация по `sync.contract.edition: operator-centric`, docs guard, memory guard, гейт прогонов judge), tools `oc3_*`, bin `oc3` (models, goals, operator, roles, skills, adapters, expect report, init).
- `oc3 briefing` и `oc3 briefing set` + tools `oc3_briefing_show`/
  `oc3_briefing_set`: режим работы сессии из `context/project.yml` →
  `briefing` (cheap | roles | custom с полями).
- docs guard: маркер установки `.ops/locks/install` снимает охрану;
  охраняется только корневой `CHANGELOG.md`; docs-области — по префиксу,
  без вложенных совпадений; `oc3 init` предупреждает о незакрытом маркере.
