import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from '@opencode/plugin';

const BRIEF_CLI = path.join('node_modules', '@shahimat', 'cli', 'dist', 'bin.js');
const BRIEF_ARGS = ['ops', 'brief'];
const BRIEF_TIMEOUT_MS = 10_000;
const BRIEF_MAX_LINES = 20;
const BRIEF_HEADER = 'ops-brief (стартовая сводка ops):';

export async function briefText(root: string): Promise<string | undefined> {
  const cli = path.join(root, BRIEF_CLI);
  if (!existsSync(cli)) return undefined;
  let stdout: string;
  try {
    stdout = await runBrief(cli, root);
  } catch {
    return undefined;
  }
  const lines = stdout
    .trimEnd()
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) return undefined;
  return [BRIEF_HEADER, ...lines.slice(0, BRIEF_MAX_LINES)].join('\n');
}

function runBrief(cli: string, root: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'node',
      [cli, ...BRIEF_ARGS],
      { cwd: root, timeout: BRIEF_TIMEOUT_MS },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export async function appendBrief(
  prompt: { text: string },
  root: string,
  seen: Set<string>,
  sessionID: string,
): Promise<void> {
  if (seen.has(sessionID)) return;
  const text = await briefText(root);
  if (text === undefined) return;
  seen.add(sessionID);
  prompt.text = `${prompt.text}\n\n${text}`;
}

export async function registerOpsBrief(ctx: Plugin.Context): Promise<Plugin.Cleanup> {
  const root = ctx.location.directory;
  const seen = new Set<string>();
  const registration = await ctx.session.hook('prompt', (input) =>
    appendBrief(input.prompt, root, seen, input.sessionID),
  );
  return async () => {
    await registration.dispose();
  };
}
