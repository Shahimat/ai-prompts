# Спецификация: оператор-центричный контракт v3

Статус: черновик, 2026-11-01. Документ проектирования, не промпт: в
`prompts/index.yml` не попадает.

Заменяет FSM-центричную модель v3 в части интерактивной работы. FSM и
внешний harness не удаляются: они остаются инструментами для
детерминированных headless-задач и на этом этапе откладываются.

Рабочее имя — «v3 operator-centric». Ключ
`agent-operational-contract-v3` остаётся: это редакция v3 in place, не
новый v4.

Связанные документы: `design/agent-operational-contract-v3.md` —
исходная FSM-центричная спецификация; `design/operator.md` и
`design/roles.md` — текущая модель оператора и ролей. Этот документ
задаёт новое направление для интерактивной работы; старые документы
остаются историей и описанием headless-части.

## Handoff для новой сессии

Читать в этом порядке:

1. Раздел 0 — принятые решения; они не пересматриваются без пользователя.
2. Раздел 16 — текущее состояние и следующая итерация.
3. Остальной документ — детали ролей, артефактов и протоколов.

Текущее состояние: **только дизайн**. Код, промпты, skills и контракт
v3 ещё не менялись. Следующий шаг — **16.2.1: схемы и решения**, не код
плагина.

## 0. Принятые решения

- **v3 in place.** Ключ `agent-operational-contract-v3` не меняем.
- **Маркер редакции.** В `context/project.yml`:
  `sync.contract.edition: operator-centric`. Плагин активируется только
  при этом маркере; старые v3-проекты без него не затрагиваются.
- **`plan/` — плоский набор `*.expect.ts`.** `plan/program.expect.ts`
  импортирует цели в порядке приоритета. Других файлов в `plan/` нет:
  ни `plan.md`, ни `expectations.yml`, ни `proposal/specs/design/tasks`.
- **`plan/` коммитится.** В долгосроке это очередь работ — замена
  goals/programs.
- **goals/programs упраздняются.** Приоритет — порядок импортов в
  `program.expect.ts`; завершённое удаляется, история — git.
- **External executor.** Для external-проекта нужен executor, который
  работает в удалённом проекте и меняет его; GUI/CI-работы — его
  штатная нагрузка.
- **Scratchpad локальный.** `.ops/operator/state.yml`, в git не
  попадает.
- **Judge resume** — только в цикле judge ↔ executor. Вернулись к
  оператору — новый свежий judge.
- **Merge worktree** — оператор.
- **Watcher-транспорт** — MCP + Unix socket; на Windows — named pipe
  или HTTP-fallback. Event log — JSONL.
- **`oracle` и `reviewer` удаляются** из ядра; не плодим роли.
- **Лимит исполнителей** — не больше 5 одновременно работающих
  executor. Сессия на паузе не считается.
- **Исполнители могут спать.** Пауза — штатное состояние; оператор не
  опрашивает и не «агрится» на спящих.
- **Кастомные роли** — формальное пространство и схема.
- **Skills проекта** — `.agents/skills` + `context/skills.yml` +
  `context/roles.yml`; core через source-sync, project через
  `extends`/новый skill; оператор — только allowlist.
- **Browser** — capability, не роль: `browser` для executor,
  `browser-read` для judge/researcher; оператор — только исключение;
  отдельный `browser-executor` — только если нужен свой lifecycle.
- **Общение оператора и ролей** — формальное, по сообщениям.
- **Миграция существующих v3-проектов** — забота ответственного за
  проект, не этого дизайна.

## 1. Разворот

Исходная v3-модель делала FSM центром: состояния, переходы, harness,
jobs. Это хорошо для однозначных повторяемых задач. Но контракт
универсален, а задачи разнородны: исследование, правка кода, ревью,
документация, ожидание внешнего события.

Следствие:

- центр — оператор, а не автомат;
- строгость — на краях: permissions, схемы, скрипты, бюджеты, locks,
  expectations;
- FSM — опциональный инструмент для headless-задач, не обязательный
  runtime;
- контракт не выдумывает новый runtime: он описывает поведение поверх
  OpenCode, Claude Code, Codex и других.

## 2. Принципы

- **Один оператор.** Одна интерактивная primary-сессия ведёт приоритеты,
  план, распределение и отчёт.
- **Один библиотекарь.** Документацию пишет только librarian;
  последовательно, без параллельных правок.
- **Много ролей.** Researcher, executor и judge могут работать
  параллельно; librarian — один.
- **Лимит исполнителей.** Не больше 5 одновременно работающих executor;
  пауза не считается.
- **Чтение и запись разделены.** Оператор и executor документацию только
  читают. Правки — через librarian.
- **Скиллы — ролям.** Оператор не загружает ролевые skills; его протокол
  живёт в `AGENTS.md`. Исключение — операторский skill фидбека.
- **Артефакты вместо FSM.** План, expectations, вердикты и отчёты — это
  состояние задачи.
- **`plan/` вместо goals.** Плоские `plan/<goal>.expect.ts`, агрегатор
  `plan/program.expect.ts`; приоритет — порядок импортов. Никаких
  `plan/index.yml`, `plan.md`, `expectations.yml`.
- **Формальное общение.** Оператор и роли общаются сообщениями по схеме,
  не свободным чатом.
- **Кастомные роли.** Проект может добавлять свои роли в формальном
  пространстве `.agents/agents` + `context/roles.yml`.
- **Skills проекта формальны.** `.agents/skills` + `context/skills.yml`
  + `context/roles.yml`; core — source-sync, project — extends/новый
  skill; оператор — allowlist.
- **Browser — capability.** Не роль: `browser` для executor,
  `browser-read` для judge/researcher; отдельная роль — только по
  необходимости.
- **Строгость на краях.** Схемы, проверки, permissions, бюджеты, locks и
  аудит вместо центрального автомата.
- **Существующие runtime.** Плагин OpenCode — адаптер поведения, а не
  новый движок. Claude Code и Codex получают те же роли через свои
  механизмы.
- **Worktree на исполнителя.** Параллельные executor не работают в одном
  checkout. Merge — оператор.
- **События, не polling.** Watcher-демон и plugin будят оператора;
  роли не крутят циклы ожидания.
- **Спящие исполнители — норма.** Оператор не опрашивает paused-сессии и
  не считает их активными.
- **Ограниченное состояние оператора.** Scratchpad — явный временный
  журнал, не memory.
- **Фидбек в источник.** Оператор умеет собирать метрики работы,
  причины и рекомендации по улучшению контракта.

## 3. Паттерны

- **`source-sync`** — применяется: контракт, skills и роли обновляются из
  источника через индекс и SHA. Trade-off нет.
- **`guardrail-dual-level`** — применяется к правилам, которые должны
  работать и как инструкция агенту, и как механический запрет
  (документация только librarian, права ролей). Trade-off — нужны
  permissions/скрипты под каждый runtime.
- **`goals`** — больше не применяется в v3: очередь и приоритеты
  переезжают в `plan/`. Паттерн и модуль `goals` остаются для старых
  проектов и помечаются deprecated.

Рекомендация: `source-sync` — всегда; `guardrail-dual-level` — для
документации и прав ролей; `goals` — не применять в новых v3-проектах.

## 4. Роли

### 4.1 Оператор

Один, primary, постоянная сессия.

**Читает:** `AGENTS.md`, `context/`, `docs/`, `plan/`,
`plan/program.expect.ts`, артефакты ролей.

**Пишет:** `plan/program.expect.ts`, `plan/<goal>.expect.ts`,
`.ops/operator/state.yml`, `.ops/feedback/<ticket>.yml`.

**Не пишет:** `docs/`, `context/`, `CHANGELOG.md`, код.

**Не загружает ролевые skills.** Протокол — в `AGENTS.md` и в
операторском разделе контракта.

**Делает:**

- принимает запрос и определяет сценарий: `plan`, `execute`, `audit`,
  `challenge`, `report`;
- берёт приоритеты из порядка импортов `plan/program.expect.ts` и
  указаний пользователя; не изобретает их;
- фиксирует цели и шаги как `describe`/`crit` в `plan/<goal>.expect.ts`;
  на первом проходе — `it.todo`/`crit.wip`, затем механика проверок;
- держит `plan/program.expect.ts` как агрегатор и очередь;
- состав целей и бюджет — его собственность;
- выдаёт брифы ролям; параллельные задачи — параллельно,
  зависимые — последовательно;
- выделяет worktree исполнителям; для external — удалённый target;
  merge — его;
- держит не больше 5 активных executor; paused не считает;
- запускает проверки и гейты;
- обновляет `plan/`, `todowrite` и scratchpad;
- по запросу собирает feedback по метрикам и причинам;
- отчитывается пользователю коротко и по делу;
- эскалирует только то, что не может решить сам.

**Не делает:** не читает сырые логи ролей без нужды, не перепроверяет
их работу вручную, не блокируется на минуты молча.

**Отзывчивость:** перед долгим запуском — строка «что запущено, чего
жду, сколько примерно»; дальше — ответы на сообщения, итог по
уведомлению.

### 4.2 Researcher

Всегда свежий контекст, без resume.

**Читает:** всё, что нужно по задаче.

**Пишет:** только `.ops/<ticket>/research/<id>.md` (один артефакт на
задание).

**Не пишет:** код, документацию, план, expectations.

**Возвращает:** находки, источники, уверенность, неизвестное,
рекомендацию и указатели. Без сырых дампов.

**Параллельность:** сколько угодно; каждый — отдельная задача и
отдельный артефакт.

**Зачем:** разведка перед планом, внешние системы, код, документация.
Если ответ не найден — это фиксируется, а не выдумывается.

### 4.3 Executor

Возобновляемая сессия; работает в своём worktree.

**Читает:** план, expectations, research, вердикты judge, код,
документацию.

**Пишет:** код, тесты, конфиги, `.ops/<ticket>/reports/<id>.md` в своём
worktree.

**Не пишет:** `docs/`, `context/`, `CHANGELOG.md`, план, expectations.

**Получает:** задачу, DoD, ограничения, worktree, указатели, бюджет
циклов, прошлые замечания judge (без аргументов в чате).

**Возвращает:** что сделано, какие проверки прошли, что осталось, где
риски, указатель на diff/ветку.

**Resume:** для доработок по замечаниям judge или оператора. Новая
задача — новый worktree и, как правило, новая сессия.

**Параллельность:** до 5 одновременно работающих executor; paused не
считается. Один worktree — один executor. Два executor в одном checkout
запрещены.

**Пауза:** исполнитель может стоять на паузе в ожидании очереди, события
или ответа пользователя. Это штатное состояние, а не сбой. Оператор не
опрашивает paused-сессии и не шлёт им «ты как?». Возобновление — по
событию, таймеру или просьбе пользователя. Пользователь может сказать
«эта задача на паузе» — оператор фиксирует это в `plan/<goal>.expect.ts`
(`it.todo('paused: ...')`) и scratchpad, не трогает исполнителя.

#### External executor

Для external-проекта нужен executor, который работает **в удалённом
проекте** и меняет его, а не локальный overlay.

- Роль `external-executor` — preset-роль external-вида, не core;
  контракт роли тот же: lifecycle, permissions, output, artifacts.
- Target — из `context/project.yml` → `external`; один ticket — один
  target/web app; несколько web app — несколько задач в очереди.
- Skills: `executor`, `external-context`, `browser`, `data-access`.
- GUI/CI — штатная работа: открыть CI, проверить процесс, толкнуть
  зависший запуск, вытащить логи, снять страницу/скриншот, ввести
  данные. Для этого нужен `browser` (полный), а не `browser-read`.
- Evidence: скриншоты, snapshot, console/network, логи CI — в
  `.ops/<ticket>/reports/`.
- Много web-приложений: active executor ≤5, остальные paused/в очереди;
  paused не считается.
- Merge/publish — по политике автономии и target; локального worktree
  merge для external нет.

### 4.4 Judge

Помогает executor завершить работу корректно. Это его интерес: не
«завалить», а довести до соответствия DoD.

Всегда читает только результат и expectations; **аргументов и чата
executor не видит**.

**Читает:** expectations, DoD, артефакты результата, проверки.

**Пишет:** `.ops/<ticket>/verdicts/<cycle>.yml`; может править в
`plan/<goal>.expect.ts` только `title` и механику проверки.

**Не может:** добавлять/удалять `describe`/`crit`/`warn`, менять
`budget`, писать код или документацию.

**Если считает, что пункт лишний или заголовок искажает смысл:** правит
заголовок/механику в разрешённых местах и отчитывается; добавить/удалить
пункт — только предложение оператору.

**Валидация:** runtime-neutral AST-проверка `ai plan check` сравнивает
файл с baseline: число и порядок `describe`/`crit`/`warn` не меняются,
`budget` не меняется, разрешены только строки заголовков и тела проверок.
Невалидная правка отклоняется.

**Baseline.** На старте ticket оператор снимает копию `plan/` в
`.ops/<ticket>/baseline/`; `ai plan check` сравнивает с ней. Baseline
обновляет только оператор, когда принято новое состояние целей; judge
baseline не трогает.

**Возвращает:**

- executor — подробный результат по каждому пункту: вердикт, цитата,
  причина, что именно не сходится;
- оператору — короткую сводку: «всё прошло» / «есть замечания» +
  сколько циклов и что изменено в expectations.

**Циклы:** до 3 по умолчанию. Бюджет задаёт оператор.

**Конфликт:**

- executor говорит «готово», а judge показывает замечания — конфликт
  оператору сразу;
- циклы исчерпаны — конфликт оператору;
- оператор решает: ещё один цикл, другой executor, эскалация
  пользователю.

**Сессия:** внутри цикла judge ↔ executor можно resume, чтобы уточнить
вердикт или продолжить диалог с исполнителем. Как только вопрос вернулся
оператору, следующий запуск — свежий judge; старый контекст не
переиспользуется.

### 4.5 Librarian

Один, всегда свежий контекст, последовательный писатель документации.

**Читает:** документацию, код, план, запрос оператора.

**Пишет:** `docs/`, `context/`, `CHANGELOG.md`.

**Не пишет:** код, план, expectations, тесты.

**Получает запрос:** что зафиксировать, зачем, evidence, целевой слой,
критерий готовности.

**Перед фиксацией:**

- проверяет целостность: ссылки, id, схему, orphans, дубли;
- запускает формальный скрипт проверки документации;
- если скрипт нашёл проблему — чинит;
- если вопрос неоднозначный — спрашивает оператора;
- оператор решает сам; пользователь — только если оператор не может.

**Возвращает:** что изменено, результат скрипта, открытые вопросы,
короткую сводку.

**Параллельность:** один librarian; очередь запросов; параллельные
правки документации запрещены.

### 4.6 Skills ролей

- **operator** — без ролевого skill; протокол в `AGENTS.md`. Единственное
  исключение — `operator-feedback` по явному запросу пользователя.
- **researcher** — `research`.
- **executor** — `executor` (кодовые правила и проверки).
- **judge** — `judge` (формат expectations и вердикта).
- **librarian** — `librarian` (правила документации и проверки
  целостности).

Скиллы не попадают в контекст оператора: в OpenCode это `skill`
permissions, в Claude Code — `skills` субагента, в Codex — инструкции
роли.

### 4.7 Скилл `operator-feedback`

Единственный операторский skill-исключение. Загружается по явному
запросу: «собери фидбек по работе», «что улучшить в контракте».

**Вход:** plan, reports, verdicts, scratchpad, session stats, события
watcher, замечания пользователя.

**Метрики:**

- `human_distractions_total` — сообщения оператора пользователю;
- `human_distractions_empty` — из них без решения/действия;
- `operator_distractions_total` — запуски ролей;
- `operator_distractions_empty` — запуски без принятого артефакта,
  дубли, лишние проверки;
- `tokens_wasted_estimate` — оценка: сумма токенов ролей с
  неуспешным/отклонённым/дублирующим результатом, ретраев и пустых
  сообщений; это оценка, не бухгалтерия;
- `judge_cycles`, `conflicts`, `rework`, `queue_wait`,
  `time_to_first_status`, `docs_corrections`, `check_failures`,
  `paused_time`, `scratchpad_churn`.

**Выход:** `.ops/feedback/<ticket>.yml`:

```yaml
ticket: <key>
period: <from>..<to>
metrics: {}
observations: []
root_causes: []
recommendations: []
evidence: []
```

Правила: без сырых логов и секретов; evidence — указатели; фидбек не
правит контракт сам, а передаётся в source-feedback/пользователю.
`human_distractions_empty` и `tokens_wasted_estimate` — оценки: первая
классифицируется по логу сообщений и реакции пользователя, вторая — по
session stats; в отчёте указывается метод и погрешность.

### 4.8 Кастомные роли

Формальное пространство:

- источник роли — `.agents/agents/<name>.md`;
- реестр — `context/roles.yml`;
- схема роли — `expectations/schemas/role.schema.json`;
- адаптеры генерируют `.opencode/agents`, `.claude/agents`,
  `.codex/agents`.

Реестр:

```yaml
roles:
  - name: <kebab-case>
    kind: primary | core | custom
    description: <одна строка>
    permissions: <capability или набор действий>
    lifecycle: persistent | fresh | resumable | paused
    concurrency: <число или unlimited>
    skills: [<имена>]
    output: <протокол>
    artifacts: [<пути>]
```

Правила:

- все роли, включая core и `external-executor`, заполняют эту схему;
  примеры в 4.11/4.12/4.13 — либо полные записи, либо явно помеченные
  фрагменты;
- `operator` — `kind: primary`, `lifecycle: persistent`; это не
  субагент и не `.agents/agents/operator.md`;
- role-level `permissions` — capability-уровень (`browser`,
  `remote-write`, `data-access`); гранулярные permissions
  (`browser.click`, `browser.type`) — в `context/skills.yml`; уровни
  `self`/`ask`/`never` — в `context/autonomy.yml`;
- имена core-ролей зарезервированы;
- коллизия имён — ошибка;
- custom-роль не переопределяет core-права;
- `output` обязателен для subagent-ролей; у `operator` (`kind:
  primary`) его нет — протокол в `AGENTS.md`;
- роль без `output` — просто субагент, не роль контракта;
- проект может добавить роль, не меняя ядро;
- валидация — схемой и `ai roles check` (имя условное).

### 4.9 Формальное общение

Свободного чата между оператором и ролями нет. Сообщения:

- `brief` — оператор → роль;
- `report` — роль → оператор;
- `verdict` — judge → executor, копия-сводка оператору;
- `docs_request` — оператор → librarian;
- `feedback` — оператор → источник/пользователь;
- `event` — watcher → оператор.

Общие поля: `id`, `from`, `to`, `ticket`, `kind`, `summary`,
`artifacts`, `evidence`, `status`, `questions`, `budget`, `created_at`.
Тело — по схеме сообщения; подробности — в файлах-артефактах, не в
сообщении.

Роль не видит разговор; оператор не читает сырые логи. Ответ роли —
`submit_result` или файл; оператор получает сводку.

### 4.10 Роли вне ядра

`oracle` и `reviewer` удаляются из ядра и репозитория: быстрый ответ —
вариант researcher, оценка DoD — judge. Не держим роли «на всякий
случай»; если позже понадобится отдельный code review — это новый
модуль, а не ядро.
`watch-triage` и `watch-request` — роли watcher-модуля, не ядра; демон
может иметь свой триаж, но он не входит в базовый набор.

`implementer` переименовывается в `executor`; `docs-keeper` — в
`librarian`. Ключи ролей и skills мигрируются отдельным решением.

### 4.11 Skills проекта

Skill — это инструкции, а не инструмент. Ему нужны tool/MCP и
permissions; одно без другого не работает.

Пространство:

```text
.agents/skills/<name>/SKILL.md   # проектные и установленные core-skills
context/skills.yml               # каталог skills
context/roles.yml                # привязка skills к ролям
```

- `skills/` в источнике `ai-prompts` — core-skills контракта;
- `.agents/skills/` в проекте — установленные core-skills и проектные
  skills;
- core-skill обновляется source-sync, проект его не редактирует;
- проекту нужно дополнительное поведение — новый project-skill с
  `extends: <core>` или отдельным именем, а не правка core-копии.

`context/skills.yml`:

```yaml
skills:
  - key: executor
    kind: core                 # core | project
    source: ai-prompts
    path: .agents/skills/executor
    sha: <hex>
  - key: browser
    kind: core
    source: ai-prompts
    path: .agents/skills/browser
    sha: <hex>
    requires:
      tools: [browser]
    permissions:
      - browser.navigate
      - browser.snapshot
      - browser.click
      - browser.type
  - key: browser-read
    kind: core
    source: ai-prompts
    path: .agents/skills/browser-read
    sha: <hex>
    requires:
      tools: [browser]
    permissions:
      - browser.navigate
      - browser.snapshot
```

Autonomy в `skills.yml` не хранится: единственный источник —
`context/autonomy.yml`. Пресет может задать дефолты autonomy, но
установщик пишет их в `context/autonomy.yml`.

`context/roles.yml` — единственный runtime-источник привязки. Пресет
`role_skills` — install-time дефолт: установщик пишет его в
`context/roles.yml`, дальше проект правит роли явно; второй источник
не используется.

```yaml
roles:
  - name: operator
    kind: primary                  # протокол — AGENTS.md, не субагент
    lifecycle: persistent
    skills: [operator-feedback]    # только allowlist
  - name: researcher
    skills: [research, browser-read]
  - name: executor
    skills: [executor, browser]
  - name: judge
    skills: [judge, browser-read]
```

Полные определения остальных ролей — в `.agents/agents/<name>.md`;
оператор — primary, отдельного файла роли у него нет.

Операции:

- **добавить:** создать `.agents/skills/<name>/SKILL.md`, запись в
  `context/skills.yml`, привязку в `context/roles.yml`, затем
  `ai skills check`;
- **обновить project skill:** править локально, обновить запись/`sha`,
  `ai skills check`;
- **обновить core skill:** только source-sync; локальные дополнения —
  новым skill/`extends`;
- **удалить:** отвязать от ролей, убрать из каталога; project-skill
  удалить, core оставить;
- **привязать к оператору:** только через allowlist. По умолчанию
  `skills: []`; всё остальное — ошибка валидатора.

Валидация `ai skills check`:

- `name` совпадает с каталогом, `description` есть;
- все skills из `roles.yml` есть в `skills.yml`;
- project-skill не подменяет core без `extends`;
- у роли есть tools/permissions для skill;
- у оператора только разрешённые skills;
- нет секретов;
- нет skills, которые не ставит ни роль, ни контракт.

Runtime:

- OpenCode читает `.agents/skills` нативно; preload — через тело роли
  или `skill` permissions;
- Claude Code — `.claude/skills` + `skills` у субагента;
- Codex — `.agents/skills` + инструкции роли;
- `context/roles.yml` — источник привязки для всех адаптеров.

### 4.12 Browser capability

Browser — это capability, а не роль. По умолчанию:

- **`browser`** — полное управление: табы, навигация, snapshot,
  клики, ввод, скриншоты, console/network. Привязывается к executor.
- **`browser-read`** — только навигация, snapshot, скриншот; без
  мутирующих кликов и ввода. Привязывается к judge и researcher.
- **operator + `browser-read`** — только явное исключение; иначе
  оператор делегирует.

Browser-задачи с отдельным lifecycle, credentials, моделью или
ограничением «одна browser-сессия на проект» могут стать кастомной
ролью:

```yaml
- name: browser-executor
  kind: custom
  description: executor с полноценным управлением браузером
  lifecycle: resumable
  concurrency: 1
  skills: [browser]
  permissions: [browser]           # capability; granular — в skills.yml
  output: result
  artifacts: [.ops/<ticket>/reports/]
```

Но это не новый вид executor по умолчанию, а кастомная роль с теми же
принципами.

Требования:

- tool/MCP: OpenCode browser namespace (desktop), Playwright MCP,
  browser-use или другой провайдер; адаптер отображает capability;
- permissions: `browser.navigate`, `browser.snapshot`, `browser.click`,
  `browser.type`, `browser.submit`;
- autonomy: `context/autonomy.yml` — `self`, `ask`, `never` по
  действиям и доменам; `submit`/платёж/удаление — по умолчанию `ask`
  или `never`;
- evidence: скриншоты, snapshot, console/network — в
  `.ops/<ticket>/reports/` или `.ops/<ticket>/research/`;
- judge проверяет через `browser-read` или evidence executor, без
  побочных действий;
- оператор не управляет браузером как основной работой.

Skill без browser-tool бесполезен; поэтому `context/skills.yml` хранит
`requires.tools` и permissions, а runtime даёт соответствующий tool.

### 4.13 Пресеты

Пресет задаёт modules, install-time `role_skills`, `role_exceptions` и
дефолты `autonomy`; `plan_schema` нет — `plan/` плоский и одинаковый.
Core-роли одни и те же; external добавляет `external-executor`.
`role_skills` — вход установки: установщик пишет `context/roles.yml`,
дальше runtime читает только его; пресет не второй источник.
`role_exceptions` — явные замены/исключения core-ролей (например,
external заменяет executor на external-executor).

Общее для всех:

- `goals` и `context/views` не подключаются;
- `harness` — только если нужны headless/CI jobs, не по умолчанию;
- `plan/` — плоские `*.expect.ts` + `program.expect.ts`;
- `app-loop` использует `plan-domain-field`, а не `goal-domain-field`.

**operational**

```yaml
key: operational
modules: [domain, manuals]
role_skills:
  operator: [operator-feedback]
  researcher: [research, domain, manuals]
  executor: [executor, domain, manuals]
  judge: [judge, domain, manuals]
  librarian: [librarian, domain, manuals]
```

**private** (бывший personal/life)

```yaml
key: private
modules: [domain, manuals, privacy, safety-boundaries, life, app-loop, data-access]
role_skills:
  operator: [operator-feedback]
  researcher: [research, domain, manuals, life, privacy, safety-boundaries]
  executor: [executor, domain, manuals, life, privacy, safety-boundaries]
  judge: [judge, domain, manuals, life, privacy, safety-boundaries]
  librarian: [librarian, domain, manuals, life, privacy, safety-boundaries]
```

`safety-boundaries` — ещё и жёсткое правило в `AGENTS.md`; оператор
соблюдает его без загрузки skill.

**external**

```yaml
key: external
modules: [domain, manuals, external-context, data-access]
roles:
  external-executor:
    kind: custom
    description: executor в удалённом проекте, GUI/CI-работы
    permissions: [remote-write, browser, data-access]
    lifecycle: resumable
    concurrency: 5
    skills: [executor, domain, manuals, external-context, browser, data-access]
    output: result
    artifacts: [.ops/<ticket>/reports/]
role_skills:
  operator: [operator-feedback]
  researcher: [research, domain, manuals, external-context, browser-read]
  judge: [judge, domain, manuals, external-context, browser-read]
  librarian: [librarian, domain, manuals, external-context]
role_exceptions: [executor]   # заменён на external-executor
```

`external-executor` работает в удалённом проекте, меняет его, делает
GUI/CI-работу, снимает логи/скриншоты. `browser` — полный; judge и
researcher — `browser-read`. `roles:` в пресете — install-time
определения: установщик пишет `.agents/agents/external-executor.md` и
запись в `context/roles.yml`; runtime-истина — `context/roles.yml`.
`role_exceptions` фиксирует, что core executor в этом пресете заменён;
это не ошибка покрытия.

**analytical**

```yaml
key: analytical
modules: [domain, manuals, privacy, analysis, app-loop, data-access, book-corpus]
role_skills:
  operator: [operator-feedback]
  researcher: [research, domain, manuals, analysis, book-corpus, data-access, browser-read, privacy]
  executor: [executor, domain, manuals, analysis, data-access, privacy]
  judge: [judge, domain, manuals, analysis, privacy]
  librarian: [librarian, domain, manuals, analysis, privacy]
```

Новых core-ролей нет. `corpus-loader`/`browser-executor` — только если
нужен отдельный lifecycle/credentials/модель; иначе это executor +
skill.

## 5. Матрица прав

| Роль | Документация | Код | Артефакты | Сессия | Параллельность |
| --- | --- | --- | --- | --- | --- |
| operator | read | read | plan/, .ops/operator/state.yml, .ops/feedback | постоянная | один |
| researcher | read | read | .ops/<ticket>/research | свежая | много |
| executor | read | write | .ops/<ticket>/reports, worktree | возобновляемая | ≤5 активных, paused не считается |
| external-executor | read | write remote | .ops/<ticket>/reports, remote target | возобновляемая | ≤5 активных, paused не считается |
| judge | read | read | .ops/<ticket>/verdicts, plan expect | resume в цикле; свежая после оператора | много, по файлу |
| librarian | write | read | docs/, context/, CHANGELOG | свежая | один |

Активных executor — не больше 5; paused не считается. Merge локального
worktree — оператор; external publish — по autonomy. Judge меняет
`plan/*.expect.ts` только в заголовках/механике; AST-валидатор не даёт
менять состав и бюджет. Skills привязываются через `context/roles.yml`;
browser-права — только через `browser`/`browser-read` и autonomy.

Механическое исполнение:

- **OpenCode** — `permissions` агентов + плагин docs guard + `skill`
  permissions; `subagent` только для ролей.
- **Claude Code** — субагенты, `tools`, hooks; ограничения на docs.
- **Codex** — роли/инструкции, внешний runner, проверки.
- **Headless** — внешний harness: роль получает только разрешённые
  инструменты.

Инвариант один: документацию пишет только librarian; оператор и
executor — никогда.

## 6. Артефакты

```text
plan/
  program.expect.ts        # агрегатор: импорты целей в порядке приоритета
  <goal>.expect.ts         # цель: describe + crit/warn/it.todo
  ...

.ops/
  operator/state.yml       # локальный scratchpad, в git не идёт
  feedback/<ticket>.yml    # фидбек по работе
  <ticket>/
    baseline/              # снимок plan/ на старте ticket
    research/              # researcher
    reports/               # executor
    verdicts/              # judge
    checks/                # результаты проверок

context/
  project.yml              # sync.contract.key/edition, external targets
  autonomy.yml             # единственный источник уровней self/ask/never
  roles.yml                # runtime-роли и привязка skills
  skills.yml               # каталог skills, requires, permissions
.agents/
  skills/<name>/SKILL.md   # проектные и установленные core-skills
  agents/<name>.md         # роли, включая кастомные
```

`plan/` — плоский набор `*.expect.ts`. Никаких `plan/index.yml`,
`plan.md`, `expectations.yml`, `proposal/specs/design/tasks` нет.

- `program.expect.ts` импортирует цели в порядке приоритета; порядок
  импортов = очередь.
- Каждая цель — `describe` с `crit`/`warn`; незапущенная или paused —
  `it.todo('paused: ...')`; в работе — `crit.wip`.
- `plan/` коммитится. Завершённая цель удаляется из `program.expect.ts`
  и из `plan/`; история — git.
- `.ops/<ticket>/` коммитится как след работы; `.ops/operator/` —
  локальный и не коммитится.
- `plan/` — не проектная документация; docs guard его не трогает.
- Это не `expectations/*.expect.ts` репозитория: там долгосрочные
  ожидания к промптам и коду; здесь — цели конкретной работы.

Пример цели:

```ts
import { describe, crit, warn } from '@shahimat/ai-core/expect';

describe('goal: обновить AGENTS.md', () => {
  crit('AGENTS.md содержит маршрут к plan/', () => Check.route());
  warn('CLAUDE.md остаётся прослойкой', () => Check.pointer());
});
```

Пример программы:

```ts
import './agents-md.expect.ts';
import './contract-v2.expect.ts';
import './judge.expect.ts';
```

Правила judge:

- judge может менять только строки заголовков и механику проверок в
  `plan/<goal>.expect.ts`;
- judge не добавляет/удаляет `describe`/`crit`/`warn`, не меняет
  `budget` и не трогает `program.expect.ts`;
- baseline — снимок `plan/` на старте ticket в
  `.ops/<ticket>/baseline/`, обновляет только оператор;
- `ai plan check` парсит AST и сравнивает с baseline: число и порядок
  `describe`/`crit`/`warn`, `budget` неизменны; разрешены только
  заголовки и тела проверок;
- невалидная правка отклоняется, judge получает ошибку;
- judge отчитывается, что именно изменил.

Это ответ на «как валидировать diff judge на всех runtime»: не через
permissions рантайма (они path-level), а общим AST-валидатором,
одинаковым для OpenCode, Claude Code и Codex.

## 7. Протоколы

### 7.1 План

1. Оператор читает маршрут, `plan/program.expect.ts`, документацию по
   задаче.
2. Определяет сценарий и DoD.
3. Пишет `plan/<goal>.expect.ts`: `describe` цели, на первом проходе —
   `it.todo`/`crit.wip`, затем механика проверок.
4. Добавляет импорт цели в `plan/program.expect.ts` в порядке
   приоритета.
5. Показывает пользователю план, если есть развилка; иначе идёт по
   согласованному сценарию.

### 7.2 Бриф роли

Бриф — формальное сообщение `brief`, указатели, не пересказ:

- `id`, `ticket`, `role`, `goal` — цель одной строкой и что считать
  готовым;
- `plan/program.expect.ts`, `plan/<goal>.expect.ts`, research,
  verdicts — путями;
- `worktree`, `constraints`, `deadline`, `budget` — ограничения;
- `output` — формат ответа и куда писать артефакт;
- `questions` — что роль должна спросить, а не додумать.

Бриф — до 15 строк. Длиннее — пересказ того, что роль прочитает сама.

### 7.3 Цикл executor ↔ judge

1. Executor работает, запускает свои проверки, пишет отчёт.
2. Judge получает expectations, DoD и результат; аргументов executor не
   видит.
3. Judge пишет вердикт: подробно executor, кратко оператору.
4. Если judge меняет заголовок/механику — правит `plan/<goal>.expect.ts`;
   `ai plan check` проверяет AST и отклоняет добавление/удаление
   пунктов или смену бюджета.
5. Если есть замечания — executor дорабатывает; цикл до 3. Внутри
   цикла judge можно resume.
6. Executor говорит «готово», а judge — «есть замечания»: конфликт
   оператору сразу.
7. Бюджет исчерпан: конфликт оператору.
8. Вернулись к оператору — следующий judge свежий, старый контекст не
   переиспользуется.
9. Оператор решает: ещё цикл, замена executor, эскалация.

### 7.4 Librarian

1. Оператор формирует запрос: что зафиксировать, evidence, слой.
2. Librarian читает релевантные документы.
3. Проверяет целостность и запускает формальный скрипт.
4. Пишет или чинит.
5. Повторяет скрипт; при неоднозначности спрашивает оператора.
6. Возвращает отчёт.

### 7.5 Проверки

Оператор запускает лестницу:

1. быстрые: lint, typecheck, format;
2. тесты;
3. task expectations;
4. docs consistency;
5. финальная сборка/проверка.

Для внешнего проекта — те же шаги через провайдер удалённых команд.
Оператор получает структурированный результат, не сырой лог.

### 7.6 Watcher-событие

1. Демон публикует событие.
2. Плагин классифицирует: `ignore`, `notify`, `wake`, `start_job`.
3. `wake` — сообщение оператору через `session.prompt`/`synthetic`;
   busy — в очередь.
4. Оператор обновляет план/todo, решает, что делать.
5. Событие подтверждается; повторно не доставляется.

### 7.7 Feedback

1. Пользователь просит: «собери фидбек».
2. Оператор загружает `operator-feedback`.
3. Собирает метрики из session stats, plan, reports, verdicts,
   scratchpad, событий.
4. Классифицирует пустые отвлечения и потери токенов; помечает оценки
   как estimate.
5. Формулирует причины и рекомендации с evidence.
6. Пишет `.ops/feedback/<ticket>.yml`; контракт сам не правит.

### 7.8 Пауза исполнителя

1. Пользователь: «эта задача на паузе» или оператор видит ожидание
   события/очереди.
2. Оператор ставит `it.todo('paused: ...')` в `plan/<goal>.expect.ts` и
   фиксирует паузу в scratchpad; executor-сессия остаётся, но не
   считается активной.
3. Оператор не опрашивает paused-сессию и не шлёт статусные пинги.
4. Возобновление — событие, таймер, просьба пользователя или решение
   оператора.
5. В `todowrite` пункт остаётся `pending` с пометкой «paused» в тексте;
   в plan — точный статус.

## 8. Операторский scratchpad

`.ops/operator/state.yml` — локальное временное состояние оператора, не
memory и не проектная документация. В git не попадает и не является
частью репозиторного состояния.

Схема:

```yaml
session: <id>
goal: <одна строка>
priorities: [<ссылки на plan/program.expect.ts или goal>]
plan: plan/program.expect.ts
decisions: [<короткие решения>]
waits: [<чего ждём и где>]
open_questions: [<что требует решения>]
pointers: [<файлы и сессии>]
updated_at: <ISO>
```

Правила:

- лимит: 200 строк / 16 KB; без сырых логов и секретов;
- 80% — предупреждение; 100% — блокировка записи до утилизации;
- устойчивые факты — librarian; детали — plan; resolved — удалить;
- на рестарте оператор читает state, сверяет с plan и продолжает;
- проверка — `ai operator state check` или plugin/hook; одинаково для
  всех runtime.

Scratchpad не является скрытой memory: он явный, ограниченный и
читаемый пользователем. Всё, что влияет на решения надолго, уходит в
docs. При смене машины или потере state оператор восстанавливается по
`plan/program.expect.ts`, целям в `plan/` и документации; state — кэш,
не истина.

## 9. Строгость на краях

- **Схемы:** `plan/*.expect.ts` (AST), `plan/program.expect.ts`,
  verdict, report, brief, feedback, state, roles, skills, skill
  manifest, browser autonomy, watcher events.
- **AST-валидаторы:** judge не меняет число/порядок
  `describe`/`crit`/`warn` и `budget`; разрешены только заголовки и
  тела проверок; baseline — `.ops/<ticket>/baseline/`, обновляет
  оператор.
- **Скрипты:** lint, typecheck, tests, build, docs consistency,
  expectations, roles check, skills check, plan check.
- **Locks:** docs (librarian), plan expectation (judge/operator),
  worktree (executor), `plan/program.expect.ts` (operator).
- **Бюджеты:** циклы judge, время роли, размер scratchpad, активные
  executor (≤5), paused не считается.
- **Аудит:** sessionID роли, задача, вердикт, артефакты, кто запустил,
  сколько токенов/времени.
- **Permissions:** docs write только librarian; operator/executor deny.

FSM не нужен для этой строгости. FSM остаётся для случаев, где переходы
и повторяемость важнее свободы: CI, релиз, миграция, headless jobs.

## 10. Runtime-адаптеры

### OpenCode

Плагин только для проектов v3 operator-centric. Проверка:

```yaml
sync:
  contract:
    key: agent-operational-contract-v3
    edition: operator-centric
```

Старый v3 без `edition` плагин не активирует.

- оператор — primary-сессия;
- роли — subagents с `mode: subagent`, включая кастомные из
  `context/roles.yml`;
- `experimental.todo: true` — видимый чеклист;
- `subagent` — запуск ролей; background для параллельных; active ≤5,
  paused не считается;
- `todowrite` — плоский список; иерархия кодируется текстом;
- `.agents/skills` — skills нативно; привязка — `context/roles.yml`;
- `plan/program.expect.ts` — `ai expect report` + `ai plan check`;
- `submit_result` — структурированный ответ ролей;
- `operator-feedback` — операторский skill по запросу;
- `browser`/`browser-read` — через browser namespace/MCP и autonomy;
- docs guard — `permission.hook("evaluate")`;
- watcher MCP — события/триггеры;
- Subagents tab — видимость ролей;
- resume executor/judge — через `sessionID`; paused — без опроса.

Ограничения: todo плоский, нет вложенных зависимостей; для DAG нужен
плагин-инструмент, не в MVP.

### Claude Code

- роли — субагенты `.claude/agents`;
- skills — `.claude/skills`, привязка из `context/roles.yml`;
- browser — MCP (Playwright/browser-use);
- docs guard — hooks;
- видимость — субагенты/транскрипты;
- watcher — MCP;
- headless/durable — внешний harness.

### Codex

- роли — `.codex/agents` или инструкции;
- skills — `.agents/skills`, привязка из `context/roles.yml`;
- browser — MCP (Playwright/browser-use);
- hooks/плагины ограничены;
- docs guard — проверки/раннер;
- watcher — MCP;
- headless/durable — внешний harness.

### Headless

Внешний harness и FSM — только для детерминированных задач и CI. На этом
этапе не развиваем.

## 11. Watcher-демон

Один machine-wide daemon, не по демону на проект.

- проекты регистрируют watches;
- providers: timer, git, CI, manual, внешние системы;
- event log — JSONL; dedupe, ack, retry;
- транспорт: MCP (stdio) + Unix socket на POSIX; на Windows — named
  pipe (`\\.\pipe\...`) или HTTP-fallback;
- API: добавить/удалить watch, получить события, подтвердить, trigger;
- MCP — тонкий фасад для оператора и executor;
- события не теряются при закрытой сессии; plugin доставляет при старте;
- daemon не управляет агентами: он публикует события.

Unix socket на Windows в Node — это не Unix domain socket, а named
pipe; отдельная реализация не нужна, `net` умеет и то, и другое. Если
пайп недоступен в конкретной обвязке — HTTP на localhost с токеном.

MCP-инструменты:

- `watch_add`, `watch_list`, `watch_remove`;
- `event_list`, `event_ack`;
- `wait_event` с коротким таймаутом;
- `trigger_fire`.

Права: оператор — add/remove/trigger; executor — list/ack/wait;
librarian — не нужен.

## 12. Фазы

1. **Design.** Этот документ; согласование ролей, артефактов, границ.
2. **Контракт и skills.** Оператор, researcher, executor, judge,
   librarian; плоский `plan/*.expect.ts` + `program.expect.ts`;
   scratchpad; `operator-feedback`; кастомные роли; external
   executor; формальные сообщения; реестр skills; browser-capability;
   presets с `role_skills`/`role_exceptions`/`autonomy`; permissions;
   удаление обязательного FSM из интерактивной части.
3. **OpenCode MVP.** v3-only плагин: оператор, subagents, `todowrite`,
   skills из `context/roles.yml`, browser tool, docs guard,
   `submit_result`, state check, `operator-feedback`.
4. **Watcher MVP.** Один тип события (timer или CI), JSONL event log,
   MCP, Unix socket/named pipe/HTTP, plugin wake.
5. **Гейты.** Task expectations, judge AST-валидатор, docs
   consistency, check ladder, roles check, skills check, plan check,
   browser autonomy.
6. **Пилот.** Один проект: оператор, 2 researcher, executor, judge,
   librarian; параллельный и последовательный блоки; конфликт; пауза
   executor; feedback. Для external — external-executor, remote target
   и browser/CI-проверка.
7. **Другие runtime.** Claude Code/Codex адаптеры; внешний harness для
   headless — позже.

## 13. Критерии готовности пилота

- оператор планирует задачу из 3 пунктов и ведёт её без FSM;
- плагин активируется только при `sync.contract.edition:
  operator-centric`; старый v3 не затрагивается;
- `plan/program.expect.ts` задаёт очередь и приоритет, цели лежат
  плоскими `*.expect.ts`; baseline снят в `.ops/<ticket>/baseline/`;
- два researcher работают параллельно, executor — в отдельном worktree;
- external executor работает в удалённом проекте и делает GUI/CI-работу;
- активных executor не больше 5; paused не считается и не опрашивается;
- judge даёт подробный вердикт executor и краткий оператору; правка
  `.expect.ts` проходит AST-валидатор;
- librarian пишет документацию и прогоняет формальную проверку;
- оператор и executor не могут писать docs;
- scratchpad не растёт бесконечно и чистится;
- watcher-событие будит оператора; event log JSONL;
- кастомная роль добавляется через `.agents/agents` + `context/roles.yml`;
- project-skill добавляется в `.agents/skills`, привязывается к executor
  через `context/roles.yml` и проходит `ai skills check`;
- пресет проходит схему: `role_skills` разрешаются, `autonomy`
  переносится в `context/autonomy.yml`, external содержит полный
  `external-executor`;
- browser-задача выполняется executor с `browser`, judge проверяет через
  `browser-read` без побочных действий;
- `operator-feedback` даёт метрики, причины и рекомендации;
- роли видны в Subagents tab;
- после рестарта оператор продолжает по state/plan.

## 14. Открытые вопросы

- Соглашение об именах `plan/*.expect.ts` и `program.expect.ts`;
  как кодировать подпрограммы.
- Гранулярность цели: один `describe` — одна цель или файл-тема.
- Формулы метрик feedback: что считать «пустым отвлечением» и
  `tokens_wasted_estimate`; как не собирать секреты.
- Точная схема `context/roles.yml` и правила композиции кастомных
  ролей.
- Схема preset: `role_skills`, `role_exceptions`, `autonomy`,
  external roles; как установщик переносит их в `context/roles.yml` и
  `context/autonomy.yml`.
- External executor: target mapping, remote workspace/branch, publish
  policy, много web-приложений.
- AST-валидатор `plan/*.expect.ts`: как ловить смысловое ослабление
  проверки, не только структуру.
- Точная схема skill manifest (`context/skills.yml`), правила
  `core`/`project`/`extends` и allowlist оператора.
- Матрица browser-capability: какие tools у OpenCode/Claude/Codex,
  какие действия `self`/`ask`/`never`, какие домены.
- Сколько живёт paused-исполнитель и когда его закрывать.
- Схема watcher events, retention JSONL, ack/replay.
- Точные схемы формальных сообщений brief/report/verdict/docs_request.
- Область формальной проверки документации: ссылки/схема/дубли или
  ещё смысловые проверки.
- Поведение при удалённых проверках внешнего проекта.

## 15. Что не делаем

- не пишем новый runtime;
- не тащим FSM в плагин;
- не развиваем внешний harness сейчас;
- не мигрируем существующие v3-проекты — это забота ответственного;
- не сохраняем goals/programs в новой модели;
- не держим `oracle`/`reviewer` «на всякий случай»;
- не плодим `browser-executor` по умолчанию;
- не даём skill без tool/permissions;
- не даём оператору ролевые skills, кроме `operator-feedback`;
- не даём оператору/executor писать документацию;
- не даём judge менять состав/budget expectations;
- не делаем marketplace и упаковку skills.

## 16. Состояние и следующая итерация

### 16.1 Сейчас

- Есть только этот design-документ.
- Код, промпты, skills, контракт v3, пакеты и `prompts/index.yml` не
  менялись.
- Принятые решения — раздел 0; открытые вопросы — раздел 14.
- Следующая итерация начинается с 16.2, а не с кода плагина.

### 16.2 Порядок следующей итерации

1. **Зафиксировать схемы и решения.**
   - `plan/*.expect.ts` (AST + `describe`/`crit`/`warn`/`it.todo`),
     `plan/program.expect.ts`, `verdict.yml`, `report.yml`,
     `brief.yml`, `.ops/feedback/<ticket>.yml`, `context/project.yml`
     (`sync.contract.edition`), `context/autonomy.yml`,
     `context/roles.yml`, `context/skills.yml`, skill manifest,
     browser autonomy, preset schema, `state.yml`, watcher event,
     baseline `.ops/<ticket>/baseline/`.
   - Решить открытые вопросы из раздела 14, которые блокируют схемы.
2. **Переписать контракт v3.**
   - роли operator/researcher/executor/judge/librarian;
   - external-executor для удалённого проекта/GUI;
   - формальные сообщения;
   - плоский `plan/` вместо goals/programs;
   - scratchpad;
   - feedback;
   - кастомные роли;
   - реестр skills и привязка к ролям;
   - browser-capability и autonomy;
   - пресеты: `role_skills`, `role_exceptions`, `autonomy`;
   - матрица прав;
   - убрать обязательный FSM из интерактивной части; harness/ops/
     watchers оставить модулями.
3. **Переписать skills и agents.**
   - шаблон `AGENTS.md` в контракте — протокол оператора; отдельного
     `skills/operator` нет, `agents/operator` не создаём;
   - удалить `skills/operator` и его запись из `prompts/index.yml`;
   - `skills/operator-feedback` — новый;
   - `skills/research` + `agents/researcher`;
   - `skills/executor` + `agents/executor` (переименовать
     `implementer`);
   - `agents/external-executor` для external-пресета;
   - `skills/judge` + `agents/judge`;
   - `skills/librarian` + `agents/librarian` (переименовать
     `docs-keeper`);
   - `skills/browser` и `skills/browser-read` — core-skills контракта;
     требуют browser tool/MCP в проекте;
   - убрать `oracle`/`reviewer`;
   - пометить `goals`/programs и `context/views` deprecated;
   - обновить presets, modules, `prompts/index.yml`.
4. **OpenCode MVP.**
   - v3-only активация: `sync.contract.edition: operator-centric`;
   - `.opencode/agents` и skills из `context/roles.yml` +
     `context/skills.yml`;
   - `plan/program.expect.ts` + `ai plan check`;
   - `todowrite` + `subagent`;
   - `browser`/`browser-read` через browser tool/MCP;
   - `external-executor` и remote target;
   - docs guard plugin;
   - `submit_result`;
   - `operator state check`;
   - `operator-feedback` tool/skill.
5. **Watcher MVP.**
   - JSONL event log;
   - MCP-фасад;
   - Unix socket/named pipe, HTTP-fallback;
   - plugin wake;
   - ack/replay.
6. **Гейты.**
   - `ai plan check` (AST), `ai skills check`, `ai roles check`;
   - docs consistency, check ladder, browser autonomy;
   - DoD пресетов;
   - гейты должны быть зелёными до пилота.
7. **Пилот.**
   - один проект;
   - критерии — раздел 13;
   - после пилота — правки контракта и схем.
8. **Другие runtime.** Claude Code/Codex адаптеры после пилота;
   внешний harness для headless — позже.

### 16.3 Ожидаемые файлы

Источник `ai-prompts`:

- `design/operator-centric-v3.md` — этот документ.
- `design/agent-operational-contract-v3.md` — пометить, что
  интерактивная часть заменена этим документом; FSM-часть остаётся для
  headless.
- `design/operator.md`, `design/roles.md` — обновить или пометить
  историей.
- `prompts/productivity/agent-operational-contract-v3.md` — шаблон
  `AGENTS.md` с протоколом оператора; корневой `AGENTS.md` ai-prompts не
  трогать.
- `skills/operator-feedback`, `skills/research`,
  `skills/executor`, `skills/judge`, `skills/librarian`,
  `skills/browser`, `skills/browser-read`.
- `agents/researcher`, `agents/executor`,
  `agents/external-executor`, `agents/judge`, `agents/librarian`.
- `presets/*`, `prompts/modules/*`, `prompts/index.yml`.
- `expectations/schemas/*`, `expectations/*.expect.ts`.
- Пакеты/плагин/демон — только после контракта и схем.

Проект-потребитель (устанавливается/создаётся):

- `plan/program.expect.ts`, `plan/*.expect.ts`.
- `.ops/<ticket>/{baseline,research,reports,verdicts,checks}/`,
  `.ops/feedback/<ticket>.yml`; `.ops/operator/state.yml` — локально.
- `context/project.yml`, `context/autonomy.yml`, `context/roles.yml`,
  `context/skills.yml`.
- `.agents/agents/*`, `.agents/skills/*`.
- `AGENTS.md`.

### 16.4 Проверка итерации

- `npm run index:build` — индекс промптов.
- `npm run ci` — format, build, typecheck, lint, tests, index, expect.
- `npm run expect` — ожидания; при новых смысловых заголовках —
  `npm run expect:judge:opencode`.
- Итерация контракта считается завершённой, когда контракт, skills,
  agents, presets, схемы и `prompts/index.yml` согласованы, а
  `npm run ci` зелёный. Плагин, watcher и гейты — следующая итерация.
- Preset DoD: схема пресета валидна; каждая core-роль есть в
  `role_skills` или `role_exceptions`; skills модулей и ролей
  разрешаются; `autonomy` переносится в `context/autonomy.yml`;
  external содержит полный `external-executor`.
- Operator DoD: `skills/operator` и `agents/operator` отсутствуют;
  оператор — primary в `context/roles.yml`, протокол в `AGENTS.md`.
- Browser DoD: `browser`/`browser-read` есть в `context/skills.yml`;
  `requires.tools` разрешается в runtime; granular permissions
  (`browser.click`, `browser.type`) — в `context/skills.yml`, уровни
  `self`/`ask`/`never` — в `context/autonomy.yml`.
- Пилот — по разделу 13, после плагина, watcher и гейтов.

### 16.5 Что не начинать первым

- Не писать плагин до схем и контракта.
- Не мигрировать проекты.
- Не тащить FSM в плагин.
- Не делать marketplace.
- Не добавлять `oracle`/`reviewer` обратно.
- Не добавлять `proposal/specs/design/tasks` и другие планировочные
  файлы: `plan/` — только `*.expect.ts` и `program.expect.ts`.

### 16.6 Если сессия перезапустилась

Читать: раздел 0 → раздел 16.1 → раздел 16.2. Текущее состояние —
только дизайн; следующий шаг — схемы и контракт, не код плагина. Все
решения и открытые вопросы — в этом документе, внешнего контекста не
требуется.
