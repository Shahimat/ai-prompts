import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from '@opencode/plugin';
import {
  isRecord,
  artifactPath,
  validateArtifactOutput,
  confinedProjectPath,
} from '@shahimat/ai-core';

export const BRIDGE_FILE = '.oc3/sessions/plan-review/bridge.json';

export interface PlanBridge {
  root?: string;
  events: string;
  plan: string;
  report: string;
}

export async function readBridge(root: string): Promise<PlanBridge | undefined> {
  let data: unknown;
  try {
    data = JSON.parse(
      await readFile(artifactPath(root, { kind: 'bridge', key: 'bridge.json' }), 'utf8'),
    );
  } catch {
    return undefined;
  }
  if (!isRecord(data)) return undefined;
  const str = (key: string): string | undefined => {
    const value = data[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };
  const events = str('events');
  const plan = str('plan');
  const report = str('report');
  if (events === undefined || plan === undefined || report === undefined) return undefined;
  if (data['root'] !== path.resolve(root)) return undefined;
  validateArtifactOutput(root, path.relative(root, events), 'bridge');
  confinedProjectPath(root, plan);
  return { root: path.resolve(root), events, plan, report };
}

export interface BridgeEvent {
  kind: 'prompt' | 'edit' | 'bash';
  [key: string]: unknown;
}

export async function appendBridgeEvent(bridge: PlanBridge, event: BridgeEvent): Promise<void> {
  if (bridge.root === undefined) throw new Error('ARTIFACT_SCOPE_REQUIRED');
  validateArtifactOutput(bridge.root, path.relative(bridge.root, bridge.events), 'bridge');
  await mkdir(path.dirname(bridge.events), { recursive: true });
  const line = `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`;
  await appendFile(bridge.events, line, 'utf8');
}

export const EDIT_ACTIONS = ['edit', 'write'] as const;
export const BASH_ACTIONS = ['bash', 'shell'] as const;

export const editDenied = (plan: string): string => `планер правит только файл ожиданий ${plan}`;

export const bashDenied = (report: string): string =>
  `в сессии планера Bash — только команда отчёта: ${report}. Проект читай инструментами Read, Glob и Grep.`;

export async function plannerGuard(
  action: string,
  resources: readonly string[],
  bridge: PlanBridge,
  root: string,
): Promise<string | undefined> {
  if (bridge.root !== undefined && path.resolve(bridge.root) !== path.resolve(root))
    throw new Error('ARTIFACT_SCOPE_MISMATCH');
  if ((EDIT_ACTIONS as readonly string[]).includes(action)) {
    const planAbs = confinedProjectPath(root, bridge.plan);
    for (const resource of resources) {
      if (path.resolve(root, resource) !== planAbs) return editDenied(bridge.plan);
    }
    await appendBridgeEvent({ ...bridge, root }, { kind: 'edit', path: bridge.plan });
    return undefined;
  }
  if ((BASH_ACTIONS as readonly string[]).includes(action)) {
    const command = resources.join(' ').trim();
    const allowed = command === bridge.report.trim();
    await appendBridgeEvent({ ...bridge, root }, { kind: 'bash', command, allowed });
    return allowed ? undefined : bashDenied(bridge.report);
  }
  return undefined;
}

export async function registerPlanBridge(ctx: Plugin.Context): Promise<void> {
  const root = ctx.location.directory;
  await ctx.session.hook('prompt', async (input) => {
    const bridge = await readBridge(root);
    if (bridge === undefined) return;
    await appendBridgeEvent(bridge, {
      kind: 'prompt',
      text: input.prompt.text,
      sessionID: input.sessionID,
    });
  });
  await ctx.permission.hook('evaluate', async (event) => {
    const known =
      (EDIT_ACTIONS as readonly string[]).includes(event.action) ||
      (BASH_ACTIONS as readonly string[]).includes(event.action);
    if (!known) return;
    const bridge = await readBridge(root);
    if (bridge === undefined) return;
    const denied = await plannerGuard(event.action, event.resources, bridge, root);
    if (denied === undefined) return;
    event.effect = 'deny';
    event.message = denied;
  });
}
