import { existsSync } from 'node:fs';
import { readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, isRecord, isStringArray } from '@shahimat/ai-core';
import { listSessions, type Session } from '#harnesses/core/store/session';
import { appendLine, readJson, readText, remove, writeAtomic, writeJson } from './files.ts';
import { jobDir, OPS_VERSION } from './paths.ts';
import type { TaskCard } from './providers.ts';

export const JOB_HARNESS = 'ticket-work';

export interface JobMeta {
  v: number;
  id: string;
  short: string;
  ref: string;
  workdir?: string;
  published?: string;
}

export const jobFile = (s: Session, rel: string): string =>
  path.join(jobDir(s.data.project, s.short), rel);

export async function jobMeta(s: Session): Promise<JobMeta> {
  const data = await readJson(jobFile(s, 'job.json'), `${s.short}/job.json`);
  const meta: JobMeta = { v: OPS_VERSION, id: s.id, short: s.short, ref: s.data.request };
  if (isRecord(data) && typeof data['workdir'] === 'string') meta.workdir = data['workdir'];
  if (isRecord(data) && typeof data['published'] === 'string') meta.published = data['published'];
  return meta;
}

export const saveMeta = (s: Session, meta: JobMeta): Promise<void> =>
  writeJson(jobFile(s, 'job.json'), meta);

export async function jobLog(s: Session, text: string): Promise<void> {
  const at = new Date().toISOString();
  await appendLine(
    jobFile(s, 'log.md'),
    `- ${at.slice(0, 16).replace('T', ' ')} · ${s.data.state} · ${text}`,
  );
  await appendLine(jobFile(s, 'events.jsonl'), JSON.stringify({ at, state: s.data.state, text }));
}

export function renderCard(card: TaskCard): string {
  return [
    `# ${card.title}`,
    '',
    `Источник: ${card.ref}`,
    '',
    '## Definition of Done',
    '',
    ...(card.dod.length === 0 ? ['- (в источнике нет DoD)'] : card.dod.map((d) => `- ${d}`)),
    '',
    '## Ссылки',
    '',
    ...(card.links.length === 0 ? ['- нет'] : card.links.map((l) => `- ${l}`)),
    '',
    '## Текст задачи',
    '',
    card.body.trim(),
    '',
  ].join('\n');
}

export async function writeCard(s: Session, card: TaskCard): Promise<{ dodChanged: boolean }> {
  const file = jobFile(s, 'dod.json');
  const before = await readJson(file, `${s.short}/dod.json`);
  const dodChanged = isStringArray(before) && JSON.stringify(before) !== JSON.stringify(card.dod);
  await writeAtomic(jobFile(s, 'task.md'), renderCard(card));
  if (!dodChanged) await writeJson(file, card.dod);
  return { dodChanged };
}

export const acceptDod = async (s: Session, dod: string[]): Promise<void> =>
  writeJson(jobFile(s, 'dod.json'), dod);

export interface Pending {
  state: string;
  questions: string[];
  answer?: string;
}

export async function pending(s: Session): Promise<Pending | undefined> {
  const data = await readJson(jobFile(s, 'questions.json'), `${s.short}/questions.json`);
  if (!isRecord(data) || typeof data['state'] !== 'string' || !isStringArray(data['questions']))
    return undefined;
  const p: Pending = { state: data['state'], questions: data['questions'] };
  if (typeof data['answer'] === 'string') p.answer = data['answer'];
  return p;
}

export const ask = (s: Session, questions: string[]): Promise<void> =>
  writeJson(jobFile(s, 'questions.json'), { state: s.data.state, questions });

export async function answer(s: Session, text: string): Promise<'question' | 'gate'> {
  const p = await pending(s);
  if (p !== undefined && p.state === s.data.state) {
    await writeJson(jobFile(s, 'questions.json'), { ...p, answer: text });
    return 'question';
  }
  await writeJson(jobFile(s, 'answer.json'), { state: s.data.state, text });
  return 'gate';
}

export async function takeAnswered(s: Session): Promise<string | undefined> {
  const p = await pending(s);
  if (p === undefined || p.state !== s.data.state || p.answer === undefined) return undefined;
  await remove(jobFile(s, 'questions.json'));
  return (
    p.questions.map((q, i) => `${i + 1}. ${q}`).join('\n') + `\n\nОтвет пользователя: ${p.answer}`
  );
}

export async function takeGate(s: Session): Promise<string | undefined> {
  const data = await readJson(jobFile(s, 'answer.json'), `${s.short}/answer.json`);
  if (!isRecord(data) || data['state'] !== s.data.state || typeof data['text'] !== 'string')
    return undefined;
  await remove(jobFile(s, 'answer.json'));
  return data['text'];
}

export async function addFeedback(root: string, short: string, text: string): Promise<void> {
  await appendLine(path.join(jobDir(root, short), 'feedback.md'), `${text.trim()}\n`);
}

export async function takeFeedback(s: Session): Promise<string | undefined> {
  const file = jobFile(s, 'feedback.md');
  const text = await readText(file);
  if (text === undefined || text.trim() === '') return undefined;
  let n = 1;
  while (existsSync(jobFile(s, `feedback-${n}.md`))) n++;
  await rename(file, jobFile(s, `feedback-${n}.md`));
  return text.trim();
}

export async function lastFeedback(s: Session): Promise<string | undefined> {
  let n = 1;
  while (existsSync(jobFile(s, `feedback-${n + 1}.md`))) n++;
  return readText(jobFile(s, `feedback-${n}.md`));
}

export async function runIndex(s: Session, state: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(jobFile(s, 'runs'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 1;
    throw error;
  }
  return names.filter((n) => n.startsWith(`${state}-`)).length + 1;
}

export async function projectJobs(home: string, root: string): Promise<Session[]> {
  return (await listSessions(home)).filter(
    (s) => s.data.harness === JOB_HARNESS && path.resolve(s.data.project) === path.resolve(root),
  );
}

export const AFFIRMATIVE =
  /^\s*(да|ок|ok|yes|y|approve|approved|го|поехали|готово|done|merged|влито)\s*[.!]?\s*$/i;

const AFFIRMATIVE_HEAD =
  /^\s*(да|ок|ok|yes|approved|approve|y|го|поехали|готово|done|merged|влито)(?=$|[\s.,!:;—–-])[\s.,!:;—–-]*([\s\S]*)$/i;

export function affirmation(text: string): { yes: boolean; rest: string } {
  const m = AFFIRMATIVE_HEAD.exec(text);
  return m === null ? { yes: false, rest: text.trim() } : { yes: true, rest: (m[2] ?? '').trim() };
}

export const EXTERNAL_DONE = 'external.done';

export async function markExternal(root: string, short: string, text: string): Promise<void> {
  await appendLine(path.join(jobDir(root, short), EXTERNAL_DONE), `${text.trim()}\n`);
}
