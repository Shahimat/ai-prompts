import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { publishJson, syncDirectory } from '#lib/local-store';
import { historicalArtifactPath, migrateArtifacts } from '#lib/artifact-migration';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, open: vi.fn<typeof original.open>(original.open) };
});

const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let root: string;

function platform(value: NodeJS.Platform): void {
  const override: unknown = Object.create(process, { platform: { value } });
  vi.stubGlobal('process', override);
}

beforeEach(async () => {
  const parent = artifactPath(path.resolve(import.meta.dirname, '..', '..', '..'), {
    kind: 'run',
    key: 'ci-portability',
    name: 'fixtures',
  });
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, 'store-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(open).mockReset();
  await rm(root, { recursive: true, force: true });
});

it('Windows skips unsupported directory fsync without opening a directory handle', async () => {
  platform('win32');
  vi.mocked(open).mockRejectedValueOnce(new Error('EPERM: fsync'));
  await expect(syncDirectory(root)).resolves.toBeUndefined();
  expect(open).not.toHaveBeenCalled();
});

it.each(['linux', 'darwin'])(
  'directory fsync on %s closes the handle after success or failure',
  async (value) => {
    if (value !== 'linux' && value !== 'darwin') throw new Error('invalid platform');
    platform(value);
    const handle = await fs.open(path.join(root, 'handle'), 'wx');
    const sync = vi.spyOn(handle, 'sync').mockResolvedValue(undefined);
    const close = vi.spyOn(handle, 'close');
    vi.mocked(open).mockResolvedValueOnce(handle);
    await syncDirectory(root);
    expect(open).toHaveBeenCalledWith(root, 'r');
    expect(sync).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();

    const failed = await fs.open(path.join(root, 'failed-handle'), 'wx');
    const failure = new Error('EIO: fsync');
    vi.spyOn(failed, 'sync').mockRejectedValue(failure);
    const failedClose = vi.spyOn(failed, 'close');
    vi.mocked(open).mockResolvedValueOnce(failed);
    await expect(syncDirectory(root)).rejects.toBe(failure);
    expect(failedClose).toHaveBeenCalledOnce();
  },
);

it('POSIX directory open failures remain fatal', async () => {
  platform('linux');
  const failure = new Error('EACCES: directory');
  vi.mocked(open).mockRejectedValueOnce(failure);
  await expect(syncDirectory(root)).rejects.toBe(failure);
});

it.each([true, false])(
  'Windows JSON publication flushes file bytes and preserves immutable=%s semantics',
  async (immutable) => {
    platform('win32');
    let flushes = 0;
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await fs.open(...args);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        flushes++;
        await sync();
      });
      return handle;
    });
    const file = path.join(root, 'record.json');
    await publishJson(file, { generation: 1 }, immutable);
    expect(await readFile(file, 'utf8')).toBe('{\n  "generation": 1\n}\n');
    await publishJson(file, { generation: 1 }, immutable);
    const result = await publishJson(file, { generation: 2 }, immutable).then(
      () => null,
      (error: unknown) => error,
    );
    expect(result).toEqual(immutable ? new Error('IDEMPOTENCY_CONFLICT') : null);
    const record: unknown = JSON.parse(await readFile(file, 'utf8'));
    expect(record).toEqual({ generation: immutable ? 1 : 2 });
    expect(await readdir(root)).toEqual(['record.json']);
    expect(open).toHaveBeenCalledTimes(3);
    expect(flushes).toBe(3);
  },
);

it('Windows publication does not suppress file fsync failures', async () => {
  platform('win32');
  const failure = new Error('EIO: file fsync');
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await fs.open(...args);
    vi.spyOn(handle, 'sync').mockRejectedValue(failure);
    return handle;
  });
  const file = path.join(root, 'record.json');
  await expect(publishJson(file, { generation: 1 })).rejects.toBe(failure);
  await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('Windows migration uses writable file handles and the same directory sync policy', async () => {
  platform('win32');
  vi.mocked(open).mockImplementation(async (...args) => {
    if (args[1] === 'r') throw new Error('EPERM: read-only fsync handle');
    return await fs.open(...args);
  });
  await mkdir(path.join(root, '.ops'));
  await writeFile(path.join(root, '.ops/proof.json'), '{"synthetic":true}\n');
  expect((await migrateArtifacts(root)).moved).toBe(1);
  expect(await readFile(await historicalArtifactPath(root, '.ops/proof.json'), 'utf8')).toBe(
    '{"synthetic":true}\n',
  );
  expect(vi.mocked(open).mock.calls.some(([, flags]) => flags === 'r+')).toBe(true);
});
