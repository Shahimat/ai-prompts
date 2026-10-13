# @shahimat/expectations

Наборы ожиданий к правилам работы AI-агента для `harness expect`
([`@shahimat/harness`](https://www.npmjs.com/package/@shahimat/harness)).
Текст ожиданий — единый для всех проектов; каждый проект проверяет ими
свои файлы с правилами.

```ts
import { budget } from '@shahimat/harness/expect';
import { ticketCommits } from '@shahimat/expectations';

budget({ crit: 0, warn: 0 });
ticketCommits(['CLAUDE.md#Тикеты и коммиты']);
```

## Наборы

- `ticketCommits(evidence)` — тикет из шагов-коммитов по типам karma,
  `--amend` для подряд идущей работы одного типа, режим «пройти
  целиком», git-запись только по просьбе пользователя.

## Лицензия

MIT
