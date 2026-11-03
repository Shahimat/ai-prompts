import { describe, expect } from 'vitest';
import { BUILTIN_TREE } from '@shahimat/cli';
import { HARNESS } from '@shahimat/harness';
import {
  INTENT_KINDS,
  INTENTS_SCHEMA,
  parseIntents,
  PROTOCOL,
  PROTOCOL_MESSAGES,
  roleArgs,
  SUBMIT_TOOL_ID,
  type AgentDef,
} from '@shahimat/ai-core';
import {
  budget,
  crit,
  doc,
  expectSchema,
  frontmatters,
  indexEntries,
  readRepo,
} from '@shahimat/ai-core/expect';
import { recordOrEmpty, stringList } from './shared/guards.ts';

budget({ crit: 0, warn: 0 });

describe('[roles] формат', () => {
  crit(
    'frontmatter каждой роли в agents/ соответствует схеме agent-frontmatter: name, description, model, output и необязательные tools',
    () => Check.roleSchema(),
  );
  crit(
    'frontmatter ролей контракта соответствует схеме role: kind, lifecycle, permissions и artifacts',
    () => Check.roleContractSchema(),
  );
  crit(
    'роль judge проверяет только чтением и правит goals/*.expect.ts: tools Read, Glob, Grep, Edit, Bash; output — verdict',
    () => Check.judgeReadOnly(),
  );
  crit('модели ролей: researcher, executor, external-executor, librarian — max, judge — low', () =>
    Check.roleModels(),
  );
  crit('роль librarian возвращает итог сообщением result', () => Check.librarianResult());
});

describe('[roles] протокол', () => {
  crit('протокол harness — сообщения result, verdict и question; лишние поля запрещены', () =>
    Check.protocolClosed(),
  );
  crit(
    'вход librarian — схема intents: kind из decision, fact, rule, behavior-change, task, manual, summary в одну строку, evidence; YAML-список принимается',
    () => Check.intentsSchema(),
  );
  crit(
    'роль запускается изолированно: claude -p без настроек пользователя, единственный MCP — канал harness с submit_result',
    () => Check.isolatedRun(),
  );
});

describe('[roles] процессы', () => {
  crit('expect judge --run отвечает на задания ролью judge', () =>
    Check.optionOf('expect judge <file>', '--run'),
  );
  crit('docs-delta start --file <намерения> — apply выполняет роль документации без handoff', () =>
    Check.optionOf('docs-delta start', '--file'),
  );
  crit(
    'ядро контракта v3 ставит роли researcher, executor, judge и librarian; oracle, reviewer, implementer и docs-keeper отсутствуют',
    () => Check.coreRoles(),
  );
  crit(
    'правило 4 шаблона AGENTS.md: документацию пишет librarian по docs_request, без правки в основной сессии',
    () => Check.intentsToHarness(),
  );
  crit('ai plan-review заморожен: дизайн объявляет статус «заморожен»', () =>
    Check.planReviewFrozen(),
  );
});

const SCHEMAS = 'expectations/schemas';

class Check {
  static async roleSchema(): Promise<void> {
    const paths = (await indexEntries()).filter((e) => e.kind === 'agent').map((e) => e.path);
    await expectSchema(await frontmatters(paths), `${SCHEMAS}/agent-frontmatter.schema.json`);
  }

  static async roleContractSchema(): Promise<void> {
    const keys = ['researcher', 'executor', 'external-executor', 'judge', 'librarian'];
    const paths = (await indexEntries())
      .filter((e) => e.kind === 'agent' && keys.includes(e.key))
      .map((e) => e.path);
    await expectSchema(await frontmatters(paths), `${SCHEMAS}/role.schema.json`);
  }

  static async judgeReadOnly(): Promise<void> {
    const fm = (await doc('agents/judge.md')).frontmatter ?? {};
    expect({
      tools: stringList(fm['tools'], 'judge: tools'),
      output: fm['output'],
      permissions: stringList(fm['permissions'], 'judge: permissions'),
    }).toEqual({
      tools: ['Read', 'Glob', 'Grep', 'Edit', 'Bash'],
      output: 'verdict',
      permissions: ['read', 'goals-expect-write', 'verdicts-write', 'results-write', 'browser'],
    });
  }

  static async roleModels(): Promise<void> {
    const expected: Record<string, string> = {
      researcher: 'zai-coding-plan/glm-5.3-flash#max',
      executor: 'zai-coding-plan/glm-5.3-flash#max',
      'external-executor': 'zai-coding-plan/glm-5.3-flash#max',
      librarian: 'zai-coding-plan/glm-5.3-flash#max',
      judge: 'zai-coding-plan/glm-5.3-flash#low',
    };
    for (const [name, model] of Object.entries(expected)) {
      const fm = (await doc(`agents/${name}.md`)).frontmatter ?? {};
      expect({ name, model: fm['model'] }).toEqual({ name, model });
    }
  }

  static async librarianResult(): Promise<void> {
    expect((await doc('agents/librarian.md')).frontmatter?.['output']).toBe('result');
  }

  static protocolClosed(): void {
    expect([...PROTOCOL_MESSAGES].sort()).toEqual(['question', 'result', 'verdict']);
    for (const m of PROTOCOL_MESSAGES)
      expect({
        m,
        closed: recordOrEmpty(PROTOCOL[m], `PROTOCOL.${m}`)['additionalProperties'],
      }).toEqual({
        m,
        closed: false,
      });
  }

  static intentsSchema(): void {
    expect([...INTENT_KINDS]).toEqual([
      'decision',
      'fact',
      'rule',
      'behavior-change',
      'task',
      'manual',
    ]);
    expect(recordOrEmpty(INTENTS_SCHEMA, 'INTENTS_SCHEMA')['additionalProperties']).toBe(false);
    expect(JSON.parse(parseIntents('- kind: fact\n  summary: s\n  evidence: e\n', 't'))).toEqual({
      intents: [{ kind: 'fact', summary: 's', evidence: 'e' }],
    });
    expect(() => parseIntents('- kind: fact\n  summary: "a\\nb"\n', 't')).toThrow('intents');
  }

  static async coreRoles(): Promise<void> {
    const roles = (await indexEntries()).filter((e) => e.kind === 'agent').map((e) => e.key);
    expect(
      ['researcher', 'executor', 'judge', 'librarian'].filter((r) => !roles.includes(r)),
    ).toEqual([]);
    expect(
      roles.filter((r) => ['oracle', 'reviewer', 'implementer', 'docs-keeper'].includes(r)),
    ).toEqual([]);
  }

  static async intentsToHarness(): Promise<void> {
    const contract = await readRepo('prompts/productivity/agent-operational-contract-v3.md');
    const rule = (/^4\. [\s\S]*?(?=^5\. )/m.exec(contract)?.[0] ?? '').replace(/\s+/g, ' ');
    expect(rule).toContain('librarian');
    expect(rule).toContain('docs_request');
    expect(rule).toContain('оператор, executor и judge');
  }

  static isolatedRun(): void {
    const role: AgentDef = {
      name: 'judge',
      source: 'agents/judge.md',
      description: 'd',
      skills: [],
      tools: ['Read'],
      output: 'verdict',
      instructions: 'i',
    };
    const args = roleArgs({ root: '.', role, task: 't', out: 'o.json', self: ['harness'] });
    const config = JSON.stringify(JSON.parse(args[args.indexOf('--mcp-config') + 1] ?? '{}'));
    expect({
      sources: args[args.indexOf('--setting-sources') + 1],
      strict: args.includes('--strict-mcp-config'),
      channel: config.includes('"role","channel","verdict"'),
      submit: args.at(-1)?.split(',').includes(SUBMIT_TOOL_ID),
    }).toEqual({ sources: '', strict: true, channel: true, submit: true });
  }

  static optionOf(command: string, option: string): void {
    const node = [...BUILTIN_TREE.commands, ...HARNESS.commands].find(
      (c) => c.path.join(' ') === command,
    );
    expect(node?.options ?? '').toContain(option);
  }

  static async planReviewFrozen(): Promise<void> {
    expect(await readRepo('design/harness-plan-review.md')).toMatch(/^Статус: заморожен/m);
  }
}
