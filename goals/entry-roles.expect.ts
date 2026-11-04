import { crit, describe } from '@shahimat/ai-core/expect';

describe('goal: entry-roles', () => {
  describe('ticket: role-window', () => {
    crit.todo(
      'oc3 init --roles <список> пишет .agents/agents/<роль>.md выбранных ролей и context/skills.yml с привязками пресета operator-centric, отфильтрованными по ролям; повторный запуск не перетирает пользовательские правки',
    );
    crit.todo(
      'без флага окно ролей входит в вопросы человеку: предложение researcher, executor, judge, librarian (дефолт) и точная команда повторного прогона; выбор ролей — часть установки, не «потом»',
    );
    crit.todo(
      'watch-request/watch-triage вне дефолта: запрос без подключённого модуля watchers — отказ с подсказкой contract-setup',
    );
    crit.todo(
      'шаблоны AGENTS.md пакета синхронизированы с каноном контракта: брифинг-строка («быстро» не отменяет), фразы-маршруты в «Сценариях», AI_CORE_FALLBACK_PIN 0.1.7',
    );
    crit.todo(
      'детект плагина не доверяет подстроке: ключ «plugin» (не «plugins») с @shahimat/oc3 — состояние не v3-ok, вывод называет причину («плагин не загрузится — ключ plugin вместо plugins»); unit-тест на этот кейс',
    );
    crit.todo(
      'отчёт установщика печатает канонический состав ядра operator-centric (имена core-skills и агентов) — SHA частей заполняют первые source-sync update, самодельные экстракторы из удалённого индекса не нужны',
    );
    crit.todo(
      'skill source-sync: в разделе «Развёртывание и миграция» — окно ролей сразу после установки, не «потом» (оператор, эта ветка)',
    );
    crit.todo(
      'unit-тесты: пресет по ролям, повторный merge, отказ watch без модуля; npm run ci зелёный; версии и пины не тронуты',
    );
  });
});
