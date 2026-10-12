# Спецификация: agent-operational-contract-v3

Статус: черновик. Документ проектирования, не промпт: в `prompts/index.yml`
не попадает, проектам-потребителям не отдаётся. По нему пишутся ядро v3,
модули-возможности и команды harness.

## 1. Что меняется относительно v2

- **`AGENTS.md` вместо `CLAUDE.md`.** Точка входа — открытый стандарт,
  который читают Codex, Cursor, Copilot, Gemini CLI. `CLAUDE.md` —
  генерируемая прослойка `@AGENTS.md`. Формулировки — про «агента», без
  привязки к Claude Code; специфика инструментов — в адаптерах.
- **Ядро + возможности.** Обязательный минимум — ядро. Всё остальное —
  модули-возможности, которые агент предлагает чеклистом при настройке
  и которые можно добавить или убрать позже.
- **Worktrees — возможность**, а не неявное допущение. Горячие файлы
  (индексы, CHANGELOG, goals) спроектированы под параллельные ветки.
- **Harness.** Механические проверки и генерация уходят из головы агента
  в `@shahimat/harness` (TS strict, vitest, Node ≥ 24, кроссплатформенно).
- **Жёсткий CHANGELOG.** Строка ≤ 120 символов, обязательный тег из
  закрытого списка, пишет только docs-keeper, проверяет harness.
- **Чтение отделено от записи.** Основной агент знает, где искать
  ответ коротким путём. Правила ведения документации живут в skill
  `docs-keeper`, который исполняет субагент или сам агент по требованию.

## 2. Опорные факты об инструментах

Проверено по документации на 2026-10-13. Пересматривать при каждом
крупном обновлении спецификации.

- **AGENTS.md.** Codex читает от git-root до cwd, по одному файлу на
  каталог, суммарно ≤ 32 KiB. Claude Code (v2.1.277+) читает `AGENTS.md`
  нативно, только если рядом нет `CLAUDE.md`; импорт `@AGENTS.md` из
  `CLAUDE.md` работает во всех версиях.
- **Skills (формат Agent Skills, `SKILL.md`).** Общий путь
  `.agents/skills/` читают Codex, Copilot, Cursor, Gemini CLI. Claude Code
  читает только `.claude/skills/`. Subagent Claude Code умеет
  предзагружать skills полем `skills`.
- **Subagents.** Общего формата нет: Claude Code — `.claude/agents/*.md`,
  Codex — `.codex/agents/*.toml`, Copilot — `.github/agents/*.agent.md`.
- **Hooks.** И Claude Code, и Codex: событие `PreToolUse`, блокировка
  exit code 2 или `permissionDecision: "deny"`. Кроссплатформенный
  запуск — exec-форма `"command": "node", "args": [...]`, без shell.
- **Вопрос с выбором нескольких вариантов.** Claude Code —
  `AskUserQuestion` с `multiSelect`. Codex — `request_user_input`, не во
  всех режимах, multi-select не подтверждён.
- **Worktrees.** Claude Code — `--worktree`, `.claude/worktrees/`,
  `.worktreeinclude` (копирует только игнорируемые git файлы). Codex —
  в приложении, `$CODEX_HOME/worktrees`; в CLI встроенного нет.

Следствия для дизайна:

- канонические файлы лежат в нейтральных путях (`AGENTS.md`,
  `.agents/skills/`), файлы под конкретный инструмент генерирует harness;
- копии, а не symlink'и — symlink'и ненадёжны на Windows;
- `AGENTS.md` маленький: лимит Codex общий на всю иерархию.

## 3. Ядро

Ядро — то, без чего контракт не работает. Всё прочее — возможности.

### 3.1. Что ядро создаёт в проекте

```
AGENTS.md                         ← маршрутизация и жёсткие правила
CLAUDE.md                         ← одна строка @AGENTS.md
CHANGELOG.md                      ← журнал решений
context/
  project.yml                     ← реквизиты, namespaces, sync
  conventions/<key>.yml           ← только правила этого проекта
  modules/<key>.yml               ← манифесты подключённых возможностей
.agents/skills/
  contract-setup/SKILL.md         ← чеклист возможностей, add/remove
  source-sync/SKILL.md            ← «сверь всё»
.gitattributes                    ← eol=lf, CHANGELOG.md merge=union
```

Правила самого контракта в `context/conventions/` не копируются (в v2
`verification.yml` был полной копией раздела контракта). В
`conventions/` — только договорённости этого проекта. Правила
контракта живут в `AGENTS.md` и skills и обновляются через source-sync.

### 3.2. `AGENTS.md`

Бюджет: ≤ 150 строк и ≤ 8 KiB вместе с блоками модулей. Превышение —
сигнал, что содержимое должно уехать в skill или слой.

Состав:

1. Одна строка: что за проект, ссылка на `README.md`.
2. **Маршрутизация по типу вопроса** — кратчайший путь (см. 3.3).
3. **Жёсткие правила** — не больше 7 пунктов (см. 3.4).
4. Сценарии `plan` / `execute` / `audit` / `challenge` / `report` — по
   одной строке с ключевыми словами; протоколы — в skills.
5. Список доступных skills с одностроковым «когда звать».
6. Блоки модулей между маркерами:
   `<!-- module:<key> -->` … `<!-- /module:<key> -->`. Модуль пишет
   только внутрь своего блока (правило WRITE > UPDATE сохраняется).

### 3.3. Маршрутизация по типу вопроса

Вместо обязательного порядка чтения из 9 шагов — «вопрос → где ответ»:

- «как сейчас устроено X» → код; при domain — `docs/entities/` по `id`;
- «как X должно себя вести и проверено ли» → `docs/behavior/` (domain);
- «почему у нас X» / «когда перешли на X» → `CHANGELOG.md`, затем
  `git log`;
- «как мы договорились про X» → `context/conventions/<key>.yml` по ключу;
- «что делать дальше» → `context/views/goals.yaml` (goals);
- «как сделать руками X» → `docs/manuals/` (manuals);
- «какие доки касаются файла F» → `harness context for F` (harness),
  иначе поиск по `id` / `namespace` / пути.

Правило: перед правкой агент берёт ровно те документы, на которые
указывает маршрут, а не весь namespace. Полный обход `docs/` и
`context/` запрещён.

### 3.4. Жёсткие правила ядра

1. Перед правкой — прочитать документы по маршруту задачи (3.3).
2. Устойчивые факты — в репозиторий, не в memory / скрытое состояние
   инструмента. «Запомни» = запись в проектную документацию.
3. Одна фаза — один тип изменений (karma commit-msg); точка
   согласования в конце фазы.
4. Блокирующий вопрос — по формату (нумерованные варианты, дефолт с
   обоснованием, стоп до ответа). Формат переносится из v2 без
   изменений.
5. Запись в проектную документацию — через docs-keeper (3.6), если
   возможность подключена; иначе — по skill `docs-keeper` вручную.
6. Ничего не создавать, не переносить, не удалять без явного «да».
7. Git-решения принимает человек.

### 3.5. CHANGELOG.md

Формат строки:

```
- YYYY-MM-DD · [tag] <суть> · <почему>
```

- длина строки ≤ 120 символов, включая дату и маркер;
- `tag` — из закрытого списка: `arch`, `stack`, `dep`, `milestone`;
  тег не подбирается — запись не для CHANGELOG;
- тест на пользу: строка поможет через год ответить «почему»? Нет —
  это `git log`;
- в отличие от v2, «крупные правки `context/`» больше не повод для
  записи: перекладка документации — не решение;
- только принятые решения, обратный хронологический порядок;
- пишет только docs-keeper; при harness — `harness changelog lint` в
  pre-commit и CI;
- `.gitattributes`: `CHANGELOG.md merge=union` — параллельные ветки не
  конфликтуют на вставке в начало файла.

### 3.6. Чтение и запись документации

Основной агент не держит в контексте правила записи. Поток:

1. Агент в ходе работы копит **намерения** — короткий список:
   ```yaml
   - kind: decision | fact | rule | behavior-change | task | manual
     summary: <одна строка>
     evidence: <файл, команда, коммит — чем подтверждено>
   ```
2. В фазе `docs` (или по завершении задачи) агент передаёт намерения
   docs-keeper:
   - есть субагенты → субагент `docs-keeper` с предзагруженным skill;
   - нет → агент сам загружает `.agents/skills/docs-keeper/SKILL.md`
     и применяет его.
3. docs-keeper раскладывает факты по слоям, обновляет ссылки, пишет
   CHANGELOG по правилам 3.5, запускает `harness check` (если есть).
4. Агенту возвращается отчёт: что изменено, что не прошло проверку,
   какие вопросы к человеку.

Что остаётся у основного агента: маршрутизация (3.3), жёсткие правила
(3.4), понимание «что есть правда». Что уходит в docs-keeper: формат
слоёв, двусторонние ссылки, правило полноты, проверки
непротиворечивости, CHANGELOG, жизненный цикл целей.

## 4. Возможности (модули)

### 4.1. Модуль-возможность

Возможность — модуль в `prompts/modules/<key>.md` с
`applicable_to: [agent-operational-contract-v3]` и блоком `feature` во
frontmatter:

```yaml
key: goals
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync, goals]
title: Цели и программы
use_case: ...
feature:
  summary: <одна строка для чеклиста>
  default: true            # отмечена ли галочка по умолчанию
  requires: []             # ключи других возможностей
  conflicts: []
  asks:                    # уточняющие вопросы после выбора
    - key: <kebab-case>
      question: <текст>
      multi: true
      options: [...]       # или options_from (см. открытые вопросы)
```

Всё, что модуль кладёт в проект, перечислено в `provides` (как в v2),
плюс новые виды:

```yaml
provides:
  layers: [...]
  files: [...]
  skills: [<имя каталога в .agents/skills/>]
  agents_md_block: true
  harness_checks: [<ключ проверки>]
```

Модули без блока `feature` (старые) в чеклисте не участвуют.

### 4.2. Каталог

- **domain** (по умолчанию да) — `docs/entities/`, `docs/behavior/`,
  механика `verified`. Новое:
  - в entity поле `paths: [<glob>]` — связь кода с документацией, на
    ней работает `harness context for`;
  - в behavior поле `check: <команда>` — `harness verify` сам выполняет
    проверку и ставит `verified_at`; ручной `verified` — только где
    команды нет, с объяснением в `verified_note`.
- **manuals** (да) — `docs/manuals/*.md`, ручные процедуры.
- **goals** (да) — `context/views/`, цели и программы; инлайнит
  паттерн `goals`. Механическая часть `goal-consistency` (циклы,
  ссылки на удалённые цели, порядок против зависимостей) — в harness,
  смысловая (конфликт интентов, дубли) — в docs-keeper.
- **docs-keeper** (да) — skill `docs-keeper` + генерируемые субагенты.
  Без него запись идёт по skill вручную (3.6).
- **harness** (да) — `context/harness.yml`, подключение
  `@shahimat/harness`. Требует Node ≥ 24. Задаёт вложенный вопрос:
  какие проверки включить (см. 4.3).
- **worktrees** (нет) — правила параллельной работы, `.worktreeinclude`,
  `harness wt new`. Требует harness.
- **memory-guard** (нет) — hook, блокирующий запись в memory агента.
  Требует harness.
- **code-rules-fullstack-js-ts** (нет) — существующий модуль; расширить
  `applicable_to` и добавить `feature`.
- **knowledge-external-gui** (нет) — то же.

### 4.3. Вложенный чеклист harness

После выбора harness — второй вопрос с несколькими вариантами:

- `changelog` — lint CHANGELOG (да);
- `context-index` — генерация `context/index.yml` (да);
- `links` — двусторонние ссылки entity ↔ behavior ↔ manual (да при
  domain);
- `goals` — механическая проверка целей (да при goals);
- `verify` — выполнение `check:` у behavior (нет);
- `adapters` — генерация файлов под инструменты (да);
- `hooks` — pre-commit с `harness check` (нет).

Выбор записывается в `context/harness.yml`.

### 4.4. Протокол настройки (skill `contract-setup`)

1. Определить режим: greenfield / brownfield (как в v2).
2. Получить `prompts/index.yml` через source-sync, отобрать модули с
   `applicable_to`, содержащим ключ ядра, и с блоком `feature`.
3. Показать чеклист:
   - есть инструмент вопроса с несколькими вариантами → использовать
     его, галочки по `default`;
   - нет → нумерованный список, отмеченные по умолчанию помечены,
     ответ — номерами через запятую.
4. Разрешить `requires` (добавить и сообщить) и `conflicts` (стоп,
   вопрос).
5. Задать вопросы из `asks` выбранных модулей.
6. Подключать модули по одному, каждый — отдельная фаза с точкой
   согласования; манифест в `context/modules/<key>.yml`.
7. Повторный вызов («что добавить / убрать») — тот же чеклист, текущие
   галочки = подключённые модули; снятие галочки = отключение по
   `provides`.

## 5. Адаптеры под инструменты

Канон — нейтральные файлы. Генерируемые копии помечены строкой
«generated by harness — do not edit» и пересоздаются
`harness adapters sync`.

- **Claude Code:**
  - `CLAUDE.md` — `@AGENTS.md`;
  - `.claude/skills/<name>/` — копии `.agents/skills/<name>/`;
  - `.claude/agents/docs-keeper.md` — субагент с `skills: [docs-keeper]`;
  - `.claude/settings.json` — hook memory-guard (если подключён).
- **Codex:**
  - `AGENTS.md` и `.agents/skills/` читаются напрямую;
  - `.codex/agents/docs-keeper.toml` — субагент;
  - `.codex/hooks.json` — hook memory-guard (если подключён).

Без harness адаптеры создаёт агент при настройке, по тем же правилам, и
отвечает за их актуальность сам.

Набор инструментов задаётся в `context/harness.yml` (`adapters:
[claude-code, codex]`) или, без harness, в `context/project.yml`.

## 6. Worktrees

- Горячие файлы:
  - `context/index.yml` — только генерируется; конфликт → пересборка;
  - `CHANGELOG.md` — `merge=union`;
  - `context/views/goals.yaml` — union для YAML опасен; после merge —
    `harness check`, конфликт решается правкой и пересборкой проверки.
- `harness wt new <name>` — `git worktree add`, копирование файлов по
  `.worktreeinclude`, установка зависимостей. Каталог по умолчанию —
  `.claude/worktrees/<name>`, чтобы совпадать с Claude Code; настраивается
  в `context/harness.yml`.
- В каждом worktree зависимости ставятся заново: `node_modules` не
  копируются.

## 7. Harness

### 7.1. `context/harness.yml`

```yaml
version: 0.3.0                  # точная версия @shahimat/harness
adapters: [claude-code, codex]
checks:
  changelog:
    max_line: 120
    tags: [arch, stack, dep, milestone]
  context-index: {}
  links: {}
  goals: {}
worktrees:
  dir: .claude/worktrees
rules: tools/harness/rules       # дополнения проекта (7.3)
```

### 7.2. Доставка

- Сейчас: `npx -y @shahimat/harness@<version>`; версия — из
  `context/harness.yml`.
- Позже: глобальный лаунчер (`npm i -g @shahimat/harness`), который
  читает `version` из `context/harness.yml` и запускает нужную версию из
  кэша. Нужен для hooks: `npx` на каждый вызов слишком медленный.

### 7.3. Дополнения проекта

Ядро экспортирует `defineCheck`. Проект кладёт свои проверки в
`tools/harness/rules/*.ts`, harness подхватывает их по пути из
`harness.yml`. Проверка, полезная везде, переносится в пакет.

### 7.4. Команды (бэклог)

Первая очередь — на них ссылается ядро:

- `harness check` — все включённые проверки, ненулевой код при ошибке;
- `harness changelog lint`;
- `harness context index` — генерация `context/index.yml`;
- `harness adapters sync`.

Вторая очередь:

- `harness context for <path...>` — документы, связанные с файлами
  (по `paths` в entity и namespace);
- `harness goals check`;
- `harness verify [<behavior-id>...]`;
- `harness hook memory-guard` — единый обработчик для Claude Code и
  Codex;
- `harness wt new <name>`.

Третья очередь:

- лаунчер с выбором версии;
- `defineCheck` и загрузка `tools/harness/rules`.

### 7.5. Изменения в индексе ai-prompts

`harness index build` начинает выводить для модулей `title` и блок
`feature`, чтобы `contract-setup` строил чеклист по одному `index.yml`,
не скачивая каждый модуль.

## 8. Миграция v2 → v3

Фазы — все `docs`, кроме подключения harness (`chore`):

1. `CLAUDE.md` → `AGENTS.md` (содержимое по 3.2), `CLAUDE.md` —
   прослойка.
2. `context/workflow.md` → skills; удалить копии правил контракта из
   `context/conventions/` (`verification`, `goals`, `goal-consistency`).
3. Подключить выбранные возможности через `contract-setup`; v2-слои
   (`docs/`, `context/views/`) становятся слоями модулей domain / goals
   без переноса файлов.
4. `CHANGELOG.md`: строки > 120 символов и без тега — пересобрать или
   удалить (кандидаты показать списком до правки).
5. Ручной `context/index.yml` → генерируемый.
6. Bash-hook `block-memory-write-for-*.sh` → memory-guard.
7. `sync.contract.key` → `agent-operational-contract-v3`.

## 9. Открытые вопросы

- `options_from` в `asks`: вопрос, варианты которого берутся из
  индекса (например, список проверок harness). Нужен ли, или варианты
  всегда перечисляются в модуле.
- Каким инструментом агент пишет в memory (предположение — Write/Edit
  по пути `~/.claude/projects/*/memory/`). Проверить до реализации
  memory-guard.
- Поддержка multi-select в `request_user_input` у Codex.
- Связанные контракты (`personal-project`, `analytical-project`,
  `external-project-context-v2`) — свести к пресетам возможностей
  поверх ядра v3 или оставить отдельными.
- Сценарии `plan` / `execute` / `audit` / `challenge` / `report`: один
  skill `workflow` или по skill на сценарий.
- Где жить `contract-setup` и `source-sync` в проекте после настройки:
  нужен ли `source-sync` как skill, если harness умеет `harness sync`.
