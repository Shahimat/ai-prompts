import { spawn } from 'node:child_process';

export interface PlanPage {
  url: string;
  stop: () => Promise<void>;
}

const URL_LINE = /http:\/\/127\.0\.0\.1:\d+\//;
const START_MS = 20_000;

export function openerFor(url: string): string[] | undefined {
  const browser = process.env['BROWSER'];
  if (browser === 'none') return undefined;
  if (browser !== undefined && browser !== '') return [browser, url];
  if (process.platform === 'darwin') return ['open', url];
  if (process.platform === 'win32') return ['cmd', '/c', 'start', '', url];
  return ['xdg-open', url];
}

function openBrowser(url: string): void {
  const [cmd, ...rest] = openerFor(url) ?? [];
  if (cmd === undefined) return;
  const child = spawn(cmd, rest, { stdio: 'ignore', detached: true });
  child.on('error', () => undefined);
  child.unref();
}

export function servePage(self: string[], root: string, file: string): Promise<PlanPage> {
  const [bin = process.execPath, ...pre] = self;
  const child = spawn(bin, [...pre, 'expect', 'serve', file, '--root', root, '--port', '0'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill();
    await exited;
  };
  return new Promise<PlanPage>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      void stop();
      reject(new Error(`expect serve не напечатал адрес за ${START_MS / 1000} с`));
    }, START_MS);
    const onData = (d: Buffer): void => {
      out += d.toString('utf8');
      const url = URL_LINE.exec(out)?.[0];
      if (url === undefined) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stdout.resume();
      openBrowser(url);
      resolve({ url, stop });
    };
    child.stdout.on('data', onData);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`expect serve завершился с кодом ${String(code)}: ${out.trim()}`));
    });
  });
}
