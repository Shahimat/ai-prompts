# report: operator-agent (run 1)

```yaml
done:
  - oc3 init создаёт .opencode/agents/operator.md (mode: primary; промпт только маршрутизирующий: маршрут/правила/сценарии — AGENTS.md, брифинг и протоколы — skill workflow, первое сообщение сессии — брифинг схемы, после ответа — oc3.briefing_done)
  - init пишет "default_agent": "operator" в opencode.json(c) проекта: merge на уровне текста JSONC (комментарии и $schema сохраняются), при отсутствии конфига создаётся opencode.jsonc с $schema + default_agent
  - повторный запуск идемпотентен: шаблон operator.md — «без изменений»; пользовательские правки — «не перетираю»; чужой default_agent — сохраняется с подсказкой переключения вручную; поведение описано в выводе команды (проверено дымовым прогоном init в песочнице /tmp/opencode/oc3-smoke: создание → повтор → правки пользователя)
  - CONFIGS перенесён в operator-agent.ts (init импортирует, цикла нет); эффект команды init в CLI-дереве сменён query → mutation (init теперь мутирует .opencode/agents и opencode.jsonc)
checks:
  - npm run ci (format, build, typecheck x4, lint, тесты x4, packages-check, index-check, expectations) — зелёный, «в бюджете»
  - vitest oc3: 58 тестов x 9 файлов; новые operator-agent.test.ts — генерация, повторный запуск, чужой default_agent, JSONC-комментарии, вложенный/строковый default_agent не считается верхнеуровневым
left:
  - приёмка judge (run 1)
risks:
  - JSONC-merge текстовый: ключ внутри строки/вложенного объекта не принимается за верхнеуровневый (тест есть), но экзотические формы (ключ как escape-строка) не разбираются
refs:
  - git diff в worktree contract-entry (файлы: packages/oc3/src/{operator-agent.ts,init.ts,tree.ts}, packages/oc3/test/operator-agent.test.ts)
```
