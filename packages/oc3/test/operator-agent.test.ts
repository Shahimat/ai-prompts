import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRecord } from '@shahimat/ai-core';
import {
  applyDefaultAgent,
  ensureDefaultAgent,
  ensureOperatorAgent,
  operatorAgentMd,
} from '#operator-agent';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-operator-agent-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ensureOperatorAgent', () => {
  it('создаёт operator.md с mode primary и только маршрутизирующим промптом', async () => {
    const report = await ensureOperatorAgent(root);
    expect(report).toContain('создан');
    const text = await readFile(path.join(root, '.opencode', 'agents', 'operator.md'), 'utf8');
    expect(text).toContain('mode: primary');
    expect(text).toContain('AGENTS.md');
    expect(text).toContain('skill workflow');
    expect(text).toContain('брифинг схемы');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain('oc3.briefing_done');
  });

  it('повторный запуск на шаблоне — без изменений, на правках пользователя — не перетирает', async () => {
    await ensureOperatorAgent(root);
    const second = await ensureOperatorAgent(root);
    expect(second).toContain('без изменений');
    const abs = path.join(root, '.opencode', 'agents', 'operator.md');
    const edited = '---\nmode: primary\n---\nмой собственный промпт оператора\n';
    await writeFile(abs, edited, 'utf8');
    const third = await ensureOperatorAgent(root);
    expect(third).toContain('не перетираю');
    expect(await readFile(abs, 'utf8')).toBe(edited);
  });
});

describe('applyDefaultAgent', () => {
  it('вставляет default_agent после верхней фигурной скобки, сохраняя $schema и комментарии', () => {
    const text =
      '{\n  // комментарий пользователя\n  "$schema": "https://opencode.ai/config.json",\n  "plugins": ["@shahimat/oc3"]\n}\n';
    const applied = applyDefaultAgent(text);
    expect(applied.report).toContain('добавил');
    expect(applied.text).toContain('// комментарий пользователя');
    expect(applied.text).toContain('"$schema": "https://opencode.ai/config.json"');
    expect(applied.text).toContain('"default_agent": "operator"');
    expect(applied.text.indexOf('"default_agent"')).toBeLessThan(applied.text.indexOf('"plugins"'));
    const withoutComments = applied.text
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(() => {
      JSON.parse(withoutComments);
    }).not.toThrow();
  });

  it('пустой конфиг и конфиг без объекта обрабатываются без порчи', () => {
    const empty = applyDefaultAgent('{}\n');
    expect(empty.text).toBe('{\n  "default_agent": "operator"\n}\n');
    const broken = applyDefaultAgent('не конфиг вовсе\n');
    expect(broken.text).toBe('не конфиг вовсе\n');
    expect(broken.report).toContain('вручную');
  });

  it('чужой default_agent не перетирает, свой — без изменений', () => {
    const foreign = applyDefaultAgent('{\n  "default_agent": "build"\n}\n');
    expect(foreign.text).toBe('{\n  "default_agent": "build"\n}\n');
    expect(foreign.report).toContain('не перетираю');
    expect(foreign.report).toContain('build');
    const own = applyDefaultAgent('{\n  "default_agent": "operator"\n}\n');
    expect(own.text).toBe('{\n  "default_agent": "operator"\n}\n');
    expect(own.report).toContain('уже стоит');
  });

  it('default_agent внутри строки или вложенного объекта не считается верхнеуровневым', () => {
    const text = '{\n  "note": "see default_agent key",\n  "agent": { "inner": "operator" }\n}\n';
    const applied = applyDefaultAgent(text);
    expect(applied.report).toContain('добавил');
    const hits = applied.text.match(/"default_agent"/g) ?? [];
    expect(hits.length).toBe(1);
  });
});

describe('ensureDefaultAgent', () => {
  it('без конфига создаёт opencode.jsonc с $schema и default_agent', async () => {
    const report = await ensureDefaultAgent(root);
    expect(report).toContain('opencode.jsonc: создан');
    const text = await readFile(path.join(root, 'opencode.jsonc'), 'utf8');
    const data: unknown = JSON.parse(text);
    if (!isRecord(data)) throw new Error('opencode.jsonc не объект');
    expect(data['default_agent']).toBe('operator');
    expect(data['$schema']).toBe('https://opencode.ai/config.json');
  });

  it('существующий opencode.jsonc получает ключ, повторный запуск — без изменений', async () => {
    const abs = path.join(root, 'opencode.jsonc');
    await writeFile(
      abs,
      '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugins": ["@shahimat/oc3"]\n}\n',
      'utf8',
    );
    const first = await ensureDefaultAgent(root);
    expect(first).toContain('добавил');
    const second = await ensureDefaultAgent(root);
    expect(second).toContain('уже стоит');
    const text = await readFile(abs, 'utf8');
    expect(text).toContain('"default_agent": "operator"');
    expect(text).toContain('"plugins": ["@shahimat/oc3"]');
  });

  it('чужой default_agent в существующем конфиге сохраняется', async () => {
    const abs = path.join(root, 'opencode.json');
    await writeFile(abs, '{\n  "default_agent": "plan"\n}\n', 'utf8');
    const report = await ensureDefaultAgent(root);
    expect(report).toContain('не перетираю');
    expect(report).toContain('opencode.json:');
    expect(await readFile(abs, 'utf8')).toBe('{\n  "default_agent": "plan"\n}\n');
    const absent = await readFile(path.join(root, 'opencode.jsonc'), 'utf8').catch(() => 'нет');
    expect(absent).toBe('нет');
  });

  it('шаблон agent-файла стабилен и первичен', () => {
    expect(operatorAgentMd()).toContain('mode: primary');
    expect(operatorAgentMd().endsWith('\n')).toBe(true);
  });
});
