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
2. Раздел 16 — текущее состояние, порядок итерации (16.2) и решения
   вне §14 (16.7).
3. Остальной документ — детали ролей, артефактов и протоколов.

Текущее состояние: **только дизайн**. Код, промпты, skills и контракт
v3 ещё не менялись. Следующий шаг — **16.2.1: схемы и решения**, не код
плагина.

## 0. Принятые решения

- **v3 in place.** Ключ `agent-operational-contract-v3` не меняем.
- **Маркер редакции.** В `context/project.yml`:
  `sync.contract.edition: operator-centric`. Плагин активируется только
  при этом маркере; старые v3-проекты без него не затрагиваются.
- **`goals/` — цели и программы.** Один файл — одна цель
  `goals/<goal>.expect.ts` или одна программа
  `goals/program--<key>.expect.ts`. Программа — агрегатор: импортирует
  свои цели в порядке приоритета; программ много, единой очереди нет;
  одна цель входит ровно в одну программу. Старый `program` из
  `context/views` сюда не переносится. Проверки запускаются в скоупе:
  одна цель или целая программа.
- **Цель и тикеты.** Внутри файла цели — тикеты:
  `describe('ticket: …')` со своими `crit`/`warn`/`it.todo`. Один
  активный тикет на файл цели; параллель — между целями. Артефакты
  тикета — `.ops/<ticket>/`.
- **Этапы цели.** `it.todo` — план; `it.todo` нет — готовый план; нет
  `it.todo`/`crit.wip` и все тикеты приняты (≥80% `pass`) — цель
  достигнута, файл и импорт удаляются. Стадию показывает `ai goals
  status`.
- **`goals/` коммитится.** Это рабочее пространство целей, замена
  `context/views`. Старая очередь goals/programs в новой модели не
  используется; паттерн и модуль `goals` остаются deprecated для старых
  проектов и в v3 не ставятся: приоритет — порядок импортов внутри
  программы, завершённое удаляется, история — git.
- **External executor.** Для external-проекта нужен executor, который
  работает в удалённом проекте и меняет его; GUI/CI-работы — его
  штатная нагрузка.
- **Scratchpad локальный.** `.ops/operator/state.yml`, в git не
  попадает.
- **Открытость и явность.** Долговременное состояние — только в git;
  локальные файлы (scratchpad, locks, event log) — явные кэши, не
  влияющие на решения; память инструментов выключена.
- **Memory guard — часть ядра.** Память инструментов выключена не на
  словах: memory-инструменты и memory-MCP запрещены, запись в
  memory-пути блокируется, настройки и hooks ставят адаптеры и проверяет
  `ai adapters check`.
- **Judge resume** — только в цикле judge ↔ executor. Вернулись к
  оператору — новый свежий judge; запускает его executor по команде
  оператора.
- **Оператор всегда на связи.** Все роли оператор запускает только с
  `background: true`; он не блокируется на субагенте и отвечает
  человеку. Завершение роли будит оператора результатом; человек может
  разбудить его напрямую.
- **Модели закреплены.** Все роли — DeepSeek V4.1 Flash 1017
  (`deepseek/deepseek-flash`); по умолчанию `#max`, judge — `#low`.
  Бесплатные модели запрещены. Модель — обязательное поле frontmatter
  роли.
- **Результаты прогонов.** Рядом с каждым `*.expect.ts` лежит
  `*.expect.json`: `timestamp` и `results`; оператор сбрасывает файл
  перед циклом, judge добавляет запись `{run, items}`. Статусы —
  `pass`/`удовлетворительно`/`fail`; во втором и последующих прогонах негатив
  помечается `удовлетворительно`.
- **Циклы.** Первый прогон judge — `pass`/`fail`; executor дорабатывает;
  второй — негатив `удовлетворительно`. Оператор считает 80% `pass` по
  `crit`/`warn` активного тикета (закрыто = `pass`); если меньше — может
  один раз запустить повторный цикл executor→judge, после него — к
  человеку.
- **Делегирование executor.** Executor может запускать `judge` и
  `researcher`; другие роли — нет. Глубина не больше 2 (оператор →
  executor → judge/researcher); judge и researcher не запускают никого;
  все запуски видны в GUI.
- **Merge worktree** — оператор.
- **Watcher-транспорт** — MCP + Unix socket; на Windows — named pipe
  или HTTP-fallback. Event log — JSONL.
- **`oracle` и `reviewer` удаляются** из ядра; не плодим роли.
- **Лимит исполнителей** — не больше 5 одновременно работающих
  executor. Сессия на паузе не считается.
- **Исполнители могут спать.** Пауза — штатное состояние; оператор не
  опрашивает и не «агрится» на спящих.
- **Кастомные роли** — формальное пространство и схема.
- **Skills проекта** — `.agents/skills` + `context/skills.yml`; core через
  source-sync, project через `extends`/новый skill; оператор — только
  allowlist.
- **Роли — один файл.** `.agents/agents/<role>.md` — единственный
  источник роли (frontmatter + промпт); `context/roles.yml` нет.
  Привязка skills — `context/skills.yml`, исключения ролей —
  `context/project.yml`. Оператор — исключение: файла роли нет, его
  `kind`/`lifecycle` фиксирует контракт, allowlist — `skills.yml`.
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
- **Чтение и запись разделены.** Оператор, executor и judge
  документацию только читают. Правки — через librarian.
- **Скиллы — ролям.** Оператор не загружает ролевые skills; его протокол
  живёт в `AGENTS.md`. Исключения — `operator-feedback` и явный
  `browser-read`.
- **Артефакты вместо FSM.** `goals/`, expectations, вердикты и
  отчёты — это состояние задачи.
- **`goals/` вместо `context/views`.** Плоские
  `goals/<goal>.expect.ts` и `goals/program--<key>.expect.ts`; программа
  импортирует свои цели, приоритет — порядок импортов внутри программы.
  Никаких `goals/index.yml`, `goals/README.md`, `expectations.yml`.
- **Открытость и явность.** Всё, что влияет на решения, живёт явными
  файлами в репозитории и переносится на другую машину. Скрытой памяти
  инструмента, глобальных инструкций и hooks вне репозитория нет.
  Локальны только явные кэши (`.ops/operator/state.yml`, `.ops/locks/`,
  watcher event log): они не источник истины, не содержат решений и
  восстанавливаются из `goals/`, docs и git.
- **Memory guard.** Запрет memory — часть ядра, не опция: memory-MCP и
  memory-инструменты запрещены, запись в memory-пути блокируется,
  настройки и hooks ставят адаптеры, `ai adapters check` проверяет.
- **Формальное общение.** Оператор и роли общаются сообщениями по схеме,
  не свободным чатом.
- **Кастомные роли.** Проект может добавлять свои роли в формальном
  пространстве `.agents/agents`.
- **Skills проекта формальны.** `.agents/skills` + `context/skills.yml`;
  core — source-sync, project — extends/новый skill; оператор —
  allowlist.
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
- **Оператор не блокируется.** Долгие роли — только `background: true`;
  оператор всегда доступен человеку, просыпается на результате или
  сообщении.
- **Модели фиксированы.** `deepseek/deepseek-flash`, по умолчанию
  `#max`, judge — `#low`; бесплатные модели запрещены.
- **Результаты прогонов — файл.** Рядом с `*.expect.ts` лежит
  `*.expect.json` с историей прогонов; решение о повторе — по нему, не
  по чату.
- **Фидбек в источник.** Оператор умеет собирать метрики работы,
  причины и рекомендации по улучшению контракта.

## 3. Паттерны

- **`source-sync`** — применяется: контракт, skills и роли обновляются из
  источника через индекс и SHA. Trade-off нет.
- **`guardrail-dual-level`** — применяется к правилам, которые должны
  работать и как инструкция агенту, и как механический запрет
  (документация только librarian, права ролей). Trade-off — нужны
  permissions/скрипты под каждый runtime.
- **`goals`** — больше не применяется в v3: работа и приоритеты
  переезжают в `goals/`. Паттерн и модуль `goals` (старая очередь
  `context/views`) остаются для старых проектов, помечаются deprecated и
  в v3-проектах не ставятся; с новым `goals/` их не путать.

Рекомендация: `source-sync` — всегда; `guardrail-dual-level` — для
документации и прав ролей; `goals` — не применять в новых v3-проектах.

## 4. Роли

### 4.1 Оператор

Один, primary, постоянная сессия. Модель — `deepseek/deepseek-flash#max`.

**Читает:** `AGENTS.md`, `context/`, `docs/`, `goals/` (цели и
программы), `*.expect.json`, артефакты ролей.

**Пишет:** `goals/program--<key>.expect.ts`,
`goals/<goal>.expect.ts`, `.ops/operator/state.yml`,
`.ops/feedback/<ticket>.yml`, сброс `*.expect.json` перед циклом.

**Не пишет:** `docs/`, `context/`, `CHANGELOG.md`, код.

**Не загружает ролевые skills.** Протокол — в `AGENTS.md` и в
операторском разделе контракта.

**Делает:**

- принимает запрос и определяет сценарий: `plan`, `execute`, `audit`,
  `challenge`, `report`;
- берёт приоритеты из порядка импортов в файлах программ и указаний
  пользователя; не изобретает их;
- фиксирует цель как `goals/<goal>.expect.ts`: `describe` цели и
  `describe('ticket: …')` на каждый тикет; на первом проходе —
  `it.todo`/`crit.wip`, затем механика проверок;
- ведёт тикеты: один активный на файл цели, следующий — после принятия
  предыдущего; тикет принят, когда ≥80% его `crit`/`warn` — `pass`,
  остальные `удовлетворительно` — принятый остаток;
- держит `goals/program--<key>.expect.ts` как агрегаторы; удаляет цель
  из её программы и из `goals/`, когда все её тикеты приняты;
- состав целей, программы и бюджет — его собственность;
- запускает роли только с `background: true`; не блокируется, всегда
  отвечает человеку; просыпается на результате роли или сообщении;
- перед циклом сбрасывает `*.expect.json` активной цели в
  `{timestamp, results: []}` и запускает executor;
- по результатам judge считает 80% `pass` по `crit`/`warn` активного
  тикета; меньше — может один раз запустить повторный цикл
  executor→judge, после него — к человеку;
- выдаёт брифы ролям; параллельные задачи — параллельно,
  зависимые — последовательно;
- выделяет worktree исполнителям; для external — удалённый target;
  merge — его;
- держит не больше 5 активных executor; paused не считает;
- запускает проверки и гейты в скоупе: цель или программа;
- обновляет `goals/`, `todowrite` и scratchpad;
- по запросу собирает feedback по метрикам и причинам;
- отчитывается пользователю коротко и по делу;
- эскалирует только то, что не может решить сам.

**Не делает:** не читает сырые логи ролей без нужды, не перепроверяет
их работу вручную, не блокируется на минуты молча.

**Отзывчивость:** перед долгим запуском — строка «что запущено, чего
жду, сколько примерно»; дальше — ответы на сообщения, итог по
уведомлению.

### 4.2 Researcher

Всегда свежий контекст, без resume. Модель —
`deepseek/deepseek-flash#max`. Запускает оператор или executor в рамках
тикета; researcher не запускает никого.

**Читает:** всё, что нужно по задаче.

**Пишет:** только `.ops/<ticket>/research/<id>.md` (один артефакт на
задание).

**Не пишет:** код, документацию, `goals/`, expectations.

**Возвращает:** находки, источники, уверенность, неизвестное,
рекомендацию и указатели. Без сырых дампов.

**Параллельность:** сколько угодно; каждый — отдельная задача и
отдельный артефакт.

**Зачем:** разведка перед планом, внешние системы, код, документация.
Если ответ не найден — это фиксируется, а не выдумывается.

### 4.3 Executor

Возобновляемая сессия; работает в своём worktree. Модель —
`deepseek/deepseek-flash#max`. Может запускать `judge` и `researcher`;
другие роли — нет. Глубина — не больше 2 (оператор → executor →
judge/researcher); judge и researcher никого не запускают; запуски видны
в GUI.

**Читает:** цель и тикет, expectations, `*.expect.json`, research,
вердикты judge, код, документацию.

**Пишет:** код, тесты, конфиги, `.ops/<ticket>/reports/<id>.md` в своём
worktree.

**Не пишет:** `docs/`, `context/`, `CHANGELOG.md`, `goals/`,
expectations.

**Получает:** тикет, DoD, ограничения, worktree, указатели, бюджет
(два прогона judge + один повторный цикл), `*.expect.json`, прошлые
замечания judge (без аргументов в чате).

**Возвращает:** что сделано, какие проверки прошли, что осталось, где
риски, указатель на diff/ветку.

**Resume:** для доработок по замечаниям judge или оператора. Новая
задача — новый worktree и, как правило, новая сессия.

**Цикл.** Получает сброшенный `*.expect.json`; после работы запускает
judge; judge пишет первый прогон. Читает результаты, дорабатывает,
запускает judge снова; judge пишет второй прогон (негатив —
`удовлетворительно`). Дальше executor ничего не делает, пока оператор не
запустит повторный цикл.

**Параллельность:** до 5 одновременно работающих executor; paused не
считается. Один worktree — один executor. Два executor в одном checkout
запрещены. Тикеты одной цели последовательны: они живут в одном файле;
параллель — между целями.

**Пауза:** исполнитель может стоять на паузе в ожидании очереди, события
или ответа пользователя. Это штатное состояние, а не сбой. Оператор не
опрашивает paused-сессии и не шлёт им «ты как?». Возобновление — по
событию, таймеру или просьбе пользователя. Пользователь может сказать
«эта задача на паузе» — оператор переводит проверки тикета в `crit.wip`,
ставит пометку `paused` и фиксирует паузу в scratchpad, не трогает
исполнителя.

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
«завалить», а довести до соответствия DoD. Модель —
`deepseek/deepseek-flash#low`. Запускает executor; judge виден в GUI;
глубина 2; сам judge никого не запускает.

Всегда читает только результат и expectations; **аргументов и чата
executor не видит**.

**Читает:** expectations, DoD, артефакты результата, проверки; из файла
цели — только свой `describe('ticket: …')`.

**Пишет:** `.ops/<ticket>/verdicts/<run>.yml` и `*.expect.json`:
добавляет запись `{run, items}` с результатами прогона. В первом
прогоне статусы `pass`/`fail`; во втором и последующих негатив
помечается `удовлетворительно`, `fail` не ставится. Может править в
`goals/<goal>.expect.ts` только `title` и механику проверки внутри
своего тикета.

**Не может:** добавлять/удалять `describe`/`crit`/`warn`/`it.todo`,
менять `budget`, трогать чужие тикеты, писать код или документацию.

**Если считает, что пункт лишний или заголовок искажает смысл:** правит
заголовок/механику в разрешённых местах и отчитывается; добавить/удалить
пункт — только предложение оператору.

**Валидация:** runtime-neutral AST-проверка
`ai goals check goals/<goal>.expect.ts --ticket <key>` сравнивает файл с
baseline: число и порядок `describe`/`crit`/`warn`/`it.todo` не
меняются, `budget` не меняется, разрешены только строки заголовков и
тела проверок; изменения вне блока активного тикета отклоняются.
Невалидная правка отклоняется.

**Baseline.** На старте ticket оператор снимает копию активного файла
`goals/<goal>.expect.ts` в `.ops/<ticket>/baseline/`; `ai goals check`
сравнивает с ней. Baseline обновляет только оператор — после merge
тикета; вне ticket baseline не меняется. Judge baseline не трогает.

**Где правит.** Judge работает в worktree executor: читает результат,
правит свой блок, пишет вердикт и checks туда же. Baseline-копия лежит в
том же worktree, потому что закоммичена до его создания. Оператор
мержит ветку, затем обновляет baseline в main. Для external схема та же
на target; детали — открытый вопрос §14.

**Возвращает:**

- executor — подробный результат по каждому пункту: вердикт, цитата,
  причина, что именно не сходится;
- оператору — сводку по последнему прогону: сколько `crit`/`warn`
  `pass`, `удовлетворительно`, `fail`, и долю закрытых (80%).

**Циклы:** за попытку — два прогона judge (первый и после доработки).
Оператор может один раз запустить повторный цикл executor→judge; после
него — к человеку. Бюджет задаёт оператор.

**Конфликт:**

- executor говорит «готово», а judge в первом прогоне показывает
  `fail` — executor дорабатывает;
- второй прогон не даёт 80% `pass` — оператор решает: один повторный
  цикл или к человеку;
- после повторного цикла — только к человеку с результатами.

**Сессия:** внутри цикла judge ↔ executor можно resume, чтобы уточнить
вердикт или продолжить диалог с исполнителем. Как только вопрос вернулся
оператору, исполнитель запускает свежий judge по команде оператора;
старый контекст не переиспользуется.

### 4.5 Librarian

Один, всегда свежий контекст, последовательный писатель документации.
Модель — `deepseek/deepseek-flash#max`.

**Читает:** документацию, код, `goals/`, запрос оператора.

**Пишет:** `docs/`, `context/`, `CHANGELOG.md`.

**Не пишет:** код, `goals/`, expectations, тесты.

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

- **operator** — без ролевого skill; протокол в `AGENTS.md`. Исключения:
  `operator-feedback` по явному запросу пользователя и `browser-read`
  только как явное исключение.
- **researcher** — `research`.
- **executor** — `executor` (кодовые правила и проверки).
- **judge** — `judge` (формат expectations и вердикта).
- **librarian** — `librarian` (правила документации и проверки
  целостности).

Скиллы не попадают в контекст оператора: в OpenCode это `skill`
permissions, в Claude Code — `skills` субагента, в Codex — инструкции
роли.

### 4.7 Скилл `operator-feedback`

Операторский skill-исключение; второй допустимый — явный `browser-read`
(см. 4.11/4.12). Загружается по явному запросу: «собери фидбек по
работе», «что улучшить в контракте».

**Вход:** `goals/`, reports, verdicts, scratchpad, session stats, события
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

### 4.8 Роли и кастомные роли

Роль — один файл; отдельного реестра нет. Исключение — оператор: файла
роли нет, его метаданные фиксирует контракт.

- источник роли — `.agents/agents/<name>.md`: frontmatter + промпт;
- схема frontmatter — `expectations/schemas/role.schema.json` (новый;
  расширяет `agent-frontmatter.schema.json`);
- привязка skills — `context/skills.yml` (`roles: [...]`), не в роли;
- исключения ролей (`role_exceptions`) — `context/project.yml`;
- адаптеры генерируют `.opencode/agents`, `.claude/agents`,
  `.codex/agents`.

Frontmatter роли:

```yaml
---
name: <kebab-case>
kind: primary | core | custom
description: <одна строка>
model: <provider/model#variant>
permissions: <capability или набор действий>
lifecycle: persistent | fresh | resumable | paused
concurrency: <число или unlimited>
output: <протокол>
artifacts: [<пути>]
---
<промпт роли>
```

Правила:

- все роли, включая core и `external-executor`, заполняют эту схему;
  примеры ролей — в 4.12 и 4.13, либо полные записи, либо явно
  помеченные фрагменты;
- `operator` — `kind: primary`, `lifecycle: persistent`; файла роли нет,
  протокол в `AGENTS.md`, allowlist skills — в `context/skills.yml`;
- `model` обязателен: `deepseek/deepseek-flash#max` по умолчанию, у
  judge — `#low`; бесплатные модели запрещены;
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
- валидация — схемой и `ai roles check`.

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
`librarian`. Переименование жёсткое, без deprecated-алиасов; ключи в
`prompts/index.yml` обновляются в той же итерации.

### 4.11 Skills проекта

Skill — это инструкции, а не инструмент. Ему нужны tool/MCP и
permissions; одно без другого не работает.

Пространство:

```text
.agents/skills/<name>/SKILL.md   # проектные и установленные core-skills
context/skills.yml               # каталог skills и привязка к ролям
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
    roles: [executor, external-executor]
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
      - browser.screenshot
      - browser.click
      - browser.type
      - browser.submit
    roles: [executor, external-executor]
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
      - browser.screenshot
    roles: [judge, researcher]
  - key: operator-feedback
    kind: core
    source: ai-prompts
    path: .agents/skills/operator-feedback
    sha: <hex>
    roles: [operator]
```

Autonomy в `skills.yml` не хранится: единственный источник —
`context/autonomy.yml`. Пресет может задать дефолты autonomy, но
установщик пишет их в `context/autonomy.yml`.

`roles` в `context/skills.yml` — единственный runtime-источник привязки.
Пресет `role_skills` — install-time дефолт: установщик инвертирует
роль → skills в `roles` записей `context/skills.yml`; роль skills не
перечисляет, второй источник не используется.

Роль без записей в `roles` не получает skills; оператор по умолчанию
без skills, кроме allowlist. Полные определения ролей — в
`.agents/agents/<name>.md`; оператор — primary, файла роли у него нет.

Операции:

- **добавить:** создать `.agents/skills/<name>/SKILL.md`, запись в
  `context/skills.yml` с `roles`, затем `ai skills check`;
- **обновить project skill:** править локально, обновить запись/`sha`,
  `ai skills check`;
- **обновить core skill:** только source-sync; локальные дополнения —
  новым skill/`extends`;
- **удалить:** убрать роль из `roles`, убрать из каталога; project-skill
  удалить, core оставить;
- **привязать к оператору:** только через allowlist. У оператора
  допустимы `operator-feedback` и, как явное исключение, `browser-read`;
  любая другая запись с `roles: [operator]` — ошибка валидатора.

Валидация `ai skills check`:

- `name` совпадает с каталогом, `description` есть;
- все `roles` ссылаются на существующую роль (`.agents/agents/<name>.md`
  или `operator`);
- project-skill не подменяет core без `extends`;
- у роли есть tools/permissions для skill;
- у оператора только разрешённые skills;
- нет секретов;
- нет skills, которые не ставит ни роль, ни контракт.

Runtime:

- OpenCode читает `.agents/skills` нативно; привязка — только из
  `context/skills.yml`; `skill` permissions дают доступ, но не задают
  привязку;
- Claude Code — `.claude/skills` + `skills` у субагента;
- Codex — `.agents/skills` + инструкции роли;
- `context/skills.yml` — источник привязки для всех адаптеров.

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
---
name: browser-executor
kind: custom
description: executor с полноценным управлением браузером
model: deepseek/deepseek-flash#max
lifecycle: resumable
concurrency: 1
permissions: [browser]           # capability; granular — в skills.yml
output: result
artifacts: [.ops/<ticket>/reports/]
---
<промпт роли>
```

`skills` в роли нет: привязка `[browser]` — в `context/skills.yml`.

Но это не новый вид executor по умолчанию, а кастомная роль с теми же
принципами.

Требования:

- tool/MCP: OpenCode browser namespace (desktop), Playwright MCP,
  browser-use или другой провайдер; адаптер отображает capability;
- permissions: `browser.navigate`, `browser.snapshot`,
  `browser.screenshot`, `browser.click`, `browser.type`,
  `browser.submit`;
- `browser-read` на нативном `browser` OpenCode v2 механически не
  ограничивается: действие одно на весь каталог. Это инструкция плюс
  аудит; механический запрет — через MCP-провайдера, где permission
  задаётся на каждый `<server>_<tool>`;
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
дефолты `autonomy`; отдельной схемы `goals/` нет — она одна для всех.
Core-роли одни и те же; external добавляет `external-executor`.
Модели: все core-роли — `deepseek/deepseek-flash#max`, judge — `#low`;
external-executor — `#max`.
`role_skills` — вход установки: установщик инвертирует его в `roles`
записей `context/skills.yml`; дальше runtime читает только `skills.yml`;
пресет не второй источник.
`role_exceptions` — явные замены/исключения core-ролей (например,
external заменяет executor на external-executor); установщик пишет их в
`context/project.yml` (`roles.exceptions`).

Общее для всех:

- `goals` (старая очередь `context/views`) не подключается;
- `harness` — только если нужны headless/CI jobs, не по умолчанию;
- `goals/` — плоские `*.expect.ts`: цели и `program--<key>.expect.ts`;
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
    model: deepseek/deepseek-flash#max
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
`roles` в `context/skills.yml`; runtime-истина — файл роли и
`context/skills.yml`. `skills` в записи роли пресета — вход установки, а
не поле роли. `role_exceptions` фиксирует, что core executor в этом
пресете заменён; это не ошибка покрытия.

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

| Роль | Модель | Документация | Код | Артефакты | Сессия | Параллельность |
| --- | --- | --- | --- | --- | --- | --- |
| operator | deepseek/deepseek-flash#max | read | read | goals/, .ops/operator/state.yml, .ops/feedback | постоянная | один |
| researcher | deepseek/deepseek-flash#max | read | read | .ops/<ticket>/research | свежая | много |
| executor | deepseek/deepseek-flash#max | read | write | .ops/<ticket>/reports, worktree | возобновляемая | ≤5 активных, paused не считается |
| external-executor | deepseek/deepseek-flash#max | read | write remote | .ops/<ticket>/reports, remote target | возобновляемая | ≤5 активных, paused не считается |
| judge | deepseek/deepseek-flash#low | read | read | .ops/<ticket>/verdicts, goals expect, *.expect.json | resume в цикле; свежая по команде оператора | много, по файлу |
| librarian | deepseek/deepseek-flash#max | write | read | docs/, context/, CHANGELOG | свежая | один |

Активных executor — не больше 5; paused не считается. Merge локального
worktree — оператор; external publish — по autonomy. Judge меняет
`goals/*.expect.ts` только в заголовках/механике своего тикета;
AST-валидатор не даёт менять состав и бюджет. Skills привязываются через
`context/skills.yml`; browser-права — только через `browser`/`browser-read`
и autonomy. Цикл: два прогона judge, 80% `pass` по `crit`/`warn`, один
повторный цикл executor→judge.

Механическое исполнение:

- **OpenCode** — `permissions` агентов + плагин docs guard + `skill`
  permissions; `subagent` только для ролей.
- **Claude Code** — субагенты, `tools`, hooks; ограничения на docs.
- **Codex** — роли/инструкции, внешний runner, проверки.
- **Headless** — внешний harness: роль получает только разрешённые
  инструменты.

Инвариант один: документацию пишет только librarian; оператор и
executor — никогда. Память инструментов выключена на всех runtime (см.
§10).

## 6. Артефакты

```text
goals/
  <goal>.expect.ts          # цель: describe('goal') → describe('ticket: …') → crit/warn
  <goal>.expect.json        # результаты прогонов judge рядом с файлом цели
  program--<key>.expect.ts  # программа: импорты своих целей в порядке приоритета
  ...

.ops/
  operator/state.yml       # локальный scratchpad, в git не идёт
  feedback/<ticket>.yml    # фидбек по работе
  <ticket>/
    baseline/              # снимок файла цели на старте ticket
    research/              # researcher
    reports/               # executor
    verdicts/              # judge
    checks/                # результаты проверок

context/
  project.yml              # sync.contract.key/edition, external targets, roles.exceptions
  autonomy.yml             # единственный источник уровней self/ask/never
  skills.yml               # каталог skills, requires, permissions, привязка roles
.agents/
  skills/<name>/SKILL.md   # проектные и установленные core-skills
  agents/<name>.md         # роли: frontmatter + промпт
```

`goals/` — плоский набор `*.expect.ts` и `*.expect.json`. Никаких
`goals/index.yml`, `goals/README.md`, `expectations.yml`,
`proposal/specs/design/tasks` нет. `context/ai-core.yml`,
`context/modules/`, `context/conventions/` и `context/index.yml`
остаются как в контракте v3: новые файлы аддитивны.

- Файл программы содержит только импорты своих целей; порядок импортов
  = приоритет внутри программы. Программ много, единой очереди нет;
  одна цель — в одной программе.
- Проверки запускаются в скоупе: `ai expect report
  goals/<goal>.expect.ts` — одна цель, `ai expect report
  goals/program--<key>.expect.ts` — вся программа.
- Каждая цель — `describe('goal: …')`; внутри — тикеты
  `describe('ticket: …')`, в каждом — `crit`/`warn`.
- Незапущенный тикет — `it.todo`; paused или в работе — `crit.wip`
  (падение не блокирует); пометка паузы — в заголовке тикета и
  scratchpad.
- Этапы цели: есть `it.todo` — план; `it.todo` нет — готовый план; все
  тикеты приняты (≥80% `pass`) — цель достигнута.
- `ai goals status` показывает программы, их цели, стадии (план /
  готовый план / достигнута) и тикет в работе (по `crit.wip`);
  «достигнута» фиксируется до удаления файла. `ai goals check` требует
  файл цели и явный `--ticket`: активный тикет не берётся из локального
  кэша.
- `goals/` не входит в `npm run expect`: цель или программа запускается
  по запросу.
- `goals/` коммитится. Завершённая цель удаляется из своего файла
  программы и из `goals/`; история — git.
- `.ops/<ticket>/` коммитится как след работы; `.ops/operator/` —
  локальный и не коммитится.
- `goals/` — не проектная документация; docs guard его не трогает.
- Это не `expectations/*.expect.ts` репозитория: там долгосрочные
  ожидания к промптам и коду; здесь — цели конкретной работы. Механизм
  `*.expect.json` одинаков для обоих: файл лежит рядом с любым
  `*.expect.ts`.

Пример цели:

```ts
import { describe, crit, warn } from '@shahimat/ai-core/expect';

describe('goal: обновить AGENTS.md', () => {
  describe('ticket: route', () => {
    crit('AGENTS.md содержит маршрут к goals/', () => Check.route());
  });
  describe('ticket: pointer', () => {
    warn('CLAUDE.md остаётся прослойкой', () => Check.pointer());
  });
});
```

Пример программы:

```ts
import './agents-md.expect.ts';
import './contract-v2.expect.ts';
import './judge.expect.ts';
```

Правила judge:

- judge может менять только строки заголовков и механику проверок внутри
  своего `describe('ticket: …')` в `goals/<goal>.expect.ts`;
- judge не добавляет/удаляет `describe`/`crit`/`warn`/`it.todo`, не
  меняет `budget`, не трогает чужие тикеты и файлы программ;
- baseline — снимок активного `goals/<goal>.expect.ts` на старте ticket
  в `.ops/<ticket>/baseline/`, обновляет только оператор после merge;
- `ai goals check` парсит AST и сравнивает с baseline: число и порядок
  `describe`/`crit`/`warn`/`it.todo`, `budget` неизменны; разрешены
  только заголовки и тела проверок внутри активного тикета;
- невалидная правка отклоняется, judge получает ошибку;
- judge отчитывается, что именно изменил.

### Результаты прогонов

Рядом с каждым `*.expect.ts` лежит `*.expect.json`:

```json
{
  "timestamp": "<ISO начала цикла>",
  "results": [
    {
      "run": 1,
      "items": [
        { "key": "crit: ...", "status": "pass | удовлетворительно | fail", "reason": "..." }
      ]
    }
  ]
}
```

- Перед циклом оператор сбрасывает файл в `{ timestamp: now, results: [] }`.
- Judge после прогона добавляет `{ run, items }`; `run` — 1, 2, 3;
  `items` — только `crit`/`warn` активного тикета, закрытые тикеты в
  текущий run не входят.
- `run` — один прогон judge; попытка — два прогона; повторный цикл —
  run 3. Перед повторным циклом `results` не сбрасывается: run 3
  дописывается.
- Первый прогон — `pass`/`fail`; второй и последующие — негатив
  `удовлетворительно` (без `fail`).
- `удовлетворительно` не считается закрытым. 80% — доля `pass` по всем
  `crit`/`warn` активного тикета (items последнего run), а не по всему
  файлу.
- За попытку — два прогона; оператор может один раз запустить третий
  (повторный цикл), после него — к человеку.
- `*.expect.json` коммитится рядом с `*.expect.ts`. Сброс коммитит
  оператор до создания worktree; run пишет judge в worktree, оператор
  мержит ветку и коммитит результат вместе с тикетом. В репозитории
  источника — тот, кто запускает проверку.

Это ответ на «как валидировать diff judge на всех runtime»: не через
permissions рантайма (они path-level), а общим AST-валидатором,
одинаковым для OpenCode, Claude Code и Codex.

## 7. Протоколы

### 7.1 План

1. Оператор читает маршрут, `goals/` (цели и программы),
   документацию по задаче.
2. Определяет сценарий и DoD.
3. Пишет `goals/<goal>.expect.ts`: `describe('goal: …')`, внутри —
   `describe('ticket: …')` на каждый тикет; на первом проходе —
   `it.todo`/`crit.wip`, затем механика проверок.
4. Добавляет импорт цели в файл её программы
   `goals/program--<key>.expect.ts` в порядке приоритета.
5. Показывает пользователю план, если есть развилка; иначе идёт по
   согласованному сценарию.
6. Тикеты раскрываются по одному: следующий — после принятия
   предыдущего. Цель удаляется, когда все её тикеты приняты (≥80%
   `pass`).

### 7.2 Бриф роли

Бриф — формальное сообщение `brief`, указатели, не пересказ:

- `id`, `ticket`, `role`, `goal` — цель одной строкой и что считать
  готовым;
- `goals/program--<key>.expect.ts`, `goals/<goal>.expect.ts`,
  `*.expect.json`, research, verdicts — путями;
- `worktree`, `constraints`, `deadline`, `budget` — ограничения;
- `output` — формат ответа и куда писать артефакт;
- `questions` — что роль должна спросить, а не додумать.

Бриф — до 15 строк. Длиннее — пересказ того, что роль прочитает сама.

### 7.3 Цикл executor ↔ judge

1. Оператор сбрасывает `*.expect.json` активной цели в
   `{ timestamp: now, results: [] }`, коммитит его до создания worktree
   и запускает executor в фоне.
2. Executor работает, запускает judge; judge в worktree executor читает
   expectations, DoD и результат; аргументов executor не видит; из файла
   цели читает только свой `describe('ticket: …')`; пишет run 1
   (`pass`/`fail`).
3. Executor читает run 1, дорабатывает по замечаниям, запускает judge
   снова; judge пишет run 2, негатив — `удовлетворительно`.
4. Executor больше ничего не делает; оператор получает сводку по
   последнему прогону.
5. Оператор считает долю `pass` по `crit`/`warn`. ≥80% — тикет принят,
   merge и baseline. <80% — оператор может один раз запустить повторный
   цикл (run 3); после него — к человеку.
6. Если judge меняет заголовок/механику — правит только свой блок в
   `goals/<goal>.expect.ts`; `ai goals check` с файлом цели и
   `--ticket <key>` проверяет AST и отклоняет добавление/удаление
   пунктов, смену бюджета и правки чужих тикетов.
7. Judge не запускает никого; executor запускает только judge и
   researcher; глубина — 2; запуски видны в GUI.
8. Тикет принят — оператор мержит ветку вместе с `*.expect.json`,
   обновляет baseline и закрывает тикет; следующий тикет цели
   начинается с нового baseline.

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
4. Оператор обновляет `goals/`/todo, решает, что делать.
5. Событие подтверждается; повторно не доставляется.

### 7.7 Feedback

1. Пользователь просит: «собери фидбек».
2. Оператор загружает `operator-feedback`.
3. Собирает метрики из session stats, `goals/`, reports, verdicts,
   scratchpad, событий.
4. Классифицирует пустые отвлечения и потери токенов; помечает оценки
   как estimate.
5. Формулирует причины и рекомендации с evidence.
6. Пишет `.ops/feedback/<ticket>.yml`; контракт сам не правит.

### 7.8 Пауза исполнителя

1. Пользователь: «эта задача на паузе» или оператор видит ожидание
   события/очереди.
2. Оператор переводит проверки тикета в `crit.wip`, ставит пометку
   `paused` в заголовок тикета и фиксирует паузу в scratchpad;
   executor-сессия остаётся, но не считается активной.
3. Оператор не опрашивает paused-сессию и не шлёт статусные пинги.
4. Возобновление — событие, таймер, просьба пользователя или решение
   оператора.
5. В `todowrite` пункт остаётся `pending` с пометкой «paused» в тексте;
   в `goals/` — точный статус.

## 8. Операторский scratchpad

`.ops/operator/state.yml` — локальное временное состояние оператора, не
memory и не проектная документация. В git не попадает и не является
частью репозиторного состояния.

Схема:

```yaml
session: <id>
goal: <одна строка>
priorities: [<ссылки на goals/program--<key>.expect.ts или goal>]
programs: [<активные программы>]
tickets: [<активный тикет и его цель>]
results: [<активные *.expect.json>]
waits: [<чего ждём и где>]
open_questions: [<что требует решения>]
pointers: [<файлы и сессии>]
updated_at: <ISO>
```

Правила:

- лимит: 200 строк / 16 KB; без сырых логов и секретов;
- 80% — предупреждение; 100% — блокировка записи до утилизации;
- state — только указатели, ожидания и открытые вопросы; решения
  пишутся в `goals/` или docs, state на них только ссылается;
- устойчивые факты — librarian; детали — `goals/`; resolved — удалить;
- на рестарте оператор читает state, сверяет с `goals/` и продолжает;
- state не переносится между машинами; на новой машине оператор
  восстанавливается из `goals/` и docs;
- проверка — `ai operator state check` или plugin/hook; одинаково для
  всех runtime.

Scratchpad не является скрытой memory: он явный, ограниченный и
читаемый пользователем. Всё, что влияет на решения надолго, уходит в
docs. При смене машины или потере state оператор восстанавливается по
`goals/` (цели и программы), целям в `goals/` и документации; state —
кэш, не истина.

## 9. Строгость на краях

- **Схемы:** `goals/*.expect.ts` (AST: цели и программы),
  `*.expect.json` (timestamp + results), verdict, report, brief,
  feedback, state, role frontmatter (включая model), skills, skill
  manifest, browser autonomy, watcher events.
- **AST-валидаторы:** judge не меняет число/порядок
  `describe`/`crit`/`warn`/`it.todo` и `budget`; разрешены только
  заголовки и тела проверок внутри тикета из `--ticket`; baseline —
  снимок активного `goals/<goal>.expect.ts` в
  `.ops/<ticket>/baseline/`, обновляет оператор после merge.
- **Валидатор целей:** `goals/program--*.expect.ts` содержит только
  импорты; одна цель — ровно в одной программе; у цели один активный
  тикет.
- **Результаты прогонов:** `*.expect.json` рядом с любым
  `*.expect.ts`; оператор сбрасывает `timestamp` и `results`, judge
  добавляет `{run, items}`; первый прогон — `pass`/`fail`, второй и
  последующие — негатив `удовлетворительно`; 80% считается по `pass` в
  `crit`/`warn` активного тикета.
- **Модели:** все роли — `deepseek/deepseek-flash`; по умолчанию
  `#max`, judge — `#low`; бесплатные модели запрещены.
- **Скрипты:** lint, typecheck, tests, build, docs consistency,
  expectations, goals check, goals status, roles check, skills check,
  operator state check.
- **Locks:** docs (librarian), goal expectation (judge/operator),
  worktree (executor), файлы программ (operator); файловые, через CLI
  (`.ops/locks/`).
- **Бюджеты:** два прогона judge за попытку, один повторный цикл
  executor→judge, время роли, размер scratchpad, активные executor (≤5),
  paused не считается. Лимит и paused — протокол плюс аудит, не
  механический запрет рантайма.
- **Аудит:** sessionID роли, задача, вердикт, артефакты, кто запустил,
  сколько токенов/времени.
- **Permissions:** docs write только librarian; operator, executor и
  judge — deny на `edit` вне разрешённых путей (у judge — только
  `goals/*.expect.ts`, `.ops/<ticket>/verdicts/`, `*.expect.json`).
  Запись через shell покрывается аудитом, не path-level permission.
- **Memory guard:** memory-инструменты и memory-MCP запрещены; запись в
  memory-пути (`~/.claude/projects/*/memory/`, memory-каталоги Codex,
  аналоги) блокируется; OpenCode — deny memory-MCP/инструментов и
  `permission.hook("evaluate")`; `ctx.storage` — только явные кэши.
  Настройки и hooks ставит `ai adapters sync`, проверяет
  `ai adapters check`.

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

- оператор — primary-сессия; все запуски ролей — `background: true`;
  оператор не блокируется и всегда доступен человеку, просыпается на
  результате или сообщении;
- роли — subagents с `mode: subagent`, включая кастомные; источник —
  `.agents/agents/<name>.md`, адаптер генерирует `.opencode/agents`;
- `experimental.todo: true` — видимый чеклист;
- `experimental.subagent_depth: 2` — executor может запускать
  `judge`/`researcher`; глубже нельзя; всё видно в Subagents tab/GUI;
- `subagent` — запуск ролей; active ≤5, paused не считается; лимит —
  протокол и аудит, не запрет рантайма;
- модели: оператор, researcher, executor, external-executor, librarian —
  `deepseek/deepseek-flash#max`; judge — `#low`; бесплатные модели deny;
- `todowrite` — плоский список; иерархия кодируется текстом;
- `.agents/skills` — skills нативно; привязка — из `context/skills.yml`;
- `goals/program--<key>.expect.ts` и `goals/<goal>.expect.ts` —
  `ai expect report` + `ai goals check`; рядом — `*.expect.json` с
  результатами прогонов;
- `submit_result` — структурированный ответ ролей;
- `operator-feedback` — операторский skill по запросу;
- `browser`/`browser-read` — через browser namespace/MCP и autonomy;
  granular-запрет `browser-read` — только через MCP-провайдера, нативный
  `browser` — инструкция плюс аудит;
- docs guard — `permission.hook("evaluate")` для `edit`: operator,
  executor и judge; judge — только `goals/*.expect.ts`,
  `.ops/<ticket>/verdicts/`, `*.expect.json`. Запись в docs через shell
  ловится аудитом;
- memory guard — auto-memory нет; memory-MCP и инструменты с `*memory*`
  deny; `permission.hook("evaluate")` блокирует `edit`/`write` в
  memory-пути; `ctx.storage` — только явные кэши;
- watcher MCP — события/триггеры;
- Subagents tab — видимость ролей;
- resume executor/judge — через `sessionID`; paused — без опроса.

Ограничения: todo плоский, нет вложенных зависимостей; для DAG нужен
плагин-инструмент, не в MVP.

### Claude Code

- роли — субагенты `.claude/agents`, источник — `.agents/agents`;
- модели — `deepseek/deepseek-flash#max`, judge — `#low`; запуски
  оператора в фоне; executor → judge/researcher, глубина 2;
- skills — `.claude/skills`, привязка из `context/skills.yml`;
- browser — MCP (Playwright/browser-use);
- docs guard — hooks;
- memory guard — `autoMemoryEnabled: false` в `.claude/settings.json`;
  hook `block-memory-write-for-<contract-key>.sh` на `PreToolUse`
  блокирует запись в `~/.claude/projects/*/memory/`;
- видимость — субагенты/транскрипты;
- watcher — MCP;
- headless/durable — внешний harness.

### Codex

- роли — `.codex/agents` или инструкции; источник — `.agents/agents`;
- модели — `deepseek/deepseek-flash#max`, judge — `#low`; запуски
  оператора в фоне; executor → judge/researcher, глубина 2;
- skills — `.agents/skills`, привязка из `context/skills.yml`;
- browser — MCP (Playwright/browser-use);
- hooks/плагины ограничены;
- docs guard — проверки/раннер;
- memory guard — `.codex/config.toml`: `features.memories=false`,
  `memories.use_memories=false`, `memories.generate_memories=false`;
  действует только в trusted-проекте, надёжнее глобально
  `codex features disable memories`; hooks/runner блокирует запись;
- watcher — MCP;
- headless/durable — внешний harness.

### Другие runtime

Если у инструмента есть memory — выключается настройкой; если нет —
memory-MCP и memory-инструменты запрещены. Правило одно: память вне
репозитория не используется.

### Headless

Внешний harness и FSM — только для детерминированных задач и CI. На этом
этапе не развиваем. Роль получает окружение без memory-инструментов;
harness проверяет memory guard.

## 11. Watcher-демон

Один machine-wide daemon, не по демону на проект.

- проекты регистрируют watches;
- providers: timer, git, CI, manual, внешние системы;
- event log — JSONL, локальный, вне git; dedupe, ack, retry;
- транспорт: MCP (stdio) + Unix socket на POSIX; на Windows — named
  pipe (`\\.\pipe\...`) или HTTP-fallback;
- API: добавить/удалить watch, получить события, подтвердить, trigger;
- MCP — тонкий фасад для оператора и executor;
- событие не теряется при закрытой сессии; plugin доставляет при старте;
- event log — транспорт, не истина: решение по событию фиксируется в
  `goals/` (или docs), не в локальном кэше;
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
   librarian; плоские `goals/*.expect.ts` и
   `goals/program--*.expect.ts`; тикеты внутри цели; `*.expect.json`;
   модели ролей; фон; scratchpad; `operator-feedback`; кастомные роли;
   external executor; формальные сообщения; реестр skills; привязка
   `roles` в `context/skills.yml`; browser-capability; presets с
   `role_skills`/`role_exceptions`/`autonomy`; permissions; удаление
   обязательного FSM из интерактивной части.
3. **OpenCode MVP.** v3-only плагин `packages/plugin`: оператор,
   subagents в фоне, `subagent_depth: 2`, `todowrite`, skills из
   `context/skills.yml`, browser tool, docs guard, `submit_result`,
   state guard, `operator-feedback`.
4. **Watcher MVP.** `packages/watcher`: один тип события (timer или CI),
   JSONL event log, MCP, Unix socket/named pipe/HTTP, plugin wake.
5. **Гейты.** Task expectations, `*.expect.json` (80% `pass`), judge
   AST-валидатор, docs consistency, check ladder, goals check, goals
   status, roles check, skills check, operator state check, browser
   autonomy.
6. **Пилот.** Один проект: оператор, 2 researcher, executor, judge,
   librarian; параллельный и последовательный блоки; конфликт; пауза
   executor; feedback. Для external — external-executor, remote target
   и browser/CI-проверка.
7. **Другие runtime.** Claude Code/Codex адаптеры; внешний harness для
   headless — позже.

## 13. Критерии готовности пилота

- оператор планирует задачу из 3 пунктов и ведёт её без FSM;
- оператор запускает роли только в фоне и остаётся доступен человеку;
- рядом с каждой целью лежит `*.expect.json`; первый прогон judge —
  `pass`/`fail`, второй — негатив `удовлетворительно`; оператор считает 80%
  по `pass` и может один раз запустить повторный цикл;
- executor сам запускает judge и researcher; запуски видны в GUI,
  глубина не больше 2;
- модели закреплены: `deepseek/deepseek-flash#max`, judge — `#low`;
  бесплатных моделей нет;
- плагин активируется только при `sync.contract.edition:
  operator-centric`; старый v3 не затрагивается;
- `goals/program--<key>.expect.ts` задаёт приоритет внутри программы;
  цель — плоский `goals/<goal>.expect.ts` с тикетами
  `describe('ticket: …')`; baseline снят в `.ops/<ticket>/baseline/`;
- проверки запускаются в скоупе: одна цель или целая программа;
- цель проходит этапы: `it.todo` — план, заглушек нет — готовый план,
  все тикеты приняты (≥80% `pass`) — цель удалена из `goals/` и файла
  программы;
- два researcher работают параллельно, executor — в отдельном worktree;
  тикеты одной цели последовательны;
- external executor работает в удалённом проекте и делает GUI/CI-работу;
- активных executor не больше 5; paused не считается и не опрашивается;
- judge даёт подробный вердикт executor и краткий оператору; правка
  `.expect.ts` проходит AST-валидатор в границах своего тикета;
- librarian пишет документацию и прогоняет формальную проверку;
- оператор, executor и judge не могут писать docs через `edit`; запись
  через shell ловится аудитом;
- memory guard включён на каждом runtime: Claude — settings + hook,
  Codex — config, OpenCode — deny memory-MCP/инструментов и
  evaluate-hook, прочие — memory off/deny, headless — окружение без
  memory; `ai adapters check` зелёный;
- scratchpad не растёт бесконечно и чистится;
- watcher-событие будит оператора; event log JSONL;
- кастомная роль добавляется файлом `.agents/agents/<name>.md` и
  привязкой skills в `context/skills.yml`;
- project-skill добавляется в `.agents/skills`, привязывается к executor
  через `context/skills.yml` и проходит `ai skills check`;
- пресет проходит схему: `role_skills` разрешаются в `roles`
  `context/skills.yml`, `autonomy` переносится в
  `context/autonomy.yml`, external содержит полный `external-executor`;
- browser-задача выполняется executor с `browser`, judge проверяет через
  `browser-read` или evidence executor без побочных действий;
- `operator-feedback` даёт метрики, причины и рекомендации;
- роли видны в Subagents tab;
- после рестарта оператор продолжает по state и `goals/`.

## 14. Открытые вопросы

- Точные схемы `verdict.yml`, `report.yml`, `brief.yml`,
  `.ops/feedback/<ticket>.yml`, `state.yml`, `context/project.yml`,
  `context/autonomy.yml`.
- Формулы метрик feedback: что считать «пустым отвлечением» и
  `tokens_wasted_estimate`; как не собирать секреты.
- Схема preset: точные поля `role_skills`, `role_exceptions`,
  `autonomy`, external roles и порядок переноса установщиком.
- External executor: target mapping, remote workspace/branch, publish
  policy, много web-приложений.
- AST-валидатор `goals/*.expect.ts`: как ловить смысловое ослабление
  проверки, не только структуру.
- Skill manifest (`context/skills.yml`): как `requires.tools` и
  `permissions` отображаются в tools/permissions каждого runtime;
  правила `core`/`project`/`extends`.
- Матрица browser-capability: какие tools у OpenCode/Claude/Codex,
  какие действия `self`/`ask`/`never`, какие домены.
- Сколько живёт paused-исполнитель и когда его закрывать; закрывать ли
  worktree при закрытии тикета.
- Схема watcher events, retention JSONL, ack/replay; автозапуск и
  обновление демона.
- Точные схемы формальных сообщений brief/report/verdict/docs_request.
- Область формальной проверки документации: ссылки/схема/дубли или
  ещё смысловые проверки.
- Поведение при удалённых проверках внешнего проекта.

## 15. Что не делаем

- не пишем новый runtime;
- не тащим FSM в плагин;
- не развиваем внешний harness сейчас;
- не мигрируем существующие v3-проекты — это забота ответственного;
- не сохраняем старую очередь goals/programs (`context/views`) в новой
  модели;
- не заводим `context/roles.yml` и второй реестр ролей;
- не заводим `goals/index.yml`, `goals/README.md` и другие файлы в
  `goals/`;
- не держим `oracle`/`reviewer` «на всякий случай»;
- не плодим `browser-executor` по умолчанию;
- не даём skill без tool/permissions;
- не даём оператору ролевые skills, кроме `operator-feedback` и явного
  `browser-read`;
- не даём оператору, executor и judge писать документацию;
- не даём judge менять состав/budget expectations;
- не запускаем роли оператора в foreground;
- не используем бесплатные модели;
- не даём глубину делегирования больше 2;
- не делаем marketplace и упаковку skills.

## 16. Состояние и следующая итерация

### 16.1 Сейчас

- Дизайн-документ; реализация контракта идёт по 16.2, состояние кода
  здесь не фиксируется.
- Принятые решения — раздел 0; открытые вопросы — раздел 14;
  решения итерации — 16.7.
- Следующая итерация начинается с 16.2, а не с кода плагина.

### 16.2 Порядок следующей итерации

1. **Зафиксировать схемы и решения.**
   - `goals/*.expect.ts` (AST:
     `describe`/`crit`/`warn`/`budget`/`crit.wip`/`it.todo` +
     `describe('ticket: …')`), `goals/program--*.expect.ts` (программа:
     импорты целей), `*.expect.json` (timestamp + results), `verdict.yml`,
     `report.yml`, `brief.yml`,
     `.ops/feedback/<ticket>.yml`, `context/project.yml`
     (`sync.contract.edition`, `roles.exceptions`),
     `context/autonomy.yml`, `context/skills.yml`,
     `expectations/schemas/role.schema.json` (role frontmatter, расширяет
     `agent-frontmatter.schema.json`), skill manifest, browser autonomy,
     preset schema, `state.yml`, watcher event, baseline
     `.ops/<ticket>/baseline/`.
   - Решить открытые вопросы из раздела 14, которые блокируют схемы.
2. **Переписать контракт v3.**
   - роли operator/researcher/executor/judge/librarian;
   - external-executor для удалённого проекта/GUI;
   - фон и модели: все роли через `background: true`, модель
     `deepseek/deepseek-flash#max`, judge `#low`;
   - executor запускает judge и researcher, глубина 2, видно в GUI;
   - формальные сообщения;
   - плоские `goals/` (цели и программы) вместо `context/views`
     (goals/programs);
   - цель и тикеты внутри файла цели;
   - результаты прогонов `*.expect.json` рядом с каждым `*.expect.ts`;
   - scratchpad;
   - feedback;
   - кастомные роли одним файлом;
   - реестр skills и привязка `roles` в `context/skills.yml`;
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
   - роли — один файл `.agents/agents/<name>.md` (frontmatter + промпт;
     `model` обязателен); `context/roles.yml` не создаётся;
   - переименования жёсткие, без deprecated-алиасов: `implementer` →
     `executor`, `docs-keeper` → `librarian`;
   - убрать `oracle`/`reviewer`;
   - пометить старую очередь `goals`/programs и `context/views`
     deprecated;
   - обновить presets, modules, `prompts/index.yml`.
4. **OpenCode MVP.**
   - плагин `packages/plugin`, v3-only активация:
     `sync.contract.edition: operator-centric`;
   - `.opencode/agents` из `.agents/agents` и skills из
     `context/skills.yml`;
   - оператор запускает роли в `background: true`; `subagent_depth: 2`;
     executor → judge/researcher видны в GUI;
   - модели ролей: `deepseek/deepseek-flash#max`, judge `#low`;
     бесплатные модели deny;
   - `goals/program--<key>.expect.ts` и `goals/<goal>.expect.ts` —
     `ai expect report`; `*.expect.json` рядом; `ai goals check/status`
     и `ai operator state check` — шаг 6;
   - `todowrite` + `subagent`;
   - `browser`/`browser-read` через browser tool/MCP;
   - `external-executor` и remote target;
   - docs guard plugin;
   - memory guard: memory-MCP deny, evaluate-hook на memory-пути,
     `ctx.storage` только для явных кэшей;
   - `submit_result`;
   - `operator-feedback` tool/skill.
5. **Watcher MVP.**
   - пакет `packages/watcher`;
   - JSONL event log;
   - MCP-фасад;
   - Unix socket/named pipe, HTTP-fallback;
   - plugin wake;
   - ack/replay.
6. **Гейты.**
   - `ai goals check` (AST), `ai goals status`, `ai skills check`,
     `ai roles check`, `ai operator state check`, `ai adapters check`;
   - `ai adapters sync` ставит memory guard, `ai adapters check`
     подтверждает memory off: Claude settings + hook, Codex config,
     OpenCode deny memory-MCP/инструментов, прочие — off/deny;
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
- `expectations/schemas/*` (включая `role.schema.json`),
  `expectations/*.expect.ts`.
- `packages/ai-core` — `adapters sync/check`: memory guard для
  Claude/Codex/OpenCode.
- Пакеты `packages/plugin` и `packages/watcher` — только после контракта
  и схем; имена зафиксированы заранее.

Проект-потребитель (устанавливается/создаётся):

- `goals/*.expect.ts` (цели и `program--<key>.expect.ts`),
  `goals/*.expect.json` (результаты прогонов).
- `.ops/<ticket>/{baseline,research,reports,verdicts,checks}/`,
  `.ops/feedback/<ticket>.yml`; `.ops/operator/state.yml` — локально;
  `.ops/locks/` — локальные локи.
- `context/project.yml`, `context/autonomy.yml`, `context/skills.yml`.
- `.agents/agents/*`, `.agents/skills/*`.
- `AGENTS.md`.

### 16.4 Проверка итерации

- `npm run index:build` — индекс промптов.
- `npm run ci` — format, build, typecheck, lint, tests, index, expect.
- `npm run expect` — ожидания; при новых смысловых заголовках —
  `npm run expect:judge:opencode`.
- Итерация контракта считается завершённой, когда контракт, skills,
  agents, presets, схемы и `prompts/index.yml` согласованы, а
  `npm run ci` зелёный. Плагин, watcher и гейты — шаги 16.2.4–16.2.6,
  не итерация контракта.
- Preset DoD: схема пресета валидна; каждая core-роль есть в
  `role_skills` или `role_exceptions`; skills модулей и ролей
  разрешаются в `roles` `context/skills.yml`; `autonomy` переносится в
  `context/autonomy.yml`; external содержит полный `external-executor`;
  у ролей `model` — `deepseek/deepseek-flash#max`, judge `#low`.
- Operator DoD: `skills/operator` и `agents/operator` отсутствуют;
  оператор — primary, протокол в `AGENTS.md`, allowlist — в
  `context/skills.yml`; запуски ролей только `background: true`, модель
  `#max`.
- Executor DoD: модель `#max`; запускает только judge и researcher,
  глубина 2, запуски видны в GUI.
- Judge DoD: модель `#low`; пишет `*.expect.json` и
  `.ops/<ticket>/verdicts/<run>.yml`; `edit` разрешён на
  `goals/*.expect.ts`, `verdicts/`, `*.expect.json`; первый прогон —
  `pass`/`fail`, второй и последующие — негатив `удовлетворительно`.
- Goals DoD: файл цели содержит тикеты `describe('ticket: …')`; рядом
  `*.expect.json`; `goals/program--*.expect.ts` — только импорты, цель
  входит ровно в одну программу; `ai goals check` ловит правки вне
  активного тикета; `ai goals status` различает план, готовый план и
  достигнутую цель; 80% `pass` по `crit`/`warn`, один повторный цикл;
  `goals/` не входит в CI-гейт `npm run expect`.
- Browser DoD: `browser`/`browser-read` есть в `context/skills.yml`;
  `requires.tools` разрешается в runtime; granular permissions
  (`browser.click`, `browser.type`) — в `context/skills.yml`, уровни
  `self`/`ask`/`never` — в `context/autonomy.yml`; механический
  `browser-read` — только через MCP-провайдера.
- Memory DoD: `ai adapters check` подтверждает memory off; Claude —
  `autoMemoryEnabled: false` + hook, Codex — config + trusted caveat,
  OpenCode — deny memory-MCP/инструментов и evaluate-hook, прочие —
  memory off/deny, headless — окружение без memory; запись в
  memory-пути блокируется.
- Пилот — по разделу 13, после плагина, watcher и гейтов.

### 16.5 Что не начинать первым

- Не писать плагин до схем и контракта.
- Не мигрировать проекты.
- Не тащить FSM в плагин.
- Не делать marketplace.
- Не добавлять `oracle`/`reviewer` обратно.
- Не добавлять `proposal/specs/design/tasks` и другие планировочные
  файлы: `goals/` — только `*.expect.ts` (цели и
  `program--*.expect.ts`).

### 16.6 Если сессия перезапустилась

Читать: раздел 0 → раздел 16.1 → раздел 16.2 → раздел 16.7. Текущее
состояние — только дизайн; следующий шаг — схемы и контракт, не код
плагина. Все решения и открытые вопросы — в этом документе, внешнего
контекста не требуется.

### 16.7 Решения итерации (вне §14)

Зафиксировано 2026-11-01; пересматривается только пользователем.

- **Тикет.** Тикет живёт блоком `describe('ticket: …')` внутри файла
  цели; артефакты — `.ops/<ticket>/`; один активный тикет на цель,
  параллель — между целями.
- **Этапы цели.** `it.todo` — план; `it.todo` нет — готовый план; все
  тикеты приняты (≥80% `pass`) — цель достигнута и удаляется; стадию
  фиксирует `ai goals status` до удаления.
- **Warn.** `warn` входит в 80% наравне с `crit`; отдельного правила
  «все warn зелёные» нет — остаток фиксируется `удовлетворительно`.
- **Имена.** `goals/` — плоские цели и программы; программа —
  `goals/program--<key>.expect.ts` (импортирует свои цели); единой
  очереди нет. Старый `goals` (`context/views`) — deprecated, не
  ставится.
- **Открытость.** Долговременное состояние — в git; локальные файлы
  (scratchpad, locks, event log) — явные кэши без решений; память
  инструментов выключена.
- **Memory guard.** Часть ядра: Claude — settings + hook, Codex — config
  (+ trusted caveat), OpenCode — deny memory-MCP/инструментов и
  evaluate-hook; проверка — `ai adapters check`.
- **Фон.** Оператор запускает роли только с `background: true`; он
  всегда доступен человеку, просыпается на результате или сообщении.
- **Модели.** Все роли — `deepseek/deepseek-flash`; по умолчанию `#max`,
  judge `#low`; бесплатные модели запрещены.
- **Результаты.** `*.expect.json` рядом с каждым `*.expect.ts`;
  `timestamp` + `results`; первый прогон `pass`/`fail`, второй и
  последующие — негатив `удовлетворительно`; 80% по `pass` в `crit`/`warn`
  активного тикета.
- **Циклы.** Два прогона judge за попытку; оператор может один раз
  запустить повторный цикл executor→judge, затем — к человеку.
- **Делегирование.** Executor запускает judge и researcher; глубина 2;
  judge и researcher никого не запускают; запуски видны в GUI.
- **Роли.** Один файл `.agents/agents/<role>.md` (кроме оператора: файла
  нет, протокол в `AGENTS.md`); `context/roles.yml` не существует;
  привязка skills — `roles` в `context/skills.yml`; `role_exceptions` —
  `roles.exceptions` в `context/project.yml`.
- **Гейт.** `goals/` не входит в `npm run expect`; запуск в скоупе:
  `ai expect report goals/<goal>.expect.ts` или
  `ai expect report goals/program--<key>.expect.ts`.
- **Context аддитивен.** `context/ai-core.yml`, `context/modules/`,
  `context/conventions/`, `context/index.yml` остаются.
- **Baseline.** Снимок активного файла цели и сброшенный
  `*.expect.json` коммитятся до создания worktree; оператор обновляет
  baseline после merge тикета.
- **Locks.** Файловые, `.ops/locks/`, через CLI.
- **Команды.** В итерации после контракта (шаг 16.2.6, до пилота):
  `ai goals check`, `ai goals status`, `ai roles check`,
  `ai skills check`, `ai operator state check`, `ai adapters check`;
  AST — TypeScript compiler API; установка memory guard —
  `ai adapters sync`.
- **Пакеты.** `packages/plugin` (OpenCode v2 only) и
  `packages/watcher`.
- **Renames.** Сразу, без deprecated-алиасов.
- **browser-read.** Механический запрет — через MCP-провайдера; нативный
  `browser` — инструкция плюс аудит.
- **Лимиты.** ≤5 executor, paused, один librarian — протокол и аудит,
  не механический запрет рантайма.
- **Docs guard.** `edit` deny для operator, executor и judge (у judge —
  `goals/*.expect.ts`, `.ops/<ticket>/verdicts/`, `*.expect.json`);
  запись в docs через shell — аудит, не hard-hook.
