import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { digestOf } from '#lib/local-store';
import { CONFIG_PATH, DEFAULT_CHANGELOG, loadConfig } from '#shared/config';
import { ensureProof } from '#lib/proof/runner';
import { beginOrJoinProofRun, joinProofRun, PROOF_TRANSPORT } from '#lib/proof/transport';
import type { CommandArgs } from '#shared/args';
import type { ProofRun } from '#lib/proof/model';

const checkerUrls = [
  import.meta.url,
  import.meta.resolve('#commands/changelog/lint'),
  import.meta.resolve('#commands/changelog/index'),
  import.meta.resolve('#registry'),
  import.meta.resolve('#shared/frontmatter'),
  import.meta.resolve('#shared/guards'),
  import.meta.resolve('#shared/report'),
  import.meta.resolve('#shared/config'),
  import.meta.resolve('#shared/diagnostics'),
  import.meta.resolve('#shared/layout'),
  import.meta.resolve('#lib/local-store'),
  import.meta.resolve('#lib/artifacts'),
];
const yamlDirectory = path.dirname(createRequire(import.meta.url).resolve('yaml/package.json'));
const proofDirectory = path.dirname(fileURLToPath(import.meta.url));

async function generationFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await generationFiles(file)));
    else if (entry.isFile()) files.push(file);
    else throw new Error('CHECKER_GENERATION_UNAVAILABLE');
  }
  return files;
}

async function captureCheckerGeneration() {
  const files = [
    ...new Set([
      ...checkerUrls.map((url) => fileURLToPath(url)),
      ...(await generationFiles(yamlDirectory)),
      ...(await generationFiles(proofDirectory)),
    ]),
  ].sort();
  return Promise.all(
    files.map(async (file) => {
      if (/(^|[\\/])\.env(?:\.|$)|credentials|private[-_]key/i.test(file))
        throw new Error('CHECKER_GENERATION_UNAVAILABLE');
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error('CHECKER_GENERATION_UNAVAILABLE');
      return {
        file,
        hash: digestOf({ mode: stat.mode, content: (await readFile(file)).toString('base64') }),
      };
    }),
  );
}

const loadedCheckerGeneration = captureCheckerGeneration().catch(() => null);

export async function commandProofRun(args: CommandArgs): Promise<ProofRun> {
  if (args.proofRun !== undefined) {
    const run = await joinProofRun(args.root, JSON.stringify(args.proofRun));
    if (args.force === true && !run.force) throw new Error('PROOF_POLICY_MISMATCH');
    return run;
  }
  const inherited = process.env[PROOF_TRANSPORT];
  if (inherited !== undefined) {
    const run = await joinProofRun(args.root, inherited);
    if (args.force === true && !run.force) throw new Error('PROOF_POLICY_MISMATCH');
    return run;
  }
  return beginOrJoinProofRun(args.root, {
    owner: 'native',
    scope: ['*'],
    force: args.force === true,
    allowJudge: false,
  });
}

export async function runRegisteredCommand(
  command: readonly string[],
  args: CommandArgs,
  execute: () => Promise<number>,
): Promise<number> {
  const run = await commandProofRun(args);
  const id = `command:${command.join(':')}`;
  if (command.join(' ') === 'changelog lint') {
    const config = await loadConfig(args.root);
    const options = config?.checks.changelog ?? DEFAULT_CHANGELOG;
    const implementation = checkerUrls.map((url) =>
      path.relative(args.root, fileURLToPath(url)).split(path.sep).join('/'),
    );
    const yaml = path.relative(args.root, yamlDirectory).split(path.sep).join('/');
    if ([...implementation, yaml].some((file) => file.split('/').includes('..'))) {
      console.log('proof changelog lint: run-only (checker outside project root)');
      return execute();
    }
    const generation = await loadedCheckerGeneration;
    if (generation === null) {
      console.error('proof changelog lint: checker generation unavailable; fresh process required');
      return 1;
    }
    const loadedImplementation = Object.fromEntries(
      generation.map(({ file, hash }) => [
        path.relative(args.root, file).split(path.sep).join('/'),
        hash,
      ]),
    );
    const receipt = await ensureProof(run, {
      id,
      declaration: {
        cacheability: 'runtime-bound',
        complete: !process.execArgv.some((argument) =>
          /^(?:--(?:import|require|loader|experimental-loader)(?:=|$)|-r)/.test(argument),
        ),
        files: ['CHANGELOG.md'],
        optionalFiles: [CONFIG_PATH, 'package-lock.json'],
        implementation,
        loadedImplementation,
        environment: { NODE_OPTIONS: [] },
        membership: [
          yaml,
          path
            .dirname(implementation[0] ?? '')
            .split(path.sep)
            .join('/'),
        ],
        config: { options, day: args.now.toISOString().slice(0, 10) },
      },
      execute: async () => {
        const code = await execute();
        return { status: code === 0 ? 'pass' : 'fail', code, diagnostics: [] };
      },
    });
    console.log(`proof changelog lint: ${receipt.origin} ${receipt.status}`);
    if (receipt.diagnostics.length > 0) console.error(receipt.diagnostics.join('; '));
    return receipt.code;
  }
  console.log(`proof ${command.join(' ')}: run-only (unmodelled command/effects)`);
  return execute();
}
