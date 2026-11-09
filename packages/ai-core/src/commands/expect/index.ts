// expect:expect-cycles
// expect:verdict-prune
// expect:verdict-by-code
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  expectHelperDir,
  expectHelperPath,
  normalizedProjectPath,
  confinedProjectPath,
  ARTIFACT_IGNORE_LINES,
} from '#lib/artifacts';
import { UsageError } from '#shared/diagnostics';
import { applyAnswers, planBatches, renderBatch } from '#lib/expect/batch';
import { readEvidence, shaOf } from '#lib/expect/evidence';
import { COLLECT_ENV, isPendingItem, SEEN_ENV, type PendingItem } from '#lib/expect/pending';
import { errorMessage, isRecord } from '#shared/guards';
import { askRole } from '#lib/role';
import { lintTitles } from '#lib/expect/lint';
import {
  ENTRY_ENV,
  loadVerdicts,
  saveVerdicts,
  verdictsPath,
  type VerdictStore,
  sealVerdict,
} from '#lib/expect/verdicts';
import { canonicalDigest, criterionInventory, registrationInput } from '#lib/expect/inventory';
import { acquireLease } from '#lib/local-store';
import { entryLeaseName, implementationContext, producerContext } from '#lib/expect/proof';
import {
  titlePlan,
  titleDelta,
  applyTitleAnswer,
  renderTitlePlan,
  isTitlePlan,
  type TitlePlan,
} from '#lib/expect/title-proof';
import { commandProofRun } from '#lib/proof/adapter';
import { ensureProof } from '#lib/proof/runner';
import { PROOF_TRANSPORT } from '#lib/proof/transport';
import {
  applyBoundPlan,
  currentBoundPlan,
  prepareBoundPlan,
  semanticGeneration,
  isBoundPlan,
  runBoundProducer,
  validateAnswerEnvelope,
  type BoundPlan,
} from '#lib/expect/bundle';
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

const judgeDir = expectHelperDir;

function entryOf(args: CommandArgs): string {
  const file = args.params?.['file'];
  if (file === undefined) throw new UsageError('нужен путь к файлу ожиданий: <file>');
  const rel = normalizedProjectPath(file);
  confinedProjectPath(args.root, rel);
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
  env: NodeJS.ProcessEnv = {},
  extra: string[] = [],
): TestResult[] {
  const inheritedHead = process.env['HARNESS_EXPECT_HEAD_SOURCE'];
  if (
    inheritedHead !== undefined &&
    inheritedHead !== '' &&
    env['HARNESS_EXPECT_HEAD_SOURCE'] === undefined
  )
    throw new UsageError('HEAD source requires explicit collection provenance');
  const inventory =
    env['HARNESS_EXPECT_HEAD_SOURCE'] === undefined ? criterionInventory(root, entry) : undefined;
  const scratch = mkdtempSync(path.join(tmpdir(), 'harness-expect-'));
  const out = path.join(scratch, 'report.json');
  try {
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
        env: {
          ...process.env,
          [COLLECT_ENV]: undefined,
          [SEEN_ENV]: undefined,
          ...env,
          HARNESS_EXPECT_ROOT: root,
          [ENTRY_ENV]: entry,
          HARNESS_EXPECT_SOURCE_GENERATION: inventory?.generation ?? 'unmodelled-source',
        },
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );
    if (!existsSync(out)) throw new Error('vitest не записал отчёт');
    const data: unknown = JSON.parse(readFileSync(out, 'utf8'));
    const results = parseVitestReport(data, root);
    if (inventory !== undefined) {
      if (criterionInventory(root, entry).generation !== inventory.generation)
        throw new Error('STALE_EXPECT_GENERATION');
      const registrations = results.flatMap((result) =>
        result.registration === undefined ? [] : [result.registration],
      );
      for (const result of results) {
        const criterion =
          result.registration === undefined
            ? undefined
            : registrationInput(inventory, result.registration, registrations);
        if (criterion !== undefined) result.criterion = criterion;
      }
    }
    return results;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const NOTHING = '(?!)';

class CollectionNeedsReview extends Error {}

async function collectOnce(args: CommandArgs, env: NodeJS.ProcessEnv = {}): Promise<TestResult[]> {
  const head = process.env['HARNESS_EXPECT_HEAD_SOURCE'];
  if (head !== undefined && head !== '' && env['HARNESS_EXPECT_HEAD_SOURCE'] === undefined)
    throw new UsageError('HEAD source requires explicit collection provenance');
  const run = await commandProofRun(args);
  const entry = entryOf(args);
  let results: TestResult[] | undefined;
  let executions = 0;
  const receipt = await ensureProof(run, {
    id: `expect:collection:${entry}:${env[COLLECT_ENV] === undefined ? 'query' : 'prepare'}`,
    declaration: {
      cacheability: 'run-only',
      complete: false,
      diagnostics: [
        'unattested Vitest collection runtime; observation only; fresh run required for another collection',
      ],
      files: [entry],
      optionalFiles: ['package.json', 'package-lock.json'],
      implementation: [],
      config: { generation: criterionInventory(args.root, entry).generation },
    },
    execute: async () => {
      executions++;
      results = runVitest(args.root, entry, { ...env, [PROOF_TRANSPORT]: JSON.stringify(run) });
      return { status: 'pass', code: 0, diagnostics: [] };
    },
  });
  console.error(
    `expect collection: ${receipt.origin} ${receipt.status}; executed ${executions}; run-only observation, not semantic PASS`,
  );
  if (results === undefined || receipt.status !== 'pass')
    throw new CollectionNeedsReview(receipt.diagnostics.join('; '));
  if (results.length === 0)
    throw new CollectionNeedsReview('empty/unresolved collection: no evaluated scope');
  return results;
}

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
): Promise<{ reports: FileReport[]; blocked: boolean; titleIssueCount: number }> {
  const run = await commandProofRun(args);
  const all = await collectOnce({ ...args, proofRun: run });
  const store = await loadVerdicts(args.root, entryOf(args));
  const producer = await producerContext(args.root);
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
    const completeTitlePlan = titlePlan(
      file,
      items.map((t) => ({ file, path: t.path, title: t.title })),
      producer,
      items.every((t) => t.criterion?.titleComplete === true),
    );
    const delta = titleDelta(completeTitlePlan, store.titles ?? {}, run.force, run.id);
    log(
      `  titles: reused ${delta.reused.length} · needs-review ${delta.plan.checks.length} · executed 0`,
    );
    if (delta.plan.checks.length > 0 || !delta.plan.complete) {
      count.pending++;
      log(
        `  ? смысловая проверка заголовков устарела — needs-review: ${delta.plan.diagnostics.join('; ') || 'missing explicit title coverage'}`,
      );
    }
    for (const proof of delta.reused.filter((proof) => proof.problem)) {
      const peers = proof.check.nodes.map((id) => {
        const node = completeTitlePlan.nodes.find((node) => node.id === id);
        return items.find(
          (t) =>
            node?.intent.title === t.title &&
            canonicalDigest(node.intent.path) === canonicalDigest(t.path),
        );
      });
      const wip = peers.some((t) => t !== undefined && (t.wip || isPlannedTest(t)));
      const text = `${proof.check.kind === 'pair' ? 'противоречие' : 'неизмеримо'}: ${proof.reason}`;
      issues.push({ text });
      log(`  ${wip ? '◐' : '⚠'} ${text}`);
      if (!wip) count.warn++;
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
  return { reports, blocked, titleIssueCount: titleIssues.length };
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
    const head = headTitles(args.root, r.file, (env) =>
      visible(runVitest(args.root, r.file, env, ['-t', NOTHING])).filter((t) => t.file === r.file),
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
    const out = expectHelperPath(args.root, entryOf(args), args.html);
    await mkdir(path.dirname(out), { recursive: true });
    const html = await pageHtml(args, reports);
    await writeFile(expectHelperPath(args.root, entryOf(args), args.html), html, 'utf8');
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
  const { blocked, titleIssueCount } = await collect(args, (line) => console.log(line));
  const failed = blocked || titleIssueCount > 0;
  console.log(`expect lint: ${failed ? 'needs-review/failed' : 'ok'}`);
  return failed ? 1 : 0;
}

interface Plan {
  execution: { run: string; force: boolean; allowJudge: boolean };
  batches: { task: string; answer: string; items: PendingItem[] }[];
  lint: { task: string; answer: string; review: TitlePlan }[];
  bound?: BoundPlan;
  tasks?: Record<string, string>;
}

function isPlan(v: unknown): v is Plan {
  const task = (t: unknown): t is Record<string, unknown> =>
    isRecord(t) && typeof t['task'] === 'string' && typeof t['answer'] === 'string';
  return (
    isRecord(v) &&
    isRecord(v['execution']) &&
    typeof v['execution']['run'] === 'string' &&
    typeof v['execution']['force'] === 'boolean' &&
    typeof v['execution']['allowJudge'] === 'boolean' &&
    (v['tasks'] === undefined ||
      (isRecord(v['tasks']) &&
        Object.values(v['tasks']).every((text) => typeof text === 'string'))) &&
    (v['bound'] === undefined || isBoundPlan(v['bound'])) &&
    Array.isArray(v['batches']) &&
    v['batches'].every(
      (b) => task(b) && Array.isArray(b['items']) && b['items'].every(isPendingItem),
    ) &&
    Array.isArray(v['lint']) &&
    v['lint'].every((l) => task(l) && isTitlePlan(l['review']))
  );
}

function preparedTaskText(
  plan: Plan,
  bound: BoundPlan,
  task: { task: string; answer: string },
): string {
  const text = plan.tasks?.[task.task];
  if (typeof text !== 'string') throw new Error('CORRUPT_EXPECT_TASK');
  const envelope = {
    version: 2,
    binding: bound.binding,
    item: task.task,
    input: canonicalDigest(task),
    data: '<ответ согласно заданию>',
  };
  return `${text}\nОтвет только в конверте v2 (data — результат задания):\n${JSON.stringify(envelope)}\n`;
}

function checkPlanPaths(root: string, entry: string, plan: Plan): void {
  for (const item of [...plan.batches, ...plan.lint])
    for (const file of [item.task, item.answer]) expectHelperPath(root, entry, file);
}

export interface ExpectConsumerTask {
  task: string;
  kind: 'batch' | 'lint';
  text: string;
}

export interface ExpectPlanConsumer {
  tasks: readonly ExpectConsumerTask[];
  produce: (task: string, producer: (request: unknown) => Promise<unknown>) => Promise<void>;
  apply: () => Promise<void>;
}

export async function expectPlanConsumer(
  root: string,
  entryPath: string,
  now: Date,
): Promise<ExpectPlanConsumer> {
  const entry = normalizedProjectPath(entryPath);
  const file = expectHelperPath(root, entry, `${judgeDir(entry)}/plan.json`);
  const plan: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!isPlan(plan) || !isBoundPlan(plan.bound)) throw new Error('CORRUPT_EXPECT_PLAN');
  const bound = plan.bound;
  const { bound: ignored, ...payload } = plan;
  void ignored;
  if (canonicalDigest(payload) !== canonicalDigest(bound.payload))
    throw new Error('CORRUPT_EXPECT_PLAN');
  checkPlanPaths(root, entry, plan);
  const tasks = [...plan.batches, ...plan.lint];
  if (new Set(tasks.map((task) => task.task)).size !== tasks.length)
    throw new Error('CORRUPT_EXPECT_PLAN');
  const refs = plan.batches.flatMap((batch) =>
    batch.items.flatMap((item) => item.evidence.map((evidence) => evidence.ref)),
  );
  const capture = () => semanticGeneration(root, entry, refs);
  const inspect = async () => {
    await currentBoundPlan(root, entry, bound, capture);
    const current: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (canonicalDigest(current) !== canonicalDigest(plan)) throw new Error('CORRUPT_EXPECT_PLAN');
    for (const task of tasks)
      if (
        (await readFile(expectHelperPath(root, entry, task.task), 'utf8')) !==
        preparedTaskText(plan, bound, task)
      )
        throw new Error('CORRUPT_EXPECT_TASK');
    if (
      plan.lint.some((task) => !task.review.complete) ||
      plan.batches.some((batch) => batch.items.some((item) => item.binding?.complete !== true))
    )
      throw new Error('INCOMPLETE_EXPECT_PRODUCER: needs-review');
  };
  await inspect();
  const accepted = new Set<string>();
  return {
    tasks: [
      ...plan.batches.map(
        (task) =>
          ({
            task: task.task,
            kind: 'batch',
            text: preparedTaskText(plan, bound, task),
          }) satisfies ExpectConsumerTask,
      ),
      ...plan.lint.map(
        (task) =>
          ({
            task: task.task,
            kind: 'lint',
            text: preparedTaskText(plan, bound, task),
          }) satisfies ExpectConsumerTask,
      ),
    ],
    produce: async (item, producer) => {
      const task = tasks.find((task) => task.task === item);
      if (task === undefined) throw new Error('FOREIGN_EXPECT_TASK');
      await inspect();
      const answer = await runBoundProducer(
        root,
        entry,
        bound,
        item,
        canonicalDigest(task),
        capture,
        async (request) => {
          await inspect();
          const value = await producer(request);
          await inspect();
          return value;
        },
      );
      const data = validateAnswerEnvelope(bound, item, canonicalDigest(task), answer);
      if ('review' in task) applyTitleAnswer(task.review, data, now);
      else {
        const texts = new Map<string, string>();
        for (const ref of new Set(task.items.flatMap((item) => item.evidence.map((e) => e.ref))))
          texts.set(ref, await readEvidence(ref, root));
        if (applyAnswers(task.items, data, texts, now).rejected.length > 0)
          throw new Error('REJECTED_EXPECT_ANSWERS');
      }
      await inspect();
      await writeFile(
        expectHelperPath(root, entry, task.answer),
        JSON.stringify(answer, null, 2),
        'utf8',
      );
      accepted.add(item);
    },
    apply: async () => {
      if (accepted.size !== tasks.length) throw new Error('MISSING_EXPECT_ANSWERS');
      await inspect();
      await judgeApply({ root, now, params: { file: entry } });
    },
  };
}

async function judgePrepare(args: CommandArgs): Promise<number> {
  const lease = await acquireLease(
    args.root,
    `${entryLeaseName(entryOf(args))}-prepare`,
    'expect-collection',
  );
  try {
    return await judgePrepareWork(args);
  } finally {
    await lease.release();
  }
}

async function judgePrepareWork(args: CommandArgs): Promise<number> {
  const entry = entryOf(args);
  const run = await commandProofRun(args);
  const initial = criterionInventory(args.root, entry).generation;
  const JUDGE_DIR = `${judgeDir(entry)}/tasks/${randomUUID()}`;
  const dir = path.dirname(expectHelperPath(args.root, entry, `${JUDGE_DIR}/plan.json`));
  const pendingDir = expectHelperPath(args.root, entry, `${JUDGE_DIR}/pending`);
  const seenDir = expectHelperPath(args.root, entry, `${JUDGE_DIR}/seen`);
  const results = await collectOnce(
    { ...args, proofRun: run },
    { [COLLECT_ENV]: pendingDir, [SEEN_ENV]: seenDir },
  );
  if (existsSync(expectHelperPath(args.root, entry, `${JUDGE_DIR}/seen`)))
    for (const file of await readdir(expectHelperPath(args.root, entry, `${JUDGE_DIR}/seen`)))
      expectHelperPath(args.root, entry, `${JUDGE_DIR}/seen/${file}`);
  await rm(expectHelperPath(args.root, entry, `${JUDGE_DIR}/seen`), {
    recursive: true,
    force: true,
  });
  const items: PendingItem[] = [];
  if (existsSync(expectHelperPath(args.root, entry, `${JUDGE_DIR}/pending`))) {
    for (const f of (
      await readdir(expectHelperPath(args.root, entry, `${JUDGE_DIR}/pending`))
    ).sort()) {
      const item: unknown = JSON.parse(
        await readFile(expectHelperPath(args.root, entry, `${JUDGE_DIR}/pending/${f}`), 'utf8'),
      );
      if (!isPendingItem(item))
        throw new Error(`${JUDGE_DIR}/pending/${f}: неверная форма вопроса`);
      const current = await implementationContext(
        args.root,
        entry,
        item.question,
        item.evidence.map((evidence) => evidence.ref),
      );
      if (
        canonicalDigest(current.binding) !== canonicalDigest(item.binding) ||
        current.source !== item.source
      )
        throw new Error('STALE_EXPECT_INPUT');
      items.push(item);
    }
    await rm(expectHelperPath(args.root, entry, `${JUDGE_DIR}/pending`), {
      recursive: true,
      force: true,
    });
  }
  const plan: Plan = {
    batches: [],
    lint: [],
    execution: { run: run.id, force: run.force, allowJudge: run.allowJudge },
  };
  for (const [i, batch] of planBatches(items).entries()) {
    const task = `${JUDGE_DIR}/batch-${i + 1}.md`;
    const answer = `${JUDGE_DIR}/batch-${i + 1}.answer.json`;
    await mkdir(dir, { recursive: true });
    const texts = new Map<string, string>();
    for (const ref of batch.refs) texts.set(ref, await readEvidence(ref, args.root));
    for (const item of batch.items)
      for (const evidence of item.evidence)
        if (shaOf(texts.get(evidence.ref) ?? '') !== evidence.sha)
          throw new Error('STALE_EXPECT_EVIDENCE');
    await writeFile(
      expectHelperPath(args.root, entry, task),
      renderBatch(batch, answer, texts),
      'utf8',
    );
    plan.batches.push({ task, answer, items: batch.items });
  }
  const store = await loadVerdicts(args.root, entry);
  const producer = await producerContext(args.root);
  for (const [file, all] of byFile(results)) {
    const tests = visible(all);
    const { plan: review } = titleDelta(
      titlePlan(
        file,
        tests.map((t) => ({ file, path: t.path, title: t.title })),
        producer,
        tests.every((t) => t.criterion?.titleComplete === true),
      ),
      store.titles ?? {},
      run.force,
      run.id,
    );
    if (review.complete && review.checks.length === 0) continue;
    const n = plan.lint.length + 1;
    const task = `${JUDGE_DIR}/lint-${n}.md`;
    const answer = `${JUDGE_DIR}/lint-${n}.answer.json`;
    await mkdir(dir, { recursive: true });
    await writeFile(expectHelperPath(args.root, entry, task), renderTitlePlan(review), 'utf8');
    plan.lint.push({ task, answer, review });
  }
  if (plan.batches.length === 0 && plan.lint.length === 0) {
    console.log('expect judge: всё свежее, судья не нужен');
    return 0;
  }
  if (initial !== criterionInventory(args.root, entry).generation)
    throw new Error('STALE_EXPECT_GENERATION');
  const refs = [...new Set(items.flatMap((item) => item.evidence.map((evidence) => evidence.ref)))];
  plan.tasks = {};
  for (const task of [...plan.batches, ...plan.lint])
    plan.tasks[task.task] = await readFile(expectHelperPath(args.root, entry, task.task), 'utf8');
  const bound = await prepareBoundPlan(args.root, entry, plan, () =>
    semanticGeneration(args.root, entry, refs),
  );
  plan.bound = bound;
  for (const task of [...plan.batches, ...plan.lint]) {
    const text = preparedTaskText(plan, bound, task);
    await writeFile(expectHelperPath(args.root, entry, task.task), text, {
      encoding: 'utf8',
      flag: 'w',
    });
  }
  await writeFile(
    expectHelperPath(args.root, entry, `${judgeDir(entry)}/plan.json`),
    JSON.stringify(plan, null, 2),
    'utf8',
  );
  console.log(
    `expect judge: вопросов ${items.length} в пакетах ${plan.batches.length}, проверок заголовков ${plan.lint.length}`,
  );
  for (const t of [...plan.batches, ...plan.lint]) console.log(`  ${t.task} → ${t.answer}`);
  if (args.run !== true)
    console.log(
      'Каждый файл — задание судье (субагенту), ответ — в указанный JSON. Затем: ai expect judge --apply',
    );
  return 1;
}

async function judgeRun(args: CommandArgs): Promise<number> {
  const prepared = await judgePrepare(args);
  if (prepared === 0) return 0;
  const JUDGE_DIR = judgeDir(entryOf(args));
  const plan: unknown = JSON.parse(
    await readFile(expectHelperPath(args.root, entryOf(args), `${JUDGE_DIR}/plan.json`), 'utf8'),
  );
  if (!isPlan(plan)) throw new Error(`${JUDGE_DIR}/plan.json: неверная форма`);
  if (!isBoundPlan(plan.bound)) throw new Error('LEGACY_EXPECT_PLAN: needs-review');
  const bound = plan.bound;
  const { bound: ignored, ...payload } = plan;
  void ignored;
  if (canonicalDigest(payload) !== canonicalDigest(bound.payload))
    throw new Error('CORRUPT_EXPECT_PLAN');
  if (
    !bound.generation.complete ||
    plan.lint.some((task) => !task.review.complete) ||
    plan.batches.some((batch) => batch.items.some((item) => item.binding?.complete !== true))
  ) {
    console.error('INCOMPLETE_EXPECT_PRODUCER: needs-review; agent calls 0');
    return 1;
  }
  checkPlanPaths(args.root, entryOf(args), plan);
  const tasks = [...plan.batches, ...plan.lint];
  const envDir = process.env['HARNESS_EXPECT_TRANSCRIPT'];
  const transcriptDir =
    envDir !== undefined && envDir.trim() !== ''
      ? envDir
      : path.posix.join(JUDGE_DIR, 'transcripts');
  const failed = await Promise.all(
    tasks.map(async (t) => {
      const text = preparedTaskText(plan, bound, t);
      if (text !== (await readFile(expectHelperPath(args.root, entryOf(args), t.task), 'utf8')))
        throw new Error('CORRUPT_EXPECT_TASK');
      const name = path.basename(t.task, '.md');
      const transcript = expectHelperPath(
        args.root,
        entryOf(args),
        path.posix.join(transcriptDir, `${name}.jsonl`),
      );
      try {
        const refs = plan.batches.flatMap((batch) =>
          batch.items.flatMap((item) => item.evidence.map((evidence) => evidence.ref)),
        );
        const answer = await runBoundProducer(
          args.root,
          entryOf(args),
          bound,
          t.task,
          canonicalDigest(t),
          () => semanticGeneration(args.root, entryOf(args), refs),
          async () => {
            const { data } = await askRole(
              args.root,
              'judge',
              `${text}\nФайл ответа не пиши: верни итог инструментом submit_result; инструмента нет — тем же JSON в код-блоке последним сообщением.`,
              {
                transcript,
                modelContext: 'expect.judge',
                context: { purpose: 'expect-helper', entry: entryOf(args) },
              },
            );
            return data;
          },
        );
        await writeFile(
          expectHelperPath(args.root, entryOf(args), t.answer),
          JSON.stringify(answer, null, 2),
          'utf8',
        );
        console.log(`  ${t.task}: ответ получен`);
        return 0;
      } catch (error) {
        console.error(`  ${t.task}: ${errorMessage(error)}`);
        return 1;
      }
    }),
  );
  const applied = await judgeApply(args);
  return failed.some((f) => f !== 0) ? 1 : applied;
}

async function judgeApply(args: CommandArgs): Promise<number> {
  const JUDGE_DIR = judgeDir(entryOf(args));
  const planFile = expectHelperPath(args.root, entryOf(args), `${JUDGE_DIR}/plan.json`);
  if (!existsSync(planFile)) throw new UsageError('нет плана: сначала ai expect judge');
  const plan: unknown = JSON.parse(await readFile(planFile, 'utf8'));
  if (!isPlan(plan))
    throw new UsageError(`${JUDGE_DIR}/plan.json: неверная форма — заново ai expect judge`);
  checkPlanPaths(args.root, entryOf(args), plan);
  const bound = plan.bound;
  if (!isBoundPlan(bound)) throw new UsageError('LEGACY_EXPECT_PLAN: needs-review');
  const { bound: ignored, ...payload } = plan;
  void ignored;
  if (canonicalDigest(payload) !== canonicalDigest(bound.payload))
    throw new Error('CORRUPT_EXPECT_PLAN');
  const refs = plan.batches.flatMap((batch) =>
    batch.items.flatMap((item) => item.evidence.map((evidence) => evidence.ref)),
  );
  await applyBoundPlan(
    args.root,
    entryOf(args),
    bound,
    () => semanticGeneration(args.root, entryOf(args), refs),
    () => validatePlanAnswers(args, plan, bound),
    (store) => saveVerdicts(store, args.root, entryOf(args)),
  );
  console.log(`expect judge --apply: вердикты сохранены в ${verdictsPath(entryOf(args))}`);
  return 0;
}

async function validatePlanAnswers(
  args: CommandArgs,
  plan: Plan,
  bound: BoundPlan,
): Promise<VerdictStore> {
  const store = await loadVerdicts(args.root, entryOf(args));
  const run = await commandProofRun(args);
  const currentRun =
    plan.execution.run === run.id &&
    plan.execution.force === run.force &&
    plan.execution.allowJudge === run.allowJudge
      ? run.id
      : undefined;
  const rejected: string[] = [];
  const readJson = async (rel: string): Promise<unknown> => {
    const file = expectHelperPath(args.root, entryOf(args), rel);
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return undefined;
    }
  };
  for (const b of plan.batches) {
    const envelope = await readJson(b.answer);
    if (envelope === undefined) {
      rejected.push(`${b.answer}: нет ответа`);
      continue;
    }
    const answers = validateAnswerEnvelope(bound, b.task, canonicalDigest(b), envelope);
    if (b.items.some((item) => item.binding?.complete !== true))
      throw new Error('INCOMPLETE_EXPECT_INPUT: needs-review');
    const texts = new Map<string, string>();
    for (const ref of new Set(b.items.flatMap((i) => i.evidence.map((e) => e.ref))))
      texts.set(ref, await readEvidence(ref, args.root));
    const result = applyAnswers(b.items, answers, texts, args.now);
    for (const [id, verdict] of Object.entries(result.accepted)) {
      const old = store.verdicts[id];
      store.verdicts[id] =
        old === undefined
          ? sealVerdict({ ...verdict, ...(currentRun === undefined ? {} : { run: currentRun }) })
          : sealVerdict({
              ...verdict,
              ...(currentRun === undefined ? {} : { run: currentRun }),
              history: [...(old.history ?? []), { ...old, history: [] }],
            });
    }
    for (const r of result.rejected) rejected.push(`${b.answer}: ${r.id} — ${r.reason}`);
  }
  for (const l of plan.lint) {
    const answer = validateAnswerEnvelope(
      bound,
      l.task,
      canonicalDigest(l),
      await readJson(l.answer),
    );
    for (const proof of applyTitleAnswer(l.review, answer, args.now, currentRun)) {
      store.titles ??= {};
      store.titles[proof.check.id] = proof;
    }
  }
  for (const r of rejected) console.error(r);
  if (rejected.length > 0) {
    console.error(`expect judge --apply: отклонено ${rejected.length}; изменения не сохранены`);
    throw new Error('REJECTED_EXPECT_ANSWERS');
  }
  return store;
}

const initIndex = (name: string): string => `import './${name}.expect.ts';
`;

const initExample = (name: string): string => `import { describe, it } from 'vitest';
import { budget } from '@shahimat/ai-core/expect';

budget({ crit: 0, warn: 0 });

describe('${name}', () => {
  it.todo('первое ожидание: одно утверждение до 200 символов, да/нет или число');
});

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
  const gitignore = path.join(args.root, '.gitignore');
  const ignored = existsSync(gitignore) ? await readFile(gitignore, 'utf8') : '';
  const missing = ARTIFACT_IGNORE_LINES.filter((line) => !ignored.split('\n').includes(line));
  if (missing.length > 0) {
    await writeFile(
      gitignore,
      `${ignored}${ignored === '' || ignored.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`,
      'utf8',
    );
    done.push(`.gitignore: local artifact roots (${missing.length})`);
  }

  const pkgFile = path.join(args.root, 'package.json');
  if (existsSync(pkgFile)) {
    const pkg: unknown = JSON.parse(await readFile(pkgFile, 'utf8'));
    if (!isRecord(pkg)) throw new UsageError('package.json: корень должен быть объектом');
    const current = pkg['scripts'] ?? {};
    if (!isRecord(current)) throw new UsageError('package.json: scripts должно быть объектом');
    const scripts = {
      expect: `ai expect report ${INDEX_ENTRY} --root .`,
      'expect:judge': `ai expect judge ${INDEX_ENTRY} --root .`,
      'expect:apply': `ai expect judge ${INDEX_ENTRY} --apply --root .`,
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
  console.log('Зависимости: npm i -D vitest @shahimat/ai-core');
  return 0;
}

export async function runExpect(command: string | undefined, args: CommandArgs): Promise<number> {
  if ((args.run === true || args.apply === true) && command !== 'judge')
    throw new UsageError('--run/--apply supported only for expect judge');
  if (args.run === true && args.apply === true)
    throw new UsageError('--run and --apply are exclusive');
  if (args.force === true && !['report', 'lint', 'judge'].includes(command ?? ''))
    throw new UsageError('--force supported only for expect report/lint/judge');
  process.env['HARNESS_EXPECT_ROOT'] = args.root;
  if (['report', 'lint', 'judge'].includes(command ?? ''))
    args = { ...args, proofRun: await commandProofRun(args) };
  try {
    switch (command) {
      case 'init':
        return await init(args);
      case 'report':
        return await report(args);
      case 'serve':
        return await serve(args);
      case 'lint':
        return await lint(args);
      case 'judge':
        if (args.apply === true) return await judgeApply(args);
        return args.run === true ? await judgeRun(args) : await judgePrepare(args);
      default:
        throw new UsageError(`неизвестная команда: expect ${command ?? ''}`.trimEnd());
    }
  } catch (error) {
    if (!(error instanceof CollectionNeedsReview)) throw error;
    console.error(`expect needs-review: ${error.message}`);
    return 1;
  }
}
