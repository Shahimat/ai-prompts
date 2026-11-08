# Журнал @shahimat/cli

Свежее сверху.

## 0.1.6

- `@shahimat/ai-core` 0.1.9: плоская `.oc3/`, память, проектные модели,
  knowledge inbox и гейты проверки; CLI передаёт `--batch` автоматам.
- `check` включает schema-driven `tree check`, `context-index` заменён
  на `context`; обязательный `memory check` не допускает false GREEN
  отсутствующей/повреждённой/стухшей установленной памяти, без auto-repair.
- REFRESH: adapters sync → memory build → CHECK; внутренний DOCS_VERIFY:
  adapters sync → delta check → memory build → CHECK. Упразднённый
  `index.yml` не строится, новой публичной команды `ai docs verify` нет.
- Без установленной canonical memory явно пропускаются только точные
  шаги `memory build`/`memory check`, без нового `checks.memory`;
  inbox pending/enqueue/batch не фильтруются этим skip.

## 0.1.4

- Маркер корня проекта — каталог `.opencode`: команды `ai` ищут его вверх
  от места вызова, домашний каталог проектом не считается.
- `@shahimat/ai-core` 0.1.6: раннер ролей и адаптер opencode.
- Разбор флагов `--stale`, `--days`, `--forget`: протухшие сессии
  (`list`) и снятие с учёта (`open`).

## 0.1.3

- `@shahimat/ai-core` 0.1.4: guard установки и корневой CHANGELOG.

## 0.1.2

- `@shahimat/ai-core` 0.1.2; неверный вход команды — короткая ошибка
  без полной справки.

## 0.1.1

- `@shahimat/ai-core` 0.1.1.

## 0.1.0

- Опции `--all`, `--every`, `--until`, `--job`, `--timeout` для команд
  `ai ops …`.

- Пакет — точка входа: бинарь `ai`, скрипты `check`, `refresh`,
  `docs verify` (перенесены из `@shahimat/ai-core`), оболочка, дерево
  команд из `ai-core`, автоматов `@shahimat/harness` (динамически, если
  установлен) и расширений проекта из `.agents/commands`,
  `.agents/scripts`, `.agents/harnesses`.
- `runtime` для автоматов и ролей: исполнитель скриптов и команда `ai`.
