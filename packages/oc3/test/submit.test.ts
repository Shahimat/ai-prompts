import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { submitResult } from '#submit';
import { intakeSuccessfulResult, pendingKnowledge } from '@shahimat/ai-core';

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
  out = path.join(root, '.oc3/submit', 'submit.json');
  process.env[ENV_OUT] = out;
});

afterEach(async () => {
  delete process.env[ENV_OUT];
  await rm(root, { recursive: true, force: true });
});

describe('submit_result', () => {
  it('known secrets are rejected before output publication; store failure never claims durable acceptance', async () => {
    await writeRole('executor', 'result');
    const delta = [
      {
        subject: 'native',
        property: 'pending',
        value: `sk-${'x'.repeat(32)}`,
        kind: 'candidate',
        evidence: ['synthetic'],
      },
    ];
    await expect(
      submitResult(
        call('executor', { message: 'result', data: { ...RESULT_DATA, knowledge_delta: delta } }),
      ),
    ).rejects.toThrow('SECRET_INPUT');
    await expect(readFile(out)).rejects.toThrow();
    await mkdir(path.join(root, '.oc3'), { recursive: true });
    await symlink(tmpdir(), path.join(root, '.oc3/inbox'));
    const data = { ...RESULT_DATA, knowledge_delta: [{ ...delta[0], value: 'safe synthetic' }] };
    await expect(submitResult(call('executor', { message: 'result', data }))).rejects.toThrow(
      'symlink',
    );
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(data);
    await rm(path.join(root, '.oc3/inbox'));
    expect(await submitResult(call('executor', { message: 'result', data }))).toContain(
      'durable pending',
    );
    expect(await pendingKnowledge(root)).toHaveLength(1);
  });
  it('native retry and managed parent readback share one durable receipt', async () => {
    await writeRole('executor', 'result');
    const data = {
      ...RESULT_DATA,
      knowledge_delta: [
        {
          subject: 'native',
          property: 'pending',
          value: { synthetic: true },
          kind: 'decision',
          evidence: ['fixture:native'],
        },
      ],
    };
    process.env['HARNESS_EXECUTION_ID'] = 'parent-run';
    try {
      const first = await submitResult(call('executor', { message: 'result', data }));
      expect(first).toContain('durable pending');
      expect(await submitResult(call('executor', { message: 'result', data }))).toBe(first);
      const parent = await intakeSuccessfulResult(
        { root, actor: 'executor', channel: 'managed-role', execution: 'parent-run' },
        data,
      );
      expect(first).toContain(parent?.submission_id);
      expect(await pendingKnowledge(root)).toHaveLength(1);
      expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(data);
    } finally {
      delete process.env['HARNESS_EXECUTION_ID'];
    }
  });
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
