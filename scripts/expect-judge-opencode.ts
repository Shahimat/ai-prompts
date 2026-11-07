import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findRole, resolveProjectModel } from '@shahimat/ai-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENTRY = 'expectations/index.expect.ts';
const JUDGE_DIR = 'expectations/.judge';

interface Task {
  task: string;
  answer: string;
}

interface Plan {
  batches: Task[];
  lint: Task[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringAt = (value: unknown, key: string): string => {
  if (!isRecord(value)) throw new Error(`нет объекта с полем ${key}`);
  const field = value[key];
  if (typeof field !== 'string') throw new Error(`поле ${key} — не строка`);
  return field;
};

const taskList = (value: unknown): Task[] => {
  if (!Array.isArray(value)) throw new Error('план: список задач — не массив');
  return value.map((entry) => ({ task: stringAt(entry, 'task'), answer: stringAt(entry, 'answer') }));
};

const readPlan = async (): Promise<Plan> => {
  const data: unknown = JSON.parse(await readFile(path.join(ROOT, JUDGE_DIR, 'plan.json'), 'utf8'));
  if (!isRecord(data)) throw new Error('план: не объект');
  return { batches: taskList(data['batches']), lint: taskList(data['lint']) };
};

const stripAnsi = (text: string): string =>
  text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');

const parseJson = (text: string, kind: 'batch' | 'lint'): unknown => {
  const clean = stripAnsi(text);
  const blocks = [...clean.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].reverse();
  for (const block of blocks) {
    const body = block[1];
    if (body === undefined) continue;
    try {
      const value: unknown = JSON.parse(body.trim());
      if (kind === 'batch' ? Array.isArray(value) : isRecord(value)) return value;
    } catch {}
  }
  const start = kind === 'batch' ? clean.lastIndexOf('[') : clean.lastIndexOf('{');
  if (start >= 0) {
    try {
      const value: unknown = JSON.parse(clean.slice(start).trim());
      if (kind === 'batch' ? Array.isArray(value) : isRecord(value)) return value;
    } catch {}
  }
  throw new Error(`судья не вернул JSON (${kind}): ${clean.slice(-500)}`);
};

const run = (command: string, args: string[], timeout = 30 * 60_000): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

const prepare = (): boolean => {
  const result = run(process.execPath, ['packages/cli/dist/bin.js', 'expect', 'judge', ENTRY, '--root', '.']);
  if (result.status === 0) {
    console.log('expect judge: всё свежее, судья не нужен');
    return false;
  }
  if (result.status !== 1) {
    console.error(result.stderr || result.stdout);
    throw new Error(`expect judge: код ${result.status}`);
  }
  return true;
};

const ask = (task: Task, kind: 'batch' | 'lint', model: string): unknown => {
  const prompt = [
    `Прочитай задание из файла \`${task.task}\` целиком.`,
    'Ничего не создавай и не правь: у тебя только чтение.',
    kind === 'batch'
      ? 'Верни JSON-массив ответов последним блоком сообщения; файл ответа не пиши.'
      : 'Верни JSON-объект с contradictions и unmeasurable последним блоком сообщения; файл ответа не пиши.',
  ].join(' ');
  const result = run('opencode', [
    'run',
    '--standalone',
    '--agent',
    'judge',
    '--model',
    model,
    prompt,
  ]);
  if (result.status !== 0) throw new Error(`opencode run judge: код ${result.status}: ${result.stderr.slice(-500)}`);
  return parseJson(result.stdout, kind);
};

const main = async (): Promise<number> => {
  const role = await findRole(ROOT, 'judge');
  if (role.model === undefined) throw new Error('judge: модель не задана');
  const { model } = await resolveProjectModel(ROOT, 'judge', role.model, 'expect.judge');
  if (!prepare()) return 0;
  const plan = await readPlan();
  const tasks = [
    ...plan.batches.map((task) => ({ ...task, kind: 'batch' as const })),
    ...plan.lint.map((task) => ({ ...task, kind: 'lint' as const })),
  ];
  for (const task of tasks) {
    const answer = ask(task, task.kind, model);
    await writeFile(path.join(ROOT, task.answer), `${JSON.stringify(answer, null, 2)}\n`, 'utf8');
    console.log(`  ${task.task}: ответ получен`);
  }
  const applied = run(process.execPath, [
    'packages/cli/dist/bin.js',
    'expect',
    'judge',
    ENTRY,
    '--apply',
    '--root',
    '.',
  ]);
  if (applied.stdout.trim() !== '') console.log(applied.stdout.trim());
  if (applied.stderr.trim() !== '') console.error(applied.stderr.trim());
  return applied.status;
};

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
