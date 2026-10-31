# Журнал @shahimat/cli

Свежее сверху.

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
