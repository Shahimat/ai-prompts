import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isRecord } from '#shared/guards';
import { contentHash } from '#lib/local-store';
import { resolveProofInputs } from '#lib/proof/inputs';
import type { ProofDeclaration } from '#lib/proof/model';

export const BOUNDED_TEST = 'test/bounded-guards.test.ts';
export const BOUNDED_CONFIG = 'vitest.bounded.config.ts';

const approved: Record<string, string> = {
  'test/bounded-guards.test.ts': 'fdf654d504e93a6d866309183f886eeb374acad5ced9e06dc8bec7627ef7b29f',
  'vitest.bounded.config.ts': '66d98a0c9a8631840391d1634de02d50c27a47434083cf02b211b323df7c27b3',
  'src/shared/guards.ts': '95cbb2c71a7069ad8553e120de29608396617b43eb723e15d9bbcf106dcd8065',
  'tsconfig.json': '88098467c6ae4aa0e15558f644f32dc4442ba7dd5aee7ee53a9a6cf14617f989',
  'package.json': '6ad52081ed00f39e8b01197f2750d1915593d2f572dc8b75a5a5beef9a197e48',
};
const approvedRoot: Record<string, string> = {
  'tsconfig.base.json': '9ca0089519497c4b78ab5296aa79849fea1112ab816ae13783c4657fcf0e13a6',
  'package.json': '4a53b85053c865e5c7e4c03d317ee8f5d2682c3b939e8a925e828bf11ae200fd',
};

async function filesIn(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (/(^|[/\\])\.env(?:\.|$)|credentials|private[-_]key/i.test(file))
      throw new Error('PRIVATE_ORDINARY_DEPENDENCY_UNAVAILABLE');
    if (item.isDirectory()) files.push(...(await filesIn(file)));
    else if (item.isFile()) files.push(file);
    else throw new Error('UNMODELLED_ORDINARY_DEPENDENCY');
  }
  return files;
}

async function dependencyDirectories(packageRoot: string): Promise<string[]> {
  const directories = new Set<string>();
  const visit = async (directory: string): Promise<void> => {
    if (directories.has(directory)) return;
    directories.add(directory);
    const file = path.join(directory, 'package.json');
    const metadata: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!isRecord(metadata)) throw new Error('INVALID_ORDINARY_DEPENDENCY');
    const require = createRequire(file);
    const dependencies = isRecord(metadata['dependencies'])
      ? Object.keys(metadata['dependencies'])
      : [];
    const optional = isRecord(metadata['optionalDependencies'])
      ? Object.keys(metadata['optionalDependencies'])
      : [];
    const peers = isRecord(metadata['peerDependencies'])
      ? Object.keys(metadata['peerDependencies'])
      : [];
    const peerMeta = metadata['peerDependenciesMeta'];
    if (isRecord(peerMeta))
      for (const name of peers) {
        const item = peerMeta[name];
        if (isRecord(item) && item['optional'] === true) optional.push(name);
      }
    for (const name of new Set([...dependencies, ...optional, ...peers])) {
      let resolved: string;
      try {
        resolved = require.resolve(`${name}/package.json`);
      } catch {
        let entry: string;
        try {
          entry = require.resolve(name);
        } catch (error) {
          if (
            optional.includes(name) &&
            !(require.resolve.paths(name) ?? []).some((directory) =>
              existsSync(path.join(directory, name, 'package.json')),
            )
          )
            continue;
          throw error;
        }
        let candidate = path.dirname(entry);
        for (;;) {
          try {
            const value: unknown = JSON.parse(
              await readFile(path.join(candidate, 'package.json'), 'utf8'),
            );
            if (isRecord(value) && value['name'] === name) break;
          } catch {}
          const parent = path.dirname(candidate);
          if (parent === candidate) throw new Error('UNRESOLVED_ORDINARY_DEPENDENCY');
          candidate = parent;
        }
        resolved = path.join(candidate, 'package.json');
      }
      await visit(path.dirname(resolved));
    }
  };
  const require = createRequire(path.join(packageRoot, 'package.json'));
  await visit(path.dirname(require.resolve('vitest/package.json')));
  return [...directories].sort();
}

const adapterFile = fileURLToPath(import.meta.url);
const adapterBytes = readFile(adapterFile);
const codeRoot = path.resolve(import.meta.dirname, '..', '..');
const loadedCode = Promise.all(
  [
    ...(await filesIn(import.meta.dirname)),
    ...(await filesIn(path.join(codeRoot, 'shared'))),
    path.join(codeRoot, 'lib/local-store.ts'),
    path.join(codeRoot, 'lib/artifacts.ts'),
  ].map(async (file) => ({
    file,
    hash: await contentHash(codeRoot, path.relative(codeRoot, file).split(path.sep).join('/')),
  })),
);

export async function ordinaryDeclaration(
  root: string,
  packageRoot: string,
): Promise<ProofDeclaration> {
  const relative = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const source = (file: string) => relative(path.join(packageRoot, file));
  const diagnostics: string[] = [];
  const declarations = Object.keys(approved);
  for (const file of declarations) {
    const text = await readFile(path.join(packageRoot, file));
    if (createHash('sha256').update(text).digest('hex') !== approved[file])
      diagnostics.push(`unattested bounded source: ${file}`);
  }
  for (const [file, expected] of Object.entries(approvedRoot)) {
    if (
      createHash('sha256')
        .update(await readFile(path.join(root, file)))
        .digest('hex') !== expected
    )
      diagnostics.push(`unattested bounded root configuration: ${file}`);
  }
  if (!(await adapterBytes).equals(await readFile(adapterFile)))
    diagnostics.push('loaded ordinary adapter generation mismatch');
  if (
    process.execArgv.some(
      (argument) => !['--conditions=source', '--experimental-strip-types'].includes(argument),
    )
  )
    diagnostics.push('unattested parent runtime flags');
  let membership: string[] = [];
  try {
    membership = (await dependencyDirectories(packageRoot)).map(relative);
    if (membership.some((directory) => directory.split('/').includes('..')))
      throw new Error('EXTERNAL_ORDINARY_DEPENDENCY');
  } catch {
    diagnostics.push('unresolved Vitest runtime dependency closure');
    membership = [];
  }
  const declaration: ProofDeclaration = {
    cacheability: 'runtime-bound',
    complete: diagnostics.length === 0,
    diagnostics,
    files: [...declarations.map(source), 'package.json', 'tsconfig.base.json', 'package-lock.json'],
    implementation: (await loadedCode).map((item) => relative(item.file)),
    membership,
    environment: { NODE_OPTIONS: [] },
    config: {
      contract: 'reviewed-pure-guards-v1',
      config: BOUNDED_CONFIG,
      test: BOUNDED_TEST,
      childEnvironment:
        'only authenticated run transport and inherited NODE_OPTIONS; no arbitrary env/CLI inputs',
    },
  };
  const inputs = await resolveProofInputs(root, declaration);
  const members = inputs.manifest.membership.flatMap((directory) => directory.files);
  const checker = new Map((await loadedCode).map((item) => [relative(item.file), item.hash]));
  const resolved = new Map(inputs.manifest.files.map((item) => [item.file, item.hash]));
  const seal: Record<string, string> = {};
  for (const file of new Set([...declaration.implementation, ...members])) {
    const hash = checker.get(file) ?? resolved.get(file);
    if (hash === null || hash === undefined) throw new Error('UNAVAILABLE_ORDINARY_CHECKER');
    seal[file] = hash;
  }
  declaration.loadedImplementation = seal;
  return declaration;
}
