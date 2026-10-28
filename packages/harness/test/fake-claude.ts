import { SUBMIT_TOOL } from '@shahimat/ai-core';

export const FAKE_CLAUDE = `import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
const args = process.argv.slice(2);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.harness;
const message = config.args[config.args.indexOf('channel') + 1];
if (process.env.FAKE_ARGS) appendFileSync(process.env.FAKE_ARGS, JSON.stringify({ message, args, prompt }) + '\\n');
if (message === 'result')
  for (const [rel, text] of Object.entries(JSON.parse(process.env.FAKE_FILES ?? '{}'))) {
    mkdirSync(path.dirname(rel), { recursive: true });
    writeFileSync(rel, text);
  }
const done = () => process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'ok', session_id: 's', total_cost_usd: 0 }));
const submit = JSON.parse(process.env.FAKE_SUBMIT ?? '{}')[message];
if (submit === undefined) { done(); process.exit(0); }
const server = spawn(config.command, config.args, { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: server.stdout });
const send = (m) => server.stdin.write(JSON.stringify(m) + '\\n');
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === 1) send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: '${SUBMIT_TOOL}', arguments: submit } });
  if (m.id === 2) { server.stdin.end(); done(); }
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
`;
