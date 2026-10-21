// expect:expect-cycles
// expect:verdict-prune
// expect:verdict-by-code
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UsageError } from '#shared/diagnostics';
import {
  applyAnswers,
  applyLintAnswer,
  planBatches,
  renderBatch,
  renderLintBatch,
} from '#lib/expect/batch';
import { readEvidence, shaOf } from '#lib/expect/evidence';
import { COLLECT_ENV, idOf, isPendingItem, SEEN_ENV, type PendingItem } from '#lib/expect/judge';
import { isRecord, isStringArray } from '#shared/guards';
import { lintTitles, type Title } from '#lib/expect/lint';
import {
  ENTRY_ENV,
  loadVerdicts,
  pruneStore,
  saveVerdicts,
  verdictsPath,
} from '#lib/expect/verdicts';
import type { CommandArgs } from '#shared/args';
import { headTitles } from './head.ts';
import { portOf, renderInChild, serveHtml } from './serve.ts';
import { renderHtml, type FileReport } from './html.ts';
import {
  budgetOf,
  byFile,
  fullName,
  isPlannedTest,
  isProgress,
  machinesOf,
  parseVitestReport,
  planOf,
  stepIssues,
  stepsOf,
  docIssues,
  stepStatusOf,
  visible,
  type Remark,
  type TestResult,
} from './results.ts';

export const INDEX_ENTRY = 'expectations/index.expect.ts';

const BUILTIN_CONFIG = path.join(
  import.meta.dirname,
  existsSync(path.join(import.meta.dirname, 'vitest.config.js'))
    ? 'vitest.config.js'
    : 'vitest.config.ts',
);

const posix = (p: string): string => p.split(path.sep).join('/');

const judgeDir = (entry: string): string => path.posix.join(path.posix.dirname(entry), '.judge');

function entryOf(args: CommandArgs): string {
  const file = args.params?.['file'];
  if (file === undefined) throw new UsageError('нужен путь к файлу ожиданий: <file>');
  const rel = posix(path.relative(args.root, path.resolve(args.root, file)));
  if (rel.startsWith('../') || !existsSync(path.join(args.root, rel)))
    throw new UsageError(`нет файла ожиданий ${file} в ${args.root}`);
  if (!rel.endsWith('.expect.ts')) throw new UsageError(`файл ожиданий — *.expect.ts: ${file}`);
  process.env[ENTRY_ENV] = rel;
  return rel;
}

function vitestBin(root: string): string {
  const require = createRequire(path.join(root, 'package.json'));
  let vitestPkg: string;
  try {
    vitestPkg = require.resolve('vitest/package.json');
  } catch {
    throw new UsageError('vitest не установлен в проекте: npm i -D vitest');
  }
  const pkg: unknown = JSON.parse(readFileSync(vitestPkg, 'utf8'));
  const bins = isRecord(pkg) ? pkg['bin'] : undefined;
  const bin = isRecord(bins) ? bins['vitest'] : undefined;
  if (typeof bin !== 'string') throw new Error(`${vitestPkg}: нет bin.vitest`);
  return path.join(path.dirname(vitestPkg), bin);
}

function runVitest(
  root: string,
  entry: string,
  env: Record<string, string> = {},
  extra: string[] = [],
): TestResult[] {
  const out = path.join(tmpdir(), `harness-expect-${process.pid}-${Date.now()}.json`);
  spawnSync(
    process.execPath,
    [
      vitestBin(root),
      'run',
      '--root',
      root,
      '--config',
      BUILTIN_CONFIG,
      '--reporter=json',
      `--outputFile=${out}`,
      ...extra,
    ],
    {
      cwd: root,
      env: { ...process.env, ...env, HARNESS_EXPECT_ROOT: root, [ENTRY_ENV]: entry },
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  if (!existsSync(out)) throw new Error('vitest не записал отчёт');
  const data: unknown = JSON.parse(readFileSync(out, 'utf8'));
  rmSync(out, { force: true });
  return parseVitestReport(data, root);
}

const NOTHING = '(?!)';

const titlesSha = (tests: TestResult[]): string => shaOf(tests.map(fullName).sort().join('\n'));

const isPending = (t: TestResult): boolean =>
  t.status === 'failed' && t.message.includes('нет свежего вердикта');

function stepLabels(tests: TestResult[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const t of tests)
    if (t.stepDef !== undefined)
      labels.set(t.path.join('\u0000'), stepStatusOf(t.stepDef.id, tests));
  return labels;
}

async function collect(
  args: CommandArgs,
  log: (line: string) => void,
): Promise<{ reports: FileReport[]; blocked: boolean }> {
  const all = runVitest(args.root, entryOf(args));
  const store = await loadVerdicts();
  const titleIssues = lintTitles(
    visible(all).map((r) => ({ file: r.file, path: r.path, title: r.title })),
  );
  let blocked = false;
  let total = { tests: 0, crit: 0, warn: 0, info: 0, pending: 0 };
  const reports: FileReport[] = [];

  for (const [file, tests] of byFile(all)) {
    const budget = budgetOf(tests);
    const items = visible(tests);
    const steps = stepsOf(tests);
    const labels = stepLabels(tests);
    const issues: Remark[] = [];
    const count = { crit: 0, warn: 0, info: 0, pending: 0 };
    log(file);
    let prev: string[] = [];
    for (const t of items) {
      t.path.forEach((p, i) => {
        if (prev[i] === p) return;
        const status = labels.get(t.path.slice(0, i + 1).join('\u0000'));
        log(`${'  '.repeat(i + 1)}${p}${status === undefined ? '' : ` · ${status}`}`);
      });
      prev = t.path;
      const pad = '  '.repeat(t.path.length + 1);
      if (t.wip) {
        log(`${pad}◐ ${t.level} ${t.title}${isProgress(t) ? `  — ${t.message}` : ''} (в работе)`);
      } else if (isPlannedTest(t)) {
        log(`${pad}○ ${t.level} ${t.title}`);
      } else if (isPending(t)) {
        count.pending++;
        log(`${pad}? ${t.title}  — нужен вердикт судьи`);
      } else if (t.status === 'failed') {
        count[t.level === 'warn' ? 'warn' : 'crit']++;
        log(`${pad}${t.level === 'warn' ? '⚠' : '✗'} ${t.title}  — ${t.message}`);
      } else {
        log(`${pad}${t.status === 'todo' ? '○' : t.status === 'passed' ? '✓' : '-'} ${t.title}`);
      }
      for (const n of t.notes) log(`${pad}  ℹ ${n}`);
      count.info += t.notes.length;
    }

    for (const issue of [...stepIssues(steps, tests), ...docIssues(tests)]) {
      count.crit++;
      issues.push({ text: issue });
      log(`  ✗ план: ${issue}`);
    }
    for (const d of titleIssues.filter((i) => i.title.file === file)) {
      count[d.level]++;
      issues.push({ text: `заголовок «${d.title.title}»`, detail: d.message });
      log(`  ${d.level === 'crit' ? '✗' : '⚠'} заголовок «${d.title.title}» — ${d.message}`);
    }
    const lint = store.lint[file];
    if (lint === undefined || lint.titles !== titlesSha(items)) {
      count.pending++;
      log('  ? смысловая проверка заголовков устарела — harness expect judge');
    } else {
      const byId = new Map(items.map((t) => [idOf(fullName(t)), t]));
      const name = (id: string) => byId.get(id)?.title;
      const stub = (...ids: string[]) =>
        ids.some((id) => {
          const t = byId.get(id);
          return t !== undefined && (t.wip || isPlannedTest(t));
        });
      const note = (wip: boolean) => (wip ? ' (в работе — не блокирует)' : '');
      for (const c of lint.contradictions) {
        const wip = stub(c.a, c.b);
        const text = `противоречие: «${name(c.a)}» ↔ «${name(c.b)}»${note(wip)}`;
        issues.push({ text, detail: c.reason });
        log(`  ${wip ? '◐' : '⚠'} ${text} — ${c.reason}`);
        if (!wip) count.warn++;
      }
      for (const u of lint.unmeasurable) {
        const wip = stub(u.id);
        const text = `неизмеримо: «${name(u.id)}»${note(wip)}`;
        issues.push({ text, detail: u.reason });
        log(`  ${wip ? '◐' : '⚠'} ${text} — ${u.reason}`);
        if (!wip) count.warn++;
      }
    }

    const over = count.crit > budget.crit || count.warn > budget.warn || count.pending > 0;
    blocked ||= over;
    log(
      `  ${over ? '✗' : '✓'} crit ${count.crit}/${budget.crit} · warn ${count.warn}/${budget.warn} · info ${count.info}` +
        (count.pending > 0 ? ` · ? ${count.pending} без вердикта` : ''),
    );
    total = {
      tests: total.tests + items.length,
      crit: total.crit + count.crit,
      warn: total.warn + count.warn,
      info: total.info + count.info,
      pending: total.pending + count.pending,
    };
    const report: FileReport = {
      file,
      all: tests,
      tests: items,
      steps,
      machines: machinesOf(tests),
      issues,
      budget,
      count,
    };
    const declared = planOf(tests);
    if (declared !== undefined) report.plan = declared;
    reports.push(report);
  }
  const remarks = reports.reduce((n, r) => n + r.issues.length, 0);
  const declared = reports.some((r) => r.all.some((t) => t.doc?.kind === 'remarks'));
  const titled = reports.some((r) => r.all.some((t) => t.doc?.kind === 'title'));
  const planned = reports.find((r) => r.plan !== undefined)?.plan;
  if (planned !== undefined && !titled)
    log(`\nу плана «${planned.name}» нет шапки: добавьте info.title()`);
  if (remarks > 0 && !declared)
    log(
      `\nзамечаний ${remarks}, блока info.remarks нет — на странице их не видно: добавьте info.remarks()`,
    );
  log(
    `\nожиданий ${total.tests}: crit ${total.crit} · warn ${total.warn} · info ${total.info} · ? ${total.pending} — ${blocked ? 'бюджет превышен' : 'в бюджете'}`,
  );
  return { reports, blocked };
}

export interface ExpectSummary {
  blocked: boolean;
  count: { crit: number; warn: number; info: number; pending: number };
  budget: { crit: number; warn: number };
  remarks: Remark[];
  failures: { level: 'crit' | 'warn'; title: string; message: string }[];
  remarksDeclared: boolean;
}

export async function expectSummary(root: string, file: string): Promise<ExpectSummary> {
  process.env['HARNESS_EXPECT_ROOT'] = root;
  const args: CommandArgs = { root, now: new Date(), params: { file } };
  const { reports, blocked } = await collect(args, () => undefined);
  const own = reports.find((r) => r.file === entryOf(args));
  const failures = reports.flatMap((r) =>
    r.tests
      .filter((t) => t.status === 'failed' && !t.wip && !isPending(t))
      .map((t) => ({
        level: t.level === 'warn' ? ('warn' as const) : ('crit' as const),
        title: fullName(t),
        message: t.message,
      })),
  );
  const sum = (key: 'crit' | 'warn' | 'info' | 'pending'): number =>
    reports.reduce((n, r) => n + r.count[key], 0);
  return {
    blocked,
    count: { crit: sum('crit'), warn: sum('warn'), info: sum('info'), pending: sum('pending') },
    budget: own?.budget ?? { crit: 0, warn: 0 },
    remarks: reports.flatMap((r) => r.issues),
    failures,
    remarksDeclared: reports.some((r) => r.all.some((t) => t.doc?.kind === 'remarks')),
  };
}

export interface ExpectBuild {
  ok: boolean;
  errors: string[];
}

function nearestTsconfig(root: string, file: string): string | undefined {
  let dir = path.dirname(path.join(root, file));
  for (;;) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    if (path.relative(root, dir) === '' || dir === path.dirname(dir)) return undefined;
    dir = path.dirname(dir);
  }
}

function tscErrors(root: string, file: string): string[] {
  const config = nearestTsconfig(root, file);
  if (config === undefined) return [];
  let tsc: string;
  try {
    tsc = createRequire(path.join(root, 'package.json')).resolve('typescript/bin/tsc');
  } catch {
    return [];
  }
  const r = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false', '-p', config], {
    cwd: root,
    encoding: 'utf8',
  });
  if (r.status === 0) return [];
  return r.stdout.split('\n').filter((line) => line.includes(file) && line.includes('error'));
}

export function expectBuild(root: string, file: string): ExpectBuild {
  const loadErrors = runVitest(root, file)
    .filter((t) => t.title.startsWith('файл не собран'))
    .map((t) => t.title);
  const errors = [...loadErrors, ...tscErrors(root, file)];
  return { ok: errors.length === 0, errors };
}

async function pageHtml(args: CommandArgs, reports: FileReport[]): Promise<string> {
  for (const r of reports) {
    const head = headTitles(args.root, r.file, (rel) =>
      visible(runVitest(args.root, rel, {}, ['-t', NOTHING])).filter((t) => t.file === rel),
    );
    if (head !== undefined) r.head = head;
  }
  return renderHtml(reports, entryOf(args));
}

async function report(args: CommandArgs): Promise<number> {
  if (args.html === '-') {
    const { reports, blocked } = await collect(args, () => undefined);
    process.stdout.write(await pageHtml(args, reports));
    return blocked ? 1 : 0;
  }
  const { reports, blocked } = await collect(args, (line) => {
    console.log(line);
  });
  if (args.html !== undefined) {
    const out = path.resolve(args.root, args.html);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, await pageHtml(args, reports), 'utf8');
    console.log(`html: ${out}`);
  }
  return blocked ? 1 : 0;
}

async function serve(args: CommandArgs): Promise<number> {
  const entry = entryOf(args);
  return serveHtml({
    root: args.root,
    port: portOf(args.port),
    render: () => renderInChild(args.root, entry),
  });
}

async function lint(args: CommandArgs): Promise<number> {
  const titles: Title[] = visible(runVitest(args.root, entryOf(args))).map((r) => ({
    file: r.file,
    path: r.path,
    title: r.title,
  }));
  const diags = lintTitles(titles);
  for (const d of diags)
    console.error(`${d.level} ${d.title.file}: «${d.title.title}» — ${d.message}`);
  console.log(
    diags.length === 0
      ? `expect lint: ok (${titles.length})`
      : `expect lint: нарушений ${diags.length}`,
  );
  return diags.length === 0 ? 0 : 1;
}

interface Plan {
  batches: { task: string; answer: string; items: PendingItem[] }[];
  lint: { task: string; answer: string; file: string; titles: string; ids: string[] }[];
}

function isPlan(v: unknown): v is Plan {
  const task = (t: unknown): t is Record<string, unknown> =>
    isRecord(t) && typeof t['task'] === 'string' && typeof t['answer'] === 'string';
  return (
    isRecord(v) &&
    Array.isArray(v['batches']) &&
    v['batches'].every(
      (b) => task(b) && Array.isArray(b['items']) && b['items'].every(isPendingItem),
    ) &&
    Array.isArray(v['lint']) &&
    v['lint'].every(
      (l) =>
        task(l) &&
        typeof l['file'] === 'string' &&
        typeof l['titles'] === 'string' &&
        isStringArray(l['ids']),
    )
  );
}

async function judgePrepare(args: CommandArgs): Promise<number> {
  const entry = entryOf(args);
  const JUDGE_DIR = judgeDir(entry);
  const dir = path.join(args.root, JUDGE_DIR);
  await rm(dir, { recursive: true, force: true });
  const pendingDir = path.join(dir, 'pending');
  const seenDir = path.join(dir, 'seen');
  const results = runVitest(args.root, entry, { [COLLECT_ENV]: pendingDir, [SEEN_ENV]: seenDir });
  const seen = new Set(existsSync(seenDir) ? await readdir(seenDir) : []);
  await rm(seenDir, { recursive: true, force: true });
  const items: PendingItem[] = [];
  if (existsSync(pendingDir)) {
    for (const f of (await readdir(pendingDir)).sort()) {
      const item: unknown = JSON.parse(await readFile(path.join(pendingDir, f), 'utf8'));
      if (!isPendingItem(item))
        throw new Error(`${JUDGE_DIR}/pending/${f}: неверная форма вопроса`);
      items.push(item);
    }
    await rm(pendingDir, { recursive: true, force: true });
  }
  const plan: Plan = { batches: [], lint: [] };
  for (const [i, batch] of planBatches(items).entries()) {
    const task = `${JUDGE_DIR}/batch-${i + 1}.md`;
    const answer = `${JUDGE_DIR}/batch-${i + 1}.answer.json`;
    await mkdir(dir, { recursive: true });
    const texts = new Map<string, string>();
    for (const ref of batch.refs.filter((r) => r.startsWith('@')))
      texts.set(ref, await readEvidence(ref));
    await writeFile(path.join(args.root, task), renderBatch(batch, answer, texts), 'utf8');
    plan.batches.push({ task, answer, items: batch.items });
  }
  const store = await loadVerdicts();
  const removed = pruneStore(store, seen, new Set(byFile(results).keys()));
  if (removed > 0) {
    await saveVerdicts(store);
    console.log(`expect judge: удалено устаревших вердиктов ${removed}`);
  }
  for (const [file, all] of byFile(results)) {
    const tests = visible(all);
    const sha = titlesSha(tests);
    if (store.lint[file]?.titles === sha) continue;
    const n = plan.lint.length + 1;
    const task = `${JUDGE_DIR}/lint-${n}.md`;
    const answer = `${JUDGE_DIR}/lint-${n}.answer.json`;
    const titles = tests.map((t) => ({ id: idOf(fullName(t)), title: fullName(t) }));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(args.root, task), renderLintBatch(file, titles, answer), 'utf8');
    plan.lint.push({ task, answer, file, titles: sha, ids: titles.map((t) => t.id) });
  }
  if (plan.batches.length === 0 && plan.lint.length === 0) {
    console.log('expect judge: всё свежее, судья не нужен');
    return 0;
  }
  await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf8');
  console.log(
    `expect judge: вопросов ${items.length} в пакетах ${plan.batches.length}, проверок заголовков ${plan.lint.length}`,
  );
  for (const t of [...plan.batches, ...plan.lint]) console.log(`  ${t.task} → ${t.answer}`);
  console.log(
    'Каждый файл — задание судье (субагенту), ответ — в указанный JSON. Затем: harness expect judge --apply',
  );
  return 1;
}

async function judgeApply(args: CommandArgs): Promise<number> {
  const JUDGE_DIR = judgeDir(entryOf(args));
  const planFile = path.join(args.root, JUDGE_DIR, 'plan.json');
  if (!existsSync(planFile)) throw new UsageError('нет плана: сначала harness expect judge');
  const plan: unknown = JSON.parse(await readFile(planFile, 'utf8'));
  if (!isPlan(plan))
    throw new UsageError(`${JUDGE_DIR}/plan.json: неверная форма — заново harness expect judge`);
  const store = await loadVerdicts();
  const rejected: string[] = [];
  const readJson = async (rel: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(path.join(args.root, rel), 'utf8'));
    } catch {
      return undefined;
    }
  };
  for (const b of plan.batches) {
    const answers = await readJson(b.answer);
    if (answers === undefined) {
      rejected.push(`${b.answer}: нет ответа`);
      continue;
    }
    const texts = new Map<string, string>();
    for (const ref of new Set(b.items.flatMap((i) => i.evidence.map((e) => e.ref))))
      texts.set(ref, await readEvidence(ref));
    const result = applyAnswers(b.items, answers, texts, args.now);
    Object.assign(store.verdicts, result.accepted);
    for (const r of result.rejected) rejected.push(`${b.answer}: ${r.id} — ${r.reason}`);
  }
  for (const l of plan.lint) {
    const answer = await readJson(l.answer);
    const { verdict, error } = applyLintAnswer(l.titles, new Set(l.ids), answer, args.now);
    if (verdict === null) rejected.push(`${l.answer}: ${error ?? 'нет ответа'}`);
    else store.lint[l.file] = verdict;
  }
  await saveVerdicts(store);
  for (const r of rejected) console.error(r);
  if (rejected.length > 0) {
    console.error(
      `expect judge --apply: отклонено ${rejected.length}; принятое сохранено в ${verdictsPath()}`,
    );
    return 1;
  }
  await rm(path.join(args.root, JUDGE_DIR), { recursive: true, force: true });
  console.log(`expect judge --apply: вердикты сохранены в ${verdictsPath()}`);
  return 0;
}

const initIndex = (name: string): string => `import './${name}.expect.ts';
`;

const initExample = (name: string): string => `import { describe, it } from 'vitest';
import { budget } from '@shahimat/harness/expect';

budget({ crit: 0, warn: 0 });

describe('${name}', () => {
  it.todo('первое ожидание: одно утверждение до 200 символов, да/нет или число');
});

// ─────────────────────────────── проверки ───────────────────────────────

class Check {}
void Check;
`;

async function init(args: CommandArgs): Promise<number> {
  const done: string[] = [];
  const put = async (rel: string, content: string): Promise<void> => {
    const abs = path.join(args.root, rel);
    if (existsSync(abs)) return;
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
    done.push(`создан ${rel}`);
  };
  const name = path.basename(args.root);
  await put(INDEX_ENTRY, initIndex(name));
  await put(`expectations/${name}.expect.ts`, initExample(name));
  const JUDGE_DIR = judgeDir(INDEX_ENTRY);

  const gitignore = path.join(args.root, '.gitignore');
  const ignored = existsSync(gitignore) ? await readFile(gitignore, 'utf8') : '';
  if (!ignored.split('\n').includes(`${JUDGE_DIR}/`)) {
    await writeFile(
      gitignore,
      `${ignored}${ignored === '' || ignored.endsWith('\n') ? '' : '\n'}${JUDGE_DIR}/\n`,
      'utf8',
    );
    done.push(`.gitignore: ${JUDGE_DIR}/`);
  }

  const pkgFile = path.join(args.root, 'package.json');
  if (existsSync(pkgFile)) {
    const pkg: unknown = JSON.parse(await readFile(pkgFile, 'utf8'));
    if (!isRecord(pkg)) throw new UsageError('package.json: корень должен быть объектом');
    const current = pkg['scripts'] ?? {};
    if (!isRecord(current)) throw new UsageError('package.json: scripts должно быть объектом');
    const scripts = {
      expect: `harness expect report ${INDEX_ENTRY} --root .`,
      'expect:judge': `harness expect judge ${INDEX_ENTRY} --root .`,
      'expect:apply': `harness expect judge ${INDEX_ENTRY} --apply --root .`,
    };
    const added = Object.entries(scripts).filter(([k]) => current[k] === undefined);
    if (added.length > 0) {
      pkg['scripts'] = { ...current, ...Object.fromEntries(added) };
      await writeFile(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
      done.push(`package.json: скрипты ${added.map(([k]) => k).join(', ')}`);
    }
  }

  for (const line of done) console.log(line);
  console.log(done.length === 0 ? 'expect init: всё уже на месте' : 'expect init: готово');
  console.log('Зависимости: npm i -D vitest @shahimat/harness [@shahimat/expectations]');
  return 0;
}

export async function runExpect(command: string | undefined, args: CommandArgs): Promise<number> {
  process.env['HARNESS_EXPECT_ROOT'] = args.root;
  switch (command) {
    case 'init':
      return init(args);
    case 'report':
      return report(args);
    case 'serve':
      return serve(args);
    case 'lint':
      return lint(args);
    case 'judge':
      return args.apply === true ? judgeApply(args) : judgePrepare(args);
    default:
      throw new UsageError(`неизвестная команда: expect ${command ?? ''}`.trimEnd());
  }
}
