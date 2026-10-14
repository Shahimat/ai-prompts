import { describe, expect } from 'vitest';
import { budget, crit, readRepo } from '@shahimat/harness/expect';
import { attention, ticketCommits } from '@shahimat/expectations';
import { at, parseJson, recordOrEmpty, stringAt } from './shared/guards.ts';

budget({ crit: 0, warn: 0 });

ticketCommits('ticket-commits', 'ticket-commits:repo');
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

const PACKAGES = ['harness', 'expectations'];

const localVersion = async (pkg: string): Promise<string> =>
  stringAt(parseJson(await readRepo(`packages/${pkg}/package.json`)), 'version');

const parse = (v: string): number[] => v.split('.').map((x) => Number.parseInt(x, 10));

function isNextVersion(latest: string, next: string): boolean {
  const [a = 0, b = 0, c = 0] = parse(latest);
  return [`${a}.${b}.${c + 1}`, `${a}.${b + 1}.0`, `${a + 1}.0.0`].includes(next);
}

class Check {
  static async oneUnpublishedVersion(): Promise<void> {
    for (const pkg of PACKAGES) {
      const response = await fetch(`https://registry.npmjs.org/@shahimat%2f${pkg}`);
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
