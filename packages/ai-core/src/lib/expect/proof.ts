import { readFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { canonicalDigest, criterionInventory, type CriterionInput } from './inventory.ts';
import { isRecord, isStringArray } from '#shared/guards';
import { confinedProjectPath } from '#lib/artifacts';
import { readEvidence, shaOf } from './evidence.ts';

function checkerContent() {
  const extension = import.meta.filename.endsWith('.ts') ? '.ts' : '.js';
  const base = path.resolve(import.meta.dirname, '..', '..');
  const walk = (directory: string): { file: string; sha: string }[] =>
    readdirSync(path.join(base, directory), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((item) => {
        const file = `${directory}/${item.name}`;
        if (item.isDirectory()) return walk(file);
        return item.isFile() && item.name.endsWith(extension)
          ? [
              {
                file,
                sha: createHash('sha256')
                  .update(readFileSync(path.join(base, file)))
                  .digest('hex'),
              },
            ]
          : [];
      });
  const dependencies: { file: string; sha: string }[] = [];
  const visited = new Set<string>();
  const dependency = (name: string, from: string) => {
    const require = createRequire(from);
    const metadata = require.resolve(`${name}/package.json`);
    if (visited.has(metadata)) return;
    visited.add(metadata);
    const directory = path.dirname(metadata);
    const walkDependency = (folder: string) => {
      for (const item of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (item.name === 'node_modules') continue;
        const file = path.join(folder, item.name);
        if (/(^|[/\\])\.env(?:\.|$)|credentials|private[-_]key/i.test(file))
          throw new Error('PRIVATE_CHECKER_DEPENDENCY_UNAVAILABLE');
        if (item.isDirectory()) walkDependency(file);
        else if (item.isFile() && /\.(?:js|json)$/.test(item.name))
          dependencies.push({
            file: `dependency:${name}/${path.relative(directory, file).split(path.sep).join('/')}`,
            sha: createHash('sha256').update(readFileSync(file)).digest('hex'),
          });
        else if (item.isSymbolicLink()) throw new Error('UNATTESTED_CHECKER_DEPENDENCY');
      }
    };
    walkDependency(directory);
    const value: unknown = JSON.parse(readFileSync(metadata, 'utf8'));
    if (!isRecord(value)) throw new Error('INVALID_CHECKER_DEPENDENCY');
    if (isRecord(value['dependencies']))
      for (const child of Object.keys(value['dependencies']).sort()) dependency(child, metadata);
  };
  for (const name of ['typescript', 'yaml', 'ajv']) dependency(name, import.meta.filename);
  return [
    ...['lib', 'commands/expect', 'shared'].flatMap(walk),
    {
      file: 'package.json',
      sha: createHash('sha256')
        .update(readFileSync(path.join(base, '..', 'package.json')))
        .digest('hex'),
    },
    ...dependencies,
  ];
}

const loadedChecker = checkerContent();
const loadedCheckerDigest = canonicalDigest(loadedChecker);

export function checkerGeneration() {
  const current = checkerContent();
  return { content: current, valid: canonicalDigest(current) === loadedCheckerDigest };
}

export interface ProducerContext {
  adapter: string;
  complete: boolean;
  instructions: { name: string; text: string; present?: boolean }[];
  contract: string;
  diagnostics: string[];
}

export function isProducerContext(value: unknown): value is ProducerContext {
  return (
    isRecord(value) &&
    typeof value['adapter'] === 'string' &&
    typeof value['complete'] === 'boolean' &&
    typeof value['contract'] === 'string' &&
    isStringArray(value['diagnostics']) &&
    Array.isArray(value['instructions']) &&
    value['instructions'].every(
      (instruction) =>
        isRecord(instruction) &&
        typeof instruction['name'] === 'string' &&
        typeof instruction['text'] === 'string' &&
        (instruction['present'] === undefined || typeof instruction['present'] === 'boolean'),
    )
  );
}

export interface ImplementationBinding {
  version: 2;
  input: string;
  criterion: string;
  policy: string;
  complete: boolean;
  diagnostics: string[];
}

export function isImplementationBinding(value: unknown): value is ImplementationBinding {
  return (
    isRecord(value) &&
    value['version'] === 2 &&
    typeof value['input'] === 'string' &&
    typeof value['criterion'] === 'string' &&
    typeof value['policy'] === 'string' &&
    typeof value['complete'] === 'boolean' &&
    isStringArray(value['diagnostics'])
  );
}

export async function producerContext(root: string): Promise<ProducerContext> {
  const instructions: ProducerContext['instructions'] = [];
  for (const name of ['AGENTS.md', 'agents/judge.md', '.oc3/project.yml', 'manifest.json']) {
    try {
      instructions.push({
        name,
        text: await readFile(confinedProjectPath(root, name), 'utf8'),
        present: true,
      });
    } catch (error) {
      if (!isRecord(error) || error['code'] !== 'ENOENT') throw error;
      instructions.push({ name, text: '', present: false });
    }
  }
  return {
    adapter: 'askRole-uncontrolled-context-v2',
    complete: false,
    instructions,
    contract:
      'expect-implementation-v2; immutable evidence; no repository reads; answer envelope v2',
    diagnostics: ['producer effective inherited/system/tool context is not attested by askRole'],
  };
}

export function implementationBinding(
  criterion: CriterionInput | undefined,
  question: string,
  evidence: { ref: string; sha: string }[],
  producer: ProducerContext,
): ImplementationBinding {
  const checker = checkerGeneration();
  const policy = canonicalDigest({
    schema: 'implementation-answer-v2',
    selector: 'readEvidence-v2',
    checker,
    producer,
  });
  const diagnostics = [
    ...(criterion?.diagnostics ?? ['unresolved runtime registration']),
    ...producer.diagnostics,
  ];
  return {
    version: 2,
    criterion: criterion?.lineage ?? 'unresolved',
    policy,
    input: canonicalDigest({
      question,
      criterion: criterion?.input ?? null,
      source: implementationSource(criterion),
      evidence: evidence
        .map(({ ref, sha }) => ({ ref, sha }))
        .sort((a, b) => a.ref.localeCompare(b.ref)),
      policy,
    }),
    complete:
      criterion?.complete === true &&
      producer.complete &&
      checker.valid &&
      diagnostics.length === 0,
    diagnostics,
  };
}

export function implementationSource(criterion: CriterionInput | undefined): string {
  return criterion === undefined
    ? 'unresolved runtime registration'
    : JSON.stringify({
        file: criterion.file,
        intent: criterion.intent,
        body: criterion.body,
        dependencies: criterion.dependencies,
        diagnostics: criterion.diagnostics,
      });
}

export async function implementationContext(
  root: string,
  entry: string,
  question: string,
  refs: string[],
) {
  const inventory = criterionInventory(root, entry);
  const candidates = inventory.criteria.filter(
    (c) => c.intent.join(' ') === question || c.intent.join(' > ') === question,
  );
  const criterion = candidates.length === 1 ? candidates[0] : undefined;
  const evidence = await Promise.all(
    [...refs].sort().map(async (ref) => ({ ref, sha: shaOf(await readEvidence(ref, root)) })),
  );
  const binding = implementationBinding(criterion, question, evidence, await producerContext(root));
  return { binding, source: implementationSource(criterion), generation: inventory.generation };
}

export async function currentImplementation(
  root: string,
  entry: string,
  question: string,
  refs: string[],
): Promise<ImplementationBinding> {
  return (await implementationContext(root, entry, question, refs)).binding;
}

export const entryLeaseName = (entry: string): string =>
  `expect-${canonicalDigest(path.posix.normalize(entry))}`;
