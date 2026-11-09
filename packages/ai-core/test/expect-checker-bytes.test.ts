import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { shaOf } from '#lib/expect/evidence';

const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const packageRoot = path.resolve(import.meta.dirname, '..');
const roots: string[] = [];
const require = createRequire(import.meta.url);

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('preserves valid UTF-8 hashes while distinguishing replacement-character byte aliases', () => {
  for (const text of ['', 'plain\n', '\uFEFFBOM\r\n', 'Привет 🌍\n', 'a\rb\r\nc\n']) {
    expect(createHash('sha256').update(Buffer.from(text)).digest('hex')).toBe(shaOf(text));
  }
  const a = Buffer.from([0xff]);
  const b = Buffer.from([0xfe]);
  expect(a.toString('utf8')).toBe(b.toString('utf8'));
  expect(shaOf(a.toString('utf8'))).toBe(shaOf(b.toString('utf8')));
  expect(createHash('sha256').update(a).digest('hex')).not.toBe(
    createHash('sha256').update(b).digest('hex'),
  );
});

it('binds an actual loaded checker to copied dependency bytes, not their decoded aliases', async () => {
  const base = artifactPath(projectRoot, {
    kind: 'run',
    key: 'incremental-verification-final',
    name: 'checker-byte-fixtures-v6',
  });
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'loaded-'));
  roots.push(root);
  await cp(path.join(packageRoot, 'dist'), path.join(root, 'dist'), { recursive: true });
  await cp(path.join(packageRoot, 'package.json'), path.join(root, 'package.json'));
  await mkdir(path.join(root, 'node_modules'));
  for (const name of ['typescript', 'ajv']) {
    await symlink(
      path.dirname(require.resolve(`${name}/package.json`)),
      path.join(root, 'node_modules', name),
    );
  }
  const yaml = path.join(root, 'node_modules', 'yaml');
  await cp(path.dirname(require.resolve('yaml/package.json')), yaml, { recursive: true });
  const target = path.join(yaml, 'dist', 'index.js');
  const original = await readFile(target);
  await writeFile(
    target,
    Buffer.concat([
      original,
      Buffer.from('\n// byte-alias: '),
      Buffer.from([0xff]),
      Buffer.from('\n'),
    ]),
  );
  const script = path.join(root, 'probe.mjs');
  await writeFile(
    script,
    `import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
const target=${JSON.stringify(target)};
const {checkerGeneration,implementationBinding}=await import('./dist/lib/expect/proof.js');
const {criterionInventory}=await import('./dist/lib/expect/inventory.js');
const {sealVerdict,findImplementationVerdict}=await import('./dist/lib/expect/verdicts.js');
fs.writeFileSync(new URL('sample.expect.ts',import.meta.url),"import {it,expect} from 'vitest'; it('sample',()=>expect(1).toBe(1));");
const criterion=criterionInventory(${JSON.stringify(root)},'sample.expect.ts').criteria[0];
assert.ok(criterion?.complete);
const producer={adapter:'controlled-copy-byte-alias',complete:true,instructions:[],contract:'no IO or tools',diagnostics:[]};
const before=implementationBinding(criterion,'sample',[],producer);
assert.equal(before.complete,true);
const verdict=sealVerdict({question:'sample',evidence:{},verdict:true,quote:'synthetic',ref:'synthetic',reason:'controlled copied dependency',at:'2026-11-09',binding:before});
assert.ok(findImplementationVerdict({verdicts:{baseline:verdict},lint:{}},before));
const originalRead=fs.readFileSync;
let rawReads=0,rawBytes=0,decodedReads=0;
fs.readFileSync=(...args)=>{const result=originalRead(...args);if(Buffer.isBuffer(result)){rawReads++;rawBytes+=result.length;}else decodedReads++;return result;};
syncBuiltinESMExports();
const loaded=checkerGeneration();
assert.equal(loaded.valid,true);
fs.readFileSync=originalRead;
syncBuiltinESMExports();
assert.equal(rawReads,loaded.content.length);
assert.ok(rawBytes>0);
const a=fs.readFileSync(target);
const b=Buffer.from(a);
const index=b.lastIndexOf(0xff);
assert.ok(index>=0);
b[index]=0xfe;
assert.equal(a.toString('utf8'),b.toString('utf8'));
assert.equal(createHash('sha256').update(a.toString('utf8')).digest('hex'),createHash('sha256').update(b.toString('utf8')).digest('hex'));
fs.writeFileSync(target,b);
const current=checkerGeneration();
assert.equal(current.valid,false);
assert.notDeepEqual(current.content,loaded.content);
const after=implementationBinding(criterion,'sample',[],producer);
assert.equal(after.complete,false);
assert.notEqual(before.input,after.input);
assert.equal(findImplementationVerdict({verdicts:{baseline:verdict},lint:{}},after),undefined);
console.log(JSON.stringify({loadedValid:loaded.valid,currentValid:current.valid,oldProofReusable:false,rawReads,rawBytes,decodedReads,selectedFiles:loaded.content.length,oldDecodedHashCollision:true,newRawHashDifferent:true}));
`,
  );
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  const evidence = artifactPath(projectRoot, {
    kind: 'run',
    key: 'incremental-verification-final',
    name: `checker-byte-fixtures-v6/outcome-${randomUUID()}.json`,
  });
  await writeFile(
    evidence,
    JSON.stringify(
      { status: result.status, stdout: result.stdout, stderr: result.stderr },
      null,
      2,
    ),
  );
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('"oldProofReusable":false');
});
