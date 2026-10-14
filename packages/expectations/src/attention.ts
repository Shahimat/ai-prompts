import { describe } from 'vitest';
import { crit, judged } from '@shahimat/harness/expect';

export function attention(...keys: string[]): void {
  if (keys.length === 0) throw new Error('attention: нужен хотя бы один ключ якоря');
  const check = (): Promise<void> => judged(keys.map((k) => `@${k}`));

  describe('внимание пользователя — самый дорогой ресурс', () => {
    crit(
      'вопрос пользователю — только там, где без его решения нельзя продолжить или откатить',
      check,
    );
    crit(
      'основная сессия тратит контекст на доменную область; документацию и проверки ведут субагенты и harness',
      check,
    );
  });
}
