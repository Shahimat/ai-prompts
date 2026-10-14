# Журнал @shahimat/harness

Свежее сверху. Одна версия — список новых команд и проверок.

## 0.4.0

- CLI harness — под его именем: `harness <имя> start | open <id> | list
  | status <id> | validate | graph`; неймспейсы `plan` и `session`, а с
  ними `resume` и `retry`, убраны. id сессии — sha256, в выводе 7
  символов, команды принимают уникальный префикс от 4. Пауза — выход:
  `open` заново выполняет действие текущего состояния, в состоянии агента
  это приём задания, из `failed` — повтор со сбросом счётчиков.
- Плоские имена harness `категория-вид`: `plan-review` (бывший
  `plan/iter`), `docs-delta`, `source-sync`. Harness живёт в одном
  каталоге `src/harnesses/<имя>/`: `harness.yaml`, критерии и промпты
  рядом с кодом, в пакет — внутри `dist`. Переопределения пользователя —
  `~/.config/harness/harnesses/<имя>/`. Код пакета — в `packages/`.
- Скрипт `harness refresh`: `context index`, `adapters sync`, затем
  шаги `check`.
- Harness агента `docs-delta` (`harness docs-delta start --name
  <дельта>`) и `source-sync` (`harness source-sync start`): в состоянии
  агента harness останавливается с заданием, `open` продолжает.
- Слои пакета: `shared` → `lib` → `commands` → `scripts` → `harness`.
  Узел дерева CLI объявляет вид (`command`, `script`, `harness`) и эффект
  (`query` или `mutation`); эффект скрипта выводится из его шагов.
  `harness check` — скрипт из `changelog lint`, `context check`,
  `adapters check`, `secrets scan`: каждый шаг печатает свой итог, общий
  итог — строкой `check (…): ok | есть нарушения`. Точка входа
  `@shahimat/harness/expect` — `dist/lib/expect/`.
- `harness context check` и `harness adapters check` — сверка
  `context/index.yml` и файлов адаптеров без записи: то же, что проверяет
  `harness check`, отдельной командой.
- Проверка `secrets` и команда `harness secrets scan [--file <path>]`:
  ключи API, токены, пароли, приватные ключи в отслеживаемых файлах или
  в файле по пути. В `harness check` включена по умолчанию, выключается
  `secrets: false`; исключения — `checks.secrets.allow` с `reason`.
- Планер `plan-review`: `harness plan-review start` и общие команды
  harness, свои — `check <id> [--hook] | render <id> | read <id> |
  clone <id> [md]`. Автомат из
  `harness.yaml` (схема `harness-fsm`), критерии `criteria.yaml`,
  плагины `handlers/`, сессии в `~/.config/harness`. Модель в любом
  состоянии, включая интерактивного планера, — без skills
  (`--disable-slash-commands`) и только с перечисленными инструментами
  (`--tools`).
- `list` и `help` на каждом уровне дерева команд; без аргументов в
  терминале — оболочка с переходом по уровням.
- `harness delta check | close` — дельта документации `context/.delta/`:
  удаление или изменение знания без пункта `revise` — нарушение; `close`
  удаляет принятую дельту. `context index` не читает `context/.delta/`.
- Справка и разбор команд — из декларативного дерева `COMMANDS`.
- `harness outdated` — версия из `context/harness.yml` против последней в
  npm и записи этого журнала между ними.
- Якоря доказательств `@KEY`: `<!-- expect:KEY -->` (markdown),
  `# expect:KEY` (YAML), `// expect:KEY` (TS).
- Ключ вердикта судьи — заголовок + доказательства.
- `expect judge` удаляет из `.verdicts.json` вердикты, которые не нужны
  ни одному текущему ожиданию: кэш не растёт с историей правок.
- `expect` работает строго от `--root`: кэш вердиктов и доказательства не
  читаются из текущей папки.
- `skill(name).description` — пустая строка, если `description` во
  frontmatter не строка (раньше `[object Object]`); `index_layers` с
  нестроковым `format` — значение в диагностике как JSON.
- Данные извне (`.verdicts.json`, `plan.json`, ответы судьи, отчёт vitest,
  npm registry, `answers` модулей и поля пресетов) проверяются по форме:
  неверная форма — ошибка с путём к полю, а не молча принятое значение.

## 0.3.0

- `harness expect init | report | lint | judge [--apply]`: ожидания в форме
  vitest, уровни crit / warn / info, бюджет, судья с кэшем вердиктов.
- Помощники `@shahimat/harness/expect`: зонды, `judged`, JSON Schema.

## 0.2.0

- `index_layers` с `format: yml`; группа `presets` и поле `deprecated` в
  индексе источника.

## 0.1.0

- `harness check`, `changelog lint`, `context index`, `adapters sync`,
  `index build | check`.
