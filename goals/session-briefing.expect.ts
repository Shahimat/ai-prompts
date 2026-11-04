import { crit, describe } from '@shahimat/ai-core/expect';

describe('goal: session-briefing', () => {
  describe('ticket: session-briefing', () => {
    crit.todo(
      'oc3: на первый промпт каждой сессии operator-centric проекта в системный промпт добавляется одна строка брифинга — режим проекта (context/project.yml → briefing, «не задан — дефолт cheap») и указание провести брифинг до ролей и тикетов; unit-тесты в packages/oc3/test',
    );
    crit.todo(
      'шаблон AGENTS.md в контракте содержит строку-триггер брифинга в блоке «Оператор», бюджет шаблона (≤80 строк) соблюдён',
    );
    crit.todo(
      'skill workflow: description начинается с императива старта сессии, раздел «Брифинг перед стартом» требует брифинг первым содержательным сообщением сессии',
    );
    crit.todo(
      'npm run ci в worktree зелёный: format, build, typecheck, lint, тесты, индекс, ожидания',
    );
  });
});
