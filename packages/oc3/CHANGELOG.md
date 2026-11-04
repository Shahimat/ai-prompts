# CHANGELOG

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
