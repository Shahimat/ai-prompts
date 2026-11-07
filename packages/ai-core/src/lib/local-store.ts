import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, isRecord } from '#shared/guards';

export const digestOf = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function gitRead(root: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trimEnd() : null;
}

export async function topologyOf(root: string) {
  const worktree = await realpath(root);
  const head = gitRead(worktree, ['rev-parse', '--verify', 'HEAD']);
  const common = gitRead(worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  let project = worktree;
  if (common !== null) {
    if (gitRead(worktree, ['rev-parse', '--is-bare-repository']) !== 'false')
      throw new Error('STORE_UNAVAILABLE: bare topology');
    const resolved = await realpath(common);
    if (path.basename(resolved) !== '.git') throw new Error('STORE_UNAVAILABLE: topology');
    project = await realpath(path.dirname(resolved));
  }
  return { project, worktree, head, branch: gitRead(worktree, ['branch', '--show-current']) };
}

export async function safePath(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..'))
    throw new Error('STORE_UNAVAILABLE: unsafe path');
  const base = await realpath(root);
  let current = base;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('STORE_UNAVAILABLE: symlink');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
  return current;
}

export async function readJson(file: string, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  try {
    if ((await lstat(file)).size > maxBytes) throw new Error('RECORD_LIMIT');
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw new Error(`CORRUPT_RECORD: ${path.basename(file)}`);
  }
}

async function syncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function publishJson(
  file: string,
  value: unknown,
  immutable = true,
  scratch?: string,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporaryDir = scratch ?? path.dirname(file);
  await mkdir(temporaryDir, { recursive: true });
  if ((await lstat(temporaryDir)).dev !== (await lstat(path.dirname(file))).dev)
    throw new Error('STORE_UNAVAILABLE: cross-device publication');
  const temporary = path.join(temporaryDir, `${path.basename(file)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (immutable) {
      try {
        await link(temporary, file);
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        if (digestOf(await readJson(file)) !== digestOf(value))
          throw new Error('IDEMPOTENCY_CONFLICT');
      }
    } else await rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function publishProjectJson(
  root: string,
  relative: string,
  value: unknown,
  immutable = true,
): Promise<void> {
  validateArtifactOutput(root, relative);
  await publishJson(
    await safePath(root, relative),
    value,
    immutable,
    await safePath(root, '.oc3/locks/atomic-tmp'),
  );
}

export async function acquireLease(
  root: string,
  name: string,
  owner: string,
  context?: { caller: string; run: string },
) {
  const file = await safePath(root, `.oc3/locks/${name}.json`);
  const leaseId = randomUUID();
  const value = {
    token: leaseId,
    owner,
    pid: process.pid,
    root: await realpath(root),
    context: context ?? null,
  };
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const handle = await open(file, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (errorCode(error) === 'EEXIST')
      throw new Error('LOCK_BUSY: explicit owner recovery required');
    throw error;
  }
  return {
    token: leaseId,
    file,
    release: async () => {
      if (digestOf(await readJson(file)) !== digestOf(value))
        throw new Error('LEASE_OWNER_MISMATCH');
      await rm(file);
    },
  };
}

export async function recoverLease(
  root: string,
  name: string,
  token: string,
  owner: string,
): Promise<void> {
  const file = await safePath(root, `.oc3/locks/${name}.json`);
  const record = await readJson(file);
  if (
    typeof record !== 'object' ||
    record === null ||
    !('token' in record) ||
    record.token !== token ||
    !('owner' in record) ||
    record.owner !== owner ||
    !('pid' in record) ||
    typeof record.pid !== 'number'
  )
    throw new Error('LEASE_OWNER_MISMATCH');
  try {
    process.kill(record.pid, 0);
    throw new Error('LEASE_OWNER_ALIVE');
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error;
  }
  if (digestOf(await readJson(file)) !== digestOf(record)) throw new Error('LEASE_OWNER_MISMATCH');
  await rm(file);
}

export async function contentHash(root: string, file: string): Promise<string | null> {
  const absolute = await safePath(root, file);
  try {
    const stat = await lstat(absolute);
    if (!stat.isFile()) throw new Error('INVALID_INPUT: regular file required');
    return digestOf({ mode: stat.mode, content: (await readFile(absolute)).toString('base64') });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

export async function localSnapshot(root: string) {
  const topology = await topologyOf(root);
  const excluded = (file: string) =>
    [
      '.oc3/inbox/',
      '.ops/',
      '.oc3/locks/',
      '.oc3/bundles/',
      '.oc3/submit/',
      '.oc3/sessions/',
      '.oc3/operator/',
      '.oc3/.delta/',
      '.oc3/verdicts/',
      '.oc3/reports/',
      '.oc3/research/',
      '.oc3/jobs/',
      '.oc3/watches/',
      '.oc3/baseline/',
      '.oc3/feedback/',
      'expectations/.judge/',
      '.opencode/agents/',
    ].some((prefix) => file.startsWith(prefix)) ||
    file === 'expectations/.verdicts.json' ||
    file === '.opencode/opencode.jsonc' ||
    /^\.oc3\/goals\/[^/]+\.expect\.json$/.test(file);
  const files = (
    gitRead(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']) ?? ''
  )
    .split('\0')
    .filter((file) => file !== '' && !excluded(file))
    .sort();
  const contents = await Promise.all(
    files.map(async (file) => [file, await contentHash(root, file)]),
  );
  const dirty = digestOf(contents);
  return {
    ...topology,
    dirty,
    scope: digestOf({ worktree: topology.worktree, head: topology.head, dirty }),
  };
}

export async function runDocsReviewStage(
  root: string,
  run: string,
  stage: 'apply' | 'verify' | 'review' | 'close',
  operation: () => Promise<boolean>,
): Promise<boolean> {
  const lease = await acquireLease(root, 'docs-review', run);
  try {
    const file = await safePath(root, '.oc3/locks/docs-review-run.json');
    const previous = await readJson(file);
    if (isRecord(previous) && previous['run'] !== run) throw new Error('LOCK_BUSY: docs review');
    const snapshot = await localSnapshot(root);
    if (stage === 'close') {
      const completed = await readJson(
        await safePath(
          root,
          artifactRelative({ kind: 'docs-proof', key: digestOf(run) + '.json' }),
        ),
      );
      if (isRecord(completed)) {
        const { digest, ...body } = completed;
        if (
          digest !== digestOf(body) ||
          completed['run'] !== run ||
          digestOf(completed['snapshot']) !== digestOf(snapshot)
        )
          throw new Error('STALE_DOCS_REVIEW');
        await rm(file, { force: true });
        return true;
      }
    }
    if (stage !== 'apply') {
      const expected = stage === 'verify' ? 'apply' : stage === 'review' ? 'verify' : 'review';
      if (
        !isRecord(previous) ||
        previous['stage'] !== expected ||
        previous['snapshot'] !== snapshot.scope
      )
        throw new Error('STALE_DOCS_REVIEW');
    }
    await publishProjectJson(
      root,
      '.oc3/locks/docs-review-run.json',
      { run, stage: 'running', snapshot: snapshot.scope },
      false,
    );
    const ok = await operation();
    const after = await localSnapshot(root);
    if (!ok || (stage !== 'apply' && snapshot.scope !== after.scope)) {
      await publishProjectJson(
        root,
        '.oc3/locks/docs-review-run.json',
        { run, stage: 'failed', snapshot: after.scope },
        false,
      );
      return false;
    }
    await publishProjectJson(
      root,
      '.oc3/locks/docs-review-run.json',
      { run, stage, snapshot: after.scope },
      false,
    );
    if (stage === 'close') {
      const proof = {
        kind: 'docs-batch',
        run,
        status: 'pass',
        stages: ['apply', 'verify', 'review', 'close'],
        snapshot: after,
      };
      await publishProjectJson(
        root,
        artifactRelative({ kind: 'docs-proof', key: digestOf(run) + '.json' }),
        {
          ...proof,
          digest: digestOf(proof),
        },
      );
      await rm(file);
    }
    return true;
  } finally {
    await lease.release();
  }
}
import { artifactRelative, validateArtifactOutput } from './artifacts.ts';
