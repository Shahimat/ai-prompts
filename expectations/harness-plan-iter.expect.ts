import { describe, it } from 'vitest';
import { budget } from '@shahimat/harness/expect';

budget({ crit: 0, warn: 0 });

// Процесс plan_iter в разработке: план — design/harness-plan-iter.md.
// Проверки появляются вместе с реализацией пунктов плана.
describe('[harness] plan_iter', () => {
  it.todo('команды планера: harness plan iter start | validate | graph, harness session <сессия> status | resume | retry | check | render | read | clone');
  it.todo('результат планера — plan.md; HTML для просмотра собирает отдельная команда render');
  it.todo('clone md --out <path> кладёт план в проект; без clone проект не меняется');
  it.todo('сессии лежат в ~/.config/harness; каталог переопределяется параметром');
  it.todo('переходами управляет автомат из harness.yaml; модель работает только внутри состояний');
  it.todo('граф автомата проверяется статически: все состояния достижимы, тупиков нет, у каждого цикла есть лимит');
  it.todo('в harness.yaml нет выражений: guards и действия — имена из реестра');
  it.todo('критерии ревью плана — один criteria.yaml по схеме plan-criteria');
  it.todo('бюджет стадии ревью: crit 0, warn не больше 3; info не блокирует');
  it.todo('проверка структуры плана (1a) не расходует попыток правки');
  it.todo('не больше 3 правок на цикл ревью; после четвёртого провала — failure-report.md');
  it.todo('ревьюеры плана не получают context.md');
  it.todo('у стадии ревью без сети нет WebSearch и WebFetch');
  it.todo('после «уточнить» plan.md не меняется ни на байт');
  it.todo('после «вернуть на доработку» изменены только отмеченные пункты и зависящие от них');
  it.todo('согласованный план не правится');
  it.todo('планер не планирует дальше нерешённого spike');
  it.todo('headless-прогоны задают флаги явно и не исполняют hooks проекта');
});
