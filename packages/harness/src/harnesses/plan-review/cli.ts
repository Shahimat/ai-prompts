import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandArgs } from '#shared/args';
import { UsageError } from '#shared/diagnostics';
import { errorMessage, isOneOf } from '#shared/guards';
import {
  ClaudeRunner,
  createSession,
  driveSession,
  HOME,
  homeOf,
  openSession,
  param,
  requireProject,
  sessionOf as sessionOfHarness,
  type DriveResult,
  type HarnessModule,
  type ModelRunner,
  type Session,
} from '#harnesses/core/index';
import { HOOKS, planFileOf, type PlanContext } from './actions.ts';
import { hookInputOf, runHook } from './hook.ts';
import { loadHarness, loadHarnessOrFail, type LoadedHarness } from './load.ts';
import { readPlanState, readReview, reviewText } from './review.ts';

export const io: {
  runner: () => ModelRunner;
  stdin: () => Promise<string>;
  terminal: () => boolean;
} = {
  runner: () => new ClaudeRunner(),
  stdin: readStdin,
  terminal: () => process.stdin.isTTY && process.stdout.isTTY,
};

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

export function selfCommand(): string[] {
  const bin = fileURLToPath(import.meta.resolve('#bin'));
  return bin.endsWith('.ts')
    ? [process.execPath, '--conditions=source', bin]
    : [process.execPath, bin];
}

function context(
  session: Session,
  home: string,
  harness: LoadedHarness,
  hook: boolean,
): PlanContext {
  return {
    session,
    home,
    def: harness.def,
    runner: io.runner(),
    self: selfCommand(),
    hook,
    terminal: io.terminal(),
  };
}

async function drive(session: Session, home: string, event?: string): Promise<DriveResult> {
  const harness = await loadHarnessOrFail(home, session.data.harness);
  const result = await driveSession(
    harness.def,
    harness.registry,
    session,
    context(session, home, harness, false),
    event,
  );
  const now = await openSession(home, session.id);
  if (harness.def.states.find((s) => s.name === now.data.state)?.final === true)
    return { final: now.data.state };
  return 'paused' in result ? { paused: now.data.state, message: result.message } : result;
}

export const PLAN_REVIEW: HarnessModule = {
  name: 'plan-review',
  startOptions: '[--request <запрос>]',
  startParams: ['<file>'],
  start: (args) => start(args),
  validate: async (home) => {
    const result = await loadHarness(home, 'plan-review');
    if (result.harness === undefined) return { errors: result.errors, plugins: [] };
    return { errors: [], plugins: result.harness.plugins, def: result.harness.def };
  },
  drive,
  status: async (s) => {
    const counters = Object.entries(s.data.counters)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    const { round } = await readPlanState(s);
    const lines = [
      `план: ${planFileOf(s)}`,
      `ревью: ${round}${counters === '' ? '' : ` · счётчики: ${counters}`}`,
    ];
    const last = round > 0 ? await readReview(s, round) : undefined;
    if (last !== undefined)
      lines.push(`последнее ревью: ${last.pass ? 'чистое' : 'сверх бюджета'}`, ...reviewText(last));
    return lines;
  },
  nodes: [
    {
      path: ['plan-review', 'hook', '<id>', '<hook>'],
      kind: 'harness',
      effect: 'mutation',
      options: HOME,
      run: (args) => runHookCommand(args),
    },
  ],
};

async function runHookCommand(args: CommandArgs): Promise<number> {
  const hook = param(args, 'hook');
  if (!isOneOf(HOOKS, hook)) throw new UsageError(`hook — одно из ${HOOKS.join(', ')}: ${hook}`);
  const home = homeOf(args);
  const session = await sessionOfHarness(args, 'plan-review');
  const harness = await loadHarnessOrFail(home, session.data.harness);
  let raw: unknown = {};
  const text = await io.stdin();
  try {
    raw = text.trim() === '' ? {} : JSON.parse(text);
  } catch (error) {
    console.error(`plan-review hook: вход не JSON: ${errorMessage(error)}`);
  }
  const outcome = await runHook(
    context(session, home, harness, true),
    harness,
    hook,
    hookInputOf(raw),
  );
  if (outcome.message !== undefined) console.error(outcome.message);
  return outcome.code;
}

async function start(args: CommandArgs): Promise<Session> {
  requireProject(args.root);
  const home = homeOf(args);
  const harness = await loadHarnessOrFail(home, 'plan-review');
  const planFile = await planFileArg(args);
  const title = await planNameOf(path.join(args.root, planFile));
  console.log(`план: ${planFile}`);
  const session = await createSession(home, {
    harness: harness.name,
    title,
    request: args.request?.trim() ?? '',
    project: args.root,
    initial: harness.def.initial,
    now: args.now,
  });
  session.data.planFile = planFile;
  await session.save();
  return session;
}

const quoted = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const planSkeleton = (name: string): string =>
  [
    "import { budget, plan } from '@shahimat/harness/expect';",
    '',
    'budget({ crit: 0, warn: 0 });',
    '',
    `plan({ name: ${quoted(name)} });`,
    '',
  ].join('\n');

const baseName = (file: string): string => path.basename(file).replace(/\.expect\.ts$/, '');

async function planFileArg(args: CommandArgs): Promise<string> {
  const file = args.params?.['file'];
  if (file === undefined) throw new UsageError('нужен путь к файлу плана: <file>');
  const abs = path.resolve(args.root, file);
  const rel = path.relative(args.root, abs).split(path.sep).join('/');
  if (rel.startsWith('../') || path.isAbsolute(rel))
    throw new UsageError(`файл плана вне проекта ${args.root}: ${file}`);
  if (!rel.endsWith('.expect.ts')) throw new UsageError(`файл плана — *.expect.ts: ${file}`);
  if (!existsSync(abs)) {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, planSkeleton(baseName(abs)), 'utf8');
  }
  return rel;
}

const PLAN_NAME = /\bplan\(\{\s*name:\s*'((?:[^'\\]|\\.)*)'/;

async function planNameOf(file: string): Promise<string> {
  const found = PLAN_NAME.exec(await readFile(file, 'utf8'))?.[1];
  return found === undefined ? baseName(file) : found.replace(/\\(.)/g, '$1');
}
