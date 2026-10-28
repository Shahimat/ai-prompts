import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSecrets, scanSecrets } from '#commands/secrets/secrets';
import { main, run } from '#cli';

const AWS = `${'AKIA'}${'Q7XK2M9PLR4TWZ8N'}`;
const GITHUB = `${'ghp'}_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}`;
const PRIVATE = `${'-----BEGIN'} OPENSSH PRIVATE KEY-----`;

const kinds = (text: string): string[] =>
  scanSecrets(text, 'f.md').map((d) => `${d.line ?? 0}: ${d.message}`);

describe('scanSecrets', () => {
  it('находит ключи, токены, приватные ключи и пароли', () => {
    expect(kinds(`a\nkey = ${AWS}\n`)).toEqual(['2: секрет: ключ API AWS']);
    expect(kinds(`token: ${GITHUB}`)).toEqual(['1: секрет: токен GitHub']);
    expect(kinds(PRIVATE)).toEqual(['1: секрет: приватный ключ']);
    expect(kinds(`password: "${'Tr0ub4dor'}&3-horse"`)).toEqual([
      '1: секрет: пароль или секрет в присваивании',
    ]);
    expect(kinds(`DB_PASSWORD="${'s3cr3t'}-Pa55word"`)).toEqual([
      '1: секрет: пароль или секрет в присваивании',
    ]);
  });

  it('не печатает значение секрета', () => {
    expect(JSON.stringify(scanSecrets(`key = ${AWS}`, 'f.md'))).not.toContain(AWS);
  });

  it('заглушки и ссылки на хранилище — не секреты', () => {
    expect(
      kinds(
        [
          'token: <hex>',
          'password: ${DB_PASSWORD}',
          'api_key: "{{ secrets.API_KEY }}"',
          'secret: env:SERVICE_SECRET',
          'password: ********',
          'password: changeme',
          'token: указатель на хранилище',
          'Пароль хранится в vault, токен — в CI.',
          'token_count: 1234567890',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('одна строка — одно нарушение', () => {
    expect(kinds(`token: ${GITHUB} ${AWS}`)).toHaveLength(1);
  });
});

describe('checkSecrets', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'harness-secrets-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('вне git обходит файлы каталога, кроме node_modules', async () => {
    await writeFile(path.join(root, 'a.md'), `key = ${AWS}\n`);
    await mkdir(path.join(root, 'node_modules/x'), { recursive: true });
    await writeFile(path.join(root, 'node_modules/x/b.md'), `key = ${AWS}\n`);
    expect((await checkSecrets(root, { allow: [] })).map((d) => d.file)).toEqual(['a.md']);
  });

  it('исключение снимает нарушение по файлу и строке', async () => {
    await writeFile(path.join(root, 'a.md'), `x\nkey = ${AWS}\nkey = ${AWS}\n`);
    const line2 = { path: 'a.md', line: 2, reason: 'пример' };
    expect((await checkSecrets(root, { allow: [line2] })).map((d) => d.line)).toEqual([3]);
    expect(await checkSecrets(root, { allow: [{ path: 'a.md', reason: 'фикстура' }] })).toEqual([]);
  });

  it('пропускает бинарные файлы', async () => {
    await writeFile(path.join(root, 'b.bin'), Buffer.from([0, 1, ...Buffer.from(AWS)]));
    expect(await checkSecrets(root, { allow: [] })).toEqual([]);
  });
});

describe('ai-core secrets scan', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'harness-secrets-cli-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('проверяет проект и отдельный файл по пути', async () => {
    expect(await main(['secrets', 'scan', '--root', root])).toBe(0);
    const file = path.join(root, 'proposal.json');
    await writeFile(file, JSON.stringify({ evidence: `token: ${GITHUB}` }));
    expect(await main(['secrets', 'scan', '--file', file])).toBe(1);
    expect(await main(['secrets', 'scan', '--root', root])).toBe(1);
    expect(await run(['secrets', 'scan', '--file', path.join(root, 'none.json')])).toBe(2);
  });
});
