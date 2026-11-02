# CHANGELOG

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
