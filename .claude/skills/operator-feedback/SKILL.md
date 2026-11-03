---
name: operator-feedback
description: Сбор фидбека оператора по работе — метрики отвлечений, циклов и потерь токенов, причины, рекомендации и evidence; файл .ops/feedback/<ticket>.yml. Загружай по явному запросу «собери фидбек», «что улучшить в контракте».
---

# operator-feedback

Операторский skill-исключение: оператор не загружает ролевые skills, но по
явному запросу пользователя собирает обратную связь о работе контракта.
Второе допустимое исключение — `browser-read`, и только как явное решение.

## Когда

- «собери фидбек по работе», «что улучшить в контракте», «почему столько
  отвлечений»;
- после серии тикетов, когда нужны причины, а не пересказ хода работы.

Фидбек не правит контракт и не меняет goals: он объясняет, что улучшить,
и передаётся пользователю или в `source-feedback`.

## Вход

- `goals/` — цели, программы, тикеты, их стадии;
- `.ops/<ticket>/reports/`, `verdicts/`, `checks/`, `research/`;
- `.ops/operator/state.yml` — scratchpad и пометки пауз;
- session stats инструмента, события watcher, замечания пользователя.

Сырые логи и стенограммы не пересказываются и не цитируются: только
указатели и обезличенные выдержки.

<!-- expect:operator-responsive -->
Оператор не замолкает: перед долгим запуском — строка «что запущено,
чего жду, ~сколько»; роли и harness с ролями запускаются в фоне, итог —
по уведомлению, а не опросом. Молчаливое ожидание — ошибка и метрика
фидбека.
<!-- /expect:operator-responsive -->

## Scratchpad

`.ops/operator/state.yml` — локальный кэш оператора, не memory и не
источник истины; формат:

```yaml
session: ses-1
goal: обновить контракт
priorities: [goals/program--contract.expect.ts]
programs: [contract]
tickets: [goals/contract.expect.ts#ticket-contract]
results: [goals/contract.expect.json]
waits: []
open_questions: []
pointers: [.ops/contract/]
updated_at: 2026-11-01T10:00:00Z
```

## Метрики

- `human_distractions_total` — сообщения оператора пользователю;
- `human_distractions_empty` — из них без решения и без действия;
- `operator_distractions_total` — запуски ролей;
- `operator_distractions_empty` — запуски без принятого артефакта, дубли,
  лишние проверки;
- `judge_cycles`, `conflicts`, `rework`, `queue_wait`,
  `time_to_first_status`, `docs_corrections`, `check_failures`,
  `paused_time`, `scratchpad_churn`;
- `tokens_wasted_estimate` — оценка токенов ролей с неуспешным,
  отклонённым или дублирующим результатом, ретраев и пустых сообщений.

`human_distractions_empty` и `tokens_wasted_estimate` — оценки, не
бухгалтерия: в отчёте укажи метод и погрешность. Пустое отвлечение
классифицируй по логу сообщений и реакции пользователя, потери токенов —
по session stats.

## Выход

`.ops/feedback/<ticket>.yml`:

```yaml
ticket: <key>
period: <from>..<to>
metrics: {}
observations: []
root_causes: []
recommendations: []
evidence: []
```

Правила:

- evidence — указатели (`file:line`, ключ тикета, session id), а не копии
  логов;
- без секретов, персональных данных и содержимого внешних систем;
- причина отделена от наблюдения: «долго ждали CI» — наблюдение,
  «проверки запускались после публикации» — причина;
- рекомендация проверяема: что поменять в контракте, роли, пресете или
  проверке и как понять, что стало лучше;
- если причина в контракте — файл предложения собирает skill
  `source-feedback`; фидбек сам источник не правит.

## Ответ

Пользователю — до 10 строк: главная причина, 2–3 рекомендации, цена
потерь и путь к файлу. Остальное остаётся в `.ops/feedback/`.
