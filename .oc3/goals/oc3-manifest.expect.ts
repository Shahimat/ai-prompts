import { crit, describe } from '@shahimat/ai-core/expect';

describe('goal: oc3-manifest', () => {
  crit.todo(
    'oc3 init (greenfield) создаёт .oc3/manifest.json: перечисляет все файлы фактов (.oc3/doc/) с дефолтными весами (common/project/autonomy — вес 0, остальное — 2), namespace: [домены из путей], data: [структуры, найденные в doc/data/], бюджеты по умолчанию; и .oc3/NOTES.md с заголовком',
  );
  crit.todo(
    'oc3 migrate (старая раскладка → .oc3/) после переноса создаёт манифест с перечнем ПЕРЕНЕСЁННЫХ файлов фактов и их дефолтными весами; файлы без namespace — общие',
  );
  crit.todo(
    'повторный прогон не перетирает пользовательские веса/узлы манифеста: существующие записи сохраняются, добавляются только новые файлы фактов',
  );
  crit.todo(
    'после init/migrate ai memory check проходит на созданном манифесте (валидация по схеме) и ai memory build собирает стартовый бандл',
  );
  crit.todo('unit-тесты: greenfield, migrate, re-run merge, веса по умолчанию; npm run ci зелёный; версии и пины не тронуты');
});
