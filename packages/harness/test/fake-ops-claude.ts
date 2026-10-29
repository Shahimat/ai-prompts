import { SUBMIT_TOOL } from '@shahimat/ai-core';

export const FAKE_OPS_CLAUDE = `import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
const args = process.argv.slice(2);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const system = args[args.indexOf('--append-system-prompt') + 1] ?? '';
const role = /Инструкции роли ([a-z-]+)/.exec(system)?.[1] ?? 'unknown';
const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.harness;
const counts = process.env.FAKE_COUNTS;
let n = 0;
if (counts) {
  const all = existsSync(counts) ? JSON.parse(readFileSync(counts, 'utf8')) : {};
  n = all[role] ?? 0;
  all[role] = n + 1;
  writeFileSync(counts, JSON.stringify(all));
}
if (process.env.FAKE_ARGS) appendFileSync(process.env.FAKE_ARGS, JSON.stringify({ role, args, prompt }) + '\\n');
const plan = JSON.parse(process.env.FAKE_BY_ROLE ?? '{}')[role];
const step = Array.isArray(plan) ? plan[Math.min(n, plan.length - 1)] : plan;
const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
if (args[args.indexOf('--output-format') + 1] === 'stream-json') line({ type: 'system', subtype: 'init', role });
if (step?.error) { line({ type: 'result', is_error: true, result: step.error }); process.exit(0); }
for (const [rel, text] of Object.entries(step?.files ?? {})) {
  mkdirSync(path.dirname(rel), { recursive: true });
  writeFileSync(rel, text);
}
const done = () => line({ type: 'result', is_error: false, result: 'ok', session_id: 's', total_cost_usd: 0 });
if (step?.submit === undefined) { done(); process.exit(0); }
const server = spawn(config.command, config.args, { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: server.stdout });
const send = (m) => server.stdin.write(JSON.stringify(m) + '\\n');
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.id === 1) send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: '${SUBMIT_TOOL}', arguments: step.submit } });
  if (m.id === 2) { server.stdin.end(); done(); }
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
`;

export const result = (report: string, questions: string[] = [], status = 'done') => ({
  status,
  changed: [],
  failed: [],
  questions,
  report,
});
