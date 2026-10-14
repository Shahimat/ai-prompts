import { describe, expect } from 'vitest';
import { contract, crit, expectAtMost, indexEntries } from '@shahimat/harness/expect';

/** Общие ожидания к любому контракту. Подключение: anyContract('<key>'). */
export function anyContract(key: string): void {
  const check = new AnyContractCheck(key);

  describe('общее для контрактов', () => {
    crit('frontmatter: key, kind contract, title и use_case заполнены', () => check.frontmatter());
    crit('у каждого паттерна из frontmatter есть файл в patterns/', () => check.patternsExist());
    crit('контракт не длиннее 600 строк', () => check.length());
    crit('в контракте нет таблиц markdown', () => check.noTables());
    crit('контракт не помечен deprecated', () => check.notDeprecated());
  });
}

// ─────────────────────────────── проверки ───────────────────────────────

class AnyContractCheck {
  private readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  async frontmatter(): Promise<void> {
    const fm = (await contract(this.key)).frontmatter ?? {};
    expect(fm['key']).toBe(this.key);
    expect(fm['kind']).toBe('contract');
    expect(fm['title']).toEqual(expect.stringMatching(/\S/));
    expect(fm['use_case']).toEqual(expect.stringMatching(/\S/));
  }

  async patternsExist(): Promise<void> {
    const patterns = ((await contract(this.key)).frontmatter?.['patterns'] ?? []) as string[];
    const known = (await indexEntries()).filter((e) => e.kind === 'pattern').map((e) => e.key);
    expect(patterns.filter((p) => !known.includes(p))).toEqual([]);
  }

  async length(): Promise<void> {
    expectAtMost((await contract(this.key)).lines, 600, 'строк в контракте');
  }

  async noTables(): Promise<void> {
    expect((await contract(this.key)).text.split('\n').filter((l) => /^\|.*\|$/.test(l.trim()))).toEqual([]);
  }

  async notDeprecated(): Promise<void> {
    expect((await contract(this.key)).frontmatter?.['deprecated']).toBeUndefined();
  }
}
