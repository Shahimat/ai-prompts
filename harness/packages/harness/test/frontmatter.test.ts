import { describe, expect, it } from 'vitest';
import { normalizeEol, parseFrontmatter } from '../src/frontmatter.ts';

describe('normalizeEol', () => {
  it('приводит CRLF и одиночный CR к LF', () => {
    expect(normalizeEol('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });
});

describe('parseFrontmatter', () => {
  it('разбирает блок между первыми двумя ---', () => {
    const text = '---\nkey: demo\npatterns: [a, b]\n---\n# body\n---\n';
    expect(parseFrontmatter(text)).toEqual({ key: 'demo', patterns: ['a', 'b'] });
  });

  it('понимает CRLF', () => {
    expect(parseFrontmatter('---\r\nkey: demo\r\n---\r\nbody')).toEqual({ key: 'demo' });
  });

  it('возвращает null, если файл не начинается с ---', () => {
    expect(parseFrontmatter('# README\n---\nkey: x\n---\n')).toBeNull();
  });

  it('возвращает null, если блок не закрыт', () => {
    expect(parseFrontmatter('---\nkey: x\n')).toBeNull();
  });

  it('пустой блок — пустой объект', () => {
    expect(parseFrontmatter('---\n---\n')).toEqual({});
  });

  it('падает на невалидном YAML', () => {
    expect(() => parseFrontmatter('---\nuse_case: a: b\n---\n')).toThrow();
  });

  it('падает, если frontmatter не объект', () => {
    expect(() => parseFrontmatter('---\n- a\n---\n')).toThrow(/YAML-объектом/);
  });
});
