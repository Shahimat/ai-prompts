// Запуск Claude Code: интерактивная сессия планера и headless-прогоны.
// Флаги задаются явно, на умолчания CLI не полагаемся: `--setting-sources ""`
// отключает settings, hooks и CLAUDE.md пользователя и проекта (spike S1),
// вход по подписке при этом работает (spike S2).

import { spawn } from 'node:child_process';
import { isRecord } from '../guards.ts';

export interface InteractiveRun {
  cwd: string;
  model: string;
  /** UUID сессии Claude Code — для `--resume` при провале 1a. */
  sessionId: string;
  name: string;
  addDirs: string[];
  systemPrompt: string;
  /** Настройки одной сессии: Stop-hook и только он. */
  settings: object;
  allowedTools: string[];
  prompt: string;
}

export interface HeadlessRun {
  cwd: string;
  model: string;
  addDirs: string[];
  systemPrompt: string;
  /** Встроенные инструменты, доступные прогону; остальных нет. */
  tools: string[];
  /** Разрешения без вопроса; всё, что спросило бы, отклоняется (`dontAsk`). */
  allowedTools: string[];
  prompt: string;
  schema?: object;
  /** Продолжить сессию Claude Code вместо новой. */
  resume?: string;
  sessionId?: string;
  /** false — сессия не сохраняется на диск (ревьюеры). */
  persist: boolean;
  maxTurns: number;
  settings?: object;
}

export interface HeadlessResult {
  text: string;
  structured: unknown;
  sessionId: string | undefined;
  costUsd: number | undefined;
}

export interface ModelRunner {
  interactive: (run: InteractiveRun) => Promise<number>;
  headless: (run: HeadlessRun) => Promise<HeadlessResult>;
}

const BASE = ['--setting-sources', ''];

export function interactiveArgs(r: InteractiveRun): string[] {
  return [
    ...BASE,
    '--model',
    r.model,
    '--session-id',
    r.sessionId,
    '--name',
    r.name,
    ...r.addDirs.flatMap((d) => ['--add-dir', d]),
    '--append-system-prompt',
    r.systemPrompt,
    '--settings',
    JSON.stringify(r.settings),
    '--allowedTools',
    r.allowedTools.join(','),
    '--disallowedTools',
    'WebSearch,WebFetch',
    r.prompt,
  ];
}

export function headlessArgs(r: HeadlessRun): string[] {
  const args = [
    '-p',
    ...BASE,
    '--output-format',
    'json',
    '--model',
    r.model,
    '--permission-mode',
    'dontAsk',
    '--tools',
    r.tools.join(','),
    '--allowedTools',
    r.allowedTools.join(','),
    '--max-turns',
    String(r.maxTurns),
    ...r.addDirs.flatMap((d) => ['--add-dir', d]),
    '--append-system-prompt',
    r.systemPrompt,
  ];
  if (!r.tools.includes('WebSearch')) args.push('--disallowedTools', 'WebSearch,WebFetch');
  if (r.schema !== undefined) args.push('--json-schema', JSON.stringify(r.schema));
  if (r.resume !== undefined) args.push('--resume', r.resume);
  if (r.sessionId !== undefined) args.push('--session-id', r.sessionId);
  if (!r.persist) args.push('--no-session-persistence');
  if (r.settings !== undefined) args.push('--settings', JSON.stringify(r.settings));
  args.push(r.prompt);
  return args;
}

/** Бинарь Claude Code: HARNESS_CLAUDE подменяет его в тестах. */
export function claudeBin(): string[] {
  const own = process.env['HARNESS_CLAUDE'];
  if (own === undefined || own === '') return ['claude'];
  // Скрипт на JS запускается текущим Node: тесты одинаково идут на всех ОС.
  return own.endsWith('.js') || own.endsWith('.mjs') ? [process.execPath, own] : [own];
}

export function parseHeadless(stdout: string): HeadlessResult {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error(`claude -p вернул не JSON: ${stdout.slice(0, 200)}`);
  }
  if (!isRecord(data)) throw new Error('claude -p: ответ не объект');
  if (data['is_error'] === true) {
    const result = data['result'];
    throw new Error(
      `claude -p: ошибка: ${typeof result === 'string' ? result : JSON.stringify(data['subtype'])}`,
    );
  }
  const text = data['result'];
  const sessionId = data['session_id'];
  const cost = data['total_cost_usd'];
  return {
    text: typeof text === 'string' ? text : '',
    structured: data['structured_output'],
    sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    costUsd: typeof cost === 'number' ? cost : undefined,
  };
}

export class ClaudeRunner implements ModelRunner {
  async interactive(run: InteractiveRun): Promise<number> {
    const [bin = 'claude', ...pre] = claudeBin();
    return new Promise((resolve, reject) => {
      const child = spawn(bin, [...pre, ...interactiveArgs(run)], {
        cwd: run.cwd,
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });
  }

  async headless(run: HeadlessRun): Promise<HeadlessResult> {
    const [bin = 'claude', ...pre] = claudeBin();
    return new Promise((resolve, reject) => {
      const child = spawn(bin, [...pre, ...headlessArgs(run)], {
        cwd: run.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
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
        try {
          resolve(parseHeadless(out));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
}
