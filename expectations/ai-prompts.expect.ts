import { budget } from '@shahimat/harness/expect';
import { ticketCommits } from '@shahimat/expectations';

// Правила работы агента в самом репозитории ai-prompts: CLAUDE.md и skill
// workflow, на который он ссылается за полным протоколом.
budget({ crit: 0, warn: 0 });

ticketCommits(['CLAUDE.md#Тикеты и коммиты', 'skills/workflow/SKILL.md#Тикеты и коммиты']);
