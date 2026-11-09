import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { artifactPath } from '#lib/artifacts';
import { serveHtml } from '#commands/expect/serve';

it('serve ignores runtime outputs but reloads a formerly passing page when semantic regeneration fails', async () => {
  const project = path.resolve(import.meta.dirname, '..', '..', '..');
  const parent = artifactPath(project, {
    kind: 'run',
    key: 'incremental-expectations-cli',
    name: 'fixtures',
  });
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'serve-freshness-'));
  await mkdir(path.join(root, '.oc3/reports'), { recursive: true });
  let ready: ((url: string) => void) | undefined;
  const listening = new Promise<string>((resolve) => {
    ready = resolve;
  });
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(parts.join(' '))?.[0];
    if (url !== undefined) ready?.(url);
  });
  let calls = 0;
  let mode = 'pass';
  const running = serveHtml({
    root,
    port: 0,
    render: async () => {
      calls++;
      if (mode === 'fail') throw new Error('new generation failed');
      return `<!doctype html><head>${mode === 'pass' ? '<meta name="expect-status" content="pass">' : ''}</head><body>synthetic</body>`;
    },
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const url = await listening;
    expect((await fetch(url)).status).toBe(200);
    const events = await fetch(`${url}events`);
    reader = events.body?.getReader();
    if (reader === undefined) throw new Error('no event stream');
    await reader.read();
    await writeFile(path.join(root, '.oc3/reports/log.json'), '{}');
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(calls).toBe(1);
    mode = 'fail';
    await writeFile(path.join(root, '.oc3/project.yml'), 'name: changed-generation\n');
    const event = await reader.read();
    expect(new TextDecoder().decode(event.value)).toContain('data: reload');
    expect((await fetch(url)).status).toBe(500);
    mode = 'unknown';
    const unknown = await fetch(url);
    expect(unknown.status).toBe(503);
    expect(unknown.headers.get('x-expect-status')).toBe('needs-review');
  } finally {
    await reader?.cancel();
    process.emit('SIGINT');
    await running;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
