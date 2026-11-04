import { crit, describe } from '@shahimat/ai-core/expect';

describe('goal: contract-entry', () => {
  describe('ticket: briefing-gate', () => {
    crit.todo(
      'до записи брифинга сессии гейт отказывает bash/edit/write/subagent с сообщением «брифинг не проведён — спроси схему работы»; после ответа человека модель вызывает oc3.briefing_done и работа разблокируется',
    );
    crit.todo(
      'строка session-brief содержит указание вызвать briefing_done после ответа на вопрос схемы; чисто текстовый ответ остаётся возможным',
    );
    crit.todo('unit-тесты: гейт до/после ack, изоляция по sessionID, чистая сессия не блокирует read-инструменты');
    crit.todo('npm run ci зелёный; версии и пины не тронуты');
  });
  describe('ticket: operator-agent', () => {
    crit.todo(
      'oc3 init создаёт .opencode/agents/operator.md (mode: primary; тонкий промпт: маршрут — AGENTS.md, брифинг и сценарии — skill workflow) и пишет "default_agent": "operator" в opencode.jsonc проекта',
    );
    crit.todo(
      'повторный запуск не перетирает пользовательские правки operator.md и чужой default_agent (merge-поведение описано в выводе команды)',
    );
    crit.todo('unit-тесты генерации и повторного запуска');
  });
  describe('ticket: init-installer', () => {
    crit.todo(
      'init определяет состояние nothing|v2|v3-partial|v3-ok (маркеры: context/workflow.md, context/views/, sync.contract.key, module-маркеры AGENTS.md) и выполняет установку/миграцию: пишет ядро из шаблонов пакета, сохраняя пользовательские секции и module-блоки',
    );
    crit.todo(
      'вопросы, решаемые только человеком (reality, реквизиты), печатаются списком; содержательный перенос v2-очереди context/views — отчёт миграции, не молчаливая конверсия',
    );
    crit.todo('состояние проекта — громко: «v2 detected» / «v3 partial» в первой строке вывода');
    crit.todo(
      'runtime: full — дефолт установщика (OpenCode ставит плагин сам без node/npm, research .ops/contract-entry/research/cold-start-plugins.md); degraded — только offline/недоступный реестр; детект node/npm даёт подсказку про ai CLI и harness-проверки, degraded описан в выводе команды',
    );
    crit.todo(
      'npm run ci зелёный; версии и пины не тронуты — релизный каскад отдельным циклом после слияния harness-reliability',
    );
  });
});
