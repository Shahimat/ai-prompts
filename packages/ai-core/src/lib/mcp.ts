import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { isRecord } from '#shared/guards';
import { compileSchema, issueText } from '#shared/schema';
import { CHANNEL_SERVER, PROTOCOL, SUBMIT_TOOL, type ProtocolMessage } from './protocol.ts';

export interface Channel {
  message: ProtocolMessage;
  out: string;
  input: Readable;
  output: Writable;
}

const COMBINATORS = ['oneOf', 'anyOf', 'allOf', '$schema', 'title'];

export function advertisedSchema(schema: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).filter(([k]) => !COMBINATORS.includes(k)));
}

const text = (t: string, isError = false): Record<string, unknown> => ({
  content: [{ type: 'text', text: t }],
  ...(isError ? { isError: true } : {}),
});

export function serveChannel(ch: Channel): Promise<void> {
  const schema = PROTOCOL[ch.message];
  const validate = compileSchema(schema);
  const tool = {
    name: SUBMIT_TOOL,
    description: `Верни итог работы сообщением протокола «${ch.message}». Вызови один раз в конце; при ошибке исправь поля и вызови снова.`,
    inputSchema: advertisedSchema(schema),
  };
  const send = (m: object): void => {
    ch.output.write(`${JSON.stringify(m)}\n`);
  };
  const reply = (id: unknown, result: unknown): void => send({ jsonrpc: '2.0', id, result });

  const call = async (id: unknown, params: unknown): Promise<void> => {
    const name = isRecord(params) ? params['name'] : undefined;
    const args = isRecord(params) ? params['arguments'] : undefined;
    if (name !== SUBMIT_TOOL) {
      reply(id, text(`нет инструмента ${String(name)}`, true));
      return;
    }
    const issues = validate(args);
    if (issues.length > 0) {
      reply(id, text(issues.map((i) => `${i.path || '/'} ${issueText(i)}`).join('\n'), true));
      return;
    }
    await writeFile(ch.out, `${JSON.stringify(args, null, 2)}\n`, 'utf8');
    reply(id, text('принято'));
  };

  const rl = createInterface({ input: ch.input });
  const pending: Promise<void>[] = [];
  rl.on('line', (line) => {
    if (line.trim() === '') return;
    let m: unknown;
    try {
      m = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      return;
    }
    if (!isRecord(m)) return;
    const { id, method } = m;
    if (method === 'initialize') {
      const params = m['params'];
      const version = isRecord(params) ? params['protocolVersion'] : undefined;
      reply(id, {
        protocolVersion: typeof version === 'string' ? version : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: CHANNEL_SERVER, version: '1' },
      });
    } else if (method === 'tools/list') {
      reply(id, { tools: [tool] });
    } else if (method === 'tools/call') {
      pending.push(call(id, m['params']));
    } else if (id !== undefined) {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `нет метода ${String(method)}` },
      });
    }
  });
  return new Promise((resolve) => {
    rl.on('close', () => {
      void Promise.all(pending).then(() => resolve());
    });
  });
}
