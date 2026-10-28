import { describe, expect } from 'vitest';
import { HARNESS } from '@shahimat/harness';
import {
  AI_CORE,
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
    'frontmatter каждой роли в agents/ соответствует схеме agent-frontmatter: name, description, output и необязательные skills, tools, model',
    () => Check.roleSchema(),
  );
  crit('роль judge — только чтение: tools Read, Glob, Grep; output — verdict', () =>
    Check.judgeReadOnly(),
  );
  crit('роль docs-keeper возвращает итог сообщением result', () => Check.docsKeeperResult());
});

describe('[roles] протокол', () => {
  crit('протокол harness — сообщения result, verdict и question; лишние поля запрещены', () =>
    Check.protocolClosed(),
  );
  crit(
    'вход docs-keeper — схема intents: kind из decision, fact, rule, behavior-change, task, manual, summary в одну строку, evidence; YAML-список принимается',
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
  crit('docs-delta start --file <намерения> — apply выполняет роль docs-keeper без handoff', () =>
    Check.optionOf('docs-delta start', '--file'),
  );
  crit('ядро контракта v3 ставит роли docs-keeper и judge: judge проверяет доку в docs-delta', () =>
    Check.coreRoles(),
  );
  crit(
    'с harness основная сессия передаёт намерения процессу docs-delta напрямую (правило 4 шаблона AGENTS.md), без субагента docs-keeper',
    () => Check.intentsToHarness(),
  );
  crit('harness plan-review заморожен: дизайн объявляет статус «заморожен»', () =>
    Check.planReviewFrozen(),
  );
});

const SCHEMAS = 'expectations/schemas';

class Check {
  static async roleSchema(): Promise<void> {
    const paths = (await indexEntries()).filter((e) => e.kind === 'agent').map((e) => e.path);
    await expectSchema(await frontmatters(paths), `${SCHEMAS}/agent-frontmatter.schema.json`);
  }

  static async judgeReadOnly(): Promise<void> {
    const fm = (await doc('agents/judge.md')).frontmatter ?? {};
    expect({ tools: stringList(fm['tools'], 'judge: tools'), output: fm['output'] }).toEqual({
      tools: ['Read', 'Glob', 'Grep'],
      output: 'verdict',
    });
  }

  static async docsKeeperResult(): Promise<void> {
    expect((await doc('agents/docs-keeper.md')).frontmatter?.['output']).toBe('result');
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
    const contract = await readRepo('prompts/productivity/agent-operational-contract-v3.md');
    expect(contract).toContain('agents: {docs-keeper: <hex>, judge: <hex>}');
  }

  static async intentsToHarness(): Promise<void> {
    const contract = await readRepo('prompts/productivity/agent-operational-contract-v3.md');
    const rule = (/^4\. [\s\S]*?(?=^5\. )/m.exec(contract)?.[0] ?? '').replace(/\s+/g, ' ');
    expect(rule).toContain('`harness docs-delta start --name <имя> --file -`');
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
    const node = [...AI_CORE.commands, ...HARNESS.commands].find(
      (c) => c.path.join(' ') === command,
    );
    expect(node?.options ?? '').toContain(option);
  }

  static async planReviewFrozen(): Promise<void> {
    expect(await readRepo('design/harness-plan-review.md')).toMatch(/^Статус: заморожен/m);
  }
}
