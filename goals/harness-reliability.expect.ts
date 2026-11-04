import { crit, describe } from '@shahimat/ai-core/expect';

describe('goal: harness-reliability', () => {
  describe('ticket: judge-submit-channel', () => {
    crit.todo(
      'ai expect judge <entry> --run доводит пакет до apply вердиктов сам: спавненная judge-сессия возвращает answers через submit_result, ручных обходов нет',
    );
    crit.todo(
      'отказ роли виден: transcript прогона доступен (флаг или env), причина «не вернула итог» объяснена в сообщении ошибки',
    );
    crit.todo(
      'unit-тесты канала роли покрывают конверт ответа батча и fallback-парсинг итога',
    );
    crit.todo('npm run ci зелёный');
  });
  describe('ticket: docs-delta-hang', () => {
    crit.todo(
      'docs-delta start/open не висят: недоступный шаг — быстрая ошибка с причиной и таймаутом, процессы не остаются висеть',
    );
    crit.todo(
      'протухшая сессия реестра harness обнаруживается и снимается штатной командой',
    );
    crit.todo(
      'релизный каскад один на цель: версии и пины @shahimat/* подняты по design/packages.md, packages-check без crit',
    );
    crit.todo('npm run ci зелёный');
  });
});
