import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { isRecord } from '#shared/guards';
import { fixtureEnvironment } from './environment.ts';

const roots: string[] = [];
const pkgRoot = path.dirname(import.meta.dirname);
const require = createRequire(import.meta.url);

async function fixtureRoot(prefix: string): Promise<string> {
  const parent = path.join(import.meta.dirname, '.tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('окружение fixtures удаляет управляющие входы, сохраняет instrumentation и выбирает текущий Node', () => {
  const dirty = {
    FAKE_EXIT: '19',
    FAKE_NEW_CONTROL: 'synthetic',
    OC3_PROOF_TRANSPORT: 'synthetic-foreign-context',
    HARNESS_ROLE_TIMEOUT_MIN: '0.0001',
    HARNESS_EXPECT_ROOT: '/synthetic/foreign',
    GIT_DIR: '/synthetic/foreign',
    GIT_CONFIG_COUNT: '9',
    GIT_CONFIG_KEY_8: 'commit.gpgSign',
    GIT_CONFIG_VALUE_8: 'true',
    NODE_OPTIONS: '--trace-warnings',
    PATH: '/synthetic/bin',
  };
  const env = fixtureEnvironment(dirty);
  for (const key of [
    'FAKE_EXIT',
    'FAKE_NEW_CONTROL',
    'OC3_PROOF_TRANSPORT',
    'HARNESS_ROLE_TIMEOUT_MIN',
    'HARNESS_EXPECT_ROOT',
    'GIT_DIR',
    'GIT_CONFIG_KEY_8',
  ])
    expect(env[key]).toBeUndefined();
  expect(env['NODE_OPTIONS']).toBe(dirty.NODE_OPTIONS);
  expect(env['GIT_CONFIG_COUNT']).toBe('3');
  expect(env['GIT_CONFIG_VALUE_1']).toBe('false');
  expect(env['PATH']?.split(path.delimiter)[0]).toBe(path.dirname(process.execPath));
  expect(fixtureEnvironment(env)).toEqual(env);
  expect(dirty.FAKE_EXIT).toBe('19');
});

it('synthetic git игнорирует чужие hooks/signing/identity без записи глобального config', async () => {
  const root = await fixtureRoot('git with spaces-');
  const hooks = path.join(root, 'hooks');
  await mkdir(hooks);
  await writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 91\n');
  await chmod(path.join(hooks, 'pre-commit'), 0o755);
  const config = path.join(root, 'synthetic.gitconfig');
  const configText = `[core]\n hooksPath = "${hooks}"\n[commit]\n gpgSign = true\n[gpg]\n program = /nonexistent/synthetic-gpg\n`;
  await writeFile(config, configText);
  const env = fixtureEnvironment({
    ...process.env,
    GIT_CONFIG_GLOBAL: config,
    GIT_AUTHOR_NAME: '',
    GIT_AUTHOR_EMAIL: '',
    GIT_COMMITTER_NAME: '',
    GIT_COMMITTER_EMAIL: '',
  });
  for (const args of [
    ['init', '-q'],
    ['commit', '--allow-empty', '-qm', 'synthetic'],
  ]) {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    expect(result.status).toBe(0);
  }
  expect(await readFile(config, 'utf8')).toBe(configText);
});

it('npm test и prepublish готовят fresh compiled output из cold/stale source в альтернативном cwd', async () => {
  const manifest: unknown = JSON.parse(await readFile(path.join(pkgRoot, 'package.json'), 'utf8'));
  const scripts = isRecord(manifest) && isRecord(manifest['scripts']) ? manifest['scripts'] : {};
  expect(scripts['pretest']).toBe('npm run build');
  expect(scripts['test']).toBe('node --conditions=source src/lib/proof/npm.ts');
  expect(scripts['prepublishOnly']).toBe('npm run typecheck && npm test');
  const npm = process.env['npm_execpath'];
  if (npm === undefined) throw new Error('Запустите preparation regression через npm test');
  const root = await fixtureRoot('preparation with spaces-');
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'node_modules'));
  await symlink(
    path.dirname(require.resolve('typescript/package.json')),
    path.join(root, 'node_modules/typescript'),
    'dir',
  );
  await writeFile(
    path.join(root, 'tsconfig.build.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        outDir: 'dist',
        rootDir: 'src',
        types: [],
        skipLibCheck: true,
      },
      include: ['src'],
    }),
  );
  await writeFile(
    path.join(root, 'assert.mjs'),
    "import {readFileSync, existsSync} from 'node:fs'; import assert from 'node:assert/strict'; const {value}=await import('./dist/index.js'); assert.equal(value,readFileSync('expected','utf8')); assert.equal(existsSync('dist/obsolete.js'),false);\n",
  );
  const build = path.join(path.dirname(pkgRoot), 'build.ts');
  const tsc = require.resolve('typescript/bin/tsc');
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'synthetic-preparation',
      private: true,
      type: 'module',
      scripts: {
        ...scripts,
        build: `"${process.execPath}" "${build}"`,
        typecheck: `"${process.execPath}" "${tsc}" --noEmit -p tsconfig.build.json`,
        test: `"${process.execPath}" assert.mjs`,
      },
    }),
  );
  async function source(value: string): Promise<void> {
    await writeFile(
      path.join(root, 'src/index.ts'),
      `export const value = ${JSON.stringify(value)};\n`,
    );
    await writeFile(path.join(root, 'expected'), value);
  }
  const run = (args: string[]): void => {
    const result = spawnSync(process.execPath, [npm, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  };
  await source('cold');
  run(['test']);
  await writeFile(path.join(root, 'dist/obsolete.js'), 'throw new Error("stale");');
  await source('fresh');
  run(['run', 'prepublishOnly']);
  run(['test']);
  const harness: unknown = JSON.parse(
    await readFile(path.join(path.dirname(pkgRoot), 'harness/package.json'), 'utf8'),
  );
  if (!isRecord(harness) || !isRecord(harness['scripts'])) throw new Error('missing scripts');
  const workspace = await fixtureRoot('harness preparation with spaces-');
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ private: true, type: 'module', workspaces: ['packages/*'] }),
  );
  await writeFile(
    path.join(workspace, 'build.mjs'),
    "import {readFileSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';rmSync('dist',{recursive:true,force:true});mkdirSync('dist');writeFileSync('dist/index.js','export const value = '+JSON.stringify(readFileSync('marker','utf8'))+';');",
  );
  await writeFile(
    path.join(workspace, 'assert.mjs'),
    "import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';for(const name of ['ai-core','harness','cli']){const root=new URL('./packages/'+name+'/',import.meta.url);const {value}=await import(new URL('dist/index.js',root));assert.equal(value,readFileSync(new URL('marker',root),'utf8'));assert.equal(existsSync(new URL('dist/obsolete.js',root)),false);}",
  );
  for (const name of ['ai-core', 'harness', 'cli']) {
    const directory = path.join(workspace, 'packages', name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: `@shahimat/${name}`,
        private: true,
        type: 'module',
        scripts: {
          ...(name === 'harness' ? harness['scripts'] : {}),
          build: 'node ../../build.mjs',
          typecheck: 'node --version',
          test: 'node ../../assert.mjs',
        },
      }),
    );
    await writeFile(path.join(directory, 'marker'), 'cold');
  }
  for (const argv of [['test'], ['run', 'prepublishOnly']]) {
    const result = spawnSync(process.execPath, [npm, ...argv], {
      cwd: path.join(workspace, 'packages/harness'),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    for (const name of ['ai-core', 'harness', 'cli']) {
      const directory = path.join(workspace, 'packages', name);
      await writeFile(path.join(directory, 'marker'), 'fresh');
      await writeFile(path.join(directory, 'dist/obsolete.js'), 'throw new Error("stale");');
    }
  }
}, 30_000);
