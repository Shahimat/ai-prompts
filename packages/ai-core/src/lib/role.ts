import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UsageError } from '#shared/diagnostics';
import { compileSchema, issueText } from '#shared/schema';
import { isRecord } from '#shared/guards';
import { parseAgent, type AgentDef } from './agent.ts';
import { claudeBin, parseHeadless } from './claude.ts';
import { runtime } from './runtime.ts';
import { CHANNEL_SERVER, PROTOCOL, SUBMIT_TOOL, SUBMIT_TOOL_ID } from './protocol.ts';

export const ROLE_DIRS = ['.agents/agents', 'agents'] as const;
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
const DEFAULT_MODEL = 'opus';
const MAX_TURNS = 60;

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
  self: string[];
  maxTurns?: number;
  transcript?: string;
  addDirs?: readonly string[];
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

export function roleArgs(run: RoleRun): string[] {
  const [bin = process.execPath, ...pre] = run.self;
  const tools = run.role.tools.length > 0 ? run.role.tools : READ_ONLY_TOOLS;
  const channel = {
    mcpServers: {
      [CHANNEL_SERVER]: {
        type: 'stdio',
        command: bin,
        args: [...pre, 'role', 'channel', run.role.output ?? 'result', '--out', run.out],
      },
    },
  };
  return [
    '-p',
    '--setting-sources',
    '',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify(channel),
    ...(run.transcript === undefined
      ? ['--output-format', 'json']
      : ['--output-format', 'stream-json', '--verbose']),
    '--model',
    run.role.model ?? DEFAULT_MODEL,
    '--permission-mode',
    'dontAsk',
    '--max-turns',
    String(run.maxTurns ?? MAX_TURNS),
    '--no-session-persistence',
    ...(run.addDirs ?? []).flatMap((d) => ['--add-dir', d]),
    '--append-system-prompt',
    roleSystemPrompt(run.role),
    '--tools',
    tools.join(','),
    '--allowedTools',
    [...tools, SUBMIT_TOOL_ID].join(','),
  ];
}

export interface SpawnOptions {
  transcript?: string;
  onLine?: (line: string) => void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MIN = 30;

export function roleTimeoutMs(): number {
  const raw = process.env['HARNESS_ROLE_TIMEOUT_MIN'];
  const n = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MIN) * 60_000;
}

function spawnClaude(
  cwd: string,
  args: string[],
  stdin: string,
  options: SpawnOptions = {},
): Promise<string> {
  const [bin = 'claude', ...pre] = claudeBin();
  if (options.transcript !== undefined)
    mkdirSync(path.dirname(options.transcript), { recursive: true });
  const journal =
    options.transcript === undefined
      ? undefined
      : createWriteStream(options.transcript, { flags: 'w' });
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...pre, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let pending = '';
    let timedOut = false;
    const limit = options.timeoutMs ?? roleTimeoutMs();
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, limit);
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      out += text;
      journal?.write(text);
      if (options.onLine === undefined) return;
      pending += text;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim() !== '') options.onLine(line);
    });
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      journal?.end();
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const finish = (): void => {
        if (timedOut) {
          reject(
            new Error(`claude -p: таймаут ${Math.round(limit / 60_000)} мин — процесс остановлен`),
          );
          return;
        }
        if (code !== 0 && out.trim() === '') {
          reject(new Error(`claude -p: код ${code ?? 'null'}: ${err.trim().slice(0, 500)}`));
          return;
        }
        resolve(out);
      };
      if (journal === undefined) finish();
      else journal.end(finish);
    });
    child.stdin.end(stdin);
  });
}

export interface RoleOutcome {
  data: unknown;
  costUsd: number | undefined;
}

export function finalLine(stdout: string): string {
  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  return lines.findLast((l) => l.includes('"type":"result"')) ?? lines.at(-1) ?? '';
}

export function stepOf(line: string): string | undefined {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(data) || data['type'] !== 'assistant' || !isRecord(data['message']))
    return undefined;
  const content = data['message']['content'];
  if (!Array.isArray(content)) return undefined;
  const tools = content
    .filter((c) => isRecord(c) && c['type'] === 'tool_use' && typeof c['name'] === 'string')
    .map((c) => (isRecord(c) ? String(c['name']) : ''));
  return tools.length === 0 ? undefined : tools.join(', ');
}

export async function runRole(run: RoleRun): Promise<RoleOutcome> {
  let steps = 0;
  const spawnOptions: SpawnOptions = {};
  if (run.transcript !== undefined) spawnOptions.transcript = run.transcript;
  if (run.timeoutMs !== undefined) spawnOptions.timeoutMs = run.timeoutMs;
  const progress = run.onProgress;
  if (progress !== undefined)
    spawnOptions.onLine = (line) => {
      const step = stepOf(line);
      if (step === undefined) return;
      steps++;
      progress(`роль ${run.role.name}: шаг ${steps} — ${step}`);
    };
  progress?.(`роль ${run.role.name}: запущена (${run.role.model ?? DEFAULT_MODEL})`);
  const stdout = await spawnClaude(run.root, roleArgs(run), run.task, spawnOptions);
  const head = parseHeadless(run.transcript === undefined ? stdout : finalLine(stdout));
  progress?.(`роль ${run.role.name}: готово, шагов ${steps}`);
  if (!existsSync(run.out))
    throw new Error(`роль ${run.role.name} не вернула результат через ${SUBMIT_TOOL}`);
  const data: unknown = JSON.parse(await readFile(run.out, 'utf8'));
  const issues = compileSchema(PROTOCOL[run.role.output ?? 'result'])(data);
  if (issues.length > 0)
    throw new Error(
      `роль ${run.role.name}: ответ не по схеме: ${issues.map((i) => `${i.path} ${issueText(i)}`).join('; ')}`,
    );
  return { data, costUsd: head.costUsd };
}

export interface AskOptions {
  transcript?: string;
  addDirs?: readonly string[];
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
      self: cliCommand(),
    };
    if (options.transcript !== undefined) run.transcript = options.transcript;
    if (options.addDirs !== undefined) run.addDirs = options.addDirs;
    if (options.timeoutMs !== undefined) run.timeoutMs = options.timeoutMs;
    if (options.onProgress !== undefined) run.onProgress = options.onProgress;
    return await runRole(run);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
