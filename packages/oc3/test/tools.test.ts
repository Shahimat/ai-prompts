import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Plugin } from '@opencode/plugin';
import { compileSchema, isRecord, pendingKnowledge } from '@shahimat/ai-core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { nativeKnowledgeEnqueue, registerTools } from '#tools';

type Editor = Parameters<Parameters<Plugin.Context['tool']['transform']>[0]>[0];
type Definition = Parameters<Editor['add']>[0];
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'native-inbox-tools-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('registers all native inbox/gate paths and advertises optional closed delta without changing legacy submit', async () => {
  const tools = new Map<string, Definition>();
  const editor: Editor = {
    list: () => [],
    get: () => undefined,
    namespace: () => undefined,
    add: (tool) => {
      tools.set(tool.name, tool);
    },
    update: () => undefined,
    remove: () => undefined,
  };
  await registerTools({
    location: { directory: root },
    tool: {
      transform: async (callback) => {
        callback(editor);
        return { dispose: async () => undefined };
      },
    },
  });
  for (const name of [
    'knowledge_enqueue',
    'knowledge_pending',
    'knowledge_batch',
    'operator_preflight',
    'operator_verify',
    'operator_ready',
    'submit_result',
  ])
    expect(tools.has(name)).toBe(true);
  const submit = tools.get('submit_result');
  const enqueue = tools.get('knowledge_enqueue');
  if (
    submit === undefined ||
    enqueue === undefined ||
    !isRecord(submit.input) ||
    !isRecord(enqueue.input)
  )
    throw new Error('tool schema missing');
  const legacy = { status: 'done', changed: [], failed: [], questions: [], report: 'synthetic' };
  const delta = [
    {
      subject: 'native',
      property: 'pending',
      value: [1, true],
      kind: 'decision',
      evidence: ['fixture'],
    },
  ];
  expect(compileSchema(submit.input)({ message: 'result', data: legacy })).toEqual([]);
  expect(
    compileSchema(submit.input)({ message: 'result', data: { ...legacy, knowledge_delta: delta } }),
  ).toEqual([]);
  expect(compileSchema(enqueue.input)({ knowledge_delta: delta })).toEqual([]);
  expect(
    compileSchema(enqueue.input)({ knowledge_delta: delta, actor: 'spoof' }).length,
  ).toBeGreaterThan(0);
  expect(await readdir(root)).toEqual([]);
});

it('native operator ingress uses caller identity, is durable/idempotent and rejects producer metadata without a role or spawn', async () => {
  const input = {
    knowledge_delta: [
      {
        subject: 'operator',
        property: 'pending',
        value: { synthetic: true },
        kind: 'candidate',
        evidence: ['fixture:native-manual'],
      },
    ],
  };
  const context = { agent: 'operator', sessionID: 'synthetic-session' };
  const first = await nativeKnowledgeEnqueue(root, input, context);
  expect(await nativeKnowledgeEnqueue(root, input, context)).toEqual(first);
  expect(await pendingKnowledge(root)).toHaveLength(1);
  await expect(
    nativeKnowledgeEnqueue(root, { ...input, actor: 'executor' }, context),
  ).rejects.toThrow('INVALID_DELTA');
  expect((await readdir(root)).sort()).toEqual(['.oc3']);
});
