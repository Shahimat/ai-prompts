import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendBrief, briefText } from '#ops-brief';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-ops-brief-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function putBin(source: string): Promise<void> {
  const bin = path.join(root, 'node_modules/@shahimat/cli/dist/bin.js');
  await mkdir(path.dirname(bin), { recursive: true });
  await writeFile(bin, source);
}

describe('briefText', () => {
  it('без CLI сводки нет', async () => {
    expect(await briefText(root)).toBeUndefined();
  });

  it('вывод CLI получает заголовок и режется до 20 строк', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `ops: строка ${i + 1}`);
    await putBin(`console.log(${JSON.stringify(lines.join('\n'))});\n`);
    const text = await briefText(root);
    expect(text).toBeDefined();
    const out = text === undefined ? [] : text.split('\n');
    expect(out.length).toBe(21);
    expect(out.at(0)).toContain('ops-brief');
    expect(out.at(1)).toBe('ops: строка 1');
    expect(out.at(20)).toBe('ops: строка 20');
  });

  it('падение CLI и пустой вывод не дают сводки', async () => {
    await putBin('process.exit(1);\n');
    expect(await briefText(root)).toBeUndefined();
    await putBin('console.log("  ");\n');
    expect(await briefText(root)).toBeUndefined();
  });
});

describe('appendBrief', () => {
  it('сводка попадает в первый промпт сессии один раз', async () => {
    await putBin('console.log("ops: jobs 0");\n');
    const seen = new Set<string>();
    const first = { text: 'первый промпт' };
    await appendBrief(first, root, seen, 's1');
    expect(first.text.startsWith('первый промпт')).toBe(true);
    expect(first.text).toContain('ops: jobs 0');
    const second = { text: 'второй промпт' };
    await appendBrief(second, root, seen, 's1');
    expect(second.text).toBe('второй промпт');
    const next = { text: 'новая сессия' };
    await appendBrief(next, root, seen, 's2');
    expect(next.text).toContain('ops: jobs 0');
  });

  it('без CLI промпт не меняется и сессия не помечается', async () => {
    const seen = new Set<string>();
    const prompt = { text: 'вопрос' };
    await appendBrief(prompt, root, seen, 's1');
    expect(prompt.text).toBe('вопрос');
    expect(seen.has('s1')).toBe(false);
  });
});
