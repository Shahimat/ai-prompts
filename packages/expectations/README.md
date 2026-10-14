# @shahimat/expectations

Наборы ожиданий к правилам работы AI-агента для `harness expect`
([`@shahimat/harness`](https://www.npmjs.com/package/@shahimat/harness)).
Текст ожиданий — единый для всех проектов; каждый проект проверяет ими
свои файлы с правилами.

```ts
import { budget } from '@shahimat/harness/expect';
import { ticketCommits } from '@shahimat/expectations';

budget({ crit: 0, warn: 0 });
ticketCommits('ticket-commits');
```

В реализации правила размечаются якорем — привязку держит реализация, а
не ожидания:

```markdown
<!-- expect:ticket-commits -->
…текст правила…
<!-- /expect:ticket-commits -->
```

## Наборы

Каждый набор — паттерн (`pattern()` из `@shahimat/harness/expect`):
функция с параметрами, без путей и имён проекта внутри. Ожидания
приписываются файлу, который применил паттерн; в HTML-отчёте у них виден
ключ паттерна. Цели паттерна входят в заголовок, якоря доказательств —
только параметром.

- `ticketCommits(...keys)` — тикет из шагов-коммитов по типам karma,
  `--amend` для подряд идущей работы одного типа, режим «пройти
  целиком», git-запись только по просьбе пользователя.
- `attention(...keys)` — внимание пользователя — самый дорогой ресурс:
  вопрос только там, где без решения нельзя продолжить или откатить;
  основная сессия — на доменной области, документация и проверки — на
  субагентах и harness.

## Паттерны harness

Для проектов, которые проверяют свои harness (`@shahimat/harness`):

```ts
import { harnessChain, harnessCommands } from '@shahimat/expectations';

harnessCommands({ harness: 'docs-delta' });
harnessChain({
  harness: 'docs-delta',
  chain: [
    { state: 'apply', event: 'done' },
    { state: 'verify', event: 'ok' },
    { state: 'close', event: 'ok' },
  ],
  fails: ['verify', 'close'],
  back: 'apply',
  limit: 3,
});
```

- `harnessCommands({ harness })` — у harness есть команды `start | open
  | list | status | validate | graph`.
- `harnessChain({ harness, chain, fails, back, limit })` — автомат
  harness — цепочка состояний `chain`; провал состояний `fails`
  возвращает в `back` не больше `limit` раз, затем `failed`; из `failed`
  — `retry` в `back` со сбросом счётчика; конечное — `done`.

## Лицензия

MIT
