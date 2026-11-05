import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UsageError } from '#shared/diagnostics';
import { errorCode, isRecord } from '#shared/guards';
import { BUNDLES_DIR } from '#shared/layout';
import { compileSchema, issueText } from '#shared/schema';
import { parseAgent, type AgentDef } from './agent.ts';
import { bundleNodes, startIndexText, START_INDEX } from './memory-graph.ts';
import {
  openCodeStepOf,
  spawnOpenCode,
  structuredFromText,
  submitFileOf,
  type OpenCodeSpawnOptions,
} from './opencode.ts';
import { runtime } from './runtime.ts';
import { isProtocolMessage, PROTOCOL, SUBMIT_TOOL } from './protocol.ts';

const MEMORY_MARKER = /память:\s*([0-9a-f]{12})/g;

const nodeText = async (root: string, dir: string): Promise<string | null> => {
  try {
    return await readFile(path.join(root, BUNDLES_DIR, dir, START_INDEX), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
};

export const memoryPromptOf = async (root: string, task: string): Promise<string> => {
  const start = await startIndexText(root);
  const requested = [...new Set([...task.matchAll(MEMORY_MARKER)].map((m) => m[1] ?? ''))];
  const nodes = await bundleNodes(root);
  const known = new Set(nodes);
  const unknown = requested.filter((sha) => !known.has(sha));
  if (unknown.length > 0)
    throw new UsageError(
      `неизвестный узел памяти: ${[...new Set(unknown)].join(', ')} — валидные узлы: ${
        nodes.length === 0 ? 'бандлы не собраны, запусти ai memory build' : nodes.join(', ')
      }`,
    );
  const parts: string[] = [];
  if (start !== null)
    parts.push(`Оперативная память проекта (стартовый граф):\n\n${start.trimEnd()}`);
  const loaded = await Promise.all(requested.map((sha) => nodeText(root, sha)));
  for (const [i, text] of loaded.entries()) {
    const sha = requested[i];
    if (sha === undefined || text === null) continue;
    parts.push(`Узел памяти ${sha}:\n\n${text.trimEnd()}`);
  }
  return parts.length === 0 ? '' : `\n\n${parts.join('\n\n')}`;
};

export const ROLE_DIRS = ['.agents/agents', 'agents'] as const;
const DEFAULT_MODEL = 'zai-coding-plan/glm-5.3-flash#max';

export const cliCommand = (): string[] => [...runtime().self];

export async function findRole(root: string, name: string): Promise<AgentDef> {
  for (const dir of ROLE_DIRS) {
    const file = `${dir}/${name}.md`;
    if (!existsSync(path.join(root, file))) continue;
    const problems: string[] = [];
    const role = parseAgent(file, await readFile(path.join(root, file), 'utf8'), (m) =>
      problems.push(m),
    );
    if (role === null) throw new UsageError(`${file}: ${problems.join('; ')}`);
    if (role.output === undefined)
      throw new UsageError(`${file}: роль без output — harness не знает схему ответа`);
    return role;
  }
  throw new UsageError(
    `роль ${name} не найдена: ${ROLE_DIRS.map((d) => `${d}/${name}.md`).join(', ')}`,
  );
}

export interface RoleRun {
  root: string;
  role: AgentDef;
  task: string;
  out: string;
  transcript?: string;
  timeoutMs?: number;
  onProgress?: (text: string) => void;
}

export function roleSystemPrompt(role: AgentDef): string {
  const skills =
    role.skills.length === 0
      ? []
      : [
          `Skills роли: ${role.skills.join(', ')} — прочитай .agents/skills/<имя>/SKILL.md (в источнике — skills/<имя>/SKILL.md) первым делом.`,
        ];
  return [
    `Финальное действие работы — вызов инструмента ${SUBMIT_TOOL} с сообщением протокола «${role.output ?? 'result'}»; ответ текстом итогом не считается (есть только резервный парсинг).`,
    '',
    role.instructions,
    '',
    ...skills,
  ].join('\n');
}

const DEFAULT_TIMEOUT_MIN = 30;

export function roleTimeoutMs(): number {
  const raw = process.env['HARNESS_ROLE_TIMEOUT_MIN'];
  const n = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MIN) * 60_000;
}

export interface RoleOutcome {
  data: unknown;
  costUsd: number | undefined;
}

const SESSION_FILE = /^[A-Za-z0-9._-]+$/;
const SESSION_DIR = ['.oc3', 'submit'] as const;

export interface RoleSources {
  readonly submit: string | undefined;
  readonly session: string | undefined;
  readonly text: string;
}

export type RoleFinal = { data: unknown } | { reason: string };

const schemaIssues = (schema: object, value: unknown): string[] =>
  compileSchema(schema)(value).map((i) => `${i.path || '/'} ${issueText(i)}`);

const VERDICT_KEYS = ['answers', 'contradictions', 'unmeasurable', 'conflicts'] as const;
const VERDICT_KEY_LIST: readonly string[] = VERDICT_KEYS;

const relaxedVerdict = (value: Record<string, unknown>): Record<string, unknown> | undefined => {
  const filled = VERDICT_KEYS.filter((k) => {
    const list = value[k];
    return Array.isArray(list) && list.length > 0;
  });
  const other = Object.keys(value).filter((k) => !VERDICT_KEY_LIST.includes(k));
  if (other.length > 0 || filled.length === Object.keys(value).length) return undefined;
  return Object.fromEntries(filled.map((k) => [k, value[k]]));
};

export function roleOutcomeOf(role: AgentDef, sources: RoleSources): RoleFinal {
  const output = role.output ?? 'result';
  const schema = PROTOCOL[output];
  const shapeOf = (value: unknown): RoleFinal => {
    const issues = schemaIssues(schema, value);
    if (issues.length === 0) return { data: value };
    if (isRecord(value)) {
      const message = value['message'];
      if (typeof message === 'string' && isProtocolMessage(message)) {
        if (message !== output)
          return { reason: `конверт с message ${message}, роль возвращает ${output}` };
        const data = value['data'];
        const inner = schemaIssues(schema, data);
        if (inner.length === 0) return { data };
        if (output === 'verdict' && isRecord(data)) {
          const relaxed = relaxedVerdict(data);
          if (relaxed !== undefined && schemaIssues(schema, relaxed).length === 0)
            return { data: relaxed };
        }
        return { reason: `data конверта не по схеме ${output}: ${inner.join('; ')}` };
      }
      if (output === 'verdict') {
        const relaxed = relaxedVerdict(value);
        if (relaxed !== undefined && schemaIssues(schema, relaxed).length === 0)
          return { data: relaxed };
      }
      return { reason: `значение не по схеме ${output}` };
    }
    if (output === 'verdict' && Array.isArray(value)) {
      const wrapped: unknown = { answers: value };
      const wrappedIssues = schemaIssues(schema, wrapped);
      return wrappedIssues.length === 0 ? { data: wrapped } : { reason: wrappedIssues.join('; ') };
    }
    return { reason: `значение не по схеме ${output}` };
  };
  const files: [string, string | undefined][] = [
    ['файл канала', sources.submit],
    ['файл сессии', sources.session],
  ];
  const reasons: string[] = [];
  for (const [label, raw] of files) {
    if (raw === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      reasons.push(`${label}: не JSON`);
      continue;
    }
    const shape = shapeOf(parsed);
    if ('data' in shape) return shape;
    reasons.push(`${label}: ${shape.reason}`);
  }
  const parsed = structuredFromText(sources.text);
  if (parsed === undefined) return { reason: [...reasons, 'текст ответа без JSON'].join('; ') };
  const shape = shapeOf(parsed);
  return 'data' in shape
    ? shape
    : { reason: [...reasons, `текст ответа: ${shape.reason}`].join('; ') };
}

export async function runRole(run: RoleRun): Promise<RoleOutcome> {
  let steps = 0;
  const options: OpenCodeSpawnOptions = { timeoutMs: run.timeoutMs ?? roleTimeoutMs() };
  if (run.transcript !== undefined) options.transcript = run.transcript;
  const progress = run.onProgress;
  if (progress !== undefined)
    options.onLine = (line) => {
      const step = openCodeStepOf(line);
      if (step === undefined) return;
      steps++;
      progress(`роль ${run.role.name}: шаг ${steps} — ${step}`);
    };
  progress?.(`роль ${run.role.name}: запущена (${run.role.model ?? DEFAULT_MODEL})`);
  const memory = await memoryPromptOf(run.root, run.task);
  const result = await spawnOpenCode(
    {
      cwd: run.root,
      agent: run.role.name,
      model: run.role.model ?? DEFAULT_MODEL,
      prompt: `${roleSystemPrompt(run.role)}${memory}`,
      task: run.task,
      out: run.out,
    },
    options,
  );
  progress?.(`роль ${run.role.name}: готово, шагов ${steps}`);
  const tail = result.error ?? result.stderr.trim().slice(0, 500);
  if (result.code !== 0) throw new Error(`opencode run: код ${result.code}: ${tail}`);
  const session = result.sessionId;
  const sessionRaw =
    session !== undefined && SESSION_FILE.test(session)
      ? await submitFileOf(path.join(run.root, ...SESSION_DIR, `${session}.json`))
      : undefined;
  const final = roleOutcomeOf(run.role, {
    submit: await submitFileOf(run.out),
    session: sessionRaw,
    text: result.lastText ?? '',
  });
  if ('data' in final) return { data: final.data, costUsd: result.costUsd };
  const why = [
    final.reason,
    run.transcript === undefined ? undefined : `транскрипт: ${run.transcript}`,
  ]
    .filter((part) => part !== undefined)
    .join('; ');
  throw new Error(
    `роль ${run.role.name} не вернула итог через ${SUBMIT_TOOL}${why === '' ? '' : ` — ${why}`}`,
  );
}

export interface AskOptions {
  transcript?: string;
  timeoutMs?: number;
  onProgress?: (text: string) => void;
}

export async function askRole(
  root: string,
  name: string,
  task: string,
  options: AskOptions = {},
): Promise<RoleOutcome> {
  const role = await findRole(root, name);
  const dir = await mkdtemp(path.join(tmpdir(), `harness-role-${name}-`));
  try {
    const run: RoleRun = {
      root,
      role,
      task,
      out: path.join(dir, 'out.json'),
    };
    if (options.transcript !== undefined) run.transcript = options.transcript;
    if (options.timeoutMs !== undefined) run.timeoutMs = options.timeoutMs;
    if (options.onProgress !== undefined) run.onProgress = options.onProgress;
    return await runRole(run);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
