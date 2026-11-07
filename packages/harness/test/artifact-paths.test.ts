import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { main } from '@shahimat/cli';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'plan-artifact-path-'));
  await mkdir(path.join(root, '.opencode'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it('real plan-review dispatch rejects absolute/traversal/symlink sources before creating a skeleton', async () => {
  for (const file of [
    '../outside.expect.ts',
    path.join(root, 'absolute.expect.ts'),
    'C:\\outside.expect.ts',
  ])
    await expect(
      main(['plan-review', 'start', file, '--root', root, '--home', root]),
    ).rejects.toThrow();
  await symlink(tmpdir(), path.join(root, 'linked'));
  await expect(
    main([
      'plan-review',
      'start',
      'linked/forbidden-plan.expect.ts',
      '--root',
      root,
      '--home',
      root,
    ]),
  ).rejects.toThrow('ARTIFACT_SYMLINK');
});
