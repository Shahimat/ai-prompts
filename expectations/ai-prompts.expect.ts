import { budget } from '@shahimat/harness/expect';
import { ticketCommits } from '@shahimat/expectations';

// Правила работы агента в самом репозитории: skill ticket-commits и
// особенности репозитория в CLAUDE.md (якоря expect:ticket-commits*).
budget({ crit: 0, warn: 0 });

ticketCommits('ticket-commits', 'ticket-commits:repo');
