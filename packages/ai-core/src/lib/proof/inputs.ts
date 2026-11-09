import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { artifactRetention, normalizedProjectPath } from '#lib/artifacts';
import { contentHash, gitRead, safePath } from '#lib/local-store';
import type { ProofDeclaration, ProofInputs } from '#lib/proof/model';

export function canonicalJson(value: unknown): string {
  return canonicalValue(value, new Set());
}

function canonicalValue(value: unknown, seen: Set<object>): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))
    return JSON.stringify(value);
  if (
    typeof value === 'object' &&
    value !== null &&
    !types.isProxy(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      (Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype)) &&
    Object.isExtensible(value) &&
    !seen.has(value)
  ) {
    seen.add(value);
    const entries: [string, unknown][] = [];
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (Array.isArray(value) && key === 'length' && descriptor?.writable === true) continue;
      if (
        typeof key !== 'string' ||
        descriptor === undefined ||
        !('value' in descriptor) ||
        descriptor.enumerable !== true ||
        descriptor.configurable !== true ||
        descriptor.writable !== true
      )
        throw new Error('PROOF_NON_CANONICAL_INPUT');
      const item: unknown = descriptor.value;
      entries.push([key, item]);
    }
    if (Array.isArray(value)) {
      if (entries.length !== value.length || entries.some(([key], index) => key !== String(index)))
        throw new Error('PROOF_NON_CANONICAL_INPUT');
      return `[${entries.map(([, item]) => canonicalValue(item, seen)).join(',')}]`;
    }
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item, seen)}`)
      .join(',')}}`;
  }
  throw new Error('PROOF_NON_CANONICAL_INPUT');
}

export const proofDigest = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

const executableDigest = readFile(process.execPath).then((bytes) =>
  createHash('sha256').update(bytes).digest('hex'),
);

async function members(root: string, directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(await safePath(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error('PROOF_AMBIGUOUS_SYMLINK');
    if (entry.isDirectory()) result.push(...(await members(root, file)));
    else if (entry.isFile()) result.push(file);
    else throw new Error('PROOF_AMBIGUOUS_MEMBER');
  }
  return result.sort();
}

export async function resolveProofInputs(
  root: string,
  declaration: ProofDeclaration,
): Promise<ProofInputs> {
  const diagnostics = [...(declaration.diagnostics ?? [])];
  if (!declaration.complete) diagnostics.push('incomplete dependency contract: run-only');
  if (declaration.implementation.length === 0) diagnostics.push('missing checker implementation');
  if (declaration.secretDependent === true) diagnostics.push('secret-dependent checker: run-only');
  const membership: ProofInputs['manifest']['membership'] = [];
  if (declaration.projectFiles === true) {
    const inventory = gitRead(root, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);
    if (inventory === null) diagnostics.push('unresolved project inventory');
    else
      membership.push({
        directory: '@git-source-inventory-v1',
        files: [
          ...new Set(
            inventory
              .split('\0')
              .filter((file) => file !== '' && artifactRetention(file) !== 'local'),
          ),
        ].sort(),
      });
  }
  for (const directory of [...new Set(declaration.membership ?? [])].sort()) {
    try {
      membership.push({
        directory: normalizedProjectPath(directory),
        files: await members(root, directory),
      });
    } catch {
      diagnostics.push(`unresolved membership: ${directory}`);
    }
  }
  const paths = [
    ...new Set([
      ...declaration.files,
      ...(declaration.optionalFiles ?? []),
      ...declaration.implementation,
      ...membership.flatMap((entry) => entry.files),
    ]),
  ].sort();
  const files: ProofInputs['manifest']['files'] = [];
  const required = new Set(
    [...declaration.files, ...declaration.implementation].map(normalizedProjectPath),
  );
  for (const candidate of paths) {
    const file = normalizedProjectPath(candidate);
    if (/(^|\/)\.env(?:\.|$)|credentials|private[-_]key/i.test(file)) {
      diagnostics.push('sensitive dependency: run-only');
      continue;
    }
    try {
      const hash = await contentHash(root, file);
      files.push({ file, hash });
      if (
        hash === null &&
        (required.has(file) || declaration.optionalFiles?.includes(file) !== true)
      )
        diagnostics.push(`missing dependency: ${file}`);
    } catch {
      diagnostics.push(`unresolved dependency: ${file}`);
    }
  }
  const environment: Record<string, string | null> = {};
  for (const [name, allowed] of Object.entries(declaration.environment ?? {})) {
    const value = process.env[name];
    if (
      /secret|token|password|credential|key/i.test(name) ||
      (value !== undefined && !allowed.includes(value))
    )
      diagnostics.push(`unmodelled environment: ${name}`);
    else environment[name] = value ?? null;
  }
  const runtime = {
    node: process.version,
    executable: await executableDigest,
    platform: process.platform,
    arch: process.arch,
  };
  const loadedImplementation = declaration.loadedImplementation ?? null;
  const checkerFiles = [
    ...new Set([
      ...declaration.implementation.map(normalizedProjectPath),
      ...membership.flatMap((entry) => entry.files),
    ]),
  ];
  const observedHashes = new Map<string, Set<string | null | undefined>>();
  for (const entry of files) {
    const hashes = observedHashes.get(entry.file) ?? new Set<string | null | undefined>();
    hashes.add(entry.hash);
    observedHashes.set(entry.file, hashes);
  }
  const generationValid =
    loadedImplementation === null ||
    (checkerFiles.length === Object.keys(loadedImplementation).length &&
      checkerFiles.every(
        (file) =>
          Object.hasOwn(loadedImplementation, file) &&
          observedHashes.get(file)?.has(loadedImplementation[file]) === true,
      ));
  if (!generationValid)
    diagnostics.push('loaded checker generation mismatch: fresh process required');
  const descriptor = Object.getOwnPropertyDescriptor(declaration, 'config');
  if (
    (descriptor === undefined && 'config' in declaration) ||
    (descriptor !== undefined &&
      (!('value' in descriptor) ||
        descriptor.enumerable !== true ||
        descriptor.configurable !== true ||
        descriptor.writable !== true))
  )
    throw new Error('PROOF_NON_CANONICAL_INPUT');
  const configValue: unknown = descriptor === undefined ? null : descriptor.value;
  const manifest = {
    files,
    membership,
    environment,
    runtime,
    config: { provided: descriptor !== undefined, value: configValue },
    loadedImplementation,
  };
  const currentReusable = diagnostics.length === 0;
  if (declaration.cacheability !== 'runtime-bound') diagnostics.push('explicit run-only policy');
  return {
    key: proofDigest({ version: 2, manifest, diagnostics, currentReusable }),
    manifest,
    cacheable: declaration.cacheability === 'runtime-bound' && currentReusable,
    currentReusable,
    generationValid,
    diagnostics,
  };
}
