export const FAKE_OPENCODE = `import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
let task = '';
for await (const chunk of process.stdin) task += chunk;
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const agent = flag('--agent');
const model = flag('--model');
let system = '';
try {
  const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
  system = readFileSync(config.instructions[0], 'utf8');
} catch {}
const record = {
  agent,
  model,
  args,
  prompt: task,
  system,
  env: {
    submit: process.env.HARNESS_SUBMIT_OUT,
    config: process.env.OPENCODE_CONFIG_CONTENT,
    dir: process.env.OPENCODE_CONFIG_DIR,
  },
};
if (process.env.FAKE_ARGS) appendFileSync(process.env.FAKE_ARGS, JSON.stringify(record) + '\\n');
const out = (o) => process.stdout.write(JSON.stringify({ timestamp: 0, sessionID: 's', ...o }) + '\\n');
out({ type: 'step_start', part: {} });
if (process.env.FAKE_STEPS) out({ type: 'tool_use', part: { tool: 'read' } });
if (process.env.FAKE_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SLEEP)));
if (process.env.FAKE_FILES)
  for (const [rel, text] of Object.entries(JSON.parse(process.env.FAKE_FILES))) {
    mkdirSync(path.dirname(rel), { recursive: true });
    writeFileSync(rel, text);
  }
const submit = JSON.parse(process.env.FAKE_SUBMIT ?? '{}')[agent ?? ''];
if (submit !== undefined && process.env.HARNESS_SUBMIT_OUT !== undefined)
  writeFileSync(process.env.HARNESS_SUBMIT_OUT, JSON.stringify(submit, null, 2) + '\\n');
if (process.env.FAKE_EXIT !== undefined) {
  out({ type: 'error', error: { type: 'unknown', message: process.env.FAKE_ERROR ?? 'сбой прогона' } });
  process.exit(Number(process.env.FAKE_EXIT));
}
out({ type: 'step_finish', part: { cost: 0.25, tokens: {} } });
const text = process.env.FAKE_TEXT ?? 'ok';
out({ type: 'text', part: { text } });
process.exit(0);
`;
