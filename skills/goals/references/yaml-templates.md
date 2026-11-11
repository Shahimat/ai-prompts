# Шаблоны YAML-очереди v2

Нейтральные шаблоны, не реальные задачи. Замени ключи и содержание под
согласованный проект. Не создавай программу без общей работы и подцелей,
manual — без человеческого действия. Порядок записи задаёт приоритет.

## context/views/goals.yaml

```yaml
goals:
  - key: shared-foundation
    kind: program
    file: program--shared-foundation.yaml
    status: planned
    one_liner: <общая основа и подцели инициативы>
    subgoals:
      - key: first-result
        file: goal--first-result.yaml
        status: planned
        one_liner: <проверяемый результат подцели>
```

Самостоятельная цель — запись без `kind: program` и `subgoals`, со ссылкой
на свой `goal--<key>.yaml`. Пустая очередь — `goals: []`.

## context/views/program--shared-foundation.yaml

```yaml
key: shared-foundation
kind: program
title: <название общей инициативы>
status: planned
why: <зачем нужна общая основа>
description: |
  <Состав общей работы, риски и открытые вопросы.>
  Тикет «<результат общего тикета>».
  Готовность: <наблюдаемый результат>.
  Чеклист: <минимальные последовательные пункты по типам изменений>.
tasks:
  blocker: []
  high:
    - '<результат общего тикета> → <итоговый type> → <блокер при наличии>'
  medium: []
  low: []
depends_on: []
```

## context/views/goal--first-result.yaml

```yaml
key: first-result
program: shared-foundation
title: <название результата>
status: planned
why: <чью потребность закрывает цель>
description: |
  <Состав результата и риски.>
  Тикет «<результат тикета>».
  Готовность: <проверяемое условие>.
  Чеклист: <минимальные последовательные пункты по типам изменений>.
tasks:
  blocker:
    - '<результат тикета> → <итоговый type> → ждёт общую основу программы'
  high: []
  medium: []
  low: []
depends_on: []
```

У цели вне программы нет поля `program`. `depends_on` содержит только
ключи реально нужных других целей; зависимость от общей работы программы
выражается блокером подцели, не искусственной зависимостью от соседней подцели.
Перед сохранением проверь всё множество через `goal-consistency`.
