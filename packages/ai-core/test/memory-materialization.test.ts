import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBundles, checkBundles, ensureMemory, writeGraph } from '#lib/memory-graph';
import { checkMemory } from '#lib/memory';
import { isRecord } from '#shared/guards';
import { createHash } from 'node:crypto';
import { checkOc3Tree } from '#commands/tree/index';
import { inlineProse } from '#lib/memory-projection';
import { enqueueKnowledge, pendingKnowledge } from '#lib/knowledge';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'memory-materialization-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const put = async (rel: string, text: string): Promise<void> => {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), text);
};
const scenario = (given: string, when: string, result: string): Record<string, string> =>
  Object.fromEntries(
    ['given', 'when', 'then'].map((key, index) => [
      key,
      index === 0 ? given : index === 1 ? when : result,
    ]),
  );
const fixture = async (cap = 16384): Promise<void> => {
  await put('.oc3/data/__schemas/manifest.schema.json', JSON.stringify({ type: 'object' }));
  await put(
    '.oc3/data/__schemas/conventions.schema.json',
    JSON.stringify({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { key: { type: 'string' }, rule: { type: 'string' } },
      },
    }),
  );
  await put('.oc3/data/__schemas/glossary.schema.json', JSON.stringify({ type: 'array' }));
  await put(
    '.oc3/data/__schemas/entities.schema.json',
    JSON.stringify({
      type: 'object',
      $defs: { body: { type: 'object', additionalProperties: true } },
      allOf: [{ $ref: '#/$defs/body' }],
    }),
  );
  await put(
    '.oc3/manifest.json',
    JSON.stringify({
      namespace: ['code'],
      data: ['entities'],
      budgets: { node: cap, start: 24576 },
      files: { 'data/entities/domain.yml': { namespace: ['code'], weight: 1 } },
    }),
  );
  await put('.oc3/data/entities/domain.yml', stringify({ id: 'domain', summary: 'unchanged' }));
};
const built = async () => {
  const report = await buildBundles(root);
  expect(report.diagnostics).toEqual([]);
  if (report.graph === null) throw new Error('нет графа');
  await writeGraph(root, report.graph);
  return report.graph;
};
const installed = async (): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of (
      await readdir(path.join(root, '.oc3/bundles', dir), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) await walk(rel);
      else out.set(rel, await readFile(path.join(root, '.oc3/bundles', rel), 'utf8'));
    }
  };
  await walk('');
  return out;
};
const unescape = (text: string): string =>
  text.replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)));
const decode = (text: string): unknown => {
  const values = new Map<number, unknown>();
  const blocks = [
    ...text.matchAll(
      /Значение (\d+) — (объект|список|строка|число|логическое|пустое); родитель (корень|\d+)(?:; элемент (\d+))?(?:; значение ([^\n]+))?\./g,
    ),
  ];
  const fragments = (label: string, id: number): string =>
    [...text.matchAll(new RegExp(`${label} ${id}, позиция (\\d+):\\n<pre>([\\s\\S]*?)</pre>`, 'g'))]
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => unescape(m[2] ?? ''))
      .join('');
  for (const m of blocks) {
    const id = Number(m[1]);
    const value: unknown =
      m[2] === 'объект'
        ? {}
        : m[2] === 'список'
          ? []
          : m[2] === 'строка'
            ? fragments('Текст', id)
            : m[2] === 'пустое'
              ? null
              : m[2] === 'логическое'
                ? m[5] === 'true'
                : Number(m[5]);
    values.set(id, value);
    if (m[3] === 'корень') continue;
    const parent = values.get(Number(m[3]));
    if (Array.isArray(parent)) parent.push(value);
    else if (typeof parent === 'object' && parent !== null)
      Object.defineProperty(parent, fragments('Ключ', id), { value, enumerable: true });
  }
  return values.get(0);
};

describe('bounded lossless memory materialization', () => {
  it('compact ring-zero prose retains typed paths and exact multiline strings without a raw serialization', () => {
    const data = {
      'a.b': { '': [false, null, '', {}, [], 0, -0, 3.25, 'false'] },
      a: { b: '  exact\n\n 😀 «guillemets» [&] \r\n' },
    };
    const text = inlineProse(data);
    const parents: unknown[] = [];
    let decoded: unknown;
    const rows = text.matchAll(
      /^( *)(?:- (?:«([^»]*)»|элемент (\d+)) — )?(объект|список|null|логическое (?:true|false)|число [^\n]+|«[^»]*»)\.\n/gm,
    );
    for (const m of rows) {
      const raw = m[4] ?? '';
      const value: unknown =
        raw === 'объект'
          ? {}
          : raw === 'список'
            ? []
            : raw === 'null'
              ? null
              : raw.startsWith('«')
                ? unescape(raw.slice(1, -1))
                : raw.startsWith('число ')
                  ? Number(raw.slice(6))
                  : raw.endsWith('true');
      const depth = m[2] === undefined && m[3] === undefined ? 0 : (m[1]?.length ?? 0) / 2 + 1;
      if (depth === 0) decoded = value;
      else {
        const parent = parents[depth - 1];
        if (Array.isArray(parent)) parent.push(value);
        else if (isRecord(parent))
          Object.defineProperty(parent, unescape(m[2] ?? ''), { value, enumerable: true });
      }
      parents[depth] = value;
    }
    expect(decoded).toEqual(data);
  });
  it('schema-valid nested BDD, typed keys, Unicode and empty values round-trip through reachable prose', async () => {
    await fixture();
    const data = {
      id: 'domain',
      summary: 'unchanged',
      verified: false,
      verified_at: null,
      scenarios: [
        scenario('  Кириллица 😀 é\n\n<&> `[]`  \r\n', 'action', 'result'),
        scenario('second', '', 'tail sentinel'),
      ],
      'a.b': [0, -4.25, true, 'false', [], {}, null],
      a: { b: false },
      '[/](*).#': { '__proto__ safe': 'key sentinel' },
      empty: '',
      ['long.key[/]😀'.repeat(4000)]: 'long key sentinel',
    };
    await put('.oc3/data/entities/domain.yml', stringify(data));
    expect((await checkMemory(root)).diagnostics).toEqual([]);
    const graph = await built();
    const files = await installed();
    const visited = new Set<string>();
    const visit = (rel: string): void => {
      if (visited.has(rel)) return;
      visited.add(rel);
      const text = files.get(rel);
      expect({ rel, exists: text !== undefined }).toEqual({ rel, exists: true });
      for (const m of (text ?? '').matchAll(/\]\(([^)]+)\)/g)) {
        const target = path.posix.normalize(
          path.posix.join(path.posix.dirname(rel), decodeURIComponent(m[1] ?? '')),
        );
        expect(target.startsWith('../')).toBe(false);
        visit(target);
      }
    };
    visit('index.md');
    const payload = [...files].filter(([p]) => p.startsWith('files/') && /part-/.test(p));
    expect(payload.length).toBeGreaterThan(0);
    expect(payload.every(([p]) => visited.has(p))).toBe(true);
    expect(decode(payload.map(([, text]) => text).join('\n'))).toEqual(data);
    expect(graph.nodes[0]?.text).not.toContain('tail sentinel');
    expect([...files.values()].join('')).not.toContain('[object Object]');
    expect((await checkOc3Tree(root)).diagnostics).toEqual([]);
  });

  it('strict behavior BDD schema retains scenarios/false/null, and multiple launches share one validated ensure', async () => {
    await fixture();
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'namespace', 'summary', 'verified', 'verified_at', 'scenarios'],
      properties: {
        id: { type: 'string' },
        namespace: { type: 'string' },
        summary: { type: 'string' },
        verified: { type: 'boolean' },
        verified_at: { type: ['string', 'null'] },
        scenarios: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['given', 'when', 'then'],
            properties: Object.fromEntries(
              ['given', 'when', 'then'].map((key) => [key, { type: 'string' }]),
            ),
          },
        },
      },
    };
    await put('.oc3/data/__schemas/behavior.schema.json', JSON.stringify(schema));
    const data = {
      id: 'flow',
      namespace: 'code',
      summary: 'BDD flow',
      verified: false,
      verified_at: null,
      scenarios: [scenario('precondition', 'action', 'result'), scenario('second', 'next', 'tail')],
    };
    await put('.oc3/data/behavior/flow.yml', stringify(data));
    await put(
      '.oc3/manifest.json',
      JSON.stringify({
        namespace: ['code'],
        data: ['entities', 'behavior'],
        files: {
          'data/entities/domain.yml': { namespace: ['code'], weight: 1 },
          'data/behavior/flow.yml': { namespace: ['code'], weight: 2 },
        },
      }),
    );
    const results = await Promise.all([ensureMemory(root), ensureMemory(root), ensureMemory(root)]);
    expect(results.every((r) => r.diagnostics.length === 0)).toBe(true);
    const files = await installed();
    const dir = createHash('sha256').update('data/behavior/flow.yml').digest('hex');
    expect(
      decode(
        [...files]
          .filter(([p]) => p.startsWith(`files/${dir}/`) && /part-/.test(p))
          .map(([, text]) => text)
          .join('\n'),
      ),
    ).toEqual(data);
    const graph = results[0]?.graph;
    const outer = graph?.nodes.find((n) => n.key === 'code:1');
    const inner = graph?.nodes.find((n) => n.key === 'code:2');
    expect(outer?.text).toContain(`../${inner?.dir}/index.md`);
    expect(files.has(`${inner?.dir}/index.md`)).toBe(true);
    await put('.oc3/data/behavior/flow.yml', stringify({ ...data, verified: 'false' }));
    expect((await ensureMemory(root)).diagnostics.length).toBeGreaterThan(0);
  });

  it.each([16384, 24576])(
    'large corpus and long scalar fit byte cap %i without changing namespace or weights',
    async (cap) => {
      await fixture(cap);
      const data = {
        id: 'domain',
        summary: 'unchanged',
        entities: Array.from({ length: 512 }, (_, i) => ({
          id: `entity-${i}`,
          components: [false, null, `entity sentinel ${i}`],
        })),
        behavior: Array.from({ length: 256 }, (_, i) => ({
          scenarios: [scenario(`given ${i}`, `when ${i}`, `then sentinel ${i}`)],
        })),
        rules: Array.from(
          { length: 192 },
          (_, i) => `rule sentinel ${i} ${'rule text '.repeat(24)}`,
        ),
        long: '  😀 Юникод\n'.repeat(cap),
      };
      await put('.oc3/data/entities/domain.yml', stringify(data));
      for (let i = 0; i < 200; i++)
        await put(
          `.oc3/manuals/${String(i).padStart(4, '0')}-${'x'.repeat(80)}.md`,
          `# Manual ${i}\n\nBody sentinel ${i}\n`,
        );
      const manifest: unknown = JSON.parse(
        await readFile(path.join(root, '.oc3/manifest.json'), 'utf8'),
      );
      if (!isRecord(manifest) || !isRecord(manifest['files'])) throw new Error('нет files');
      for (let i = 0; i < 200; i++)
        manifest['files'][`manuals/${String(i).padStart(4, '0')}-${'x'.repeat(80)}.md`] = {
          namespace: ['code'],
          weight: 1,
        };
      await put('.oc3/manifest.json', JSON.stringify(manifest));
      const manifestBytes = await readFile(path.join(root, '.oc3/manifest.json'), 'utf8');
      const graph = await built();
      expect(await readFile(path.join(root, '.oc3/manifest.json'), 'utf8')).toBe(manifestBytes);
      expect(graph.nodes.map((n) => n.key)).toEqual(['code:1']);
      const files = await installed();
      for (const [rel, text] of files)
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(rel === 'index.md' ? 24576 : cap);
      expect([...files.keys()].some((p) => /page-/.test(p))).toBe(true);
      const projection = [...files].filter(([p]) => p.startsWith('files/') && /part-/.test(p));
      const dir = createHash('sha256').update('data/entities/domain.yml').digest('hex');
      expect(
        decode(
          projection
            .filter(([p]) => p.startsWith(`files/${dir}/`))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => text)
            .join('\n'),
        ),
      ).toEqual(data);
      const text = projection.map(([, text]) => text).join('\n');
      expect(text).toContain('then sentinel 255');
      expect(text).toContain('rule sentinel 191');
      expect((await checkBundles(root)).diagnostics).toEqual([]);
      const continuation = [...files.keys()].find((p) => /page-/.test(p));
      if (continuation === undefined) throw new Error('нет страницы продолжения');
      await rm(path.join(root, '.oc3/bundles', continuation));
      expect((await checkBundles(root)).diagnostics.length).toBeGreaterThan(0);
      await built();
      await put('.oc3/data/entities/domain.yml', stringify({ id: 'domain', summary: 'unchanged' }));
      await built();
      expect((await installed()).size).toBeLessThan(files.size);
      expect((await checkBundles(root)).diagnostics).toEqual([]);
    },
  );

  it('check is read-only, detects missing/tampered/stale payload, and build prunes only owned outputs', async () => {
    await fixture();
    expect((await checkBundles(root)).diagnostics.length).toBeGreaterThan(0);
    expect(await readdir(path.join(root, '.oc3'))).not.toContain('bundles');
    await enqueueKnowledge(
      { root, actor: 'executor', execution: 'pending-test', channel: 'test' },
      [
        {
          subject: 'pending-sentinel',
          property: 'keep',
          value: false,
          kind: 'candidate',
          evidence: ['synthetic'],
        },
      ],
    );
    const pending = await pendingKnowledge(root);
    await built();
    const first = await installed();
    await built();
    expect(await installed()).toEqual(first);
    const payload = [...first.keys()].find((p) => p.startsWith('files/') && /part-/.test(p));
    if (payload === undefined) throw new Error('нет payload');
    await rm(path.join(root, '.oc3/bundles', payload));
    expect((await checkBundles(root)).diagnostics.some((d) => d.file.endsWith(payload))).toBe(true);
    await built();
    await put(`.oc3/bundles/${payload}`, 'tampered');
    expect((await checkBundles(root)).diagnostics.length).toBeGreaterThan(0);
    await built();
    await put(
      '.oc3/data/entities/domain.yml',
      stringify({ id: 'domain', summary: 'unchanged', tail: 'new tail' }),
    );
    expect((await checkBundles(root)).diagnostics.length).toBeGreaterThan(0);
    await put('.oc3/bundles/files/dead/index.md', 'stale');
    await mkdir(path.join(root, '.oc3/bundles/deadbeefdead'), { recursive: true });
    await built();
    expect([...(await installed())].some(([p]) => p.includes('/dead/'))).toBe(false);
    expect((await installed()).has('pending/index.md')).toBe(true);
    expect(await pendingKnowledge(root)).toEqual(pending);
    expect((await installed()).get('pending/index.md')).toContain('pending-sentinel');
    expect((await checkBundles(root)).diagnostics).toEqual([]);
  });

  it('schema composition, refs, nullable unions and unknown permitted keys are complete; invalid domain is rejected', async () => {
    await fixture();
    const schema = {
      type: 'object',
      $defs: { flag: { anyOf: [{ type: 'boolean' }, { type: 'null' }] } },
      allOf: [
        {
          properties: {
            nested: { type: 'object', properties: { flag: { $ref: '#/$defs/flag' } } },
          },
        },
      ],
      properties: { union: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
    };
    await put('.oc3/data/__schemas/entities.schema.json', JSON.stringify(schema));
    const data = {
      union: 3.5,
      nested: { flag: null },
      'extra.key': { mixed: [true, null, '', {}, []] },
    };
    await put('.oc3/data/entities/domain.yml', stringify(data));
    await built();
    expect(
      decode(
        [...(await installed())]
          .filter(([p]) => p.startsWith('files/') && /part-/.test(p))
          .map(([, text]) => text)
          .join('\n'),
      ),
    ).toEqual(data);
    await put('.oc3/data/entities/domain.yml', stringify({ union: false }));
    expect((await buildBundles(root)).diagnostics.length).toBeGreaterThan(0);
  });

  it('missing node and damaged navigation fail; symbolic projection cannot escape bundles', async () => {
    await fixture();
    const graph = await built();
    const node = graph.nodes[0];
    if (node === undefined) throw new Error('нет узла');
    await rm(path.join(root, '.oc3/bundles', node.dir), { recursive: true });
    expect((await checkBundles(root)).diagnostics.length).toBeGreaterThan(0);
    await built();
    await put(`.oc3/bundles/${node.dir}/index.md`, node.text.replace('../files/', '../missing/'));
    expect((await checkBundles(root)).diagnostics.length).toBeGreaterThan(0);
    await built();
    const payload = [...graph.files.keys()].find((p) => /part-/.test(p));
    if (payload === undefined) throw new Error('нет payload');
    await rm(path.join(root, '.oc3/bundles', payload));
    await symlink(
      path.join(root, '.oc3/data/entities/domain.yml'),
      path.join(root, '.oc3/bundles', payload),
    );
    await expect(checkBundles(root)).rejects.toThrow('SYMLINK');
  });

  it('invalid flat convention and impossible cap leave previous graph untouched', async () => {
    await fixture();
    await built();
    const first = await installed();
    await put('.oc3/conventions/flat.yml', stringify([{ key: 'bad', rule: { nested: 'no' } }]));
    expect((await buildBundles(root)).diagnostics.length).toBeGreaterThan(0);
    expect(await installed()).toEqual(first);
    await rm(path.join(root, '.oc3/conventions/flat.yml'));
    await fixture(5);
    const bad = await buildBundles(root);
    expect(bad.diagnostics.length).toBeGreaterThan(0);
    expect(await installed()).toEqual(first);
    await fixture();
    const manifest: unknown = JSON.parse(
      await readFile(path.join(root, '.oc3/manifest.json'), 'utf8'),
    );
    if (!isRecord(manifest) || !isRecord(manifest['budgets'])) throw new Error('нет budgets');
    manifest['budgets']['start'] = 5;
    await put('.oc3/manifest.json', JSON.stringify(manifest));
    expect((await buildBundles(root)).diagnostics.some((d) => d.message.includes('cap 5'))).toBe(
      true,
    );
    expect(await installed()).toEqual(first);
  });
});
