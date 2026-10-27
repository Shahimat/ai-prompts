import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '#shared/diagnostics';
import { compileSchema, issueText } from '#shared/schema';
import { parseAgent, type AgentDef } from './agent.ts';
import { claudeBin, parseHeadless } from './claude.ts';
import { CHANNEL_SERVER, PROTOCOL, SUBMIT_TOOL, SUBMIT_TOOL_ID } from './protocol.ts';

export const ROLE_DIRS = ['.agents/agents', 'agents'] as const;
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
const DEFAULT_MODEL = 'opus';
const MAX_TURNS = 60;

export function harnessCommand(): string[] {
  const bin = fileURLToPath(import.meta.resolve('#bin'));
  return bin.endsWith('.ts')
    ? [process.execPath, '--conditions=source', bin]
    : [process.execPath, bin];
}

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
    '--output-format',
    'json',
    '--model',
    run.role.model ?? DEFAULT_MODEL,
    '--permission-mode',
    'dontAsk',
    '--max-turns',
    String(run.maxTurns ?? MAX_TURNS),
    '--no-session-persistence',
    '--append-system-prompt',
    roleSystemPrompt(run.role),
    '--tools',
    tools.join(','),
    '--allowedTools',
    [...tools, SUBMIT_TOOL_ID].join(','),
  ];
}

function spawnClaude(cwd: string, args: string[], stdin: string): Promise<string> {
  const [bin = 'claude', ...pre] = claudeBin();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...pre, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && out.trim() === '') {
        reject(new Error(`claude -p: код ${code ?? 'null'}: ${err.trim().slice(0, 500)}`));
        return;
      }
      resolve(out);
    });
    child.stdin.end(stdin);
  });
}

export interface RoleOutcome {
  data: unknown;
  costUsd: number | undefined;
}

export async function runRole(run: RoleRun): Promise<RoleOutcome> {
  const head = parseHeadless(await spawnClaude(run.root, roleArgs(run), run.task));
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

export async function askRole(root: string, name: string, task: string): Promise<RoleOutcome> {
  const role = await findRole(root, name);
  const dir = await mkdtemp(path.join(tmpdir(), `harness-role-${name}-`));
  try {
    return await runRole({
      root,
      role,
      task,
      out: path.join(dir, 'out.json'),
      self: harnessCommand(),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
