---
key: agent-operational-contract-v3
kind: contract
title: Операционный контракт агента v3 — оператор, роли, цели
patterns: [source-sync]
tags: [docs-as-code, workflow, agent-contract, agents-md, skills, roles, goals, operator]
use_case: Скармливается AI-агенту одной ссылкой, чтобы развернуть в проекте оператор-центричный контракт v3 — тонкий AGENTS.md с протоколом оператора, роли researcher/executor/judge/librarian и external-executor, плоские goals/ с целями и программами, формальные сообщения, реестр skills в context/skills.yml, browser-capability, autonomy и пресеты. Harness, ops и watchers — опциональные модули для headless-задач.
---

# Операционный контракт агента v3 — оператор, роли, цели

## TL;DR

- **Центр — оператор, не автомат.** Одна primary-сессия держит
  приоритеты, план, распределение и отчёт; строгость — на краях: схемы,
  permissions, проверки, бюджеты, locks.
- **Точка входа — `AGENTS.md`:** маршрут, семь жёстких правил, сценарии,
  протокол оператора. `CLAUDE.md` — одна строка `@AGENTS.md`.
- **Роли:** `researcher`, `executor`, `judge`, `librarian`;
  `external-executor` — external-пресет. `oracle` и `reviewer` не
  существуют: быстрый ответ — researcher, оценка DoD — judge.
- **`goals/` вместо очереди:** плоские `goals/<goal>.expect.ts` и
  `goals/program--<key>.expect.ts`; программа импортирует свои цели,
  приоритет — порядок импортов, тикет — `describe('ticket: …')`.
- **Фон и модели.** Оператор запускает роли только в фоне; модели —
  GLM-5.3 (`zai/glm-5.3#max`), judge — FlashX `#low`, override —
  `ai models set`; бесплатные запрещены. Executor запускает judge и
  researcher (≤2 на тикет), глубина 2.
- **Результаты.** Рядом с `*.expect.ts` — `*.expect.json`: run 1
  `pass`/`fail`, run 2+ негатив «satisfactorily»; 80% `pass` по
  `crit`/`warn` активного тикета, один повторный цикл; judge всегда
  свежий, сверх двух run'ов (с `retry: true` — трёх) — гейт.
- **Skills — ролям.** Оператор не загружает ролевые skills; исключения —
  `operator-feedback` и явный `browser-read`. Привязка — `roles` в
  `context/skills.yml`. Документацию пишет только librarian.
- **Memory агента запрещена.** Устойчивое — в репозитории; локальные
  state, locks и event log — явные кэши без решений. Harness, ops и
  watchers — модули headless-рантайма, не центр интерактивной работы.

## Источник

<!-- expect:single-link -->
Точка входа — одна ссылка: «Разверни контракт <raw-URL>». Остальное —
skills, роли, модули, пресеты — ты берёшь сам по индексу источника;
пользователю пересылать ссылки не нужно.

Индекс: `https://raw.githubusercontent.com/Shahimat/ai-prompts/main/prompts/index.yml`.
Группы: `contracts`, `modules` (`applicable_to`, `feature`), `skills`
(`files`, `raw`, `sha256`), `agents`, `presets`.

Скачивание — только `curl` (раздел «Синхронизация с источниками»). SHA
каждого файла сверяй с индексом; не совпал — стоп, сообщи пользователю.
<!-- /expect:single-link -->

## Что ставит ядро

```
AGENTS.md                          ← протокол оператора, маршрут, правила
CLAUDE.md                          ← @AGENTS.md
CHANGELOG.md                       ← журнал решений
package.json                       ← devDependencies: @shahimat/cli, @shahimat/ai-core
.gitattributes                     ← eol=lf, CHANGELOG.md merge=union
.gitignore                         ← .ops/operator/, .ops/locks/ — локальные
context/
  project.yml                      ← реквизиты, reality, external, sync, roles.exceptions
  ai-core.yml                      ← конфиг CLI: adapters, hooks, checks
  autonomy.yml                     ← единственный источник self/ask/never
  skills.yml                       ← каталог skills, requires, permissions, roles
  index.yml                        ← карта документации (генерирует ai)
  conventions/<key>.yml            ← договорённости проекта
  modules/<key>.yml                ← manifest'ы возможностей
.agents/
  skills/                          ← core-skills и project-skills
  agents/                          ← роли: frontmatter + промпт
goals/                             ← цели и программы: *.expect.ts и *.expect.json
```
Роли `operator` нет: оператор — primary-сессия, его `kind` и `lifecycle`
фиксирует контракт, протокол — в `AGENTS.md`, allowlist skills — в
`context/skills.yml`. `context/roles.yml` не создаётся: роль — один файл
`.agents/agents/<name>.md`.
Канон для всех агентов — `AGENTS.md` и `.agents/`; файлы под инструмент
(`CLAUDE.md`, `.claude/`, `.codex/`, `.opencode/`) — производные.

<!-- expect:no-rule-copies -->
Правила самого контракта в `context/conventions/` **не копируются**.
Там — только договорённости проекта; правила контракта живут в
`AGENTS.md` и skills и обновляются через source-sync.
<!-- /expect:no-rule-copies -->

### `context/project.yml`

```yaml
name: <project>
summary: <одна строка — что за проект>
stack: [<lang>, <framework>]
reality: [this-repo]              # где правда о «как сейчас»
preset: <key пресета, если выбран>
namespaces: {<namespace>: <описание>}
external: {<name>: <url или указатель>}
roles: {exceptions: []}           # core-роли, заменённые пресетом
sync:
  index_source: https://raw.githubusercontent.com/Shahimat/ai-prompts/main/prompts/index.yml
  index_sha: <hex>
  contract:
    key: agent-operational-contract-v3
    edition: operator-centric
    synced_sha: <hex>
    parts:
      skills: {contract-setup: <hex>, workflow: <hex>, librarian: <hex>}
      agents: {researcher: <hex>, executor: <hex>, judge: <hex>, librarian: <hex>}
```

`edition: operator-centric` — маркер редакции: плагин и адаптеры
активируются только при нём; старый v3 без маркера не затрагивается.
`reality` — источник правды о «как сейчас»: `this-repo` или ключи
`external`. Документ и источник реальности расходятся — прав источник.
Новый namespace — только с явного «да» пользователя.

### `context/autonomy.yml`

Единственный источник уровней; пресет может задать дефолты, но
установщик пишет их сюда. В `skills.yml` уровней нет.

```yaml
levels:
  self: [browser.navigate, browser.snapshot, browser.screenshot]
  ask: [browser.submit, vcs.publish]
  never: [vcs.write]
domains:
  <domain>: ask
```

Действие — `<интерфейс>.<метод>` (`tasks.update`, `vcs.publish`,
`browser.submit`), `<интерфейс>.write` или интерфейс целиком. `@<цель>` —
уровень для одной цели. Не перечислено — `ask`. Git-запись
(`vcs.write`) — `never`: её делает пользователь; исключение —
`vcs.publish@<репозиторий>`, явно разрешённое пользователем. Репозиторий
проекта — всегда `never`. Новое `self` — только решением пользователя.

### `context/skills.yml`

Реестр skills: что установлено, какие tools и permissions нужны, каким
ролям привязано. `roles` — единственный runtime-источник привязки;
пресет `role_skills` — install-time вход, установщик инвертирует его в
эти записи.

```yaml
skills:
  - key: browser
    kind: core
    source: ai-prompts
    path: .agents/skills/browser
    sha: <hex>
    requires: {tools: [browser]}
    permissions: [browser.navigate, browser.snapshot, browser.screenshot, browser.click, browser.type, browser.submit]
    roles: [executor, external-executor]
  - key: browser-read
    kind: core
    source: ai-prompts
    path: .agents/skills/browser-read
    sha: <hex>
    requires: {tools: [browser]}
    permissions: [browser.navigate, browser.snapshot, browser.screenshot]
    roles: [judge, researcher]
  - key: operator-feedback
    kind: core
    source: ai-prompts
    path: .agents/skills/operator-feedback
    sha: <hex>
    roles: [operator]
```

Роль без записей в `roles` skills не получает. У оператора допустимы
только `operator-feedback` и, как явное исключение, `browser-read`;
любая другая запись с `roles: [operator]` — ошибка валидатора.

### `context/conventions/<key>.yml` и `.gitattributes`

Одно правило — один файл: `key` (kebab-case, совпадает с именем файла),
`summary` одной строкой и `rule`. `key` стабилен. В `.gitattributes` —
`* text=auto eol=lf` и `CHANGELOG.md merge=union`: параллельные ветки не
конфликтуют на вставке записи в начало журнала.

## Шаблон `AGENTS.md`

<!-- expect:agents-md-readonly -->
Бюджет — до 150 строк и 8 KiB вместе с блоками модулей: Codex читает
`AGENTS.md` всей иерархии в пределах 32 KiB. Разрастается — содержимое
уезжает в skill или слой.

Шаблон (подставь `<…>`, остальное — дословно):

````markdown
# <project>

<Одна строка о проекте.> Человеку — `README.md`.

## Где искать ответ

- как сейчас устроено X → источник реальности (`context/project.yml` → `reality`: код репозитория или целевые системы); почему X → `CHANGELOG.md`, затем `git log`;
- как договорились → `context/conventions/<key>.yml`; реквизиты, namespaces, external, roles.exceptions → `context/project.yml`;
- цели, программы, тикеты → `goals/`; роль, skills, browser, autonomy → `.agents/agents/`, `context/skills.yml`, `context/autonomy.yml`; возможности → `context/modules/*.yml`.

Полный обход `docs/`, `context/` и `goals/` запрещён: иди по маршруту.

## Жёсткие правила

1. Перед правкой — прочитай документы по маршруту задачи.
2. Memory агента запрещена: «запомни» — это `docs_request` librarian, а не память инструмента.
3. Внимание пользователя — самый дорогой ресурс: вопрос — только когда без решения нельзя продолжить или откатить.
4. Документацию пишет только librarian по `docs_request`: оператор, executor и judge её читают; генерируемое меняет `ai`.
5. Ничего не создавать, не переносить, не удалять без явного «да».
6. Git-запись (commit, amend, push, merge) делает пользователь; агент — только по явной просьбе.
7. Тяжёлая работа — ролям; действие наружу — по `context/autonomy.yml`; ролевые skills оператор не загружает.
Блоки возможностей ниже обязательны наравне с этими правилами.
## Сценарии

`plan` — «предложи»; `execute` — «делай»; `audit` — «проверь»; `challenge` — «покритикуй»; `report` — «статус». Протоколы — skill `workflow`.

## Оператор

- одна primary-сессия: приоритеты — порядок импортов программ и указания пользователя; пишет `goals/`, `.ops/operator/state.yml`, `.ops/feedback/`, сбрасывает `*.expect.json`, не пишет `docs/`, `context/`, `CHANGELOG.md`, код;
- роли запускает только с `background: true`; не блокируется и остаётся доступен человеку, просыпается на результате или сообщении;
- цель — `goals/<goal>.expect.ts`, программа — `goals/program--<key>.expect.ts`, тикет — `describe('ticket: …')`; один активный тикет на цель, paused — `crit.wip`;
- ролям — `brief` до 15 строк, от них — `report`; judge — `verdict`, librarian — `docs_request`; researcher от оператора — сколько угодно, от executor — ≤2 на тикет; executor — ≤5 активных (paused не считается); librarian — один;
- worktree и merge — оператор; external публикует по autonomy; проверки — в скоупе цели или программы; фидбек — skill `operator-feedback`.

## Skills

- ролевые skills — в `.agents/skills/`, привязка — `context/skills.yml`; оператор — только `operator-feedback` и явный `browser-read`; браузер — `browser` у executor, `browser-read` у judge и researcher.

<!-- блоки возможностей ниже добавляет contract-setup -->
````

Блоки модулей добавляются в конец между маркерами
`<!-- module:<key> -->` и `<!-- /module:<key> -->`. Модуль пишет только
в свой блок; блок — до 5 непустых строк с заголовком, у модулей с
`guardrail-dual-level` — до 8: маршруты, skills и правила модуля.
<!-- /expect:agents-md-readonly -->

## Документация проекта

<!-- expect:docs-readonly -->
В операторе, executor и judge файлы проектной документации только
читаются. Правки `docs/`, `context/` и `CHANGELOG.md` делает librarian по
формальному `docs_request`: что зафиксировать, зачем, evidence, слой,
критерий готовности. Намерения — `decision`, `fact`, `rule`,
`behavior-change`, `task`, `manual`, `revise`.

Librarian проверяет целостность: ссылки, id, схемы, orphans, дубли,
маршруты; производные файлы (`context/index.yml`, адаптеры) пересобирает
команда. Неоднозначный вопрос — оператору. Отчёт — до 10 строк.

Генерируемое меняет только `ai`; запись в документацию через shell
ловится аудитом, не path-level permission. С подключённым модулем
harness поток идёт через `docs-delta`; без модуля librarian пишет
напрямую.
<!-- /expect:docs-readonly -->

## Роли и права

- **operator** — читает документацию, код, `context/`, `goals/`; пишет
  `goals/`, `.ops/operator/state.yml`, `.ops/feedback/`; постоянная, одна.
- **researcher** — читает всё по задаче; пишет `.ops/<ticket>/research/`;
  свежая, параллельных много.
- **executor** — читает документацию и код; пишет код, тесты, конфиги,
  `.ops/<ticket>/reports/` в своём worktree; запускает judge и
  researcher; возобновляемый; ≤5 активных, paused не считается.
- **external-executor** — читает документацию и код; пишет удалённый
  target и `.ops/<ticket>/reports/`; возобновляемый; ≤5 активных.
- **judge** — читает expectations, DoD и результат; пишет
  `.ops/<ticket>/verdicts/<run>.yml`, `*.expect.json` и разрешённые
  строки `goals/<goal>.expect.ts`; всегда свежий, без resume.
- **librarian** — читает документацию, код, `goals/`; пишет `docs/`,
  `context/`, `CHANGELOG.md`; свежий, один.

Модели — дефолты с override: все роли, кроме judge, — `zai/glm-5.3#max`,
judge — `zai/glm-5.3-flashx#low`; override — оператор по просьбе
пользователя или `ai models set` (валидация схемой, только платные).

Инвариант: документацию пишет только librarian; оператор, executor и
judge — никогда. Merge worktree — оператор; external publish — по
autonomy. Judge не меняет состав `describe`/`crit`/`warn`/`it.todo` и
`budget` — это проверяет AST-валидатор.

## Кастомные роли

- роль — файл `.agents/agents/<name>.md` (frontmatter + промпт); реестра
  `context/roles.yml` нет;
- frontmatter: `name`, `kind`, `description`, `model`, `permissions`,
  `lifecycle`, `concurrency`, `output`, `artifacts`; `skills` — в
  `context/skills.yml`;
- имена core-ролей зарезервированы; коллизия — ошибка; custom-роль не
  переопределяет core-права; `role_exceptions` — в `context/project.yml`;
- `output` обязателен для subagent-роли; роль без `output` — просто
  субагент, не роль контракта.

## Цели, программы и тикеты

`goals/` — плоский набор `*.expect.ts`, замена `context/views`. Никаких
`goals/index.yml`, `goals/README.md`, `expectations.yml`,
`proposal/specs/design/tasks` нет.

- **Цель** — `goals/<goal>.expect.ts`: `describe('goal: …')`, внутри
  тикеты `describe('ticket: …')` со своими `crit`/`warn`/`it.todo`.
- **Программа** — `goals/program--<key>.expect.ts`: только импорты
  своих целей; порядок импортов = приоритет. Программ много, единой
  очереди нет; одна цель — ровно в одной программе.
- **Тикет** — блок `describe('ticket: …')`, артефакты `.ops/<ticket>/`.
  Один активный тикет на файл цели; параллель — между целями. Тикет
  принят, когда ≥80% его `crit`/`warn` — `pass`; остальные
  `satisfactorily` — принятый остаток.
- **Стадии.** `it.todo` — план; нет — готовый план; все тикеты приняты —
  цель достигнута, файл и импорт удаляются. Стадию показывает
  `ai goals status` до удаления.
- **Результаты.** Рядом с `*.expect.ts` — `*.expect.json`:
  `timestamp` + `retry` + `results` с `{run, items}`. Оператор сбрасывает
  перед циклом; judge пишет run 1 (`pass`/`fail`), run 2+ — негатив
  «satisfactorily»; 80% — по `pass`, меньше — один повторный цикл
  (`retry: true`), затем к человеку. Запуск сверх бюджета — гейт.
- **Baseline.** На старте тикета оператор снимает копию активного файла
  в `.ops/<ticket>/baseline/`; `ai goals check goals/<goal>.expect.ts
  --ticket <key>` сравнивает AST: число и порядок
  `describe`/`crit`/`warn`/`it.todo` и `budget` неизменны; разрешены
  только заголовки и тела проверок активного тикета. Baseline обновляет
  только оператор после merge.
- **Скоуп.** `ai expect report goals/<goal>.expect.ts` — цель,
  `goals/program--<key>.expect.ts` — программа. `goals/` не входит в
  `npm run expect`.
- **Коммит.** `goals/` коммитится; завершённая цель удаляется из
  программы и `goals/`, история — git. `.ops/<ticket>/` и
  `*.expect.json` коммитятся; `.ops/operator/state.yml` — локальный.

## Scratchpad оператора
`.ops/operator/state.yml` — локальный кэш, не memory и не истина; в git
не идёт. Поля: `session`, `goal`, `priorities`, `programs`, `tickets`,
`results`, `waits`, `open_questions`, `pointers`, `updated_at`;
`decisions` нет — решение пишется в `goals/` или docs, в state — ссылка.
Лимит 200 строк /
16 KB; 80% — предупреждение, 100% — блокировка. На рестарте и новой
машине — восстановление из `goals/`, docs и git; state не переносится.
## Формальные сообщения

Свободного чата между оператором и ролями нет. Общие поля: `id`, `from`,
`to`, `ticket`, `kind`, `summary`, `artifacts`, `evidence`, `status`,
`questions`, `budget`, `created_at`.

- `brief` — оператор → роль: цель, тикет, DoD, указатели, worktree,
  ограничения, бюджет, формат ответа. До 15 строк.
- `report` — роль → оператор: что сделано, проверки, что осталось,
  риски, указатели. До 10 строк.
- `verdict` — judge → executor, сводка оператору: вердикт, цитата,
  причина, изменения expectations.
- `docs_request` — оператор → librarian: что зафиксировать, evidence,
  слой, критерий готовности.
- `feedback` — оператор → источник/пользователь: метрики, наблюдения,
  причины, рекомендации, evidence.
- `event` — watcher → оператор: событие без решения.

Тело — по схеме, подробности — в файлах. Роль не видит разговор;
оператор не читает сырые логи. Ответ роли — `submit_result` или файл.

## Skills проекта

```
.agents/skills/<name>/SKILL.md   # проектные и установленные core-skills
context/skills.yml               # каталог skills и привязка к ролям
```

- `skills/` в источнике — core-skills; `.agents/skills/` в проекте —
  установленные core и project-skills.
- core-skill обновляется source-sync, проект его не редактирует; нужен
  другой вариант — project-skill с `extends: <core>` или новым именем.
- `roles` в `context/skills.yml` — единственный runtime-источник
  привязки; `role_skills` пресета — только вход установки.
- Операции: добавить — skill + запись с `roles`; обновить project —
  локально и `sha`; обновить core — только source-sync; удалить — убрать
  роль и каталог (core оставить).
- Валидация: `name` = каталог, `description` есть; `roles` существуют;
  project-skill не подменяет core без `extends`; у роли есть
  tools/permissions; у оператора только allowlist; нет секретов и
  skills без роли.
- Runtime: OpenCode читает `.agents/skills` нативно, Claude Code —
  `.claude/skills` + `skills` субагента, Codex — `.agents/skills` +
  инструкции роли; привязка везде из `context/skills.yml`.

## Browser

Browser — capability, не роль.

- `browser` — полное управление: табы, навигация, snapshot, клики, ввод,
  скриншоты, console/network; привязывается к executor и
  external-executor.
- `browser-read` — навигация, snapshot, скриншот; без мутирующих кликов и
  ввода; привязывается к judge и researcher.
- `operator + browser-read` — только явное исключение; иначе оператор
  делегирует. `browser-executor` — только кастомная роль, если нужен
  свой lifecycle, credentials или модель.
- Permissions `browser.navigate`, `browser.snapshot`,
  `browser.screenshot`, `browser.click`, `browser.type`,
  `browser.submit` — в `context/skills.yml`; уровни
  `self`/`ask`/`never` по действиям и доменам — только в
  `context/autonomy.yml`. `submit`, платёж, удаление — по умолчанию
  `ask` или `never`.
- Нужен browser-tool/MCP: нативный browser OpenCode v2 не урезает
  действие механически, поэтому `browser-read` — инструкция плюс аудит;
  механический запрет — через MCP-провайдера с permission на каждый
  `<server>_<tool>`.
- Evidence — скриншоты, snapshot, console/network, логи CI — в
  `.ops/<ticket>/reports/` или `research/`. Judge проверяет через
  `browser-read` или evidence executor, без побочных действий.

## Пресеты

<!-- expect:contract-kinds -->
Контракт собирается под вид проекта пресетом:

- `operational` — свой код: domain, manuals;
- `external` — оверлей поверх чужого живого проекта: domain, manuals,
  external-context, data-access; роль `external-executor`, core
  `executor` в `role_exceptions`;
- `private` — личный проект: domain, manuals, privacy,
  safety-boundaries, life, app-loop, data-access;
- `analytical` — аналитический проект: domain, manuals, privacy,
  analysis, app-loop, data-access, book-corpus.

Пресет задаёт modules, install-time `role_skills`, `role_exceptions`,
`roles` и дефолты `autonomy`; отдельной схемы `goals/` нет.
`role_skills` установщик инвертирует в `roles` записей
`context/skills.yml`; `role_exceptions` пишет в `context/project.yml` →
`roles.exceptions`. Общее: `goals` (старая очередь `context/views`) не
подключается; `harness` — только для headless/CI, не по умолчанию;
`goals/` — плоские `*.expect.ts`; `app-loop` использует
`plan-domain-field`. Вид не подходит — ручной выбор в чеклисте.
<!-- /expect:contract-kinds -->

## Возможности

<!-- expect:extends-only -->
Всё, что применимо не везде, — модули-возможности. Модуль объявляет:

```yaml
applicable_to: [agent-operational-contract-v3]
feature:
  summary: <строка для чеклиста>
  default: true | false
  requires: [<ключи модулей>]
  conflicts: [<ключи модулей>]
```

Подключённый модуль оставляет manifest `context/modules/<key>.yml` и блок
в `AGENTS.md`. Модуль только добавляет и не переопределяет ядро. В чужое
он добавляет явно, через `provides`: `extends` — поля в слоях других
модулей (`{domain: [serves]}`), два модуля с одним полем — конфликт;
`changelog_tags` — свои теги журнала; блок в `AGENTS.md` — правила,
обязательные наравне с жёсткими правилами ядра. Harness, ops, watchers и
dashboard — модули headless-рантайма, в интерактивной части не
обязательны. Протокол выбора и подключения — skill `contract-setup`.
<!-- /expect:extends-only -->

## Адаптеры под инструменты

<!-- expect:claude-md-import -->
Канон — `AGENTS.md` и `.agents/`. Производные:

- **Claude Code** — `CLAUDE.md` (`@AGENTS.md`), копии skills в
  `.claude/skills/`, субагенты в `.claude/agents/`,
  `autoMemoryEnabled: false` и hook на memory-путь;
- **Codex** — читает `AGENTS.md` и `.agents/skills/` сам; субагенты в
  `.codex/agents/`, memory выключена в `.codex/config.toml`;
- **OpenCode** — `.opencode/agents` из `.agents/agents`, skills из
  `context/skills.yml`, browser MCP, autonomy, experimental.subagent_depth:
  2 и гейт прогонов judge по счётчику `*.expect.json`.

Модели — дефолты контракта, override — `ai models set`, бесплатные
запрещены; роли в фоне, executor → judge/researcher (≤2 на тикет), глубина 2.

Производные генерирует `ai adapters sync`, проверяет
`ai adapters check`; руками их не создаёшь и не правишь. Существующий
`CLAUDE.md` с содержимым не затирай: перенеси по слоям (план —
пользователю), затем замени прослойкой.
<!-- /expect:claude-md-import -->

## Memory агента

Запрещена полностью. Всё, что влияет на решения и код, лежит в
репозитории и доступно человеку и агенту. Память инструментов выключена
не на словах:

- «Запомни», «зафиксируй», «сохрани» — `docs_request` librarian.
- Memory-инструменты и memory-MCP запрещены; запись в memory-пути
  (`~/.claude/projects/*/memory/`, memory-каталоги Codex, аналоги)
  блокируется.
- Claude Code — `"autoMemoryEnabled": false` в `.claude/settings.json` и
  hook `PreToolUse`; Codex — `.codex/config.toml` (project config
  действует только в trusted-проекте; надёжнее глобально
  `codex features disable memories` — решение пользователя); OpenCode —
  deny memory-MCP/инструментов и evaluate-hook.
- Настройки и hooks ставит `ai adapters sync`, проверяет
  `ai adapters check`. Прочие runtime: memory off или запрет memory-MCP;
  headless — окружение без memory. `ctx.storage` — только явные кэши.
- При установке найди memory по проекту: факты — в документацию через
  librarian, memory — очистить.

## Синхронизация с источниками

Применение паттерна `source-sync` (см. `patterns/source-sync.md`).
Протокол обновления живёт в skill `source-sync`; ниже — нужное при
установке.

### Единый fetch-канал: только `curl`

```bash
curl -fsSL -H "Cache-Control: no-cache" -H "Pragma: no-cache" "<url>" -o "$tmp"
shasum -a 256 "$tmp" | awk '{print $1}'
```

WebFetch и аналоги запрещены: кэш подставляет старые ответы,
pre-processing искажает контент, SHA не сойдётся. Считай SHA от
скачанного файла, без повторного fetch.

### Конфигурация и проверка `key`

Блок `sync` — в `context/project.yml`. Manifest'ы модулей — в
`context/modules/<key>.yml`; skills и роли хранят SHA в `parts`, у skill
в индексе — `files` с `raw` и `sha256`.

Тянешь контракт или модуль по прямой ссылке — сверь `key` из
frontmatter с ожидаемым. Не совпало — стоп: защита от подмены URL.

## Установка
### Развилка

- **greenfield** — документации нет или только пустой `README.md`;
- **v2** — в `context/project.yml` есть `sync.contract.key:
  agent-operational-contract-v2`;
- **brownfield** — своя документация в любом виде.

Не уверен — спроси.

### greenfield

1. Проверь `node --version` ≥ 24: без Node контракт не ставится.
2. Спроси одним блоком: название и одна строка о проекте, стек,
   namespaces, инструменты (Claude Code, Codex, OpenCode, другие), нужен
   ли hook docs guard.
3. Поставь ядро: `@shahimat/cli`, `@shahimat/ai-core` и `vitest` в
   `devDependencies` (версии из `npm view`; нет `package.json` — создай
   минимальный), `npm install` после «да»; skills и роли из индекса,
   `AGENTS.md` по шаблону, `context/project.yml`, `context/ai-core.yml`,
   `context/autonomy.yml`, `context/skills.yml` (роли по `role_skills`
   плюс core `contract-setup`, `workflow`, `source-sync`, `cli` с
   `roles: []`), пустой `goals/`; в `.gitignore` — `.ops/operator/` и
   `.ops/locks/`; затем `npx ai refresh`.
4. Запусти skill `contract-setup`: чеклист возможностей.
5. Отчёт: что поставлено, где лежит, что дальше.

### Миграция с v2

v2-слои (`docs/entities`, `docs/behavior`, `docs/manuals`,
`context/views`) сохраняются: они становятся слоями модулей domain,
manuals и, для старых проектов, deprecated-модуля goals.

1. `CLAUDE.md` → `AGENTS.md` по шаблону; маршруты и правила — из
   старого `CLAUDE.md`, лишнее — в слои.
2. Удалить `context/workflow.md` и копии правил контракта в
   `context/conventions/`; добавить `summary` в `conventions/*.yml` и
   `docs/entities/*.yml`.
3. Для operator-centric завести `goals/` из живых задач старой очереди:
   цель на файл, программа с импортами; закрытые не переносятся.
4. `contract-setup`: domain, manuals и остальное по выбору; ручной
   `context/index.yml` → генерируемый.
5. `CHANGELOG.md`: строки без тега и длиннее 120 — показать; решения
   сжать, остальное — git log.
6. Memory — по разделу «Memory агента».
7. `sync.contract.key` → `agent-operational-contract-v3`, `edition` →
   `operator-centric`, SHA — из индекса.

Миграция — тикет; нарезка на коммиты — по глобальным правилам.

### brownfield

1. Инвентаризация: `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/**`,
   wiki, ADR / RFC, todo-файлы, свои YAML.
2. Карта: «файл X — это Y» и целевое место: слой ядра, слой возможности
   или «шум — удалить».
3. Конфликты с моделью — с вариантом разрешения и trade-off.
4. Ядро + `contract-setup`, затем перенос шагами.

Чужие трекеры, wiki, IaC и release notes не мигрируют: в
`context/project.yml` → `external` — только указатель.

## Поведение по умолчанию

- предпочитай короткий маршрут полному обходу;
- предпочитай предложить, а не сделать молча;
- предпочитай `unknown` выдумыванию;
- предпочитай файл в репозитории памяти инструмента;
- предпочитай меньшие файлы, явные ссылки и списки таблицам в `.md`;
- русский — для содержательной части, английский — для ключей и имён.
