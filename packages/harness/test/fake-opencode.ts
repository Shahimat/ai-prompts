export const FAKE_OPENCODE = `import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const agent = flag('--agent');
const model = flag('--model');
const session = flag('--session');
const files = [];
for (let i = 0; i < args.length; i++) if (args[i] === '-f') files.push(args[i + 1]);
let task = '';
for await (const chunk of process.stdin) task += chunk;
const dir = process.env.FAKE_DIR;
const countFile = path.join(dir, 'count-' + agent);
const n = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8').trim()) + 1 : 1;
writeFileSync(countFile, String(n));
const turnFile = path.join(dir, agent + '-' + n + '.json');
const turn = existsSync(turnFile) ? JSON.parse(readFileSync(turnFile, 'utf8')) : {};
const record = { n, agent, model, session, files, task, config: process.env.OPENCODE_CONFIG_CONTENT };
appendFileSync(path.join(dir, 'args.jsonl'), JSON.stringify(record) + '\\n');
const out = (o) => process.stdout.write(JSON.stringify({ timestamp: 0, sessionID: session ?? 'ses_x', ...o }) + '\\n');
out({ type: 'step_start', part: {} });
for (const tool of turn.tools ?? []) out({ type: 'tool_use', part: { tool } });
if (turn.files !== undefined)
  for (const [rel, text] of Object.entries(turn.files)) {
    mkdirSync(path.dirname(rel), { recursive: true });
    writeFileSync(rel, text);
  }
if (turn.events !== undefined) {
  const bridge = JSON.parse(readFileSync('.oc3/sessions/plan-review/bridge.json', 'utf8'));
  for (const e of turn.events) appendFileSync(bridge.events, JSON.stringify(e) + '\\n');
}
if (turn.exit !== undefined) {
  out({ type: 'error', error: { type: 'unknown', message: turn.exitMessage ?? 'сбой прогона' } });
  process.exit(turn.exit);
}
const lint = task.includes('contradictions');
const text = turn.answer ?? (agent === 'judge' ? (lint ? '{"contradictions":[],"unmeasurable":[]}' : '{"answers":[]}') : (turn.text ?? ''));
out({ type: 'text', part: { text } });
out({ type: 'step_finish', part: { cost: 0.25, tokens: {} } });
process.exit(0);
`;
