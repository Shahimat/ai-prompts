# Пилот контракта v3 под OpenCode

Руководство для человека: как развернуть оператор-центричный контракт
v3 в проекте и начать им пользоваться. Модель работы — `design/operator-centric-v3.md`;
сам контракт — `prompts/productivity/agent-operational-contract-v3.md`.
Watcher и адаптеры Claude Code/Codex отложены; пилот — только OpenCode.

## Предпосылки

- Node ≥ 24 (`node --version`).
- OpenCode v2, проект открыт в нём.
- Источник `ai-prompts` запушен в `main` (для source-sync), пакеты
  `@shahimat/ai-core` и `@shahimat/oc3` опубликованы — или ставь их из
  git-ветки.

## 1. Развёртывание контракта в проекте

В свежей сессии OpenCode в проекте-потребителе скорми агенту одну ссылку:

```
Разверни контракт
https://raw.githubusercontent.com/Shahimat/ai-prompts/main/prompts/productivity/agent-operational-contract-v3.md
```

Агент проведёт установку по разделу «Установка» контракта. Два сценария:

- **greenfield** — документации нет или пустой `README.md`;
- **миграция** — своя документация в любом виде: агент инвентаризирует
  (`CLAUDE.md`, `docs/**`, wiki, todo-файлы), построит карту «файл X —
  это слой Y» и перенесёт по слоям.

Что должно появиться (проверь чеклистом):

```
AGENTS.md                  ← протокол оператора, маршрут, жёсткие правила
CLAUDE.md                  ← одна строка @AGENTS.md
context/project.yml        ← реквизиты, sync.contract.edition: operator-centric
context/autonomy.yml       ← уровни self/ask/never
context/skills.yml         ← каталог skills и привязка к ролям
.agents/skills/            ← core-skills контракта
.agents/agents/            ← роли: researcher, executor, judge, librarian
goals/                     ← цели из живых задач (если были)
.opencode/agents/          ← производные (ставит oc3 adapters sync)
```

Пресет (`operational` / `external` / `private` / `analytical`) агент
предложит через skill `contract-setup`.

## 2. Плагин `@shahimat/oc3`

**Подключается в конце установки** — после того, как вся документация
лежит: иначе docs guard начнёт отклонять правки контекста самим
установщиком.

```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@shahimat/oc3"],
  "experimental": { "todo": true, "subagent_depth": 2 }
}
```

Проверка:

```bash
npx oc3 init
# oc3 init: ok — маркер, пакеты и плагин на месте
```

Если конфиг правился в открытой сессии — выполни `/reload`.

## 3. Модели под проект

Перед первым запуском ролей — брифинг оператора (skill `workflow`):
вопрос «дефолтная или кастомная». Дефолтная схема живёт в
`context/project.yml` → `briefing` (по умолчанию cheap: всё делает
оператор, доку — librarian, judge — off), запись и смена —
`oc3 briefing set`, полный конвейер — пресет `roles`. На время
установки и добавления модулей — маркер `.ops/locks/install`
(docs guard пропускает установщика), в конце сними его.

Без оператора и без токенов:

```bash
npx oc3 models                              # роль → модель, override и расхождения
npx oc3 models set judge deepseek/deepseek-v4-pro             # любая модель каталога
npx oc3 models apply                        # вернуть override после source-sync
```

Дефолты — `zai-coding-plan/glm-5.3#max`, judge —
`zai-coding-plan/glm-5.3-flash#low`. Допустима любая модель каталога
OpenCode вида `provider/model[#variant]`, включая бесплатные. Override
хранится в `context/project.yml` → `roles.models` и переживает
source-sync; правка синхронно обновляет `.agents/agents/<role>.md` и
`.opencode/agents/<role>.md`.

Агенту те же операции доступны tools'ами: `oc3_models_set`,
`oc3_goals_check`, `oc3_goals_status`, `oc3_roles_check` и другие.

## 4. Первый рабочий цикл

1. Оператор (primary-сессия) фиксирует цель:
   `goals/<goal>.expect.ts` с тикетами `describe('ticket: …')`;
   программа `goals/program--<key>.expect.ts` импортирует цели по
   приоритету.
2. На старте тикета — baseline: копия файла цели в
   `.ops/<ticket>/baseline/`, сброс `*.expect.json` в
   `{ "timestamp": now, "results": [] }`.
3. Запуск executor'а в фоне (worktree — оператор выделяет).
4. Executor делает работу, запускает judge (run 1: `pass`/`fail`),
   дорабатывает, запускает снова (run 2: негатив `satisfactorily`).
5. Оператор считает 80% `pass` по `crit`/`warn` активного тикета:
   `npx oc3 expect report goals/<goal>.expect.ts`. Принято — merge и
   новый baseline; нет — один повторный цикл с `retry: true`; после
   него — к человеку.

Гейт плагина страхует механически: запуск judge при двух run'ах без
`retry: true` (или трёх с ним) отклоняется с именем файла.

## 5. Шпаргалка команд

```bash
npx oc3 models [list | set <role> <model>]
npx oc3 goals status [goals/<file>.expect.ts]
npx oc3 goals check goals/<goal>.expect.ts --ticket <key>
npx oc3 expect report goals/<goal>.expect.ts
npx oc3 operator state check        # лимиты scratchpad 200/16KB
npx oc3 roles check                 # роли + привязка skills
npx oc3 skills check                # каталог skills
npx oc3 adapters check              # производные + memory guard
npx oc3 adapters sync               # пересобрать производные
npx oc3 context index               # карта документации
npx oc3 init                        # проверка установки
```

Агент оператора использует те же команды tools'ами `oc3_*` — они видны
в UI и под permissions.

## 6. Сценарий пилота

Один проект; проверь по критериям из `design/operator-centric-v3.md`
(раздел 7.3). Ключевое:

- оператор планирует задачу из 3 пунктов и ведёт её без FSM;
- роли запускаются только в фоне, оператор доступен человеку;
- рядом с целью лежит `*.expect.json`; первый прогон `pass`/`fail`,
  второй — негатив `satisfactorily`; 80% `pass` — тикет принят;
- executor сам запускает judge и researcher (researcher ≤2 на тикет);
  глубина не больше 2; запуски видны в GUI;
- модели — дефолты по таблице §0, override — `roles.models`; бесплатные не запрещены;
- judge всегда свежий; гейт отклоняет запуск сверх бюджета;
- librarian пишет документацию; попытка оператора/executor/judge править
  `docs/` через `edit` отклоняется плагином;
- память инструментов заблокирована (memory guard);
- scratchpad не растёт бесконечно (`oc3 operator state check`);
- после рестарта оператор продолжает по state и `goals/`.

## 7. Типовые ситуации

**Гейт отклонил запуск judge.** Цикл по файлу из сообщения завершён:
прими тикет (merge, новый baseline), либо поставь `"retry": true` в
`*.expect.json` для одного повторного цикла, либо — к человеку.

**`fail` после повторного цикла.** Дальше решение человека: доработка
вручную, новая цель или ослабление требований через оператора.

**Docs guard отклонил правку.** Документацию пишет только librarian:
оператор формирует `docs_request` и запускает librarian; правки «заодно»
в основной сессии запрещены.

**Executor на паузе.** Штатно: оператор не опрашивает paused-сессии.
Возобновление — событие, таймер или просьба.

**Хочу собрать фидбек по работе.** Попроси оператора: «собери фидбек
по работе» — skill `operator-feedback` напишет
`.ops/feedback/<ticket>.yml`.

## 8. Ограничения пилота

- Watcher-демон отложен: автопробуждения по таймеру/CI нет — работу
  инициирует человек.
- Claude Code и Codex — пауза: контракт описывает их адаптеры, но
  пилотный прогон только под OpenCode.
- Гейт прогонов судит по всем `goals/*.expect.json` сразу: завершённый,
  но не разобранный цикл в одной цели блокирует запуск judge'а в любой.
  Сообщение гейта называет файл — разбери его (merge или `retry`).
