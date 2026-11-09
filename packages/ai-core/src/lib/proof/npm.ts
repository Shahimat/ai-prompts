import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ensureProof } from '#lib/proof/runner';
import { proofDigest, resolveProofInputs } from '#lib/proof/inputs';
import { ordinaryDeclaration, BOUNDED_TEST, BOUNDED_CONFIG } from '#lib/proof/ordinary';
import { testArguments } from '#lib/proof/options';
import type { ProofDeclaration } from '#lib/proof/model';
import {
  beginProofRun,
  joinProofRun,
  PROOF_TRANSPORT,
  proofRunEnvironment,
} from '#lib/proof/transport';

const packageRoot = process.cwd();
const workspace = path.dirname(path.dirname(packageRoot));
const root = existsSync(path.join(workspace, 'package-lock.json')) ? workspace : packageRoot;
let selected: ReturnType<typeof testArguments>;
try {
  selected = testArguments(process.argv.slice(2));
} catch (error) {
  console.error(error);
  process.exit(2);
}
const inherited = process.env[PROOF_TRANSPORT];
const run =
  inherited === undefined
    ? await beginProofRun(root, {
        owner: 'native',
        scope: ['*'],
        force: selected.force,
        allowJudge: false,
      })
    : await joinProofRun(root, inherited);
if (selected.force && !run.force) throw new Error('PROOF_POLICY_MISMATCH');
const forwarded = selected.argv;
const vitest = path.join(
  path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);
const relativePackage = path.relative(root, packageRoot).split(path.sep).join('/');
const relative = (file: string) => (relativePackage === '' ? file : `${relativePackage}/${file}`);
const bounded = forwarded.length === 0 || (forwarded.length === 1 && forwarded[0] === BOUNDED_TEST);
const launch = async (argv: string[], controlled: boolean): Promise<number> =>
  new Promise((resolve, reject) => {
    const env =
      controlled && process.env['NODE_OPTIONS'] === undefined
        ? { [PROOF_TRANSPORT]: JSON.stringify(run) }
        : proofRunEnvironment(run);
    const child = spawn(process.execPath, [vitest, 'run', ...argv], {
      cwd: packageRoot,
      stdio: 'inherit',
      env,
    });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
let boundedDeclaration: ProofDeclaration | undefined;
if (bounded && process.env['NODE_OPTIONS'] !== undefined) {
  console.error(
    'proof vitest bounded-guards: run-only fallback — bounded eligibility unavailable: NODE_OPTIONS is defined; actual opaque execution',
  );
} else if (bounded) {
  try {
    const declaration = await ordinaryDeclaration(root, packageRoot);
    const inputs = await resolveProofInputs(root, declaration);
    if (inputs.currentReusable && inputs.generationValid) boundedDeclaration = declaration;
    else
      console.error(
        `proof vitest bounded-guards: run-only fallback — ${inputs.diagnostics.join('; ')}`,
      );
  } catch {
    console.error(
      'proof vitest bounded-guards: run-only fallback — attestation unavailable; actual opaque execution',
    );
  }
}

async function runBounded(declaration: ProofDeclaration): Promise<number> {
  let executions = 0;
  const receipt = await ensureProof(run, {
    id: 'npm:test:ai-core:bounded-guards',
    declaration,
    execute: async () => {
      executions++;
      const code = await launch(['--config', BOUNDED_CONFIG], true);
      return { status: code === 0 ? 'pass' : 'fail', code, diagnostics: [] };
    },
  });
  console.log(
    `proof vitest bounded-guards: ${receipt.origin} ${receipt.status}; executed ${executions}; reused ${receipt.status !== 'stale' && receipt.origin !== 'executed' ? 1 : 0}; needs-review ${receipt.status === 'stale' || !receipt.currentReusable ? 1 : 0}; failed ${receipt.status === 'fail' ? 1 : 0}`,
  );
  if (receipt.diagnostics.length > 0) console.error(receipt.diagnostics.join('; '));
  return receipt.code;
}
const exactBounded = forwarded.length === 1 && forwarded[0] === BOUNDED_TEST;
if (exactBounded && boundedDeclaration !== undefined)
  process.exitCode = await runBounded(boundedDeclaration);
else {
  let executions = 0;
  const receipt = await ensureProof(run, {
    id: exactBounded
      ? 'npm:test:ai-core:bounded-guards'
      : `npm:test:ai-core:${proofDigest(forwarded)}`,
    declaration: {
      cacheability: 'run-only',
      complete: false,
      diagnostics: [
        'unmodelled Vitest test dependencies/environment; preparation via pretest build',
      ],
      files: [relative('package.json'), relative('vitest.config.ts')],
      optionalFiles: ['package-lock.json'],
      implementation: [relative('src/lib/proof/npm.ts')],
      projectFiles: true,
      membership: [relative('src'), relative('test'), relative('dist')],
      config: { argv: forwarded },
    },
    execute: async () => {
      if (boundedDeclaration !== undefined) {
        const code = await runBounded(boundedDeclaration);
        if (code !== 0) return { status: 'fail', code, diagnostics: [] };
      }
      executions++;
      const code = await launch(
        boundedDeclaration === undefined ? forwarded : ['--exclude', BOUNDED_TEST, ...forwarded],
        false,
      );
      return { status: code === 0 ? 'pass' : 'fail', code, diagnostics: [] };
    },
  });
  console.log(
    `proof vitest: ${receipt.origin} ${receipt.status}; baseline run-only — unmodelled Vitest dependencies/environment; observation, not reusable freshness proof; executed ${executions}`,
  );
  if (receipt.status === 'stale') console.error(receipt.diagnostics.join('; '));
  process.exitCode = receipt.code;
}
