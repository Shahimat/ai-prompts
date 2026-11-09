import { spawn } from 'node:child_process';
import { watch, lstatSync, readdirSync, type FSWatcher } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { cliCommand } from '#lib/role';
import { UsageError } from '#shared/diagnostics';
import { errorMessage } from '#shared/guards';
import { ARTIFACT_IGNORE_LINES } from '#lib/artifacts';

export const DEFAULT_PORT = 4173;

export function portOf(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^\d+$/.test(value)) throw new UsageError(`--port — число: ${value}`);
  const port = Number.parseInt(value, 10);
  if (port > 65_535) throw new UsageError(`--port вне диапазона: ${value}`);
  return port;
}

const HOST = '127.0.0.1';
const DEBOUNCE_MS = 300;
const IGNORED =
  /(^|[\\/])\.git([\\/]|$)|(^|[\\/])node_modules[\\/](?:\.vite(?:-temp)?|\.cache)([\\/]|$)/;

export const ignoredWatchPath = (file: string): boolean =>
  IGNORED.test(file) ||
  ARTIFACT_IGNORE_LINES.some(
    (directory) =>
      file.replaceAll('\\', '/') === directory.slice(0, -1) ||
      file.replaceAll('\\', '/').startsWith(directory),
  );

function watchMembers(root: string, directory = ''): string[] {
  const files: string[] = [];
  for (const item of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = directory === '' ? item.name : `${directory}/${item.name}`;
    if (ignoredWatchPath(file)) continue;
    if (item.isDirectory()) files.push(...watchMembers(root, file));
    else files.push(file);
  }
  return files.sort();
}

export const RELOAD_SCRIPT = `<script>
(() => {
  const key = 'harness-serve-scroll:' + location.pathname;
  const saved = sessionStorage.getItem(key);
  if (saved !== null) { sessionStorage.removeItem(key); window.scrollTo(0, Number(saved)); }
  const events = new EventSource('/events');
  events.onmessage = (e) => {
    if (e.data !== 'reload') return;
    sessionStorage.setItem(key, String(window.scrollY));
    location.reload();
  };
})();
</script>`;

export const withReload = (html: string): string =>
  html.replace('</body>', `${RELOAD_SCRIPT}\n</body>`);

export function renderInChild(root: string, entry: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const [bin = process.execPath, ...pre] = cliCommand();
    const child = spawn(bin, [...pre, 'expect', 'report', entry, '--root', root, '--html', '-'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (out.startsWith('<!doctype html>'))
        resolve(
          out.replace(
            '</head>',
            `<meta name="expect-status" content="${code === 0 ? 'pass' : 'needs-review'}"></head>`,
          ),
        );
      else reject(new Error(err.trim() === '' ? 'отчёт не собран' : err.trim().slice(0, 800)));
    });
  });
}

export interface ServeOptions {
  root: string;
  port: number;
  render: () => Promise<string>;
}

export function serveHtml(options: ServeOptions): Promise<number> {
  let inFlight: Promise<string> | undefined;
  let revision = 0;
  const page = (): Promise<string> => {
    const generation = revision;
    inFlight ??= options
      .render()
      .then((html) => {
        if (generation !== revision)
          throw new Error('STALE_EXPECT_PAGE: source changed while rendering');
        return html;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
  const clients = new Set<ServerResponse>();
  let last: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  const refresh = () => {
    page().then(
      (html) => {
        if (last !== undefined && html !== last)
          for (const c of clients) c.write('data: reload\n\n');
        last = html;
      },
      () => {
        last = undefined;
        for (const c of clients) c.write('data: reload\n\n');
      },
    );
  };
  let watcher: FSWatcher | undefined;
  try {
    let members = new Set(watchMembers(options.root));
    watcher = watch(options.root, { recursive: true }, (_event, file) => {
      if (file !== null && ignoredWatchPath(file)) return;
      let directory: string | undefined;
      const relative = file?.replaceAll('\\', '/');
      if (relative === undefined) directory = '';
      else {
        try {
          if (lstatSync(path.join(options.root, relative)).isDirectory()) directory = relative;
        } catch {
          if (
            relative === path.basename(options.root) ||
            [...members].some((member) => member.startsWith(`${relative}/`))
          )
            directory = relative === path.basename(options.root) ? '' : relative;
        }
      }
      if (directory !== undefined) {
        const prefix = directory === '' ? '' : `${directory}/`;
        const previous = [...members].filter((member) => member.startsWith(prefix));
        let current: string[];
        try {
          current = watchMembers(options.root, directory);
        } catch {
          current = [];
        }
        const changed =
          previous.length !== current.length || current.some((member) => !members.has(member));
        members = new Set(
          [...members].filter((member) => !member.startsWith(prefix)).concat(current),
        );
        if (!changed) return;
      } else if (relative !== undefined) members.add(relative);
      revision++;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(refresh, DEBOUNCE_MS);
    });
  } catch (error) {
    console.error(`слежение за файлами недоступно: ${errorMessage(error)}`);
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': подключено\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method !== 'GET' || url.pathname !== '/') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('нет такой страницы: только /\n');
      return;
    }
    page().then(
      (html) => {
        last = html;
        const pending = !html.includes('<meta name="expect-status" content="pass">');
        res.writeHead(pending ? 503 : 200, {
          'content-type': 'text/html; charset=utf-8',
          'x-expect-status': pending ? 'needs-review' : 'pass',
        });
        res.end(withReload(html));
      },
      (error: unknown) => {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`ошибка отчёта: ${errorMessage(error)}\n`);
      },
    );
  });
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': пульс\n\n');
  }, 15_000);
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearInterval(heartbeat);
      if (timer !== undefined) clearTimeout(timer);
      watcher?.close();
      for (const c of clients) c.end();
      server.close(() => {
        resolve(0);
      });
      server.closeAllConnections();
    };
    server.on('error', reject);
    server.listen(options.port, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      console.log(`ai expect serve: http://${HOST}:${port}/ — ${path.resolve(options.root)}`);
      console.log(
        'страница собирается при каждом запросе и обновляется сама при изменении файлов; остановка — Ctrl+C',
      );
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  });
}
