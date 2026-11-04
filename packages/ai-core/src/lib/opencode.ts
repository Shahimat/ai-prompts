import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isRecord } from '#shared/guards';
import { compileSchema } from '#shared/schema';

export interface HeadlessRun {
  cwd: string;
  model: string;
  addDirs: string[];
  systemPrompt: string;
  tools: string[];
  allowedTools: string[];
  prompt: string;
  schema?: object;
  resume?: string;
  sessionId?: string;
  persist: boolean;
  maxTurns: number;
  settings?: object;
  agent?: string;
}

export interface HeadlessResult {
  text: string;
  structured: unknown;
  sessionId: string | undefined;
  costUsd: number | undefined;
}

export interface ModelRunner {
  headless: (run: HeadlessRun) => Promise<HeadlessResult>;
}

export function opencodeBin(): string[] {
  const own = process.env['HARNESS_OPENCODE'];
  if (own === undefined || own === '') return ['opencode'];
  return own.endsWith('.js') || own.endsWith('.mjs') ? [process.execPath, own] : [own];
}

export function opencodeArgs(agent: string, model: string): string[] {
  return ['run', '--format', 'json', '--auto', '--agent', agent, '--model', model];
}

export interface OpenCodeEvents {
  costUsd: number | undefined;
  error: string | undefined;
  text: string;
  lastText: string | undefined;
  tools: string[];
  sessionId: string | undefined;
}

export function openCodeTextOf(line: string): string | undefined {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(data) || data['type'] !== 'text' || !isRecord(data['part'])) return undefined;
  const text = data['part']['text'];
  return typeof text === 'string' ? text : undefined;
}

export function parseOpenCodeEvents(stdout: string): OpenCodeEvents {
  let costUsd: number | undefined;
  let error: string | undefined;
  let sessionId: string | undefined;
  const texts: string[] = [];
  const tools: string[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(data)) continue;
    if (
      sessionId === undefined &&
      typeof data['sessionID'] === 'string' &&
      data['sessionID'] !== ''
    )
      sessionId = data['sessionID'];
    if (
      data['type'] === 'error' &&
      isRecord(data['error']) &&
      typeof data['error']['message'] === 'string'
    )
      error = data['error']['message'];
    if (data['type'] === 'step_finish' && isRecord(data['part'])) {
      const cost = data['part']['cost'];
      if (typeof cost === 'number') costUsd = cost;
    }
    const textPart = openCodeTextOf(line);
    if (textPart !== undefined) texts.push(textPart);
    const tool = openCodeStepOf(line);
    if (tool !== undefined) tools.push(tool);
  }
  return { costUsd, error, text: texts.join('\n'), lastText: texts.at(-1), tools, sessionId };
}

export function openCodeStepOf(line: string): string | undefined {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(data) || data['type'] !== 'tool_use' || !isRecord(data['part'])) return undefined;
  const tool = data['part']['tool'];
  return typeof tool === 'string' && tool !== '' ? tool : undefined;
}

export interface OpenCodeRunSpec {
  cwd: string;
  agent: string;
  model: string;
  prompt: string;
  task: string;
  out: string;
  session?: string;
  attachments?: readonly string[];
}

export interface OpenCodeSpawnOptions {
  transcript?: string;
  onLine?: (line: string) => void;
  timeoutMs?: number;
}

export interface OpenCodeOutcome extends OpenCodeEvents {
  code: number;
  stderr: string;
}

export async function spawnOpenCode(
  spec: OpenCodeRunSpec,
  options: OpenCodeSpawnOptions = {},
): Promise<OpenCodeOutcome> {
  const [bin = 'opencode', ...pre] = opencodeBin();
  const dir = await mkdtemp(path.join(tmpdir(), 'opencode-run-'));
  try {
    const configDir = path.join(dir, 'config');
    mkdirSync(configDir, { recursive: true });
    const instructions = path.join(configDir, 'instructions.md');
    writeFileSync(instructions, spec.prompt, 'utf8');
    const env: NodeJS.ProcessEnv = { ...process.env };
    env['HARNESS_SUBMIT_OUT'] = spec.out;
    env['OPENCODE_CONFIG_DIR'] = configDir;
    env['OPENCODE_CONFIG_CONTENT'] = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      instructions: [instructions],
    });
    if (options.transcript !== undefined)
      mkdirSync(path.dirname(options.transcript), { recursive: true });
    const journal =
      options.transcript === undefined
        ? undefined
        : createWriteStream(options.transcript, { flags: 'w' });
    const session = spec.session === undefined ? [] : ['--session', spec.session];
    const attachments = (spec.attachments ?? []).flatMap((f) => ['-f', f]);
    return await new Promise<OpenCodeOutcome>((resolve, reject) => {
      const child = spawn(
        bin,
        [...pre, ...opencodeArgs(spec.agent, spec.model), ...session, ...attachments],
        {
          cwd: spec.cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let out = '';
      let err = '';
      let pending = '';
      let timedOut = false;
      const limit = options.timeoutMs ?? 30 * 60_000;
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
              new Error(
                `opencode run: таймаут ${Math.round(limit / 60_000)} мин — процесс остановлен`,
              ),
            );
            return;
          }
          resolve({ code: code ?? 1, stderr: err, ...parseOpenCodeEvents(out) });
        };
        if (journal === undefined) finish();
        else journal.end(finish);
      });
      child.stdin.end(spec.task);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function submitFileOf(out: string): Promise<string | undefined> {
  const raw = await readFile(out, 'utf8').catch(() => undefined);
  const text = raw?.trim();
  return text === undefined || text === '' ? undefined : text;
}

export function structuredFromText(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  for (const block of [fenced.at(-1), text.trim()].filter((b) => b !== undefined && b !== '')) {
    try {
      return JSON.parse(block ?? '');
    } catch {
      continue;
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export class OpenCodeRunner implements ModelRunner {
  async headless(run: HeadlessRun): Promise<HeadlessResult> {
    const spec: OpenCodeRunSpec = {
      cwd: run.cwd,
      agent: run.agent ?? 'judge',
      model: run.model,
      prompt: run.systemPrompt,
      task: run.prompt,
      out: '',
    };
    if (run.sessionId !== undefined) spec.session = run.sessionId;
    const result = await spawnOpenCode(spec, { timeoutMs: 30 * 60_000 });
    const tail = result.error ?? result.stderr.trim().slice(0, 500);
    if (result.code !== 0) throw new Error(`opencode run: код ${result.code}: ${tail}`);
    let structured: unknown;
    if (run.schema !== undefined) {
      const parsed = structuredFromText(result.text);
      if (parsed !== undefined && compileSchema(run.schema)(parsed).length === 0)
        structured = parsed;
    }
    return {
      text: result.text,
      structured,
      sessionId: result.sessionId,
      costUsd: result.costUsd,
    };
  }
}
