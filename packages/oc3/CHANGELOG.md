# CHANGELOG

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
