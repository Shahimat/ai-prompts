import { crit, describe } from '@shahimat/ai-core/expect';

describe('goal: workflow-synonyms', () => {
  describe('ticket: workflow-synonyms', () => {
    crit.todo(
      'шаблон AGENTS.md в контракте: «Сценарии» ведут разговорные фразы («составь план», «спланируй», «что по целям») и маршрут «фиксируй ожидания»/«заведи тикет» → goals/*.expect.ts; бюджет шаблона соблюдён',
    );
    crit.todo(
      'skill workflow: карта слов-маршрутов по смыслу для plan/execute/audit/challenge/report/models и действий по целям (формат goal/ticket/crit.todo); AGENTS.md репозитория и копия .agents/skills/workflow синхронны с каноном',
    );
    crit.todo('npm run ci зелёный');
  });
});
