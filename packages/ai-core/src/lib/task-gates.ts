import { spawn, spawnSync } from 'node:child_process';
import type { ProofRun } from '#lib/proof/model';
import {
  beginProofRun,
  joinProofRun,
  PROOF_TRANSPORT,
  proofRunEnvironment,
} from '#lib/proof/transport';
import { createHash, randomUUID } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { isRecord } from '#shared/guards';
import { compileSchema } from '#shared/schema';
import { PROTOCOL } from './protocol.ts';
import {
  acquireLease,
  contentHash,
  digestOf,
  gitRead,
  localSnapshot,
  publishProjectJson,
  readJson,
  safePath,
  topologyOf,
} from './local-store.ts';
import { assertNoKnownSecret, pendingKnowledge } from './knowledge.ts';

export const TASK_PURPOSES = [
  'implementation',
  'ticket-acceptance',
  'docs-review',
  'expect-helper',
  'planning',
  'research',
] as const;
export type TaskPurpose = (typeof TASK_PURPOSES)[number];
interface Classification {
  path: string;
  class: 'source' | 'generated' | 'durable-evidence' | 'runtime';
  owner: string;
  disposition?: string;
}
interface Check {
  argv: string[];
  cwd: string;
  timeout_ms?: number;
  outputs?: string[];
}
interface CompletedDocs {
  session: string;
  evidence: string;
  digest: string;
  checks: string[];
}
export interface TaskPacket {
  scope: { included: string[]; excluded: string[] };
  repair_budget: {
    ordinary_attempts: number;
    identical_failure_without_new_diagnosis: number;
    existing_fsm_limits_take_precedence: boolean;
  };
  declaration_digest?: string;
  version: number;
  ticket: string;
  project_root: string;
  baseline_head: string;
  authority: { file: string; digest: string; criteria: Record<string, string> };
  owners: Record<string, string>;
  checks: Record<string, Check>;
  classification: Classification[];
  fingerprint_excludes: string[];
  prerequisites: string[];
  launch_inputs: string[];
  launch_paths: string[];
  required_checks: string[];
  managed_areas?: string[];
  no_docs_needed?: boolean;
  phase_evidence?: Record<string, string[]>;
  required_env?: string[];
  runtime_allowlist?: string[];
  launch_areas?: string[];
  completed_docs?: CompletedDocs;
}
const strings = { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 256 };
export const TASK_PACKET_SCHEMA = {
  type: 'object',
  required: [
    'version',
    'ticket',
    'project_root',
    'baseline_head',
    'authority',
    'owners',
    'checks',
    'classification',
    'fingerprint_excludes',
    'prerequisites',
    'launch_inputs',
    'launch_paths',
    'required_checks',
    'scope',
    'repair_budget',
  ],
  properties: {
    version: { const: 1 },
    ticket: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' },
    project_root: { type: 'string', minLength: 1 },
    baseline_head: { type: 'string', pattern: '^[a-f0-9]{40,64}$' },
    authority: {
      type: 'object',
      required: ['file', 'digest', 'criteria'],
      properties: {
        file: { type: 'string', minLength: 1 },
        digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        criteria: {
          type: 'object',
          minProperties: 1,
          additionalProperties: { type: 'string', minLength: 1 },
        },
      },
    },
    owners: {
      type: 'object',
      required: ['code', 'source', 'docs', 'verification', 'acceptance'],
      additionalProperties: { type: 'string', minLength: 1 },
    },
    checks: {
      type: 'object',
      required: ['full'],
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['argv', 'cwd'],
        properties: {
          argv: { ...strings, minItems: 1 },
          cwd: { type: 'string' },
          timeout_ms: { type: 'integer', minimum: 1, maximum: 3600000 },
          outputs: strings,
        },
      },
    },
    classification: {
      type: 'array',
      minItems: 1,
      maxItems: 256,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'class', 'owner'],
        properties: {
          path: { type: 'string' },
          class: { enum: ['source', 'generated', 'durable-evidence', 'runtime'] },
          owner: { type: 'string', minLength: 1 },
          disposition: { type: 'string' },
        },
      },
    },
    fingerprint_excludes: strings,
    prerequisites: strings,
    launch_inputs: strings,
    launch_paths: { ...strings, minItems: 7 },
    required_checks: { ...strings, minItems: 1 },
    runtime_allowlist: strings,
    launch_areas: strings,
    completed_docs: {
      type: 'object',
      additionalProperties: false,
      required: ['session', 'evidence', 'digest', 'checks'],
      properties: {
        session: { type: 'string', pattern: '^ses_[A-Za-z0-9]+$', maxLength: 200 },
        evidence: { type: 'string', minLength: 1, maxLength: 1000 },
        digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        checks: { ...strings, minItems: 1, maxItems: 16, uniqueItems: true },
      },
    },
    scope: {
      type: 'object',
      required: ['included', 'excluded'],
      properties: { included: { ...strings, minItems: 1 }, excluded: strings },
    },
    repair_budget: {
      type: 'object',
      required: [
        'ordinary_attempts',
        'identical_failure_without_new_diagnosis',
        'existing_fsm_limits_take_precedence',
      ],
      properties: {
        ordinary_attempts: { type: 'integer', minimum: 0, maximum: 10 },
        identical_failure_without_new_diagnosis: { type: 'integer', minimum: 1, maximum: 10 },
        existing_fsm_limits_take_precedence: { const: true },
      },
    },
  },
};
const validator = compileSchema(TASK_PACKET_SCHEMA);
const stringRecord = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.values(v).every((s) => typeof s === 'string' && s.trim() !== '');
const list = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');
const classificationOf = (v: unknown): v is Classification =>
  isRecord(v) &&
  typeof v['path'] === 'string' &&
  typeof v['owner'] === 'string' &&
  (v['class'] === 'source' ||
    v['class'] === 'generated' ||
    v['class'] === 'durable-evidence' ||
    v['class'] === 'runtime');
const checkOf = (v: unknown): v is Check =>
  isRecord(v) && list(v['argv']) && typeof v['cwd'] === 'string';
export function taskPacketOf(value: unknown): TaskPacket {
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > 131072) throw new Error('PACKET_LIMIT');
  if (
    validator(value).length > 0 ||
    !isRecord(value) ||
    !isRecord(value['authority']) ||
    !stringRecord(value['owners']) ||
    !isRecord(value['checks']) ||
    !Object.values(value['checks']).every(checkOf) ||
    !Array.isArray(value['classification']) ||
    !value['classification'].every(classificationOf) ||
    typeof value['ticket'] !== 'string' ||
    typeof value['project_root'] !== 'string' ||
    typeof value['baseline_head'] !== 'string' ||
    typeof value['authority']['file'] !== 'string' ||
    typeof value['authority']['digest'] !== 'string' ||
    !stringRecord(value['authority']['criteria']) ||
    !list(value['fingerprint_excludes']) ||
    !list(value['prerequisites']) ||
    !list(value['launch_inputs']) ||
    !list(value['launch_paths']) ||
    !list(value['required_checks'])
  )
    throw new Error('INVALID_TASK_PACKET');
  const scope = value['scope'];
  const budget = value['repair_budget'];
  if (
    !isRecord(scope) ||
    !list(scope['included']) ||
    !list(scope['excluded']) ||
    !isRecord(budget) ||
    typeof budget['ordinary_attempts'] !== 'number' ||
    typeof budget['identical_failure_without_new_diagnosis'] !== 'number' ||
    typeof budget['existing_fsm_limits_take_precedence'] !== 'boolean'
  )
    throw new Error('INVALID_TASK_PACKET');
  const launchPaths = value['launch_paths'];
  const completedDocs = value['completed_docs'];
  if (
    completedDocs !== undefined &&
    (!isRecord(completedDocs) ||
      typeof completedDocs['session'] !== 'string' ||
      typeof completedDocs['evidence'] !== 'string' ||
      typeof completedDocs['digest'] !== 'string' ||
      !list(completedDocs['checks']))
  )
    throw new Error('INVALID_COMPLETED_DOCS_BINDING');
  if (!value['required_checks'].includes('full')) throw new Error('FULL_CHECK_REQUIRED');
  if (
    !['native', 'role', 'ops', 'expect', 'plan-review', 'expect-script', 'manual-docs'].every(
      (entry) => launchPaths.includes(entry),
    )
  )
    throw new Error('INCOMPLETE_LAUNCH_CHECKLIST');
  return {
    ...(isRecord(completedDocs) &&
    typeof completedDocs['session'] === 'string' &&
    typeof completedDocs['evidence'] === 'string' &&
    typeof completedDocs['digest'] === 'string' &&
    list(completedDocs['checks'])
      ? {
          completed_docs: {
            session: completedDocs['session'],
            evidence: completedDocs['evidence'],
            digest: completedDocs['digest'],
            checks: completedDocs['checks'],
          },
        }
      : {}),
    scope: { included: scope['included'], excluded: scope['excluded'] },
    repair_budget: {
      ordinary_attempts: budget['ordinary_attempts'],
      identical_failure_without_new_diagnosis: budget['identical_failure_without_new_diagnosis'],
      existing_fsm_limits_take_precedence: budget['existing_fsm_limits_take_precedence'],
    },
    declaration_digest: digestOf(value),
    version: 1,
    ticket: value['ticket'],
    project_root: value['project_root'],
    baseline_head: value['baseline_head'],
    authority: {
      file: value['authority']['file'],
      digest: value['authority']['digest'],
      criteria: value['authority']['criteria'],
    },
    owners: value['owners'],
    checks: Object.fromEntries(
      Object.entries(value['checks']).filter((entry): entry is [string, Check] =>
        checkOf(entry[1]),
      ),
    ),
    classification: value['classification'],
    fingerprint_excludes: value['fingerprint_excludes'],
    prerequisites: value['prerequisites'],
    launch_inputs: value['launch_inputs'],
    launch_paths: launchPaths,
    required_checks: value['required_checks'],
    ...(list(value['runtime_allowlist']) ? { runtime_allowlist: value['runtime_allowlist'] } : {}),
    ...(list(value['launch_areas']) ? { launch_areas: value['launch_areas'] } : {}),
    ...(list(value['required_env']) ? { required_env: value['required_env'] } : {}),
    ...(list(value['managed_areas']) ? { managed_areas: value['managed_areas'] } : {}),
    ...(value['no_docs_needed'] === true ? { no_docs_needed: true } : {}),
    ...(isRecord(value['phase_evidence']) && Object.values(value['phase_evidence']).every(list)
      ? {
          phase_evidence: Object.fromEntries(
            Object.entries(value['phase_evidence']).filter((entry): entry is [string, string[]] =>
              list(entry[1]),
            ),
          ),
        }
      : {}),
  };
}

export async function loadTaskPacket(root: string, file: string) {
  validateArtifactOutput(root, file, 'run');
  const absolute = await safePath(root, file);
  const raw = await readFile(absolute, 'utf8');
  if (Buffer.byteLength(raw) > 131072) throw new Error('PACKET_LIMIT');
  try {
    return taskPacketOf(JSON.parse(raw));
  } catch {
    throw new Error('INVALID_TASK_PACKET');
  }
}

function matches(pattern: string, file: string): boolean {
  const escaped = pattern
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');
  return new RegExp(`^${escaped}$`).test(file);
}
export const classificationFor = (packet: TaskPacket, file: string) =>
  packet.classification
    .filter((c) => matches(c.path, file))
    .sort((a, b) => b.path.replace(/\*/g, '').length - a.path.replace(/\*/g, '').length)[0];

async function areaFiles(root: string, areas: string[]): Promise<string[]> {
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    if (dir === '.' || dir.split('/').some((part) => part === '.git' || part === 'node_modules'))
      throw new Error('UNBOUNDED_AREA');
    let entries;
    try {
      entries = await readdir(await safePath(root, dir), { withFileTypes: true });
    } catch (error) {
      if (isRecord(error) && error['code'] === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await visit(file);
      else files.push(file);
      if (files.length > 10000) throw new Error('AREA_LIMIT');
    }
  };
  for (const area of areas) await visit(area);
  return files;
}

async function inputFiles(root: string, packet: TaskPacket) {
  for (const file of packet.launch_inputs) assertArtifactNamespace(root, file);
  const listed = gitRead(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (listed === null) throw new Error('GIT_UNAVAILABLE');
  const launchFiles = await areaFiles(root, packet.launch_areas ?? []);
  const files = [
    ...new Set([
      ...listed.split('\0').filter(Boolean),
      ...packet.launch_inputs,
      ...launchFiles,
      ...Object.values(packet.checks).flatMap((check) => check.outputs ?? []),
      packet.authority.file,
    ]),
  ].sort();
  const inputs: Record<string, string | null> = {};
  for (const file of files) {
    const classification = classificationFor(packet, file);
    const declared =
      packet.launch_inputs.includes(file) ||
      launchFiles.includes(file) ||
      file === packet.authority.file;
    const producers = Object.entries(packet.checks).filter(
      ([, check]) => check.outputs?.includes(file) === true,
    );
    if (producers.length > 1) throw new Error('AMBIGUOUS_OUTPUT_PRODUCER');
    if (producers.length === 1) {
      if (classification?.class !== 'generated') throw new Error('UNDECLARED_GENERATED_OUTPUT');
      inputs[file] = digestOf({ producer: producers[0] });
      continue;
    }
    if (
      !declared &&
      !file.startsWith('.oc3/verdicts/expect/') &&
      (classification?.class === 'runtime' || classification?.class === 'durable-evidence')
    )
      continue;
    if (!declared && packet.fingerprint_excludes.some((p) => matches(p, file))) {
      if (classification?.class !== 'generated')
        throw new Error(`INVALID_FINGERPRINT_EXCLUSION: ${file}`);
      continue;
    }
    inputs[file] =
      file === packet.authority.file
        ? await authorityHash(root, packet)
        : await contentHash(root, file);
  }
  return inputs;
}

export async function authorityHash(
  root: string,
  packet: Pick<TaskPacket, 'authority'>,
): Promise<string> {
  const file = path.resolve(root, packet.authority.file);
  const info = await stat(file);
  return digestOf({ mode: info.mode, content: (await readFile(file)).toString('base64') });
}

export async function taskSnapshot(root: string, packet: TaskPacket) {
  assertPacketArtifactPaths(root, packet);
  await assertNoExternalArtifacts(root);
  const topology = await topologyOf(root);
  const inputs = await inputFiles(root, packet);
  const manager = await packageManagerOf(root);
  const node = await nodeToolchainOf(root);
  const staged = (gitRead(root, ['ls-files', '--stage', '-z']) ?? '').split('\0').filter((line) => {
    const file = line.split('\t')[1];
    return file !== undefined && Object.hasOwn(inputs, file);
  });
  const fingerprint = digestOf({
    topology,
    inputs,
    staged,
    packet,
    node,
    package_manager: manager,
    capabilities: (packet.required_env ?? []).map((key) => ({
      key,
      available: process.env[key] !== undefined && process.env[key] !== '',
    })),
  });
  const code_source = digestOf({
    authority: packet.authority,
    scope: packet.scope,
    owners: packet.owners,
    checks: packet.checks,
    package_manager: manager,
    node,
    inputs: Object.entries(inputs).filter(([file]) => {
      const c = classificationFor(packet, file);
      return (
        file === packet.authority.file ||
        (c?.class === 'source' &&
          (c.owner === packet.owners['code'] || c.owner === packet.owners['source']))
      );
    }),
  });
  return { ...topology, inputs, fingerprint, code_source, package_manager: manager, node };
}

const nodeHashes = new Map<string, string>();
async function nodeToolchainOf(root: string) {
  const result = spawnSync('node', ['--version'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024,
  });
  const version = /^v(\d+\.\d+\.\d+)\s*$/.exec(result.stdout ?? '')?.[1];
  if (result.status !== 0 || version === undefined) throw new Error('TOOLCHAIN_UNAVAILABLE');
  const executable = await toolExecutable(root, 'node');
  const info = await stat(executable);
  const key = digestOf({
    executable,
    size: info.size,
    inode: info.ino,
    modified: info.mtimeMs,
    changed: info.ctimeMs,
    mode: info.mode,
  });
  let hash = nodeHashes.get(key);
  if (hash === undefined) {
    hash = createHash('sha256')
      .update(await readFile(executable))
      .digest('hex');
    nodeHashes.set(key, hash);
  }
  return { version, executable, hash };
}

async function toolExecutable(root: string, name: string): Promise<string> {
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    try {
      const candidate = path.resolve(root, dir, name);
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch {
      continue;
    }
  }
  throw new Error('TOOLCHAIN_UNAVAILABLE');
}

const managerCache = new Map<
  string,
  { name: string; version: string; executable_hash: string; package_hash: string }
>();
async function packageManagerOf(root: string) {
  const pkg = await readJson(await safePath(root, 'package.json'));
  if (!isRecord(pkg)) throw new Error('TOOLCHAIN_UNDECLARED');
  const name =
    typeof pkg['packageManager'] === 'string' ? pkg['packageManager'].split('@')[0] : 'npm';
  if (name !== 'npm' && name !== 'pnpm' && name !== 'yarn')
    throw new Error('PACKAGE_MANAGER_UNSUPPORTED');
  const executable = await toolExecutable(root, name);
  const executableHash = createHash('sha256')
    .update(await readFile(executable))
    .digest('hex');
  let packageHash = '';
  try {
    packageHash = createHash('sha256')
      .update(await readFile(path.join(path.dirname(path.dirname(executable)), 'package.json')))
      .digest('hex');
  } catch {
    packageHash = '';
  }
  const key = digestOf({
    executable,
    executableHash,
    packageHash,
    declaration: pkg['packageManager'],
    node_options: process.env['NODE_OPTIONS'] ?? '',
  });
  const cached = managerCache.get(key);
  if (packageHash !== '' && cached !== undefined) return { ...cached };
  const result = spawnSync(name, ['--version'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024,
  });
  if (result.status !== 0 || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\s*$/.test(result.stdout))
    throw new Error('PACKAGE_MANAGER_UNAVAILABLE');
  const version = result.stdout.trim();
  if (
    typeof pkg['packageManager'] === 'string' &&
    pkg['packageManager'].split('@')[1]?.split('+')[0] !== version
  )
    throw new Error('PACKAGE_MANAGER_VERSION_MISMATCH');
  const value = { name, version, executable_hash: executableHash, package_hash: packageHash };
  if (packageHash !== '') managerCache.set(key, value);
  return value;
}

const evidencePath = (packet: TaskPacket, name: string) =>
  artifactRelative({ kind: 'run', key: packet.ticket, name: `checks/${name}.json` });
async function evidenceOf(root: string, packet: TaskPacket, name: string) {
  const record = await readJson(await safePath(root, evidencePath(packet, name)));
  if (!isRecord(record)) throw new Error(`MISSING_RECEIPT: ${name}`);
  const { digest, ...body } = record;
  if (digest !== digestOf(body) || record['ticket'] !== packet.ticket)
    throw new Error(`CORRUPT_RECEIPT: ${name}`);
  return record;
}
async function saveEvidence(
  root: string,
  packet: TaskPacket,
  name: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const record = { ...body, ticket: packet.ticket };
  await publishProjectJson(
    root,
    evidencePath(packet, name),
    { ...record, digest: digestOf(record) },
    false,
  );
  return record;
}

function assertPacketArtifactPaths(root: string, packet: TaskPacket): void {
  for (const check of Object.values(packet.checks))
    for (const file of check.outputs ?? []) validateArtifactOutput(root, file);
  for (const area of packet.managed_areas ?? []) validateArtifactOutput(root, `${area}/probe`);
  for (const files of Object.values(packet.phase_evidence ?? {}))
    for (const file of files) validateArtifactOutput(root, file);
  if (packet.completed_docs !== undefined)
    validateArtifactOutput(root, packet.completed_docs.evidence);
}
export async function taskPreflight(root: string, packet: TaskPacket) {
  assertPacketArtifactPaths(root, packet);
  await assertNoExternalArtifacts(root);
  for (const file of (
    gitRead(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']) ?? ''
  )
    .split('\0')
    .filter(Boolean)) {
    if (existsSync(confinedProjectPath(root, file))) assertArtifactNamespace(root, file);
  }
  const actual = await realpath(root);
  const declared = await realpath(path.resolve(root, packet.project_root));
  if (actual !== declared) throw new Error('ROOT_MISMATCH');
  if (gitRead(root, ['cat-file', '-t', packet.baseline_head]) !== 'commit')
    throw new Error('BASELINE_UNAVAILABLE');
  if ((await authorityHash(root, packet)) !== packet.authority.digest)
    throw new Error('DOD_UNBOUND');
  const node = await nodeToolchainOf(root);
  if (Number.parseInt(node.version.split('.')[0] ?? '0', 10) < 24)
    throw new Error('TOOLCHAIN_UNAVAILABLE');
  const pkg: unknown = await readJson(await safePath(root, 'package.json'));
  if (!isRecord(pkg) || !isRecord(pkg['engines']) || typeof pkg['engines']['node'] !== 'string')
    throw new Error('TOOLCHAIN_UNDECLARED');
  const minimum = /^>=([0-9]+)/.exec(pkg['engines']['node'])?.[1];
  if (
    minimum === undefined ||
    Number.parseInt(node.version.split('.')[0] ?? '0', 10) < Number.parseInt(minimum, 10)
  )
    throw new Error('TOOLCHAIN_UNAVAILABLE');
  const managerInfo = await packageManagerOf(root);
  const manager = managerInfo.name;
  const lock =
    manager === 'npm' ? 'package-lock.json' : manager === 'pnpm' ? 'pnpm-lock.yaml' : 'yarn.lock';
  await access(await safePath(root, lock));
  let project: unknown;
  try {
    project = parse(await readFile(await safePath(root, '.oc3/project.yml'), 'utf8'));
  } catch {
    throw new Error('RUNTIME_CONFIG_INVALID');
  }
  if (!isRecord(project) || project['runtime'] !== 'full') throw new Error('RUNTIME_FULL_REQUIRED');
  for (const key of packet.required_env ?? [])
    if (process.env[key] === undefined || process.env[key] === '')
      throw new Error('CAPABILITY_UNAVAILABLE');
  for (const file of packet.prerequisites) await access(await safePath(root, file));
  for (const file of packet.launch_inputs)
    if (
      (await contentHash(root, file)) === null &&
      !Object.values(packet.checks).some((check) => check.outputs?.includes(file) === true)
    )
      throw new Error('LAUNCH_INPUT_MISSING');
  for (const check of Object.values(packet.checks)) {
    assertNoKnownSecret(check.argv);
    const cwd = await safePath(root, check.cwd);
    if (!(await stat(cwd)).isDirectory()) throw new Error('CHECK_CWD_UNAVAILABLE');
    const command = check.argv[0];
    if (command === undefined || !['node', 'npm', 'npx'].includes(command))
      throw new Error('UNAPPROVED_CHECK_ENTRYPOINT');
    for (const output of check.outputs ?? []) validateArtifactOutput(root, output);
    for (const output of check.outputs ?? [])
      if (classificationFor(packet, output)?.class !== 'generated')
        throw new Error('UNDECLARED_GENERATED_OUTPUT');
    if (
      check.argv.some((arg) =>
        /(?:^|\s)(?:git|arc)\s+(?:commit|push|checkout|switch|reset|clean|add|rm|merge|rebase)/.test(
          arg,
        ),
      )
    )
      throw new Error('FORBIDDEN_CHECK');
  }
  for (const name of packet.required_checks)
    if (packet.checks[name] === undefined) throw new Error('MISSING_CHECK');
  const lease = await acquireLease(root, 'verification', packet.owners['verification'] ?? '');
  try {
    const snapshot = await taskSnapshot(root, packet);
    await saveEvidence(root, packet, 'preflight', {
      kind: 'preflight',
      snapshot,
      node: node.version,
      package_manager: managerInfo,
      baseline: gitRead(root, ['status', '--porcelain=v1', '-uall']),
    });
    return {
      kind: 'preflight',
      ticket: packet.ticket,
      fingerprint: snapshot.fingerprint,
      receipt: evidencePath(packet, 'preflight'),
      node: node.version,
      package_manager: managerInfo,
    };
  } finally {
    await lease.release();
  }
}

const COMPLETED_DOCS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'kind', 'session', 'owner', 'status', 'confirmation', 'targets'],
  properties: {
    version: { const: 1 },
    kind: { const: 'operator-confirmed-native-docs' },
    session: { type: 'string', pattern: '^ses_[A-Za-z0-9]+$', maxLength: 200 },
    owner: { type: 'string', minLength: 1 },
    status: { const: 'completed' },
    confirmation: { type: 'string', minLength: 1, maxLength: 1000 },
    targets: {
      type: 'array',
      minItems: 1,
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'hash'],
        properties: {
          file: { type: 'string', minLength: 1, maxLength: 1000 },
          hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        },
      },
    },
  },
};
const validateCompletedDocs = compileSchema(COMPLETED_DOCS_SCHEMA);
async function completedNativeDocs(root: string, packet: TaskPacket, evidence: string[]) {
  const binding = packet.completed_docs;
  if (binding === undefined) return undefined;
  if (
    !evidence.includes(binding.evidence) ||
    classificationFor(packet, binding.evidence)?.class !== 'durable-evidence' ||
    (await contentHash(root, binding.evidence)) !== binding.digest
  )
    throw new Error('NATIVE_DOCS_CONFIRMATION_UNBOUND');
  const completion = await readJson(await safePath(root, binding.evidence), 32768);
  assertNoKnownSecret(completion);
  if (
    validateCompletedDocs(completion).length > 0 ||
    !isRecord(completion) ||
    completion['session'] !== binding.session ||
    completion['owner'] !== packet.owners['docs'] ||
    !Array.isArray(completion['targets'])
  )
    throw new Error('INVALID_NATIVE_DOCS_COMPLETION');
  const seen = new Set<string>();
  const targets = [];
  for (const target of completion['targets']) {
    if (
      !isRecord(target) ||
      typeof target['file'] !== 'string' ||
      typeof target['hash'] !== 'string' ||
      seen.has(target['file'])
    )
      throw new Error('INVALID_NATIVE_DOCS_TARGET');
    const classification = classificationFor(packet, target['file']);
    if (
      classification?.class !== 'source' ||
      classification.owner !== packet.owners['docs'] ||
      (await contentHash(root, target['file'])) !== target['hash']
    )
      throw new Error('NATIVE_DOCS_TARGET_STALE');
    seen.add(target['file']);
    targets.push({ file: target['file'], hash: target['hash'] });
  }
  const checks = [];
  for (const name of binding.checks) {
    if (name === 'full' || packet.checks[name] === undefined)
      throw new Error('INVALID_NATIVE_DOCS_CHECK');
    const receipt = await currentCheck(root, packet, name);
    checks.push({
      name,
      run: receipt['run'],
      fingerprint: receipt['after'],
      log_digest: receipt['log_digest'],
    });
  }
  return {
    mode: 'operator-confirmed-native',
    session: binding.session,
    evidence: binding.evidence,
    confirmation_hash: binding.digest,
    targets,
    checks,
  };
}

export async function attestTaskPhase(
  root: string,
  packet: TaskPacket,
  phase: 'code-source-stable' | 'docs-derived',
  actor: string,
  evidence: string[],
  caller = actor,
) {
  for (const file of evidence) validateArtifactOutput(root, file);
  if (
    phase === 'code-source-stable'
      ? actor !== packet.owners['verification']
      : actor !== packet.owners['docs']
  )
    throw new Error('OWNER_MISMATCH');
  const snapshot = await taskSnapshot(root, packet);
  let nativeCompletion: Awaited<ReturnType<typeof completedNativeDocs>>;
  if (phase === 'code-source-stable' && packet.checks['targeted'] !== undefined)
    await currentCheck(root, packet, 'targeted');
  if (phase === 'docs-derived') {
    for (const file of packet.launch_inputs)
      if ((await contentHash(root, file)) === null) throw new Error('LAUNCH_INPUT_MISSING');
    const stable = await evidenceOf(root, packet, 'code-source-stable');
    if (stable['code_source'] !== snapshot.code_source) throw new Error('STALE_CODE_SOURCE');
    if (evidence.length === 0) throw new Error('DOCS_EVIDENCE_REQUIRED');
    if (packet.no_docs_needed !== true) {
      nativeCompletion = await completedNativeDocs(root, packet, evidence);
      let completed = nativeCompletion !== undefined;
      for (const file of evidence) {
        const proof = await readJson(await safePath(root, file));
        if (!isRecord(proof)) continue;
        const { digest, ...body } = proof;
        if (
          digest === digestOf(body) &&
          proof['kind'] === 'docs-batch' &&
          proof['status'] === 'pass' &&
          digestOf(proof['snapshot']) === digestOf(await localSnapshot(root))
        )
          completed = true;
        if (
          digest === digestOf(body) &&
          Array.isArray(proof['stages']) &&
          proof['stages'].join(',') === 'apply,verify,review,close' &&
          typeof proof['batch'] === 'string' &&
          digestOf(proof['snapshot']) === digestOf(await localSnapshot(root))
        )
          completed = true;
      }
      if (!completed) throw new Error('DOCS_CLOSE_PROOF_REQUIRED');
    }
  }
  const bindings = await Promise.all(
    evidence.map(async (file) => {
      const hash = await contentHash(root, file);
      if (hash === null) throw new Error('MISSING_PHASE_EVIDENCE');
      return { file, hash };
    }),
  );
  return saveEvidence(root, packet, phase, {
    kind: phase,
    code_source: snapshot.code_source,
    fingerprint: snapshot.fingerprint,
    bindings,
    actor: caller,
    owner: actor,
    ...(nativeCompletion === undefined ? {} : { native_completion: nativeCompletion }),
  });
}

async function checkBarriers(root: string, packet: TaskPacket) {
  const snapshot = await taskSnapshot(root, packet);
  const stable = await evidenceOf(root, packet, 'code-source-stable');
  const docs = await evidenceOf(root, packet, 'docs-derived');
  if (stable['owner'] !== packet.owners['verification'] || docs['owner'] !== packet.owners['docs'])
    throw new Error('PHASE_OWNER_MISMATCH');
  if (
    stable['code_source'] !== snapshot.code_source ||
    docs['fingerprint'] !== snapshot.fingerprint
  )
    throw new Error('STALE_PHASE_BARRIER');
  if (!Array.isArray(docs['bindings'])) throw new Error('CORRUPT_PHASE');
  for (const b of docs['bindings'])
    if (
      !isRecord(b) ||
      typeof b['file'] !== 'string' ||
      (await contentHash(root, b['file'])) !== b['hash']
    )
      throw new Error('STALE_PHASE_EVIDENCE');
}

export async function verifyTask(
  root: string,
  packet: TaskPacket,
  name: string,
  actor: string,
  caller = actor,
  proofOptions?: { force?: boolean; run?: ProofRun },
) {
  if (name === 'code-source-stable' || name === 'docs-derived')
    return attestTaskPhase(root, packet, name, actor, packet.phase_evidence?.[name] ?? [], caller);
  if (actor !== packet.owners['verification']) throw new Error('OWNER_MISMATCH');
  const check = packet.checks[name];
  if (check === undefined) throw new Error('UNKNOWN_CHECK');
  await taskPreflight(root, packet);
  const run = randomUUID();
  const lease = await acquireLease(root, 'verification', actor, { caller, run });
  try {
    if (name === 'full') await checkBarriers(root, packet);
    const inherited =
      proofOptions?.run === undefined
        ? process.env[PROOF_TRANSPORT]
        : JSON.stringify(proofOptions.run);
    const proofRun =
      inherited === undefined
        ? await beginProofRun(root, {
            owner: actor,
            scope: ['*'],
            force: proofOptions?.force === true,
            allowJudge: false,
          })
        : await joinProofRun(root, inherited);
    if (proofRun.owner !== actor || (proofOptions?.force === true && !proofRun.force))
      throw new Error('PROOF_POLICY_MISMATCH');
    const before = await taskSnapshot(root, packet);
    const command = check.argv[0];
    if (command === undefined) throw new Error('INVALID_CHECK');
    const result = await new Promise<{
      code: number | null;
      log: string;
      rawDigest: string;
      totalBytes: number;
    }>((resolve, reject) => {
      const child = spawn(command, check.argv.slice(1), {
        cwd: path.resolve(root, check.cwd),
        env: proofRunEnvironment(proofRun),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      const timer = setTimeout(() => {
        if (child.pid !== undefined && process.platform !== 'win32') {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        } else child.kill('SIGKILL');
      }, check.timeout_ms ?? 1200000);
      let log = '';
      let totalBytes = 0;
      const rawHash = createHash('sha256');
      const append = (chunk: Buffer) => {
        totalBytes += chunk.length;
        rawHash.update(chunk);
        log = `${log}${chunk.toString()}`.slice(-65536);
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        resolve({ code, log, rawDigest: rawHash.digest('hex'), totalBytes });
      });
    });
    const after = await taskSnapshot(root, packet);
    const outputs = await Promise.all(
      (check.outputs ?? []).map(async (file) => ({ file, hash: await contentHash(root, file) })),
    );
    const summaries = [
      ...result.log.matchAll(/^\s*(Test Files|Tests)\s+(\d{1,9})\s+passed\s+\((\d{1,9})\)\s*$/gm),
    ].map((match) => ({
      label: match[1],
      passed: Number.parseInt(match[2] ?? '0', 10),
      total: Number.parseInt(match[3] ?? '0', 10),
    }));
    const log = {
      version: 1,
      run,
      code: result.code,
      raw_digest: result.rawDigest,
      total_bytes: result.totalBytes,
      raw_output_persisted: false,
      summaries,
    };
    const logLocator = artifactRelative({
      kind: 'run',
      key: packet.ticket,
      name: `checks/${run}.log.json`,
    });
    await publishProjectJson(root, logLocator, log);
    const status =
      before.fingerprint !== after.fingerprint
        ? 'stale'
        : result.code === 0 && outputs.every((output) => output.hash !== null)
          ? 'pass'
          : 'fail';
    const body = {
      kind: 'check',
      name,
      run,
      actor: caller,
      owner: actor,
      lease: lease.token,
      proof_run: proofRun.id,
      proof_policy: {
        force: proofRun.force,
        allowJudge: proofRun.allowJudge,
        scope: proofRun.scope,
      },
      argv: check.argv,
      cwd: check.cwd,
      node: before.node.version,
      before: before.fingerprint,
      after: after.fingerprint,
      code: result.code,
      status,
      log_locator: logLocator,
      log_digest: digestOf(log),
      package_manager: before.package_manager,
      outputs,
    };
    await saveEvidence(root, packet, run, body);
    return await saveEvidence(root, packet, name, body);
  } finally {
    await lease.release();
  }
}

export async function currentCheck(root: string, packet: TaskPacket, name: string) {
  const receipt = await evidenceOf(root, packet, name);
  if (receipt['owner'] !== packet.owners['verification']) throw new Error('CHECK_OWNER_MISMATCH');
  const snapshot = await taskSnapshot(root, packet);
  if (
    receipt['status'] !== 'pass' ||
    receipt['before'] !== snapshot.fingerprint ||
    receipt['after'] !== snapshot.fingerprint
  )
    throw new Error(`STALE_CHECK: ${name}`);
  if (!Array.isArray(receipt['outputs'])) throw new Error('CORRUPT_RECEIPT');
  if (typeof receipt['log_locator'] !== 'string') throw new Error('CORRUPT_RECEIPT');
  const log = await readJson(await safePath(root, receipt['log_locator']));
  if (!isRecord(log) || receipt['log_digest'] !== digestOf(log))
    throw new Error('CORRUPT_CHECK_LOG');
  for (const output of receipt['outputs'])
    if (
      !isRecord(output) ||
      typeof output['file'] !== 'string' ||
      (await contentHash(root, output['file'])) !== output['hash']
    )
      throw new Error('STALE_OUTPUT');
  return receipt;
}

export async function taskReady(root: string, packet: TaskPacket) {
  assertPacketArtifactPaths(root, packet);
  await assertNoExternalArtifacts(root);
  if ((await readJson(await safePath(root, '.oc3/locks/verification.json'))) !== undefined)
    throw new Error('VERIFICATION_ACTIVE');
  if ((await authorityHash(root, packet)) !== packet.authority.digest)
    throw new Error('DOD_UNBOUND');
  await checkBarriers(root, packet);
  await currentCheck(root, packet, 'full');
  for (const name of packet.required_checks) await currentCheck(root, packet, name);
  const acceptance = await evidenceOf(root, packet, 'acceptance');
  if (
    acceptance['fingerprint'] !== (await taskSnapshot(root, packet)).fingerprint ||
    acceptance['actor'] !== packet.owners['acceptance'] ||
    !isRecord(acceptance['criteria'])
  )
    throw new Error('STALE_ACCEPTANCE');
  for (const id of Object.keys(packet.authority.criteria))
    if (acceptance['criteria'][id] !== true) throw new Error(`DOD_INCOMPLETE: ${id}`);
  if (!Array.isArray(acceptance['evidence'])) throw new Error('CORRUPT_ACCEPTANCE');
  for (const evidence of acceptance['evidence'])
    if (
      !isRecord(evidence) ||
      typeof evidence['file'] !== 'string' ||
      (await contentHash(root, evidence['file'])) !== evidence['hash']
    )
      throw new Error('STALE_ACCEPTANCE_EVIDENCE');
  if ((await pendingKnowledge(root)).some((entry) => entry.critical))
    throw new Error('CRITICAL_PENDING');
  const ledger = await readJson(await safePath(root, '.oc3/locks/delta-accepted.json'));
  if (ledger !== undefined) {
    const topology = await topologyOf(root);
    if (
      !isRecord(ledger) ||
      ledger['version'] !== 2 ||
      ledger['root'] !== topology.project ||
      ledger['worktree'] !== topology.worktree ||
      ledger['head'] !== topology.head ||
      !Array.isArray(ledger['items']) ||
      ledger['items'].length === 0
    )
      throw new Error('HYGIENE_STALE_LEDGER');
    for (const accepted of ledger['items'])
      if (
        !isRecord(accepted) ||
        typeof accepted['file'] !== 'string' ||
        (await contentHash(root, accepted['file'])) !== accepted['after']
      )
        throw new Error('HYGIENE_STALE_LEDGER');
  }
  const changed = new Set(
    [
      ...(gitRead(root, ['diff', '--name-only', '-z', packet.baseline_head]) ?? '').split('\0'),
      ...(gitRead(root, ['ls-files', '--others', '--exclude-standard', '-z']) ?? '').split('\0'),
      ...packet.launch_inputs,
      ...(await areaFiles(root, packet.launch_areas ?? [])),
      ...packet.classification
        .filter((entry) => entry.disposition === 'retire' && !entry.path.includes('*'))
        .map((entry) => entry.path),
    ].filter(Boolean),
  );
  for (const file of await areaFiles(root, packet.managed_areas ?? [])) changed.add(file);
  const inventory = [];
  for (const file of [...changed].sort()) {
    if (existsSync(confinedProjectPath(root, file))) assertArtifactNamespace(root, file);
    const classification = classificationFor(packet, file);
    if (classification === undefined) throw new Error(`HYGIENE_UNKNOWN: ${file}`);
    const hash = await contentHash(root, file);
    if (file === '.oc3/.delta/.accepted.json' && hash !== null)
      throw new Error('HYGIENE_LEGACY_LEDGER');
    if (
      hash !== null &&
      classification.class === 'runtime' &&
      !(packet.runtime_allowlist ?? []).some((pattern) => matches(pattern, file))
    )
      throw new Error(`HYGIENE_UNKNOWN_RUNTIME: ${file}`);
    if (
      hash !== null &&
      classification.class === 'runtime' &&
      gitRead(root, ['check-ignore', '--', file]) === null
    )
      throw new Error(`HYGIENE_RUNTIME_TRACKED: ${file}`);
    if (hash !== null && (await stat(await safePath(root, file))).size === 0)
      throw new Error(`HYGIENE_EMPTY: ${file}`);
    if (
      hash !== null &&
      (classification.class === 'durable-evidence' || classification.class === 'runtime') &&
      classification.disposition !== 'allow-empty' &&
      /\.(?:json|md|ya?ml)$/.test(file)
    ) {
      const text = (await readFile(await safePath(root, file), 'utf8')).trim();
      if (text === '' || text === '{}' || text === '[]') throw new Error(`HYGIENE_EMPTY: ${file}`);
    }
    inventory.push({
      file,
      ...classification,
      hash,
      deliverable:
        (classification.disposition === 'retire' && hash === null) ||
        (artifactRetention(file) !== 'local' &&
          classification.class !== 'runtime' &&
          gitRead(root, ['check-ignore', '--', file]) === null),
    });
  }
  return { ready: true, inventory };
}

export async function recordTaskAcceptance(
  root: string,
  packet: TaskPacket,
  actor: string,
  criteria: Record<string, boolean>,
  refs: string[],
) {
  if (actor !== packet.owners['acceptance']) throw new Error('OWNER_MISMATCH');
  await currentCheck(root, packet, 'full');
  if (
    Object.keys(criteria).some((key) => packet.authority.criteria[key] === undefined) ||
    refs.length === 0
  )
    throw new Error('INVALID_ACCEPTANCE');
  const evidence = await Promise.all(
    refs.map(async (file) => {
      const hash = await contentHash(root, file);
      if (hash === null) throw new Error('MISSING_ACCEPTANCE_EVIDENCE');
      return { file, hash };
    }),
  );
  return saveEvidence(root, packet, 'acceptance', {
    actor,
    criteria,
    evidence,
    fingerprint: (await taskSnapshot(root, packet)).fingerprint,
  });
}

export async function acceptTaskVerdict(
  root: string,
  packetFile: string,
  actor: string,
  execution: string,
  data: unknown,
) {
  assertNoKnownSecret(data);
  if (Buffer.byteLength(JSON.stringify(data) ?? '') > 65536) throw new Error('VERDICT_LIMIT');
  const packet = await loadTaskPacket(root, packetFile);
  if (actor !== packet.owners['acceptance']) throw new Error('OWNER_MISMATCH');
  if (
    compileSchema(PROTOCOL.verdict)(data).length > 0 ||
    !isRecord(data) ||
    !Array.isArray(data['answers'])
  )
    throw new Error('CRITERION_ANSWERS_REQUIRED');
  const criteria: Record<string, boolean> = {};
  const refs: string[] = [];
  for (const answer of data['answers']) {
    if (
      !isRecord(answer) ||
      typeof answer['id'] !== 'string' ||
      typeof answer['verdict'] !== 'boolean' ||
      packet.authority.criteria[answer['id']] === undefined ||
      Object.hasOwn(criteria, answer['id'])
    )
      throw new Error('INVALID_CRITERION_ANSWER');
    criteria[answer['id']] = answer['verdict'];
    if (answer['verdict']) {
      if (
        typeof answer['ref'] !== 'string' ||
        typeof answer['quote'] !== 'string' ||
        answer['quote'].trim() === ''
      )
        throw new Error('CRITERION_EVIDENCE_INVALID');
      const ref = (answer['ref'].split('#')[0] ?? '').replace(/:\d+(?:-\d+)?$/, '');
      const file = await safePath(root, ref);
      if (
        (await contentHash(root, ref)) === null ||
        !(await readFile(file, 'utf8')).includes(answer['quote'])
      )
        throw new Error('CRITERION_EVIDENCE_INVALID');
      refs.push(ref);
    }
  }
  const file = artifactRelative({
    kind: 'verdict',
    key: packet.ticket,
    name: `${digestOf(execution)}.json`,
  });
  await publishProjectJson(root, file, { actor, execution, data });
  return recordTaskAcceptance(root, packet, actor, criteria, [file, ...new Set(refs)]);
}

export interface LaunchContext {
  entry?: string;
  packet?: string;
  purpose: TaskPurpose;
  execution?: string;
  ticket?: string;
}
export async function launchPreflight(root: string, context?: LaunchContext) {
  await assertNoExternalArtifacts(root);
  const entry = context?.entry;
  const artifacts =
    entry === undefined
      ? {}
      : {
          entry: normalizedProjectPath(entry),
          helper: expectHelperDir(entry),
          semantic_verdicts: expectCacheFile(entry),
          results: expectStateFile(entry),
        };
  if (entry !== undefined) confinedProjectPath(root, entry);
  const topology = await topologyOf(root);
  if (context?.packet === undefined)
    return {
      ...topology,
      artifacts,
      purpose: context?.purpose ?? 'implementation',
      snapshot: (await localSnapshot(root)).scope,
      ticket_ready: false,
    };
  const packet = await loadTaskPacket(root, context.packet);
  await taskPreflight(root, packet);
  if (context.purpose === 'ticket-acceptance') await currentCheck(root, packet, 'full');
  return {
    ...topology,
    artifacts,
    purpose: context.purpose,
    ticket: packet.ticket,
    ticket_ready: false,
    acceptance_eligible: context.purpose === 'ticket-acceptance',
    snapshot: (await taskSnapshot(root, packet)).fingerprint,
  };
}
import {
  artifactRelative,
  assertArtifactNamespace,
  validateArtifactOutput,
  artifactRetention,
  confinedProjectPath,
  normalizedProjectPath,
  expectHelperDir,
  expectCacheFile,
  expectStateFile,
} from './artifacts.ts';
import { assertNoExternalArtifacts } from './artifact-migration.ts';
