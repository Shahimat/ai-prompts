import path from 'node:path';
import { isRecord, isStringArray, schemaErrors, UsageError } from '@shahimat/ai-core';
import { readYaml } from './files.ts';
import { AUTONOMY_FILE, OPS_CONFIG } from './paths.ts';

export const INTERFACES = ['tasks', 'vcs', 'review', 'checks', 'schedule'] as const;
export type InterfaceName = (typeof INTERFACES)[number];

export const OPS_CONFIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'context/ops.yml — провайдеры и проверки рантайма ops',
  type: 'object',
  additionalProperties: false,
  properties: {
    providers: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        INTERFACES.map((i) => [i, { type: 'string', pattern: '^[a-z][a-z0-9-]*$' }]),
      ),
    },
    verify: { type: 'array', items: { type: 'string', minLength: 1 } },
    repo: { type: 'string', minLength: 1 },
  },
};

export interface OpsConfig {
  providers: Record<InterfaceName, string>;
  verify: string[];
  repo: string;
}

export const DEFAULT_PROVIDERS: Readonly<Record<InterfaceName, string>> = {
  tasks: 'local',
  vcs: 'git',
  review: 'none',
  checks: 'none',
  schedule: 'auto',
};

export async function loadOpsConfig(root: string): Promise<OpsConfig> {
  const data = await readYaml(path.join(root, OPS_CONFIG), OPS_CONFIG);
  const config: OpsConfig = { providers: { ...DEFAULT_PROVIDERS }, verify: [], repo: root };
  if (data === undefined || data === null) return config;
  const errors = schemaErrors(OPS_CONFIG_SCHEMA, data, OPS_CONFIG);
  if (errors.length > 0) throw new UsageError(errors.join('\n'));
  if (!isRecord(data)) return config;
  const providers = data['providers'];
  if (isRecord(providers))
    for (const i of INTERFACES) {
      const name = providers[i];
      if (typeof name === 'string') config.providers[i] = name;
    }
  if (isStringArray(data['verify'])) config.verify = data['verify'];
  const repo = data['repo'];
  if (typeof repo === 'string') config.repo = path.resolve(root, repo);
  return config;
}

export const LEVELS = ['self', 'ask', 'never'] as const;
export type Level = (typeof LEVELS)[number];

export const AUTONOMY_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'context/autonomy.yml — политика действий наружу',
  type: 'object',
  required: ['levels'],
  properties: {
    levels: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        LEVELS.map((l) => [
          l,
          {
            type: 'array',
            items: { type: 'string', pattern: '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)?$' },
          },
        ]),
      ),
    },
  },
};

export type Autonomy = Record<Level, string[]>;

export const DEFAULT_AUTONOMY: Readonly<Autonomy> = { self: [], ask: [], never: ['vcs.write'] };

export async function loadAutonomy(root: string): Promise<Autonomy> {
  const data = await readYaml(path.join(root, AUTONOMY_FILE), AUTONOMY_FILE);
  const policy: Autonomy = { self: [], ask: [], never: [...DEFAULT_AUTONOMY.never] };
  if (data === undefined || data === null) return policy;
  const errors = schemaErrors(AUTONOMY_SCHEMA, data, AUTONOMY_FILE);
  if (errors.length > 0) throw new UsageError(errors.join('\n'));
  const levels = isRecord(data) ? data['levels'] : undefined;
  if (!isRecord(levels)) return policy;
  for (const l of LEVELS) {
    const list = levels[l];
    if (isStringArray(list))
      policy[l] = l === 'never' ? [...new Set([...policy.never, ...list])] : list;
  }
  return policy;
}

export function levelOf(policy: Autonomy, action: string): Level {
  const iface = action.split('.')[0] ?? action;
  for (const l of ['never', 'self', 'ask'] as const)
    if (policy[l].includes(action) || policy[l].includes(iface)) return l;
  return 'ask';
}
