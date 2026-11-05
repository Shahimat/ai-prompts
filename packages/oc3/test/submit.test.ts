import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { submitResult } from '#submit';

const ENV_OUT = 'HARNESS_SUBMIT_OUT';

const RESULT_DATA = {
  status: 'done',
  changed: ['packages/oc3/src/submit.ts'],
  failed: [],
  questions: [],
  report: 'готово',
};

const VERDICT_DATA = {
  answers: [{ id: 'd1', verdict: true, ref: 'a.ts:1', quote: 'x', reason: 'проверено' }],
};

const QUESTION_DATA = {
  question: 'Продолжать?',
  options: [{ label: 'да' }, { label: 'нет' }],
  default: 'да',
  reason: 'ветвление работ',
};

let root: string;
let out: string;

const writeRole = async (name: string, output: string): Promise<void> => {
  await mkdir(path.join(root, 'agents'), { recursive: true });
  await writeFile(
    path.join(root, 'agents', `${name}.md`),
    `---\nname: ${name}\ndescription: роль\noutput: ${output}\n---\nИнструкции роли\n`,
    'utf8',
  );
};

const call = (agent: string, input: unknown, sessionID = 'ses_test') => ({
  root,
  agent,
  sessionID,
  input,
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-submit-'));
  out = path.join(root, 'job', 'submit.json');
  process.env[ENV_OUT] = out;
});

afterEach(async () => {
  delete process.env[ENV_OUT];
  await rm(root, { recursive: true, force: true });
});

describe('submit_result', () => {
  it('валидный submit роли принят и записан в файл раннера', async () => {
    await writeRole('executor', 'result');
    const text = await submitResult(call('executor', { message: 'result', data: RESULT_DATA }));
    expect(text).toContain('принято');
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(RESULT_DATA);
  });

  it('вердикт судьи принят и зафиксирован', async () => {
    await writeRole('judge', 'verdict');
    await submitResult(call('judge', { message: 'verdict', data: VERDICT_DATA }));
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(VERDICT_DATA);
  });

  it('блокирующий вопрос принят от роли с output question', async () => {
    await writeRole('researcher', 'question');
    const text = await submitResult(
      call('researcher', { message: 'question', data: QUESTION_DATA }),
    );
    expect(text).toContain('question');
  });

  it('без переменной раннера итог пишется в файл сессии проекта', async () => {
    delete process.env[ENV_OUT];
    await writeRole('executor', 'result');
    await submitResult(call('executor', { message: 'result', data: RESULT_DATA }, 'ses_abc'));
    expect(
      JSON.parse(await readFile(path.join(root, '.oc3', 'submit', 'ses_abc.json'), 'utf8')),
    ).toEqual(RESULT_DATA);
  });

  it('некорректный sessionID отклоняется', async () => {
    delete process.env[ENV_OUT];
    await writeRole('executor', 'result');
    await expect(
      submitResult(call('executor', { message: 'result', data: RESULT_DATA }, 'ses/../x')),
    ).rejects.toThrow('sessionID');
  });

  it('лишние поля в data отклонены', async () => {
    await writeRole('executor', 'result');
    await expect(
      submitResult(call('executor', { message: 'result', data: { ...RESULT_DATA, cost: '1' } })),
    ).rejects.toThrow('data не по схеме result');
  });

  it('лишние поля конверта отклонены', async () => {
    await writeRole('executor', 'result');
    await expect(
      submitResult(call('executor', { message: 'result', data: RESULT_DATA, extra: 1 })),
    ).rejects.toThrow('конверт не по схеме');
  });

  it('чужая схема отклонена: verdict не принимает result', async () => {
    await writeRole('judge', 'verdict');
    await expect(
      submitResult(call('judge', { message: 'verdict', data: RESULT_DATA })),
    ).rejects.toThrow('data не по схеме verdict');
  });

  it('сообщение чужого типа для роли отклонено', async () => {
    await writeRole('judge', 'verdict');
    await expect(
      submitResult(call('judge', { message: 'result', data: RESULT_DATA })),
    ).rejects.toThrow('роль judge возвращает verdict');
  });

  it('неизвестный message отклонён', async () => {
    await writeRole('executor', 'result');
    await expect(
      submitResult(call('executor', { message: 'status', data: RESULT_DATA })),
    ).rejects.toThrow('конверт не по схеме');
  });

  it('сессия без роли отклоняется', async () => {
    await expect(
      submitResult(call('build', { message: 'result', data: RESULT_DATA })),
    ).rejects.toThrow('не найдена');
  });

  it('сессия без агента отклоняется', async () => {
    await expect(
      submitResult({
        root,
        agent: undefined,
        sessionID: 'ses_test',
        input: { message: 'result', data: RESULT_DATA },
      }),
    ).rejects.toThrow('роли');
  });
});
