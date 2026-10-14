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

- `ticketCommits(...keys)` — тикет из шагов-коммитов по типам karma,
  `--amend` для подряд идущей работы одного типа, режим «пройти
  целиком», git-запись только по просьбе пользователя.
- `attention(...keys)` — внимание пользователя — самый дорогой ресурс:
  вопрос только там, где без решения нельзя продолжить или откатить;
  основная сессия — на доменной области, документация и проверки — на
  субагентах и harness.

## Лицензия

MIT
