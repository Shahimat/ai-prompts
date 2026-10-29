import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { isRecord, UsageError } from '@shahimat/ai-core';
import type { ExecResult, ProviderContext, ScheduleUnit, TaskCard } from './providers.ts';
import { machineFile, projectKey } from './paths.ts';

function contextOf(value: unknown): ProviderContext {
  if (
    !isRecord(value) ||
    typeof value['root'] !== 'string' ||
    typeof value['home'] !== 'string' ||
    typeof value['repo'] !== 'string' ||
    typeof value['exec'] !== 'function'
  )
    throw new Error('провайдер вызван без контекста');
  const exec = value['exec'];
  return {
    root: value['root'],
    home: value['home'],
    repo: value['repo'],
    exec: (cmd, args, cwd) => {
      const r: unknown = Reflect.apply(exec, undefined, [cmd, args, cwd]);
      if (!isRecord(r) || typeof r['code'] !== 'number')
        throw new Error('exec вернул не ExecResult');
      return {
        code: r['code'],
        stdout: typeof r['stdout'] === 'string' ? r['stdout'] : '',
        stderr: typeof r['stderr'] === 'string' ? r['stderr'] : '',
      };
    },
  };
}

function must(r: ExecResult, what: string): string {
  if (r.code !== 0) throw new Error(`${what}: код ${r.code}: ${r.stderr.trim().slice(0, 300)}`);
  return r.stdout;
}

const DOD_HEADING = /^##\s+(definition of done|dod|критерии готовности)\s*$/i;

export function parseTaskMarkdown(ref: string, text: string): TaskCard {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const title =
    lines
      .find((l) => l.startsWith('# '))
      ?.slice(2)
      .trim() ?? ref;
  const dod: string[] = [];
  let inDod = false;
  for (const line of lines) {
    if (line.startsWith('## ')) inDod = DOD_HEADING.test(line.trim());
    else if (inDod) {
      const item = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line)?.[1];
      if (item !== undefined) dod.push(item.trim());
    }
  }
  const links = [...new Set(text.match(/https?:\/\/[^\s)>\]]+/g) ?? [])];
  return { ref, title, body: text, dod, links };
}

function localFile(ctx: ProviderContext, ref: string): string {
  const file = path.resolve(ctx.root, ref);
  if (!file.startsWith(path.resolve(ctx.root) + path.sep))
    throw new UsageError(`tasks/local: ${ref} — путь вне проекта`);
  return file;
}

const tasksLocal = {
  interface: 'tasks',
  name: 'local',
  fetch: async (ref: unknown, ctx: unknown): Promise<TaskCard> => {
    if (typeof ref !== 'string') throw new UsageError('tasks/local: ref — путь к markdown-файлу');
    return parseTaskMarkdown(ref, await readFile(localFile(contextOf(ctx), ref), 'utf8'));
  },
  update: async (ref: unknown, text: unknown, ctx: unknown): Promise<void> => {
    if (typeof ref !== 'string' || typeof text !== 'string')
      throw new UsageError('tasks/local: update(ref, текст)');
    const file = localFile(contextOf(ctx), ref);
    const body = await readFile(file, 'utf8');
    const head = body.includes('\n## Статус\n') ? body : `${body.trimEnd()}\n\n## Статус\n`;
    await writeFile(
      file,
      `${head.trimEnd()}\n- ${new Date().toISOString().slice(0, 10)} ${text.trim()}\n`,
      'utf8',
    );
  },
};

function jobOf(value: unknown): { short: string } {
  if (!isRecord(value) || typeof value['short'] !== 'string')
    throw new UsageError('vcs: create({ short })');
  return { short: value['short'] };
}

const vcsGit = {
  interface: 'vcs',
  name: 'git',
  create: async (job: unknown, raw: unknown): Promise<string> => {
    const ctx = contextOf(raw);
    const { short } = jobOf(job);
    const dir = machineFile(ctx.home, 'worktrees', projectKey(ctx.root), short);
    await mkdir(path.dirname(dir), { recursive: true });
    must(
      ctx.exec('git', ['-C', ctx.repo, 'worktree', 'add', '-b', `job/${short}`, dir], ctx.repo),
      'git worktree add',
    );
    return dir;
  },
  diff: async (dir: unknown, raw: unknown): Promise<string> => {
    const ctx = contextOf(raw);
    if (typeof dir !== 'string') throw new UsageError('vcs/git: diff(каталог)');
    must(ctx.exec('git', ['-C', dir, 'add', '-A', '--intent-to-add'], dir), 'git add -N');
    return must(ctx.exec('git', ['-C', dir, 'diff', 'HEAD'], dir), 'git diff');
  },
  remove: async (dir: unknown, raw: unknown): Promise<void> => {
    const ctx = contextOf(raw);
    if (typeof dir !== 'string') throw new UsageError('vcs/git: remove(каталог)');
    must(
      ctx.exec('git', ['-C', ctx.repo, 'worktree', 'remove', '--force', dir], ctx.repo),
      'git worktree remove',
    );
  },
};

function unitOf(value: unknown): ScheduleUnit {
  if (
    !isRecord(value) ||
    typeof value['name'] !== 'string' ||
    !Array.isArray(value['command']) ||
    !value['command'].every((c) => typeof c === 'string') ||
    typeof value['every'] !== 'number' ||
    typeof value['log'] !== 'string'
  )
    throw new UsageError('schedule: install({ name, command, every, log })');
  return {
    name: value['name'],
    command: value['command'].filter((c): c is string => typeof c === 'string'),
    every: value['every'],
    log: value['log'],
  };
}

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function launchdPlist(unit: ScheduleUnit): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${xml(unit.name)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...unit.command.map((c) => `    <string>${xml(c)}</string>`),
    '  </array>',
    '  <key>StartInterval</key>',
    `  <integer>${unit.every}</integer>`,
    '  <key>StandardOutPath</key>',
    `  <string>${xml(unit.log)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(unit.log)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

const plistPath = (name: string): string =>
  path.join(homedir(), 'Library', 'LaunchAgents', `${name}.plist`);
const domain = (): string => `gui/${userInfo().uid}`;

const scheduleLaunchd = {
  interface: 'schedule',
  name: 'launchd',
  install: async (raw: unknown, ctxRaw: unknown): Promise<void> => {
    const ctx = contextOf(ctxRaw);
    const unit = unitOf(raw);
    const file = plistPath(unit.name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, launchdPlist(unit), 'utf8');
    must(ctx.exec('launchctl', ['bootstrap', domain(), file]), 'launchctl bootstrap');
  },
  remove: async (name: unknown, ctxRaw: unknown): Promise<void> => {
    const ctx = contextOf(ctxRaw);
    if (typeof name !== 'string') throw new UsageError('schedule/launchd: remove(имя)');
    ctx.exec('launchctl', ['bootout', `${domain()}/${name}`]);
    await rm(plistPath(name), { force: true });
  },
  status: async (name: unknown, ctxRaw: unknown): Promise<string> => {
    const ctx = contextOf(ctxRaw);
    if (typeof name !== 'string') throw new UsageError('schedule/launchd: status(имя)');
    return ctx.exec('launchctl', ['print', `${domain()}/${name}`]).code === 0 ? 'active' : 'absent';
  },
};

export function systemdUnits(unit: ScheduleUnit): { service: string; timer: string } {
  const quote = (s: string): string =>
    /[\s"\\]/.test(s) ? `"${s.replace(/(["\\])/g, '\\$1')}"` : s;
  return {
    service: [
      '[Unit]',
      `Description=${unit.name}`,
      '',
      '[Service]',
      'Type=oneshot',
      `ExecStart=${unit.command.map(quote).join(' ')}`,
      `StandardOutput=append:${unit.log}`,
      `StandardError=append:${unit.log}`,
      '',
    ].join('\n'),
    timer: [
      '[Unit]',
      `Description=${unit.name} timer`,
      '',
      '[Timer]',
      'OnBootSec=1min',
      `OnUnitActiveSec=${unit.every}s`,
      '',
      '[Install]',
      'WantedBy=timers.target',
      '',
    ].join('\n'),
  };
}

const systemdDir = (): string => path.join(homedir(), '.config', 'systemd', 'user');

const scheduleSystemd = {
  interface: 'schedule',
  name: 'systemd',
  install: async (raw: unknown, ctxRaw: unknown): Promise<void> => {
    const ctx = contextOf(ctxRaw);
    const unit = unitOf(raw);
    const { service, timer } = systemdUnits(unit);
    await mkdir(systemdDir(), { recursive: true });
    await writeFile(path.join(systemdDir(), `${unit.name}.service`), service, 'utf8');
    await writeFile(path.join(systemdDir(), `${unit.name}.timer`), timer, 'utf8');
    must(ctx.exec('systemctl', ['--user', 'daemon-reload']), 'systemctl daemon-reload');
    must(
      ctx.exec('systemctl', ['--user', 'enable', '--now', `${unit.name}.timer`]),
      'systemctl enable',
    );
  },
  remove: async (name: unknown, ctxRaw: unknown): Promise<void> => {
    const ctx = contextOf(ctxRaw);
    if (typeof name !== 'string') throw new UsageError('schedule/systemd: remove(имя)');
    ctx.exec('systemctl', ['--user', 'disable', '--now', `${name}.timer`]);
    await rm(path.join(systemdDir(), `${name}.service`), { force: true });
    await rm(path.join(systemdDir(), `${name}.timer`), { force: true });
    ctx.exec('systemctl', ['--user', 'daemon-reload']);
  },
  status: async (name: unknown, ctxRaw: unknown): Promise<string> => {
    const ctx = contextOf(ctxRaw);
    if (typeof name !== 'string') throw new UsageError('schedule/systemd: status(имя)');
    return ctx.exec('systemctl', ['--user', 'is-active', `${name}.timer`]).stdout.trim() ===
      'active'
      ? 'active'
      : 'absent';
  },
};

export const BUILTIN_PROVIDERS: readonly { interface: string; name: string }[] = [
  tasksLocal,
  vcsGit,
  scheduleLaunchd,
  scheduleSystemd,
];
