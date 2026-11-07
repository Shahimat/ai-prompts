import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, rmdir, writeFile, link, open } from 'node:fs/promises';
import path from 'node:path';
import {
  artifactPath,
  artifactRelative,
  confinedProjectPath,
  expectCacheFile,
  expectStateFile,
  normalizedProjectPath,
  validateArtifactOutput,
  externalArtifactPath,
} from './artifacts.ts';
import {
  acquireLease,
  contentHash,
  digestOf,
  gitRead,
  localSnapshot,
  readJson,
  topologyOf,
  publishProjectJson,
} from './local-store.ts';
import { isRecord, errorCode } from '#shared/guards';

const MANIFEST = '.oc3/reports/artifact-history/manifest.json';
interface Alias {
  from: string;
  to: string;
  hash: string;
  bytes: number;
  root: string;
  worktree: string;
  head: string | null;
  snapshot: string;
  seeded?: string;
}
async function filesBelow(root: string, dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(confinedProjectPath(root, dir), { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const out = [];
  for (const e of entries) {
    const file = `${dir}/${e.name}`;
    confinedProjectPath(root, file);
    if (e.isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
    if (e.isDirectory()) out.push(...(await filesBelow(root, file)));
    else if (e.isFile()) out.push(file);
    else throw new Error('ARTIFACT_FILE_REQUIRED');
    if (out.length > 20000) throw new Error('MIGRATION_LIMIT');
  }
  return out;
}
export async function legacyArtifactInventory(root: string) {
  const listed = (
    gitRead(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']) ?? ''
  )
    .split('\0')
    .filter(Boolean);
  const entryFiles = listed
    .filter((file) => file.endsWith('.expect.ts'))
    .sort(
      (a, b) =>
        Number(a.endsWith('/index.expect.ts')) - Number(b.endsWith('/index.expect.ts')) ||
        a.localeCompare(b),
    );
  const targets = new Map<string, string>();
  for (const file of listed.filter(externalArtifactPath)) {
    if ((await contentHash(root, file)) !== null)
      targets.set(file, artifactRelative({ kind: 'archive', key: 'external', name: file }));
  }
  for (const file of (await filesBelow(root, '.ops')).filter(externalArtifactPath))
    targets.set(file, artifactRelative({ kind: 'archive', key: 'ops', name: file.slice(5) }));
  for (const file of (await filesBelow(root, '.opencode/artifacts')).filter(externalArtifactPath))
    targets.set(
      file,
      artifactRelative({
        kind: 'archive',
        key: 'opencode',
        name: file.slice('.opencode/artifacts/'.length),
      }),
    );
  for (const file of (await filesBelow(root, '.judge')).filter(externalArtifactPath))
    targets.set(file, artifactRelative({ kind: 'archive', key: 'external', name: file }));
  for (const entry of entryFiles) {
    const dir = path.posix.dirname(entry);
    const cache = `${dir}/.verdicts.json`;
    if ((await contentHash(root, cache)) !== null)
      targets.set(cache, artifactRelative({ kind: 'archive', key: 'external', name: cache }));
    for (const file of (await filesBelow(root, `${dir}/.judge`)).filter(externalArtifactPath))
      targets.set(file, artifactRelative({ kind: 'archive', key: 'external', name: file }));
    if (!entry.startsWith('.oc3/')) {
      const sidecar = entry.replace(/\.ts$/, '.json');
      if ((await contentHash(root, sidecar)) !== null)
        targets.set(sidecar, artifactRelative({ kind: 'archive', key: 'external', name: sidecar }));
    }
  }
  return [...targets].sort(([a], [b]) => a.localeCompare(b));
}
export async function assertNoExternalArtifacts(root: string): Promise<void> {
  const legacy = await legacyArtifactInventory(root);
  if (legacy.length > 0) throw new Error(`ARTIFACT_NAMESPACE: ${legacy[0]?.[0]}`);
}
async function readManifest(root: string): Promise<Alias[]> {
  const data = await readJson(validateArtifactOutput(root, MANIFEST, 'archive'));
  if (data === undefined) return [];
  if (
    !isRecord(data) ||
    data['version'] !== 1 ||
    !Array.isArray(data['aliases']) ||
    data['digest'] !== digestOf(data['aliases'])
  )
    throw new Error('MIGRATION_MANIFEST_CORRUPT');
  const aliases: Alias[] = [];
  for (const a of data['aliases']) {
    if (
      !isRecord(a) ||
      typeof a['from'] !== 'string' ||
      typeof a['to'] !== 'string' ||
      typeof a['hash'] !== 'string' ||
      typeof a['bytes'] !== 'number' ||
      typeof a['root'] !== 'string' ||
      typeof a['worktree'] !== 'string' ||
      !(typeof a['head'] === 'string' || a['head'] === null) ||
      typeof a['snapshot'] !== 'string'
    )
      throw new Error('MIGRATION_MANIFEST_CORRUPT');
    aliases.push({
      from: a['from'],
      to: a['to'],
      hash: a['hash'],
      bytes: a['bytes'],
      root: a['root'],
      worktree: a['worktree'],
      head: a['head'],
      snapshot: a['snapshot'],
      ...(typeof a['seeded'] === 'string' ? { seeded: a['seeded'] } : {}),
    });
  }
  return aliases;
}
async function publishBytes(root: string, to: string, bytes: Buffer) {
  const file = validateArtifactOutput(root, to);
  await mkdir(path.dirname(file), { recursive: true });
  const scratch = artifactPath(root, { kind: 'lock', key: 'migration-tmp' });
  await mkdir(scratch, { recursive: true });
  const temp = artifactPath(root, {
    kind: 'lock',
    key: 'migration-tmp',
    name: createHash('sha256').update(to).digest('hex'),
  });
  await writeFile(temp, bytes, { flag: 'wx' }).catch(async (error) => {
    if (errorCode(error) !== 'EEXIST' || !(await readFile(temp)).equals(bytes)) throw error;
  });
  const handle = await open(temp, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temp, file).catch(async (error) => {
      if (errorCode(error) !== 'EEXIST' || !(await readFile(file)).equals(bytes))
        throw new Error(`MIGRATION_COLLISION: ${to}`);
    });
    const dir = await open(path.dirname(file), 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await rm(temp, { force: true });
  }
}
function seedFor(root: string, from: string): string | undefined {
  const entries = (
    gitRead(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']) ?? ''
  )
    .split('\0')
    .filter((file) => file.endsWith('.expect.ts'))
    .sort(
      (a, b) =>
        Number(b.endsWith('/index.expect.ts')) - Number(a.endsWith('/index.expect.ts')) ||
        a.localeCompare(b),
    );
  if (path.posix.basename(from) === '.verdicts.json') {
    const entry = entries.find((file) => path.posix.dirname(file) === path.posix.dirname(from));
    return entry === undefined ? undefined : expectCacheFile(entry);
  }
  const entry = from.replace(/\.json$/, '.ts');
  return from.endsWith('.expect.json') && entries.includes(entry)
    ? expectStateFile(entry)
    : undefined;
}
async function saveManifest(root: string, aliases: Alias[]) {
  await publishProjectJson(
    root,
    MANIFEST,
    { version: 1, aliases, digest: digestOf(aliases) },
    false,
  );
}
export async function migrateArtifacts(root: string) {
  const lease = await acquireLease(root, 'artifact-migration', 'runtime');
  try {
    const aliases = await readManifest(root);
    for (const alias of aliases) await historicalArtifactPath(root, alias.from);
    const upgrades = aliases.filter(
      (alias) => !alias.to.startsWith('.oc3/reports/artifact-history/'),
    );
    if (upgrades.length > 0) {
      const original = await readFile(validateArtifactOutput(root, MANIFEST));
      await publishBytes(
        root,
        artifactRelative({
          kind: 'archive',
          key: 'manifests',
          name: `${digestOf(original.toString('base64'))}.json`,
        }),
        original,
      );
      for (const alias of upgrades) {
        const old = alias.to;
        const archive = artifactRelative({ kind: 'archive', key: 'external', name: alias.from });
        await publishBytes(root, archive, await readFile(validateArtifactOutput(root, old)));
        alias.to = archive;
        alias.seeded = old;
      }
      await saveManifest(root, aliases);
    }
    const topology = await topologyOf(root),
      snapshot = await localSnapshot(root);
    const plan = await legacyArtifactInventory(root);
    for (const [from, to] of plan) {
      const bytes = await readFile(confinedProjectPath(root, from));
      const previous = aliases.find((a) => a.from === from);
      if (
        previous !== undefined &&
        (previous.to !== to || previous.hash !== digestOf(bytes.toString('base64')))
      )
        throw new Error(`MIGRATION_SOURCE_CHANGED: ${from}`);
      const existing = await contentHash(root, to);
      if (existing !== null && !(await readFile(validateArtifactOutput(root, to))).equals(bytes))
        throw new Error(`MIGRATION_COLLISION: ${to}`);
      const seed = previous === undefined ? seedFor(root, from) : undefined;
      if (
        seed !== undefined &&
        (await contentHash(root, seed)) !== null &&
        !(await readFile(validateArtifactOutput(root, seed))).equals(bytes)
      )
        throw new Error(`MIGRATION_COLLISION: ${seed}`);
    }
    for (const [from, to] of plan) {
      const source = confinedProjectPath(root, from),
        bytes = await readFile(source);
      const hash = digestOf(bytes.toString('base64'));
      await publishBytes(root, to, bytes);
      const seeded = aliases.some((alias) => alias.from === from) ? undefined : seedFor(root, from);
      if (seeded !== undefined) await publishBytes(root, seeded, bytes);
      const item: Alias = {
        from,
        to,
        hash,
        bytes: bytes.length,
        root: topology.project,
        worktree: topology.worktree,
        head: topology.head,
        snapshot: snapshot.scope,
        ...(seeded === undefined ? {} : { seeded }),
      };
      if (!aliases.some((a) => a.from === from)) aliases.push(item);
      await saveManifest(root, aliases);
      if (!(await readFile(source)).equals(bytes)) throw new Error('MIGRATION_SOURCE_CHANGED');
      await rm(source);
    }
    const pruned: string[] = [];
    const directories = new Set(['.ops', '.judge', '.opencode/artifacts']);
    for (const file of (
      gitRead(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']) ?? ''
    )
      .split('\0')
      .filter((file) => file.endsWith('.expect.ts')))
      directories.add(`${path.posix.dirname(file)}/.judge`);
    for (const dir of directories) await pruneLegacyDirectories(root, dir, pruned);
    return { manifest: MANIFEST, moved: plan.length, retained: aliases.length, pruned };
  } finally {
    await lease.release();
  }
}
async function pruneLegacyDirectories(
  root: string,
  relative: string,
  pruned: string[],
): Promise<void> {
  const dir = confinedProjectPath(root, relative);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const file = `${relative}/${entry.name}`;
    confinedProjectPath(root, file);
    if (entry.isDirectory()) await pruneLegacyDirectories(root, file, pruned);
  }
  try {
    await rmdir(confinedProjectPath(root, relative));
    pruned.push(relative);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(errorCode(error) ?? '')) throw error;
  }
}
export async function historicalArtifactPath(root: string, legacy: string): Promise<string> {
  const from = normalizedProjectPath(legacy),
    topology = await topologyOf(root);
  const alias = (await readManifest(root)).find((a) => a.from === from);
  if (
    alias === undefined ||
    alias.root !== topology.project ||
    alias.worktree !== topology.worktree
  )
    throw new Error('MIGRATION_ALIAS_SCOPE');
  const target = validateArtifactOutput(root, alias.to),
    bytes = await readFile(target);
  if (bytes.length !== alias.bytes || digestOf(bytes.toString('base64')) !== alias.hash)
    throw new Error('MIGRATION_ALIAS_HASH');
  return target;
}
