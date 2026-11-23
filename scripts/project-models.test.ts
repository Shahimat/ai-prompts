import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { isRecord } from '@shahimat/ai-core';
import { parse, type ParseError } from 'jsonc-parser';
import { projectModels } from './project-models.ts';

const defaultModel = 'provider/default#careful';
const nativeAgents = ['build', 'plan', 'general', 'explore', 'compaction', 'title', 'summary'];

async function fixture(
  context: TestContext,
  config = '{}\n',
  roles: Record<string, string> = {},
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-models-'));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({ version: 1, default: defaultModel, roles }),
  );
  await writeFile(path.join(root, 'opencode.jsonc'), config);
  return root;
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else files[path.relative(root, file)] = await readFile(file, 'utf8');
    }
  }
  await visit(root);
  return files;
}

async function configAt(root: string): Promise<Record<string, unknown>> {
  const errors: ParseError[] = [];
  const config: unknown = parse(await readFile(path.join(root, 'opencode.jsonc'), 'utf8'), errors, {
    allowTrailingComma: true,
  });
  assert.deepEqual(errors, []);
  assert.ok(isRecord(config));
  return config;
}

await test('apply/check/apply сохраняет bytes и mtime после первой проекции', async (context) => {
  const root = await fixture(context);
  const file = path.join(root, 'opencode.jsonc');
  assert.equal(await projectModels(root, 'apply'), true);
  const bytes = await readFile(file);
  await utimes(file, new Date('2000-01-01'), new Date('2000-01-01'));
  const before = await stat(file);
  assert.equal(await projectModels(root, 'check'), false);
  assert.equal(await projectModels(root, 'apply'), false);
  assert.deepEqual(await readFile(file), bytes);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
});

await test('check обнаруживает drift без записи и предлагает apply', async (context) => {
  const root = await fixture(context, '{"model":"other/model"}\n');
  const before = await snapshot(root);
  const modified = (await stat(path.join(root, 'opencode.jsonc'))).mtimeMs;
  await assert.rejects(projectModels(root, 'check'), /npm run models:apply/);
  assert.deepEqual(await snapshot(root), before);
  assert.equal((await stat(path.join(root, 'opencode.jsonc'))).mtimeMs, modified);
});

await test('отсутствующий manifest не вызывает запись или scaffold', async (context) => {
  const root = await fixture(context);
  await rm(path.join(root, 'manifest.json'));
  const before = await snapshot(root);
  await assert.rejects(projectModels(root, 'apply'), /manifest.json/);
  assert.deepEqual(await snapshot(root), before);
});

await test('битый JSON или структура manifest отклоняются до записи', async (context) => {
  for (const manifest of [
    '{',
    '',
    '"not an object"',
    '{}',
    '{"version":1,"default":"invalid","roles":{}}',
    '{"version":1,"default":"provider/model","roles":{"build":false}}',
  ]) {
    const root = await fixture(context);
    await writeFile(path.join(root, 'manifest.json'), manifest);
    const before = await snapshot(root);
    await assert.rejects(projectModels(root, 'apply'), /manifest.json/);
    assert.deepEqual(await snapshot(root), before);
  }
});

await test('невалидные config и agents отклоняются до единственной записи', async (context) => {
  for (const config of [
    '{',
    '[]',
    'null',
    '{"model":false}',
    '{"agents":[]}',
    '{"agents":null}',
    '{"agents":{"custom":false}}',
    '{"agents":{"build":{},"custom":null}}',
    '{"agents":{"build":{},"custom":[]}}',
    '{"agents":{"build":{},"custom":{"model":42}}}',
    '{"agents":{"build":{"model":{"providerID":"provider","model":false}}}}',
  ]) {
    const root = await fixture(context, config);
    const before = await snapshot(root);
    await assert.rejects(projectModels(root, 'apply'), /opencode.jsonc/);
    assert.deepEqual(await snapshot(root), before);
  }
});

await test('отсутствующий config не создаётся автоматически', async (context) => {
  const root = await fixture(context);
  await rm(path.join(root, 'opencode.jsonc'));
  const before = await snapshot(root);
  await assert.rejects(projectModels(root, 'apply'), /ENOENT/);
  assert.deepEqual(await snapshot(root), before);
});

await test('native overrides и default сохраняют variant только на agents', async (context) => {
  const root = await fixture(
    context,
    '{"agents":{"custom":{"mode":"subagent","system":"keep"}}}',
    {
      build: 'provider/build#fast',
      custom: 'provider/custom#deep',
      operator: 'provider/operator#unused',
      'expect.judge': 'provider/judge#unused',
    },
  );
  const manifest = await readFile(path.join(root, 'manifest.json'), 'utf8');
  await projectModels(root, 'apply');
  const config = await configAt(root);
  assert.equal(config['model'], 'provider/default');
  const agents = config['agents'];
  assert.ok(isRecord(agents));
  assert.deepEqual(Object.keys(agents).sort(), [...nativeAgents, 'custom'].sort());
  for (const id of nativeAgents) {
    assert.deepEqual(agents[id], { model: id === 'build' ? 'provider/build#fast' : defaultModel });
  }
  assert.deepEqual(agents['custom'], {
    mode: 'subagent',
    system: 'keep',
    model: 'provider/custom#deep',
  });
  assert.equal(await readFile(path.join(root, 'manifest.json'), 'utf8'), manifest);
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({ version: 1, default: defaultModel, roles: {} }),
  );
  await projectModels(root, 'apply');
  const updated = (await configAt(root))['agents'];
  assert.ok(isRecord(updated));
  assert.deepEqual(updated['custom'], { mode: 'subagent', system: 'keep', model: defaultModel });
});

await test('JSONC comments, trailing commas и unrelated значения сохраняются', async (context) => {
  const config = `{
  // project configuration
  "model": "old/model", // default model
  "permission": {"edit": "ask",},
  "permissions": [{"action": "*memory*", "resource": "*", "effect": "deny",}],
  "plugin": ["custom-plugin"],
  "plugins": ["another-plugin"],
  "instructions": ["AGENTS.md"],
  "custom": {"url": "https://example.test/a//b", "text": "/* literal */"},
  "agents": {
    "build": {
      // native instructions
      "system": "Do not rewrite",
      "mode": "primary",
      "model": "old/build",
    },
  },
}
`;
  const root = await fixture(context, config);
  await projectModels(root, 'apply');
  const text = await readFile(path.join(root, 'opencode.jsonc'), 'utf8');
  for (const preserved of [
    '// project configuration',
    '// default model',
    '// native instructions',
    '"permission": {"edit": "ask",}',
    '"permissions": [{"action": "*memory*", "resource": "*", "effect": "deny",}]',
    '"plugin": ["custom-plugin"]',
    '"plugins": ["another-plugin"]',
    '"instructions": ["AGENTS.md"]',
    '"custom": {"url": "https://example.test/a//b", "text": "/* literal */"}',
    '"system": "Do not rewrite"',
    '"mode": "primary"',
  ]) {
    assert.ok(text.includes(preserved), preserved);
  }
  const agents = (await configAt(root))['agents'];
  assert.ok(isRecord(agents));
  assert.deepEqual(agents['build'], {
    system: 'Do not rewrite',
    mode: 'primary',
    model: defaultModel,
  });
});

await test('source v3 roles и skills неизменны, installed деревья не создаются', async (context) => {
  const root = await fixture(context, '{}', {
    operator: 'provider/operator',
    executor: 'provider/executor',
    'expect.judge': 'provider/judge',
  });
  for (const relative of ['agents/operator.md', 'agents/executor.md', 'skills/workflow/SKILL.md']) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), 'source v3 instruction');
  }
  const before = await snapshot(root);
  await projectModels(root, 'apply');
  await projectModels(root, 'check');
  const after = await snapshot(root);
  for (const [file, text] of Object.entries(before)) {
    if (file !== 'opencode.jsonc') assert.equal(after[file], text);
  }
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const directory of ['.opencode', '.agents', '.codex', '.oc3']) {
    await assert.rejects(stat(path.join(root, directory)), /ENOENT/);
  }
  const agents = (await configAt(root))['agents'];
  assert.ok(isRecord(agents));
  assert.deepEqual(Object.keys(agents).sort(), [...nativeAgents].sort());
});

await test('явный API root не зависит от cwd', async (context) => {
  const root = await fixture(context);
  const unrelated = await fixture(context, '{"custom":"untouched"}');
  const before = await snapshot(unrelated);
  const cwd = process.cwd();
  try {
    process.chdir(unrelated);
    await projectModels(root, 'apply');
    assert.equal(await projectModels(root, 'check'), false);
    assert.deepEqual(await snapshot(unrelated), before);
  } finally {
    process.chdir(cwd);
  }
});

await test('native agents и объектные ссылки модели приводятся к manifest без V1 agent', async (context) => {
  const root = await fixture(
    context,
    '{"model":{"providerID":"old","model":"root"},"agents":{"build":{"model":{"providerID":"old","model":"build","variant":"deep"},"permissions":[{"action":"edit","resource":"*","effect":"ask"}]}}}',
  );
  await projectModels(root, 'apply');
  const config = await configAt(root);
  assert.equal(config['agent'], undefined);
  const agents = config['agents'];
  assert.ok(isRecord(agents));
  assert.deepEqual(agents['build'], {
    model: defaultModel,
    permissions: [{ action: 'edit', resource: '*', effect: 'ask' }],
  });
  assert.equal(await projectModels(root, 'check'), false);
});
