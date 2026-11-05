import { crit, describe } from '@shahimat/ai-core/expect';

describe('goal: contract-deploy', () => {
  describe('ticket: contract-deploy', () => {
    crit.todo(
      'антилазейка в always-loaded: строка брифинга шаблона AGENTS.md и AGENTS.md репозитория прямо закрывает «быстро»/«просто глянь»; бюджет пресетов (≤8192 байт) соблюдён',
    );
    crit.todo(
      'skill workflow: раздел брифинга прямо закрывает «быстрый вопрос»/«срочно» — те же брифинг и порядок чтения; копия .agents/skills синхронна',
    );
    crit.todo(
      'skill source-sync (канон и копия): раздел «Развёртывание и миграция» — установщик одной командой, вопросы человеку, верификация; ручная сборка контракта из удалённых текстов запрещена; description несёт триггеры «смигрируй на v3», «разверни контракт»',
    );
    crit.todo('README: строка-вход развёртывания и миграции контракта');
    crit.todo('npm run ci зелёный');
  });
});
