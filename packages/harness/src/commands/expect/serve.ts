import { createServer } from 'node:http';
import { UsageError } from '#shared/diagnostics';
import { errorMessage } from '#shared/guards';

export const DEFAULT_PORT = 4173;

export function portOf(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^\d+$/.test(value)) throw new UsageError(`--port — число: ${value}`);
  const port = Number.parseInt(value, 10);
  if (port > 65_535) throw new UsageError(`--port вне диапазона: ${value}`);
  return port;
}

export interface ServeOptions {
  root: string;
  port: number;
  render: () => Promise<string>;
}

const HOST = '127.0.0.1';

export function serveHtml(options: ServeOptions): Promise<number> {
  let inFlight: Promise<string> | undefined;
  const page = (): Promise<string> => {
    inFlight ??= options.render().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    if (req.method !== 'GET' || url.pathname !== '/') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('нет такой страницы: только /\n');
      return;
    }
    page().then(
      (html) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      },
      (error: unknown) => {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`ошибка отчёта: ${errorMessage(error)}\n`);
      },
    );
  });
  return new Promise((resolve, reject) => {
    const stop = () => {
      server.close(() => {
        resolve(0);
      });
      server.closeAllConnections();
    };
    server.on('error', reject);
    server.listen(options.port, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      console.log(`harness expect serve: http://${HOST}:${port}/ — ${options.root}`);
      console.log('страница собирается при каждом запросе; остановка — Ctrl+C');
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  });
}
