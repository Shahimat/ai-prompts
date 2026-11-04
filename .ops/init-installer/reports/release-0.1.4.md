# report: release step (oc3 0.1.4)

```yaml
done:
  - packages/oc3/package.json: version 0.1.3 → 0.1.4
  - packages/oc3/src/templates.ts: OC3_FALLBACK_PIN 0.1.3 → 0.1.4 (фолбэк установщика держит актуальную версию пакета)
  - пины не тронуты: @shahimat/ai-core остался 0.1.6 в рабочей копии (main поднял до 0.1.7 — сойдётся при merge); CHANGELOG не писал
checks:
  - npm run ci — зелёный (packages-check в том числе; «ожиданий 331 … в бюджете»)
left:
  - publish @shahimat/oc3@0.1.4 — после merge, релизный каскад оператора
risks:
  - до publish установщик в свежих проектах запишет пин 0.1.4, которого ещё нет в npm; после publish сойдётся
refs:
  - git diff worktree: packages/oc3/package.json, packages/oc3/src/templates.ts
```
