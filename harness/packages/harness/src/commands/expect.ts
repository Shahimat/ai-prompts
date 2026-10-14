// expect:expect-cycles
// expect:verdict-prune
// expect:verdict-by-code
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UsageError } from '../diagnostics.ts';
import { applyAnswers, applyLintAnswer, planBatches, renderBatch, renderLintBatch } from '../expect/batch.ts';
import { readEvidence, shaOf } from '../expect/evidence.ts';
import { COLLECT_ENV, idOf, SEEN_ENV, type PendingItem } from '../expect/judge.ts';
import { BUDGET_TITLE, type Budget, type Level } from '../expect/levels.ts';
import { lintTitles, type Title } from '../expect/lint.ts';
import { loadVerdicts, pruneStore, saveVerdicts, VERDICTS_PATH } from '../expect/verdicts.ts';
import type { CommandArgs } from './types.ts';

export const EXPECT_CONFIG = 'expectations/vitest.config.ts';
const JUDGE_DIR = 'expectations/.judge';

interface TestResult {
  file: string;
  path: string[];
  title: string;
  status: 'passed' | 'failed' | 'todo' | 'skipped' | 'pending';
  message: string;
  level: Level;
  notes: string[];
  budget?: Budget;
}

interface VitestJson {
  testResults: {
    name: string;
    assertionResults: {
      ancestorTitles: string[];
      title: string;
      status: string;
      failureMessages: string[];
      meta?: { level?: Level; notes?: string[]; budget?: Budget };
    }[];
  }[];
}

/** Запускает vitest проекта на файлах ожиданий и возвращает результаты. */
function runVitest(root: string, env: Record<string, string> = {}): TestResult[] {
  if (!existsSync(path.join(root, EXPECT_CONFIG))) throw new UsageError(`нет ${EXPECT_CONFIG}`);
  const require = createRequire(path.join(root, 'package.json'));
  let vitestPkg: string;
  try {
    vitestPkg = require.resolve('vitest/package.json');
  } catch {
    throw new UsageError('vitest не установлен в проекте: npm i -D vitest');
  }
  const bin = (JSON.parse(readFileSync(vitestPkg, 'utf8')) as { bin: Record<string, string> }).bin['vitest'] ?? '';
  const out = path.join(tmpdir(), `harness-expect-${process.pid}-${Date.now()}.json`);
  spawnSync(
    process.execPath,
    [path.join(path.dirname(vitestPkg), bin), 'run', '--root', root, '--config', EXPECT_CONFIG, '--reporter=json', `--outputFile=${out}`],
    { cwd: root, env: { ...process.env, ...env, HARNESS_EXPECT_ROOT: root }, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (!existsSync(out)) throw new Error('vitest не записал отчёт');
  const data = JSON.parse(readFileSync(out, 'utf8')) as VitestJson;
  rmSync(out, { force: true });
  return data.testResults.flatMap((file) =>
    file.assertionResults.map((a) => {
      const result: TestResult = {
        file: path.relative(root, file.name).split(path.sep).join('/'),
        path: a.ancestorTitles,
        title: a.title,
        status: a.status as TestResult['status'],
        message: (a.failureMessages[0] ?? '').split('\n')[0] ?? '',
        // Обычный it() без обёртки — crit: формальная проверка по умолчанию.
        level: a.meta?.level ?? 'crit',
        notes: a.meta?.notes ?? [],
      };
      if (a.meta?.budget !== undefined) result.budget = a.meta.budget;
      return result;
    }),
  );
}

const fullName = (t: { path: string[]; title: string }): string => [...t.path, t.title].join(' > ');

function byFile(results: TestResult[]): Map<string, TestResult[]> {
  const files = new Map<string, TestResult[]>();
  for (const r of results) files.set(r.file, [...(files.get(r.file) ?? []), r]);
  return files;
}

const titlesSha = (tests: TestResult[]): string => shaOf(tests.map(fullName).sort().join('\n'));

const isPending = (t: TestResult): boolean => t.status === 'failed' && t.message.includes('нет свежего вердикта');

async function report(args: CommandArgs): Promise<number> {
  const all = runVitest(args.root);
  const store = await loadVerdicts();
  const titleIssues = lintTitles(all.filter((r) => r.title !== BUDGET_TITLE).map((r) => ({ file: r.file, path: r.path, title: r.title })));
  let blocked = false;
  let total = { tests: 0, crit: 0, warn: 0, info: 0, pending: 0 };

  for (const [file, tests] of byFile(all)) {
    const budget: Budget = tests.find((t) => t.title === BUDGET_TITLE)?.budget ?? { crit: 0, warn: 0 };
    const items = tests.filter((t) => t.title !== BUDGET_TITLE);
    const count = { crit: 0, warn: 0, info: 0, pending: 0 };
    console.log(file);
    let prev: string[] = [];
    for (const t of items) {
      t.path.forEach((p, i) => {
        if (prev[i] !== p) console.log(`${'  '.repeat(i + 1)}${p}`);
      });
      prev = t.path;
      const pad = '  '.repeat(t.path.length + 1);
      if (isPending(t)) {
        count.pending++;
        console.log(`${pad}? ${t.title}  — нужен вердикт судьи`);
      } else if (t.status === 'failed') {
        count[t.level === 'warn' ? 'warn' : 'crit']++;
        console.log(`${pad}${t.level === 'warn' ? '⚠' : '✗'} ${t.title}  — ${t.message}`);
      } else {
        console.log(`${pad}${t.status === 'todo' ? '○' : t.status === 'passed' ? '✓' : '-'} ${t.title}`);
      }
      for (const n of t.notes) console.log(`${pad}  ℹ ${n}`);
      count.info += t.notes.length;
    }

    for (const d of titleIssues.filter((i) => i.title.file === file)) {
      count[d.level]++;
      console.log(`  ${d.level === 'crit' ? '✗' : '⚠'} заголовок «${d.title.title}» — ${d.message}`);
    }
    const lint = store.lint[file];
    if (lint === undefined || lint.titles !== titlesSha(items)) {
      count.pending++;
      console.log('  ? смысловая проверка заголовков устарела — harness expect judge');
    } else {
      const name = new Map(items.map((t) => [idOf(fullName(t)), t.title]));
      for (const c of lint.contradictions) console.log(`  ⚠ противоречие: «${name.get(c.a)}» ↔ «${name.get(c.b)}» — ${c.reason}`);
      for (const u of lint.unmeasurable) console.log(`  ⚠ неизмеримо: «${name.get(u.id)}» — ${u.reason}`);
      count.warn += lint.contradictions.length + lint.unmeasurable.length;
    }

    const over = count.crit > budget.crit || count.warn > budget.warn || count.pending > 0;
    blocked ||= over;
    console.log(
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
  }
  console.log(
    `\nожиданий ${total.tests}: crit ${total.crit} · warn ${total.warn} · info ${total.info} · ? ${total.pending} — ${blocked ? 'бюджет превышен' : 'в бюджете'}`,
  );
  return blocked ? 1 : 0;
}

async function lint(args: CommandArgs): Promise<number> {
  const titles: Title[] = runVitest(args.root)
    .filter((r) => r.title !== BUDGET_TITLE)
    .map((r) => ({ file: r.file, path: r.path, title: r.title }));
  const diags = lintTitles(titles);
  for (const d of diags) console.error(`${d.level} ${d.title.file}: «${d.title.title}» — ${d.message}`);
  console.log(diags.length === 0 ? `expect lint: ok (${titles.length})` : `expect lint: нарушений ${diags.length}`);
  return diags.length === 0 ? 0 : 1;
}

interface Plan {
  batches: { task: string; answer: string; items: PendingItem[] }[];
  lint: { task: string; answer: string; file: string; titles: string; ids: string[] }[];
}

async function judgePrepare(args: CommandArgs): Promise<number> {
  const dir = path.join(args.root, JUDGE_DIR);
  await rm(dir, { recursive: true, force: true });
  const pendingDir = path.join(dir, 'pending');
  const seenDir = path.join(dir, 'seen');
  const results = runVitest(args.root, { [COLLECT_ENV]: pendingDir, [SEEN_ENV]: seenDir });
  const seen = new Set(existsSync(seenDir) ? await readdir(seenDir) : []);
  await rm(seenDir, { recursive: true, force: true });
  const items: PendingItem[] = [];
  if (existsSync(pendingDir)) {
    for (const f of (await readdir(pendingDir)).sort()) items.push(JSON.parse(await readFile(path.join(pendingDir, f), 'utf8')) as PendingItem);
    await rm(pendingDir, { recursive: true, force: true });
  }
  const plan: Plan = { batches: [], lint: [] };
  for (const [i, batch] of planBatches(items).entries()) {
    const task = `${JUDGE_DIR}/batch-${i + 1}.md`;
    const answer = `${JUDGE_DIR}/batch-${i + 1}.answer.json`;
    await mkdir(dir, { recursive: true });
    const texts = new Map<string, string>();
    for (const ref of batch.refs.filter((r) => r.startsWith('@'))) texts.set(ref, await readEvidence(ref));
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
    const tests = all.filter((t) => t.title !== BUDGET_TITLE);
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
  console.log(`expect judge: вопросов ${items.length} в пакетах ${plan.batches.length}, проверок заголовков ${plan.lint.length}`);
  for (const t of [...plan.batches, ...plan.lint]) console.log(`  ${t.task} → ${t.answer}`);
  console.log('Каждый файл — задание судье (субагенту), ответ — в указанный JSON. Затем: harness expect judge --apply');
  return 1;
}

async function judgeApply(args: CommandArgs): Promise<number> {
  const planFile = path.join(args.root, JUDGE_DIR, 'plan.json');
  if (!existsSync(planFile)) throw new UsageError('нет плана: сначала harness expect judge');
  const plan = JSON.parse(await readFile(planFile, 'utf8')) as Plan;
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
    for (const ref of new Set(b.items.flatMap((i) => i.evidence.map((e) => e.ref)))) texts.set(ref, await readEvidence(ref));
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
    console.error(`expect judge --apply: отклонено ${rejected.length}; принятое сохранено в ${VERDICTS_PATH}`);
    return 1;
  }
  await rm(path.join(args.root, JUDGE_DIR), { recursive: true, force: true });
  console.log(`expect judge --apply: вердикты сохранены в ${VERDICTS_PATH}`);
  return 0;
}

const INIT_CONFIG = `import { defineConfig } from 'vitest/config';

// Ожидания: заголовки crit/warn — для человека, проверки — класс Check ниже в файле.
// Отчёт: npm run expect. Вердикты судьи: npm run expect:judge → expect:apply.
export default defineConfig({
  test: {
    include: ['expectations/**/*.expect.ts'],
    testTimeout: 30_000,
  },
});
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

/** Каркас ожиданий в проекте; существующие файлы не трогаются. */
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
  await put(EXPECT_CONFIG, INIT_CONFIG);
  await put(`expectations/${name}.expect.ts`, initExample(name));

  const gitignore = path.join(args.root, '.gitignore');
  const ignored = existsSync(gitignore) ? await readFile(gitignore, 'utf8') : '';
  if (!ignored.split('\n').includes(`${JUDGE_DIR}/`)) {
    await writeFile(gitignore, `${ignored}${ignored === '' || ignored.endsWith('\n') ? '' : '\n'}${JUDGE_DIR}/\n`, 'utf8');
    done.push(`.gitignore: ${JUDGE_DIR}/`);
  }

  const pkgFile = path.join(args.root, 'package.json');
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(await readFile(pkgFile, 'utf8')) as { scripts?: Record<string, string> };
    const scripts = { expect: 'harness expect report --root .', 'expect:judge': 'harness expect judge --root .', 'expect:apply': 'harness expect judge --apply --root .' };
    const added = Object.entries(scripts).filter(([k]) => pkg.scripts?.[k] === undefined);
    if (added.length > 0) {
      pkg.scripts = { ...pkg.scripts, ...Object.fromEntries(added) };
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
  // Кэш вердиктов и доказательства читаются от --root, а не от текущей папки.
  process.env['HARNESS_EXPECT_ROOT'] = args.root;
  switch (command) {
    case 'init':
      return init(args);
    case 'report':
      return report(args);
    case 'lint':
      return lint(args);
    case 'judge':
      return args.apply === true ? judgeApply(args) : judgePrepare(args);
    default:
      throw new UsageError(`неизвестная команда: expect ${command ?? ''}`.trimEnd());
  }
}
