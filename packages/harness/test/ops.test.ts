import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '@shahimat/cli';
import { isRecord } from '@shahimat/ai-core';
import { openSession, listSessions } from '#harnesses/core/store/session';
import {
  briefLines,
  handle,
  launchdPlist,
  loadLimits,
  loadProvider,
  parseTaskMarkdown,
  systemdUnits,
} from '#harnesses/core/index';
import { parseVerdicts, quoted } from '#harnesses/ticket-work/index';
import { FAKE_OPS_CLAUDE, result } from './fake-ops-claude.ts';

const NOW = new Date('2026-10-29T12:00:00Z');
const LATER = new Date('2026-10-29T12:03:00Z');

let root: string;
let home: string;
let out: string[];

async function put(rel: string, content: string, base = root): Promise<void> {
  await mkdir(path.dirname(path.join(base, rel)), { recursive: true });
  await writeFile(path.join(base, rel), content, 'utf8');
}

const read = (rel: string, base = root): Promise<string> => readFile(path.join(base, rel), 'utf8');
const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

const roleFile = (name: string): string =>
  `---\nname: ${name}\ndescription: Тестовая роль ${name} для проверки ops\nmodel: sonnet\noutput: result\n---\n\nИнструкции роли ${name}.\n`;

const TASK = [
  '# Добавить приветствие',
  '',
  'Текст задачи https://example.invalid/t1',
  '',
  '## Definition of Done',
  '',
  '- [ ] README содержит hello world',
  '',
].join('\n');

const OK_REVIEW = result('- [ok] README содержит hello world — README.md:1 «hello world»');

function byRole(plan: Record<string, unknown>): void {
  vi.stubEnv('FAKE_BY_ROLE', JSON.stringify(plan));
}

async function project(): Promise<void> {
  await put('README.md', 'hello world\n');
  await put('tasks/t1.md', TASK);
  await put('context/ops.yml', 'verify:\n  - node -e "process.exit(0)"\n');
  for (const r of ['researcher', 'implementer', 'reviewer', 'watch-triage', 'watch-request'])
    await put(`.agents/agents/${r}.md`, roleFile(r));
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
}

async function job(): Promise<{ id: string; short: string }> {
  const s = (await listSessions(home)).find((x) => x.data.harness === 'ticket-work');
  if (s === undefined) throw new Error('нет job');
  return { id: s.id, short: s.short };
}

const stateOf = async (): Promise<string> => (await openSession(home, (await job()).id)).data.state;

async function events(): Promise<{ kind: string; text: string }[]> {
  const file = path.join(home, 'ops', 'events.jsonl');
  if (!existsSync(file)) return [];
  return (await readFile(file, 'utf8'))
    .split('\n')
    .filter((l) => l !== '')
    .map((l): unknown => JSON.parse(l))
    .filter(isRecord)
    .map((e) => ({ kind: String(e['kind']), text: String(e['text']) }));
}

const run = (words: string[], now = NOW): Promise<number> =>
  main([...words, '--root', root, '--home', home], now);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ops-'));
  await mkdir(path.join(root, '.claude'));
  home = await mkdtemp(path.join(tmpdir(), 'ops-home-'));
  const fake = path.join(home, 'fake-claude.mjs');
  await writeFile(fake, FAKE_OPS_CLAUDE, 'utf8');
  vi.stubEnv('HARNESS_CLAUDE', fake);
  vi.stubEnv('FAKE_COUNTS', path.join(home, 'counts.json'));
  vi.stubEnv('FAKE_ARGS', path.join(home, 'args.jsonl'));
  vi.stubEnv('HARNESS_OPS_POLL_MS', '20');
  vi.stubEnv('HARNESS_OPS_BACKOFF_S', '0');
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    out.push(args.join(' '));
  });
  await project();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  const worktrees = path.join(home, 'ops', 'worktrees');
  if (existsSync(worktrees)) git('worktree', 'prune');
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe('ticket-work: путь задачи', () => {
  it('start → план ждёт «да» → правка, проверка, ревью → ready ждёт «готово» → done', async () => {
    byRole({
      researcher: { submit: result('исследование') },
      implementer: { submit: result('сделано') },
      reviewer: { submit: OK_REVIEW },
    });
    expect(await run(['ticket-work', 'start', 'tasks/t1.md'])).toBe(0);
    expect(await stateOf()).toBe('plan-gate');
    const { short, id } = await job();
    const dir = path.join(root, '.ops', 'jobs', short);
    expect(await read('task.md', dir)).toContain('- README содержит hello world');
    expect((await readdir(path.join(dir, 'runs'))).sort()).toEqual([
      'plan-1.jsonl',
      'research-1.jsonl',
    ]);
    expect(await read('runs/research-1.jsonl', dir)).toContain('"type":"result"');

    expect(await main(['ticket-work', 'answer', short, 'да', '--home', home], NOW)).toBe(0);
    expect(await stateOf()).toBe('ready');
    expect(await read('review.md', dir)).toContain('[ok] README содержит hello world');
    expect(await read('verify.log', dir)).toContain('код 0');
    const meta: unknown = JSON.parse(await read('job.json', dir));
    const workdir = isRecord(meta) ? String(meta['workdir']) : '';
    expect(existsSync(path.join(workdir, 'README.md'))).toBe(true);
    const implement = (await readFile(path.join(home, 'args.jsonl'), 'utf8'))
      .split('\n')
      .filter((l) => l.includes('"role":"implementer"'))
      .at(-1);
    expect(implement).toContain('--add-dir');

    expect(await main(['ticket-work', 'status', id.slice(0, 7), '--home', home], NOW)).toBe(0);
    expect(await main(['ticket-work', 'list', '--home', home], NOW)).toBe(0);
    expect(out.join('\n')).toContain(`${short}\tready`);
    expect(await main(['ticket-work', 'answer', short, 'готово', '--home', home], NOW)).toBe(0);
    expect(await stateOf()).toBe('done');
    expect(existsSync(workdir)).toBe(false);
    const kinds = (await events()).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['question', 'ready', 'done', 'suggest']));
    expect(await main(['ticket-work', 'open', short, '--home', home], NOW)).toBe(0);
  });

  it('вопросы роли: пауза, ответ попадает в задание повторного прогона', async () => {
    byRole({
      researcher: [{ submit: result('', ['Какой стиль приветствия?']) }, { submit: result('ок') }],
      implementer: { submit: result('план') },
    });
    expect(await run(['ticket-work', 'start', 'tasks/t1.md'])).toBe(0);
    expect(await stateOf()).toBe('research');
    const { short } = await job();
    expect((await briefLines(home, root)).join('\n')).toContain(`${short} research ?`);
    expect(await main(['ticket-work', 'open', short, '--home', home], NOW)).toBe(0);
    expect(await stateOf()).toBe('research');
    expect(await main(['ticket-work', 'answer', short, 'кратко', '--home', home], NOW)).toBe(0);
    expect(await stateOf()).toBe('plan-gate');
    const second = (await readFile(path.join(home, 'args.jsonl'), 'utf8'))
      .split('\n')
      .filter((l) => l.includes('"role":"researcher"'))
      .at(-1);
    expect(second).toContain('Ответ пользователя: кратко');
  });

  it('замечание к плану — новый план; ready с доработкой — снова implement', async () => {
    byRole({
      researcher: { submit: result('и') },
      implementer: { submit: result('п') },
      reviewer: { submit: OK_REVIEW },
    });
    await run(['ticket-work', 'start', 'tasks/t1.md']);
    const { short } = await job();
    await main(['ticket-work', 'answer', short, 'добавь тест', '--home', home], NOW);
    expect(await stateOf()).toBe('plan-gate');
    expect(await read(`.ops/jobs/${short}/plan-remark.md`)).toContain('добавь тест');
    await main(['ticket-work', 'answer', short, 'да', '--home', home], NOW);
    expect(await stateOf()).toBe('ready');
    await main(['ticket-work', 'answer', short, 'переименуй функцию', '--home', home], NOW);
    expect(await stateOf()).toBe('ready');
    expect(await read(`.ops/jobs/${short}/feedback-1.md`)).toContain('переименуй функцию');
  });

  it('DoD изменился в источнике — вопрос; «нет» — ревью по прежнему DoD', async () => {
    byRole({
      researcher: { submit: result('и') },
      implementer: { submit: result('п') },
      reviewer: { submit: OK_REVIEW },
    });
    await run(['ticket-work', 'start', 'tasks/t1.md']);
    const { short } = await job();
    await put('tasks/t1.md', TASK.replace('README содержит hello world', 'есть тест'));
    await main(['ticket-work', 'answer', short, 'да', '--home', home], NOW);
    expect(await stateOf()).toBe('review');
    await main(['ticket-work', 'answer', short, 'нет', '--home', home], NOW);
    expect(await stateOf()).toBe('ready');
    expect(await read(`.ops/jobs/${short}/dod-previous.md`)).toContain(
      'README содержит hello world',
    );
    const reviewer = (await readFile(path.join(home, 'args.jsonl'), 'utf8'))
      .split('\n')
      .filter((l) => l.includes('"role":"reviewer"'))
      .at(-1);
    expect(reviewer).toContain('по прежнему DoD');
  });

  it('лимит модели: очередь на паузе, событие rate-limit, работа продолжается', async () => {
    byRole({
      researcher: [{ error: 'API Error: 429 rate limit exceeded' }, { submit: result('и') }],
      implementer: { submit: result('п') },
    });
    expect(await run(['ticket-work', 'start', 'tasks/t1.md'])).toBe(0);
    expect(await stateOf()).toBe('plan-gate');
    expect((await events()).map((e) => e.kind)).toContain('rate-limit');
  });

  it('validate и graph: автомат пригоден', async () => {
    expect(await main(['ticket-work', 'validate', '--home', home], NOW)).toBe(0);
    expect(await main(['ticket-work', 'graph', '--home', home], NOW)).toBe(0);
    expect(out.join('\n')).toContain('plan-gate --> implement: approved');
  });

  it('ревью: ok без дословной цитаты не засчитывается', async () => {
    expect(
      parseVerdicts('- [ok] пункт — README.md:1 «hello world»\n- [fail] другое — нет теста'),
    ).toEqual([
      { status: 'ok', item: 'пункт', evidence: 'README.md:1 «hello world»' },
      { status: 'fail', item: 'другое', evidence: 'нет теста' },
    ]);
    expect(await quoted(root, 'README.md:1 «hello   world»')).toBe(true);
    expect(await quoted(root, 'README.md:1 «hello moon»')).toBe(false);
    expect(await quoted(root, '../x:1 «a»')).toBe(false);
  });
});

describe('ops: оператор', () => {
  it('brief, status и wait: сводка до 20 строк, события двигают курсор', async () => {
    byRole({ researcher: { submit: result('', ['вопрос?']) } });
    await run(['ticket-work', 'start', 'tasks/t1.md']);
    const { short } = await job();
    out = [];
    expect(await run(['ops', 'brief'])).toBe(0);
    expect(out[0]).toContain('jobs 1 · ждут ответа 1');
    expect(out.length).toBeLessThanOrEqual(20);
    expect(await run(['ops', 'status'])).toBe(0);
    expect(out.join('\n')).toContain(`.ops/jobs/${short}`);
    out = [];
    expect(await run(['ops', 'wait', '--timeout', '0'])).toBe(0);
    expect(out.join('\n')).toContain('question');
    out = [];
    expect(await run(['ops', 'wait', '--timeout', '0'])).toBe(0);
    expect(out.join('\n')).toContain('событий нет');
    await expect(run(['ops', 'wait', '--timeout', 'x'])).rejects.toThrow('--timeout');
  });
});

const REVIEW_PROVIDER = `import { appendFileSync, readFileSync } from 'node:fs';
export default {
  interface: 'review',
  name: 'fake',
  poll: async () => JSON.parse(readFileSync(process.env.FAKE_REVIEW, 'utf8')),
  comment: async (id, text) => appendFileSync(process.env.FAKE_REVIEW_LOG, 'comment ' + id + ' ' + text + '\\n'),
  approve: async (id, text) => appendFileSync(process.env.FAKE_REVIEW_LOG, 'approve ' + id + ' ' + text + '\\n'),
};
`;

const SCHEDULE_PROVIDER = `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const log = () => process.env.FAKE_SCHEDULE;
export default {
  interface: 'schedule',
  name: 'fake',
  install: async (unit) => { writeFileSync(log() + '.state', 'active'); appendFileSync(log(), 'install ' + unit.command.join(' ') + ' ' + unit.every + '\\n'); },
  remove: async (name) => { writeFileSync(log() + '.state', 'absent'); appendFileSync(log(), 'remove ' + name + '\\n'); },
  status: async () => existsSync(log() + '.state') ? readFileSync(log() + '.state', 'utf8') : 'absent',
};
`;

describe('ops: что работает сейчас', () => {
  it('status показывает работающую роль, её job, время и последний шаг из журнала', async () => {
    const transcript = path.join(home, 'runs', 'research-1.jsonl');
    await put(
      'runs/research-1.jsonl',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep"}]}}\n',
      home,
    );
    await put(
      'ops/slots/jobs-0.json',
      JSON.stringify({
        pid: process.pid,
        token: 't',
        role: 'researcher',
        project: path.resolve(root),
        job: 'abc1234',
        started: new Date(NOW.getTime() - 4 * 60_000).toISOString(),
        transcript,
      }),
      home,
    );
    out = [];
    expect(await run(['ops', 'status'])).toBe(0);
    expect(out[0]).toBe(
      `работает researcher · abc1234 · 4 мин · последний шаг: Grep · ${transcript}`,
    );
    expect((await briefLines(home, root))[0]).toContain('ролей в работе 1');
  });
});

describe('ops: наблюдатели', () => {
  beforeEach(async () => {
    await put('providers/review/fake.mjs', REVIEW_PROVIDER, home);
    await put('providers/schedule/fake.mjs', SCHEDULE_PROVIDER, home);
    await put('context/ops.yml', 'providers:\n  review: fake\n  schedule: fake\n');
    await put('context/autonomy.yml', 'levels:\n  self: [review.approve]\n');
    vi.stubEnv('FAKE_REVIEW', path.join(home, 'review.json'));
    vi.stubEnv('FAKE_REVIEW_LOG', path.join(home, 'review.log'));
    vi.stubEnv('FAKE_SCHEDULE', path.join(home, 'schedule.log'));
    await writeFile(path.join(home, 'review.log'), '', 'utf8');
    await put(
      'review.json',
      JSON.stringify({ items: [{ id: '123', state: 'open', summary: 'PR' }] }),
      home,
    );
  });

  it('L0 без изменений — ноль ролей; изменение — триаж и запрос; approve сам, comment после «да»', async () => {
    expect(await run(['ops', 'watch', 'add', 'review', 'мои PR', '--every', '1'])).toBe(0);
    expect(await run(['ops', 'watch', 'list'])).toBe(0);
    expect(await run(['ops', 'tick'])).toBe(0);
    expect(existsSync(path.join(home, 'args.jsonl'))).toBe(false);
    await put(
      'review.json',
      JSON.stringify({
        items: [{ id: '123', state: 'commented', summary: 'PR: новый комментарий' }],
      }),
      home,
    );
    byRole({
      'watch-triage': { submit: result('act — новый комментарий') },
      'watch-request': {
        submit: result(
          'act: approve 123 — lgtm\nact: comment 123 — поправь тест\nПоправить тест по комментарию',
        ),
      },
    });
    expect(await run(['ops', 'tick'], LATER)).toBe(0);
    expect(await readFile(path.join(home, 'review.log'), 'utf8')).toBe('approve 123 lgtm\n');
    const all = await events();
    const suggest = all.find((e) => e.kind === 'suggest')?.text ?? '';
    expect(suggest).toContain('ai ops act review comment 123 --file .ops/suggest/');
    expect(all.find((e) => e.kind === 'request')?.text).toContain('Поправить тест');
    const file = /--file (\S+)/.exec(suggest)?.[1] ?? '';
    expect(await run(['ops', 'act', 'review', 'comment', '123', '--file', file])).toBe(0);
    expect(await readFile(path.join(home, 'review.log'), 'utf8')).toContain(
      'comment 123 поправь тест',
    );
    const id = /^(\S+)\t.*мои PR/.exec(out.find((l) => /^\S+\t.*мои PR/.test(l)) ?? '')?.[1] ?? '';
    expect(await run(['ops', 'watch', 'stop', id])).toBe(0);
    await expect(run(['ops', 'watch', 'stop', id])).rejects.toThrow('нет наблюдателя');
  });

  it('until merged: done из провайдера снимает наблюдателя', async () => {
    await run(['ops', 'watch', 'add', 'review', 'q', '--until', 'merged']);
    await put('review.json', JSON.stringify({ items: [], done: true }), home);
    await run(['ops', 'tick']);
    expect((await events()).map((e) => e.kind)).toContain('watch-stopped');
    expect(existsSync(path.join(root, '.ops', 'watches'))).toBe(true);
    expect((await readdir(path.join(root, '.ops', 'watches'))).length).toBe(0);
    await expect(run(['ops', 'watch', 'add', 'tasks', 'q'])).rejects.toThrow(
      'интерфейс review или checks',
    );
    await expect(run(['ops', 'watch', 'add', 'review', 'q', '--until', 'never'])).rejects.toThrow(
      '--until',
    );
  });

  it('планировщик один на машину: schedule on/status/off, tick --all обходит реестр', async () => {
    await run(['ops', 'watch', 'add', 'review', 'q']);
    expect(await run(['ops', 'schedule', 'on'])).toBe(0);
    expect(await readFile(path.join(home, 'schedule.log'), 'utf8')).toMatch(
      /^install .*ops tick --all .*60\n$/,
    );
    expect(await run(['ops', 'schedule', 'on'])).toBe(0);
    expect((await readFile(path.join(home, 'schedule.log'), 'utf8')).split('\n').length).toBe(2);
    out = [];
    expect(await run(['ops', 'schedule', 'status'])).toBe(0);
    expect(out.join('\n')).toContain('active');
    expect(await run(['ops', 'tick', '--all'])).toBe(0);
    const watch = (await readdir(path.join(root, '.ops', 'watches')))[0] ?? '';
    expect(await read(`.ops/watches/${watch}`)).toContain('fingerprint');
    expect(await run(['ops', 'schedule', 'off'])).toBe(0);
    expect(await readFile(path.join(home, 'schedule.log'), 'utf8')).toContain(
      'remove dev.shahimat.ai-ops-tick',
    );
  });

  it('политика never запрещает действие наружу даже по прямой команде', async () => {
    await put('context/autonomy.yml', 'levels:\n  never: [schedule.install, review]\n');
    await expect(run(['ops', 'schedule', 'on'])).rejects.toThrow('запрещено политикой');
    await put('note.md', 'текст');
    await expect(
      run(['ops', 'act', 'review', 'comment', '1', '--file', 'note.md']),
    ).rejects.toThrow('запрещено политикой');
    await expect(run(['ops', 'act', 'nope', 'x', '1'])).rejects.toThrow('нет интерфейса');
  });
});

describe('ops: провайдеры и дашборд', () => {
  it('провайдер ищется в проекте, на машине и среди встроенных; одно имя дважды — ошибка', async () => {
    await put('providers/review/fake.mjs', REVIEW_PROVIDER, home);
    expect((await loadProvider(root, home, 'review', 'fake')).source).toContain(
      path.join('providers', 'review', 'fake.mjs'),
    );
    await put('.agents/providers/review/fake.mjs', REVIEW_PROVIDER);
    await expect(loadProvider(root, home, 'review', 'fake')).rejects.toThrow('объявлен дважды');
    await expect(loadProvider(root, home, 'review', 'none')).rejects.toThrow('не выбран');
    await put(
      '.agents/providers/checks/bad.mjs',
      "export default { interface: 'checks', name: 'bad' };\n",
    );
    await expect(loadProvider(root, home, 'checks', 'bad')).rejects.toThrow('нет методов poll');
    expect((await loadProvider(root, home, 'tasks', 'local')).source).toBe('builtin:tasks/local');
  });

  it('встроенные: карточка из markdown, unit launchd и systemd', () => {
    const card = parseTaskMarkdown('t.md', TASK);
    expect(card.title).toBe('Добавить приветствие');
    expect(card.dod).toEqual(['README содержит hello world']);
    expect(card.links).toEqual(['https://example.invalid/t1']);
    const unit = {
      name: 'u',
      command: ['node', 'bin.js', 'ops', 'tick', '--all'],
      every: 60,
      log: '/l',
    };
    expect(launchdPlist(unit)).toContain('<integer>60</integer>');
    const { service, timer } = systemdUnits(unit);
    expect(service).toContain('ExecStart=node bin.js ops tick --all');
    expect(timer).toContain('OnUnitActiveSec=60s');
  });

  it('лимиты машины: по умолчанию 4 / opus 2 / наблюдатели 1; неверное значение — ошибка с путём', async () => {
    expect(await loadLimits(home)).toEqual({ jobs: 4, opus: 2, watchers: 1 });
    await put('ops/limits.yml', 'jobs: 0\n', home);
    await expect(loadLimits(home)).rejects.toThrow('ops/limits.yml/jobs');
  });

  it('serve: доска, страница job и ответ из браузера', async () => {
    byRole({ researcher: { submit: result('', ['вопрос?']) } });
    await run(['ticket-work', 'start', 'tasks/t1.md']);
    const { short } = await job();
    await expect(run(['ops', 'serve', '--port', 'x'])).rejects.toThrow('--port');
    const server: Server = createServer((req, res) => {
      handle(home, [root], req, res).catch(() => res.end());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const base = `http://127.0.0.1:${isRecord(address) ? String(address['port']) : ''}`;
    try {
      expect(await (await fetch(`${base}/`)).text()).toContain(short);
      expect(await (await fetch(`${base}/job?p=0&id=${short}`)).text()).toContain('вопрос?');
      expect((await fetch(`${base}/file?p=0&id=${short}&name=..%2Fx`)).status).toBe(400);
      const posted = await fetch(`${base}/answer`, {
        method: 'POST',
        body: new URLSearchParams({ p: '0', id: short, text: 'ответ из браузера' }),
        redirect: 'manual',
      });
      expect(posted.status).toBe(303);
      expect(await read(`.ops/jobs/${short}/questions.json`)).toContain('ответ из браузера');
      expect((await events()).map((e) => e.kind)).toContain('answered');
    } finally {
      server.close();
    }
  });
});
