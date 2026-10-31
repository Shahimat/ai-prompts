import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { budget, crit, note, readRepo, repoRoot } from '@shahimat/ai-core/expect';
import { attention } from './shared/attention.ts';
import { at, parseJson, recordOrEmpty, stringAt } from './shared/guards.ts';

budget({ crit: 0, warn: 0 });

attention('attention:repo');

describe('публичные npm-пакеты', () => {
  crit(
    'у каждого пакета не больше одной неопубликованной версии: версия в репозитории — опубликованная или следующая за последней опубликованной',
    () => Check.oneUnpublishedVersion(),
  );
  crit('верхняя запись CHANGELOG.md пакета — его текущая версия из package.json', () =>
    Check.changelogMatchesVersion(),
  );
});

describe('источник', () => {
  crit(
    'контракт, модули, skills, роли, паттерны, пресеты, harness и пакеты не называют конкретных компаний, их систем и внутренних сущностей — только абстракции',
    () => Check.abstractOnly(),
  );
});

const PACKAGES = ['ai-core', 'harness'];

const STOPLIST =
  process.env['AI_PROMPTS_STOPLIST'] ?? path.join(homedir(), '.config', 'ai-prompts', 'stoplist');

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function stopTerms(): Promise<string[] | undefined> {
  const text = await readFile(STOPLIST, 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

const localVersion = async (pkg: string): Promise<string> =>
  stringAt(parseJson(await readRepo(`packages/${pkg}/package.json`)), 'version');

const parse = (v: string): number[] => v.split('.').map((x) => Number.parseInt(x, 10));

function isNextVersion(latest: string, next: string): boolean {
  const [a = 0, b = 0, c = 0] = parse(latest);
  return [`${a}.${b}.${c + 1}`, `${a}.${b + 1}.0`, `${a + 1}.0.0`].includes(next);
}

class Check {
  static async abstractOnly(): Promise<void> {
    const terms = await stopTerms();
    if (terms === undefined || terms.length === 0) {
      note(`стоп-лист ${STOPLIST} не найден — проверка источника на конкретику пропущена`);
      return;
    }
    const word = new RegExp(
      `(?<![\\p{L}\\p{N}_-])(${terms.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_-])`,
      'iu',
    );
    const files = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: repoRoot(),
      encoding: 'utf8',
    })
      .stdout.split('\n')
      .filter((f) => f !== '');
    const found: string[] = [];
    for (const file of files) {
      const text = await readRepo(file).catch(() => '');
      text.split('\n').forEach((line, i) => {
        const term = word.exec(line)?.[1];
        if (term !== undefined) found.push(`${file}:${i + 1}: ${term}`);
      });
    }
    expect(found).toEqual([]);
  }

  static async oneUnpublishedVersion(): Promise<void> {
    for (const pkg of PACKAGES) {
      const response = await fetch(`https://registry.npmjs.org/@shahimat%2f${pkg}`);
      if (response.status === 404) {
        expect({ pkg, local: await localVersion(pkg) }).toEqual({ pkg, local: '0.1.0' });
        continue;
      }
      expect(response.ok, `npm: @shahimat/${pkg}`).toBe(true);
      const meta: unknown = await response.json();
      const versions = recordOrEmpty(at(meta, 'versions'), `npm: @shahimat/${pkg} versions`);
      const latest = stringAt(meta, 'dist-tags', 'latest');
      const local = await localVersion(pkg);
      const ok = local in versions || isNextVersion(latest, local);
      expect({ pkg, local, latest, ok }).toMatchObject({ ok: true });
    }
  }

  static async changelogMatchesVersion(): Promise<void> {
    for (const pkg of PACKAGES) {
      const top = /^## (\S+)/m.exec(await readRepo(`packages/${pkg}/CHANGELOG.md`))?.[1];
      expect({ pkg, top }).toEqual({ pkg, top: await localVersion(pkg) });
    }
  }
}
