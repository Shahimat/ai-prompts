import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UsageError } from '#shared/diagnostics';
import { compileSchema, issueText } from '#shared/schema';
import { parseAgent, type AgentDef } from './agent.ts';
import {
  openCodeStepOf,
  spawnOpenCode,
  submitFileOf,
  type OpenCodeSpawnOptions,
} from './opencode.ts';
import { runtime } from './runtime.ts';
import { PROTOCOL, SUBMIT_TOOL } from './protocol.ts';

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
    role.instructions,
    '',
    ...skills,
    `Итог работы верни инструментом ${SUBMIT_TOOL} — сообщением протокола «${role.output ?? 'result'}». Ответ текстом harness не читает.`,
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
  const result = await spawnOpenCode(
    {
      cwd: run.root,
      agent: run.role.name,
      model: run.role.model ?? DEFAULT_MODEL,
      prompt: roleSystemPrompt(run.role),
      task: run.task,
      out: run.out,
    },
    options,
  );
  progress?.(`роль ${run.role.name}: готово, шагов ${steps}`);
  const tail = result.error ?? result.stderr.trim().slice(0, 500);
  if (result.code !== 0) throw new Error(`opencode run: код ${result.code}: ${tail}`);
  const raw = await submitFileOf(run.out);
  if (raw === undefined)
    throw new Error(`роль ${run.role.name} не вернула итог через ${SUBMIT_TOOL}`);
  const data: unknown = JSON.parse(raw);
  const issues = compileSchema(PROTOCOL[run.role.output ?? 'result'])(data);
  if (issues.length > 0)
    throw new Error(
      `роль ${run.role.name}: ответ не по схеме: ${issues.map((i) => `${i.path} ${issueText(i)}`).join('; ')}`,
    );
  return { data, costUsd: result.costUsd };
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
