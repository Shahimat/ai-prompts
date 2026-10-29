import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { errorMessage, UsageError, type CommandArgs } from '@shahimat/ai-core';
import type { Session } from '#harnesses/core/store/session';
import { emit, readEvents } from './events.ts';
import { readText } from './files.ts';
import { answer, jobFile, pending, projectJobs } from './jobs.ts';
import { loadRegistry } from './machine.ts';
import { listWatches } from './watches.ts';

export const DEFAULT_OPS_PORT = 4180;
const HOST = '127.0.0.1';
const ARTIFACTS = [
  'task.md',
  'research.md',
  'plan.md',
  'diff',
  'verify.log',
  'review.md',
  'log.md',
  'progress.log',
  'feedback.md',
];

export function opsPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_OPS_PORT;
  if (!/^\d+$/.test(value) || Number.parseInt(value, 10) > 65_535)
    throw new UsageError(`--port — число до 65535: ${value}`);
  return Number.parseInt(value, 10);
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const page = (title: string, body: string, refresh: boolean): string =>
  [
    '<!doctype html>',
    '<html lang="ru"><head><meta charset="utf-8">',
    refresh ? '<meta http-equiv="refresh" content="15">' : '',
    `<title>${esc(title)}</title>`,
    '<style>body{font:14px/1.5 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem}',
    'pre{background:#f4f4f4;padding:.75rem;overflow:auto;white-space:pre-wrap}',
    '.q{color:#a40}.st{font-family:monospace}li{margin:.2rem 0}textarea{width:100%;min-height:5rem}</style>',
    '</head><body>',
    body,
    '</body></html>',
  ].join('\n');

export async function projectsOf(args: CommandArgs, home: string): Promise<string[]> {
  if (args.all !== true) return [path.resolve(args.root)];
  const registry = await loadRegistry(home);
  return registry.projects.length === 0 ? [path.resolve(args.root)] : registry.projects;
}

async function jobsBlock(home: string, root: string, index: number): Promise<string> {
  const jobs = await projectJobs(home, root);
  const items: string[] = [];
  for (const s of jobs) {
    const p = await pending(s);
    const asked =
      p !== undefined && p.answer === undefined ? ' <span class="q">ждёт ответа</span>' : '';
    items.push(
      `<li><a href="/job?p=${index}&id=${s.short}">${s.short}</a> <span class="st">${esc(s.data.state)}</span> — ${esc(s.data.title)}${asked}</li>`,
    );
  }
  const watches = (await listWatches(root)).map(
    (w) =>
      `<li>${w.id} — ${esc(w.interface)} «${esc(w.query)}», каждые ${w.every} мин${w.job === undefined ? '' : `, job ${w.job}`}</li>`,
  );
  return [
    `<h2>${esc(path.basename(root))}</h2>`,
    `<p>${esc(root)}</p>`,
    '<h3>Jobs</h3>',
    items.length === 0 ? '<p>нет</p>' : `<ul>${items.join('')}</ul>`,
    '<h3>Наблюдатели</h3>',
    watches.length === 0 ? '<p>нет</p>' : `<ul>${watches.join('')}</ul>`,
  ].join('\n');
}

export async function boardHtml(home: string, projects: readonly string[]): Promise<string> {
  const blocks = await Promise.all(projects.map((root, i) => jobsBlock(home, root, i)));
  const { events } = await readEvents(home, 0);
  const recent = events
    .filter((e) => projects.includes(e.project))
    .slice(-30)
    .reverse()
    .map(
      (e) =>
        `<li>${esc(e.at.slice(0, 16).replace('T', ' '))} <b>${esc(e.kind)}</b> ${e.job === undefined ? '' : esc(e.job)} — ${esc(e.text)}</li>`,
    );
  return page(
    'ops',
    ['<h1>ops</h1>', ...blocks, '<h2>События</h2>', `<ul>${recent.join('')}</ul>`].join('\n'),
    true,
  );
}

async function sessionOf(home: string, root: string, short: string): Promise<Session | undefined> {
  return (await projectJobs(home, root)).find((s) => s.short === short);
}

export async function jobHtml(s: Session, index: number): Promise<string> {
  const p = await pending(s);
  const runs = existsSync(jobFile(s, 'runs')) ? (await readdir(jobFile(s, 'runs'))).sort() : [];
  const files = ARTIFACTS.filter((a) => existsSync(jobFile(s, a)));
  const link = (name: string): string =>
    `<a href="/file?p=${index}&id=${s.short}&name=${encodeURIComponent(name)}">${esc(name)}</a>`;
  const form = (prompt: string): string =>
    `<form method="post" action="/answer"><input type="hidden" name="p" value="${index}"><input type="hidden" name="id" value="${s.short}"><p>${prompt}</p><textarea name="text"></textarea><p><button>Ответить</button></p></form>`;
  const gate = ['plan-gate', 'ready'].includes(s.data.state)
    ? form(
        s.data.state === 'plan-gate'
          ? 'План ок? «да» — дальше, иначе — замечание к плану'
          : 'Готово? «готово» — закрыть, иначе — доработка',
      )
    : '';
  const questions =
    p !== undefined && p.answer === undefined
      ? `<h3 class="q">Вопросы (${esc(p.state)})</h3><ol>${p.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>${form('Ответ одним текстом')}`
      : '';
  return page(
    `job ${s.short}`,
    [
      '<p><a href="/">← доска</a></p>',
      `<h1>${esc(s.data.title)}</h1>`,
      `<p>job ${s.short} · состояние <span class="st">${esc(s.data.state)}</span></p>`,
      questions,
      gate,
      '<h3>Артефакты</h3>',
      `<ul>${files.map((f) => `<li>${link(f)}</li>`).join('')}</ul>`,
      '<h3>Прогоны ролей</h3>',
      `<ul>${runs.map((r) => `<li>${link(`runs/${r}`)}</li>`).join('')}</ul>`,
      '<h3>Ход роли</h3>',
      `<pre>${esc(((await readText(jobFile(s, 'progress.log'))) ?? '').split('\n').slice(-40).join('\n'))}</pre>`,
      '<h3>Журнал</h3>',
      `<pre>${esc((await readText(jobFile(s, 'log.md'))) ?? '')}</pre>`,
    ].join('\n'),
    true,
  );
}

function safeName(name: string): boolean {
  return ARTIFACTS.includes(name) || /^runs\/[a-z0-9-]+\.jsonl$/.test(name);
}

async function body(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function send(res: ServerResponse, code: number, type: string, text: string): void {
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8` });
  res.end(text);
}

export async function handle(
  home: string,
  projects: readonly string[],
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const root = projects[Number.parseInt(url.searchParams.get('p') ?? '0', 10)] ?? projects[0] ?? '';
  const index = Math.max(0, projects.indexOf(root));
  if (req.method === 'GET' && url.pathname === '/')
    return send(res, 200, 'text/html', await boardHtml(home, projects));
  const s = await sessionOf(home, root, url.searchParams.get('id') ?? '');
  if (req.method === 'GET' && url.pathname === '/job' && s !== undefined)
    return send(res, 200, 'text/html', await jobHtml(s, index));
  if (req.method === 'GET' && url.pathname === '/file' && s !== undefined) {
    const name = url.searchParams.get('name') ?? '';
    if (!safeName(name)) return send(res, 400, 'text/plain', 'недопустимое имя файла');
    return send(res, 200, 'text/plain', (await readText(jobFile(s, name))) ?? '');
  }
  if (req.method === 'POST' && url.pathname === '/answer') {
    const form = await body(req);
    const target = await sessionOf(
      home,
      projects[Number.parseInt(form.get('p') ?? '0', 10)] ?? root,
      form.get('id') ?? '',
    );
    const text = (form.get('text') ?? '').trim();
    if (target === undefined || text === '')
      return send(res, 400, 'text/plain', 'нет job или пустой ответ');
    await answer(target, text);
    await emit(
      home,
      target.data.project,
      'answered',
      `ответ из дашборда — ai ticket-work open ${target.short}`,
      target.short,
    );
    res.writeHead(303, { location: `/job?p=${index}&id=${target.short}` });
    res.end();
    return;
  }
  send(res, 404, 'text/plain', 'нет такой страницы');
}

export async function serveBoard(args: CommandArgs, home: string): Promise<number> {
  const projects = await projectsOf(args, home);
  const port = opsPort(args.port);
  const server = createServer((req, res) => {
    handle(home, projects, req, res).catch((error: unknown) =>
      send(res, 500, 'text/plain', errorMessage(error)),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve());
  });
  console.log(`ops: http://${HOST}:${port}/ — Ctrl+C для выхода`);
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      server.close();
      resolve();
    });
    server.once('close', () => resolve());
  });
  return 0;
}
