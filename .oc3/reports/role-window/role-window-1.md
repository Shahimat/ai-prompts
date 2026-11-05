# role-window — отчёт executor (run 1 перед judge)

## done
- `oc3 init --roles <список>`: валидация по встроенному набору (researcher, executor, judge, librarian; регистр/повторы срезаются), пишет `.agents/agents/<роль>.md` (снимки канона, повторный запуск не перетирает) и `context/skills.yml` — пресет operator-centric по ролям с шапкой generated и merge-семантикой.
- Пресет привязок (SKILL_PRESET в templates.ts): research→researcher; executor→executor; judge→judge; librarian→librarian; domain, manuals→выбранным (пересечение); operator-feedback→operator; workflow, contract-setup, source-sync, cli — без привязки. Filter-семантика: в запись попадают только выбранные роли (domain при `--roles researcher` → `[researcher]`).
- Повторный merge: недостающие записи дописываются; записи, совпадающие с любым рендером пресета (то есть записанные им и не правленные), обновляются при расширении списка ролей; пользовательские записи и правки — не трогаются никогда; скелет `skills: []` разворачивается в блочный список; битый YAML не переписывается.
- Снимки ролей: researcher/executor/judge/librarian из `agents/<name>.md` источника, встраивы в templates.ts (ROLE_AGENTS); watch-request/watch-triage не встраивались. Проверено diff'ом против канона — байт-в-байт.
- Без флага: humanQuestions п.5 — окно ролей с дефолтом и точной командой повтора `oc3 init --roles researcher,executor,judge,librarian`; формулировка «потом» отсутствует. С флагом вопрос не задаётся.
- watch-request/watch-triage в --roles: отказ (exit 2) с подсказкой «подключи модуль watchers через contract-setup».
- Синхронизация дрейфа templates.ts: SCENARIOS — фразы-маршруты + «фиксируй ожидания»→goals/*.expect.ts (как в каноне v3); OPERATOR_SECTION — первой строкой брифинг-буллет с «"быстро" и "просто глянь" не отменяют»; SKILLS_YML — валидный скелет `skills: []` (был битый `roles: {}`); AI_CORE_FALLBACK_PIN → '0.1.7'. OC3_FALLBACK_PIN и версии пакетов не тронуты.
- Дополнение 1 (детект): scanPluginWiring — разбор JSONC (parseJsonc: stripper `//` и `/* */` вне строк + JSON.parse, fallback — yaml) всех CONFIGS, проверка массива plugins. Ключ `plugin` (даже с пакетом) → состояние не v3-ok + деталь «плагин не загрузится — ключ plugin вместо plugins (нужен plugins)»; plugins без пакета → «в plugins нет "@shahimat/oc3"». readinessProblems в init.ts переведён на тот же helper. ensurePluginEntry — тот же баг подстроки: на ключе `plugin` рапортовал «подключён»; теперь отличает plugins/plugin, добавляет корректный `plugins` и называет причину (см. risks — за рамками буквы дополнения).
- Дополнение 2 (манифест): CORE_MANIFEST в templates.ts (skills 11 + agents 4, порядок из задания); humanQuestions печатает оба списка и пометку «SHA заполнят первые source-sync update; до них части считаются не скачанными (sync.contract.parts: {})». Консистентность манифеста с SKILL_PRESET и ROLE_NAMES — тестом.

## checks
- `npm test -w @shahimat/oc3` — 109 passed (roles.test.ts 16: пресет по ролям, merge/скелет/битый YAML, отказ watch, валидация списка, снимки; install.test.ts +5: plugin-ключ, plugins-без-пакета, JSONC-комментарии, манифест в отчёте, CORE_MANIFEST≡пресет; operator-agent.test.ts +5: ensurePluginEntry).
- `npm run ci` — зелёный (exit=0): format, build ×4, typecheck ×7, oxlint, тесты 210+78+35+109, packages-check, index:check, expectations «в бюджете» (crit 0 · warn 4 · info 4).
- Smoke на собранном dist: init без флага — окно ролей и манифест в выводе; `--roles researcher` → 8 привязок; повтор с полным списком → domain/manuals расширены, +3 записи, 11 итог; `--roles watch-request` → exit 2 с подсказкой; `--roles batman` → exit 2 с перечнем; ключ `plugin` в конфиге → состояние не v3-ok, ensurePluginEntry дописал корректный `plugins`; снимки ролей diff'ом = канону.
- `oc3 roles check` на смоук-проекте — ok.

## left
- Пункт expectations «skill source-sync: окно ролей сразу после установки» — оператора (его правка skills/source-sync/SKILL.md уже в ветке).
- Релизный цикл (версии/пины пакетов) — после приёмки, по заданию.

## deviations (отступления от плана, с причинами)
- `prompts/index.yml` пересобран (`npm run index:build`): CI падал на рассинхроне, вызванном правкой оператора skills/source-sync/SKILL.md в этой же ветке (SHA в индексе отстали от дерева, diff = 3 строки: generated_at + 2 SHA). «Не трогай prompts/» читаю как запрет на авторский контент; пересборка производного файла — механика по правилу «index в том же коммите». Раскрываю явно.
- ensurePluginEntry починен сверх буквы дополнения 1: тот же подстрочный ложный позитив («подключён» на ключе `plugin`) означал, что init никогда не чинил конфиг из кейса. Без этого детект честен, а установка — нет.
- parseJsonc вместо голого yaml-parse: `//` — не YAML-комментарии, yaml их либо бросает, либо читает как мусорный ключ; stripper + JSON.parse с yaml-fallback надёжнее допущения из задания.
- Merge-семантика пресета: пересечение ролей в записях (иначе «отфильтрованными по ролям» не реализуется для domain/manuals) и обновление нетронутых пресетных записей при расширении списка (иначе повторный прогон не достраивает ядро).

## risks
- Записи skills.yml с ролями, введёнными пользователем вручную в форме пресета для другого подмножества (совпали с рендером пресета), будут обновлены при повторном прогоне — семантика «нетронутое пресетное обновляется»; на полностью пользовательские записи не распространяется.
- `skills check` до первого source-sync будет помечать отсутствующие SKILL.md синхронизированных skills — ожидаемое состояние до синка, не дефект.
- ensurePluginEntry при ключе `plugin` добавляет `plugins`, но не удаляет устаревший ключ — удаляет пользователь (сообщение это говорит); token-хирургия удаления сочтена рискованной.

## refs
- worktree: /mnt/dev/my/prj/ai-prompts/.opencode/worktrees/entry-roles-2 (ветка entry-roles-2)
- diff: packages/oc3/src/{templates,install,init,cli,tree,operator-agent}.ts, packages/oc3/test/{roles,install,operator-agent}.test.ts, prompts/index.yml
- цель: goals/entry-roles.expect.ts (тикет role-window, 7 crit после двух дополнений)

## judge
- Запуск judge (run 1) отклонён гейтом: «goals/harness-reliability.expect.json — попытка завершена (2 run'а); повторный цикл — только retry: true от оператора». Вердикты не писались, expectations не прогонялись судьёй; самопрогон expectations не делал (не моя зона). Решение о judge/повторном цикле — за оператором.

## релизный шаг (дополнение оператора)
- packages/oc3/package.json: 0.1.4 → 0.1.5; package-lock.json синхронизирован (npm install).
- OC3_FALLBACK_PIN (templates.ts) → '0.1.5'; пин ai-core 0.1.7 и версии ai-core/cli/harness не тронуты; CHANGELOG не писал (librarian отдельно).
- npm run ci — зелёный (exit=0), тесты 210+78+35+109, expectations в бюджете.
