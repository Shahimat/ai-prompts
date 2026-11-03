export const FAKE_OPENCODE_ROLES = `import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const agent = flag('--agent');
let task = '';
for await (const chunk of process.stdin) task += chunk;
const counts = process.env.FAKE_COUNTS;
let n = 0;
if (counts) {
  const all = existsSync(counts) ? JSON.parse(readFileSync(counts, 'utf8')) : {};
  n = all[agent] ?? 0;
  all[agent] = n + 1;
  writeFileSync(counts, JSON.stringify(all));
}
const record = { role: agent, model: flag('--model'), args, prompt: task };
if (process.env.FAKE_ARGS) appendFileSync(process.env.FAKE_ARGS, JSON.stringify(record) + '\\n');
const plan = JSON.parse(process.env.FAKE_BY_ROLE ?? '{}')[agent ?? ''];
const step = Array.isArray(plan) ? plan[Math.min(n, plan.length - 1)] : plan;
const submit = step?.submit ?? JSON.parse(process.env.FAKE_SUBMIT ?? '{}')[agent ?? ''];
const out = (o) => process.stdout.write(JSON.stringify({ timestamp: 0, sessionID: 'ses_x', ...o }) + '\\n');
out({ type: 'step_start', part: {} });
if (process.env.FAKE_STEPS) out({ type: 'tool_use', part: { tool: 'read' } });
if (process.env.FAKE_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SLEEP)));
if (step?.error !== undefined) {
  out({ type: 'error', error: { type: 'unknown', message: step.error } });
  process.exit(1);
}
const files = step?.files ?? JSON.parse(process.env.FAKE_FILES ?? '{}');
for (const [rel, text] of Object.entries(files)) {
  mkdirSync(path.dirname(rel), { recursive: true });
  writeFileSync(rel, text);
}
if (submit !== undefined && process.env.HARNESS_SUBMIT_OUT !== undefined)
  writeFileSync(process.env.HARNESS_SUBMIT_OUT, JSON.stringify(submit, null, 2) + '\\n');
if (process.env.FAKE_EXIT !== undefined) process.exit(Number(process.env.FAKE_EXIT));
out({ type: 'step_finish', part: { cost: 0.25, tokens: {} } });
process.exit(0);
`;
