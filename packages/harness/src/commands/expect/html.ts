import { Graphviz } from '@hpcc-js/wasm-graphviz';
import type { Budget, StepDef } from '#lib/expect/levels';
import { graphOf, type MachineGraph } from '#lib/expect/plan';
import { diffTitles, type DiffMark, type Titled } from './head.ts';
import { outcomeOf, type MachineDecl, type Outcome, type TestResult } from './results.ts';

export interface FileReport {
  file: string;
  tests: TestResult[];
  steps: StepDef[];
  machines: MachineDecl[];
  issues: string[];
  budget: Budget;
  count: { crit: number; warn: number; info: number; pending: number };
  head?: Titled[];
}

type NodeStatus = Outcome | 'none';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dot = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const attrs = (a: Record<string, string>): string =>
  `[${Object.entries(a)
    .map(([k, v]) => `${k}=${dot(v)}`)
    .join(' ')}]`;

const MARK: Record<Outcome, string> = { pass: '✓', fail: '✗', todo: '○', skip: '-' };

const FILL: Record<string, string> = {
  pass: '#d9f2df',
  fail: '#f9d6d5',
  todo: '#ececec',
  none: '#ffffff',
  skip: '#ffffff',
  done: '#d9f2df',
  active: '#fff1c2',
};

function statusOf(tests: TestResult[]): NodeStatus {
  const outcomes = tests.map(outcomeOf);
  if (outcomes.includes('fail')) return 'fail';
  if (outcomes.includes('todo')) return 'todo';
  if (outcomes.includes('pass')) return 'pass';
  return 'none';
}

const GRAPH_HEAD = [
  'rankdir=LR',
  'bgcolor="transparent"',
  'node [shape=box style="rounded,filled" fontname="Helvetica" fontsize=11 color="#555555"]',
  'edge [fontname="Helvetica" fontsize=10 color="#777777"]',
];

function machineDot(name: string, g: MachineGraph, tests: TestResult[]): string {
  const own = (node: string) =>
    tests.filter((t) => t.node?.machine === name && t.node.node === node);
  const lines = [...GRAPH_HEAD, `"__start" [shape=point width=0.12 label=""]`];
  lines.push(`"__start" -> ${dot(g.initial)}`);
  for (const s of g.states) {
    const status = statusOf(own(`state:${s.name}`));
    const a: Record<string, string> = {
      label: s.final ? s.name : `${s.name}\n${s.actor ?? ''}`,
      URL: `#state-${s.name}`,
      class: status,
      fillcolor: FILL[status] ?? '#ffffff',
      tooltip: s.name,
    };
    if (s.final) a['peripheries'] = '2';
    lines.push(`${dot(s.name)} ${attrs(a)}`);
  }
  for (const s of g.states)
    for (const [event, list] of Object.entries(s.on))
      for (const t of list) {
        const label = [
          event,
          t.count === undefined ? '' : `${t.count}≤${g.limits[t.count] ?? '?'}`,
          ...t.reset.map((r) => `${r}=0`),
        ]
          .filter((p) => p !== '')
          .join(' · ');
        const a: Record<string, string> = { label };
        const card = own(`tr:${s.name}:${event}`);
        if (card.length > 0) {
          a['URL'] = `#tr-${s.name}-${event}`;
          a['class'] = statusOf(card);
          a['tooltip'] = `${s.name} —${event}→ ${t.to}`;
        }
        lines.push(`${dot(s.name)} -> ${dot(t.to)} ${attrs(a)}`);
      }
  return `digraph ${dot(name)} {\n  ${lines.join(';\n  ')};\n}`;
}

function stepsDot(steps: StepDef[]): string {
  const ids = new Set(steps.map((s) => s.id));
  const lines = [...GRAPH_HEAD];
  for (const s of steps)
    lines.push(
      `${dot(s.id)} ${attrs({
        label: `${s.id}\n${s.title}`,
        URL: `#step-${s.id}`,
        class: s.status,
        fillcolor: FILL[s.status] ?? '#ffffff',
        tooltip: `${s.id}. ${s.title} — ${s.status}`,
      })}`,
    );
  for (const s of steps)
    for (const dep of s.after) if (ids.has(dep)) lines.push(`${dot(dep)} -> ${dot(s.id)}`);
  return `digraph "steps" {\n  ${lines.join(';\n  ')};\n}`;
}

const inlineSvg = (svg: string): string =>
  svg
    .replace(/<\?xml[^>]*\?>\s*/, '')
    .replace(/<!DOCTYPE[^>]*>\s*/, '')
    .trim();

function item(t: TestResult, mark: DiffMark | undefined): string {
  const outcome = outcomeOf(t);
  const cls = ['exp', `o-${outcome}`, `lvl-${t.level}`];
  if (mark !== undefined) cls.push(`diff-${mark.kind}`);
  const was =
    mark?.kind === 'changed' ? ` <del class="was" title="было в HEAD">${esc(mark.was)}</del>` : '';
  const msg =
    outcome === 'fail' && t.message !== '' ? `<div class="msg">${esc(t.message)}</div>` : '';
  const notes = t.notes.map((n) => `<div class="note">ℹ ${esc(n)}</div>`).join('');
  const from =
    t.pattern === undefined ? '' : ` <span class="pattern">паттерн ${esc(t.pattern)}</span>`;
  return `<li class="${cls.join(' ')}"><span class="mark">${MARK[outcome]}</span> <span class="lvl">${t.level}</span> <span class="title">${esc(t.title)}</span>${from}${was}${msg}${notes}</li>`;
}

const list = (tests: TestResult[], marks: Map<Titled, DiffMark>): string =>
  tests.length === 0
    ? '<p class="empty">ожиданий нет</p>'
    : `<ul>${tests.map((t) => item(t, marks.get(t))).join('')}</ul>`;

function transitionsTable(rows: { event: string; other: string; note: string }[], head: string) {
  if (rows.length === 0) return '';
  return `<table><thead><tr><th>событие</th><th>${head}</th><th></th></tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr><td><code>${esc(r.event)}</code></td><td><a href="#state-${esc(r.other)}">${esc(r.other)}</a></td><td>${esc(r.note)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function machineSection(
  m: MachineDecl,
  svg: string,
  tests: TestResult[],
  marks: Map<Titled, DiffMark>,
): string {
  const g = graphOf(m.def);
  const own = (node: string) =>
    tests.filter((t) => t.node?.machine === m.name && t.node.node === node);
  const parts = [
    `<h3>Автомат <code>${esc(m.name)}</code></h3>`,
    `<div class="graph">${svg}</div>`,
    `<section class="card" id="machine-${esc(m.name)}"><h4>Автомат целиком</h4>${list(own('machine'), marks)}</section>`,
  ];
  for (const s of g.states) {
    const out = Object.entries(s.on).flatMap(([event, l]) =>
      l.map((t) => ({
        event,
        other: t.to,
        note: [t.count === undefined ? '' : `счётчик ${t.count}`, ...t.reset.map((r) => `${r}=0`)]
          .filter((p) => p !== '')
          .join(', '),
      })),
    );
    const incoming = g.states.flatMap((from) =>
      Object.entries(from.on).flatMap(([event, l]) =>
        l.filter((t) => t.to === s.name).map(() => ({ event, other: from.name, note: '' })),
      ),
    );
    const status = statusOf(own(`state:${s.name}`));
    parts.push(
      `<section class="card state s-${status}" id="state-${esc(s.name)}"><h4>${esc(s.name)} <span class="badge">${s.final ? 'final' : esc(s.actor ?? '')}</span>${g.initial === s.name ? ' <span class="badge">initial</span>' : ''}</h4>${transitionsTable(incoming, 'откуда')}${transitionsTable(out, 'куда')}${list(own(`state:${s.name}`), marks)}</section>`,
    );
  }
  for (const s of g.states)
    for (const event of Object.keys(s.on)) {
      const card = own(`tr:${s.name}:${event}`);
      if (card.length === 0) continue;
      const to = (s.on[event] ?? []).map((t) => t.to).join(' | ');
      parts.push(
        `<section class="card transition" id="tr-${esc(s.name)}-${esc(event)}"><h4>${esc(s.name)} —${esc(event)}→ ${esc(to)}</h4>${list(card, marks)}</section>`,
      );
    }
  return parts.join('\n');
}

function stepSection(s: StepDef, tests: TestResult[], marks: Map<Titled, DiffMark>): string {
  const after =
    s.after.length === 0
      ? ''
      : `<p class="after">после: ${s.after.map((d) => `<a href="#step-${esc(d)}">${esc(d)}</a>`).join(', ')}</p>`;
  const why = s.why === undefined ? '' : `<p class="why">${esc(s.why)}</p>`;
  return `<section class="card step st-${s.status}" id="step-${esc(s.id)}"><h4>${esc(s.id)}. ${esc(s.title)} <span class="badge">${s.status}</span></h4>${after}${why}${list(
    tests.filter((t) => t.step === s.id),
    marks,
  )}</section>`;
}

function groups(tests: TestResult[], marks: Map<Titled, DiffMark>): string {
  const byPath = new Map<string, TestResult[]>();
  for (const t of tests) {
    const key = t.path.join(' › ');
    byPath.set(key, [...(byPath.get(key) ?? []), t]);
  }
  return [...byPath.entries()]
    .map(
      ([p, ts]) => `<div class="group"><h4>${esc(p === '' ? '—' : p)}</h4>${list(ts, marks)}</div>`,
    )
    .join('\n');
}

function fileSection(r: FileReport, svg: (source: string) => string): string {
  const { marks, removed } = diffTitles(r.tests, r.head);
  const parts = [
    `<h2>${esc(r.file)}</h2>`,
    `<p class="summary">crit ${r.count.crit}/${r.budget.crit} · warn ${r.count.warn}/${r.budget.warn} · info ${r.count.info}${r.count.pending > 0 ? ` · ? ${r.count.pending} без вердикта` : ''}</p>`,
  ];
  if (r.issues.length > 0)
    parts.push(
      `<ul class="issues">${r.issues.map((i) => `<li class="issue">${esc(i)}</li>`).join('')}</ul>`,
    );
  if (r.steps.length > 0) {
    parts.push('<h3>Шаги плана</h3>', `<div class="graph">${svg(stepsDot(r.steps))}</div>`);
    for (const s of r.steps) parts.push(stepSection(s, r.tests, marks));
  }
  for (const m of r.machines)
    parts.push(machineSection(m, svg(machineDot(m.name, graphOf(m.def), r.tests)), r.tests, marks));
  const rest = r.tests.filter((t) => t.step === undefined && t.node === undefined);
  if (rest.length > 0) parts.push('<h3>Ожидания</h3>', groups(rest, marks));
  if (removed.length > 0)
    parts.push(
      `<div class="group removed"><h3>Удалено относительно HEAD</h3><ul>${removed
        .map(
          (t) =>
            `<li class="exp diff-removed"><span class="path">${esc(t.path.join(' › '))}</span> <span class="title">${esc(t.title)}</span></li>`,
        )
        .join('')}</ul></div>`,
    );
  return `<div class="file">\n${parts.join('\n')}\n</div>`;
}

const STYLE = `
:root { --bg: #ffffff; --fg: #1d1d1f; --muted: #6e6e73; --line: #d2d2d7; --card: #f7f7f9;
  --pass: #1f7a3a; --fail: #b3261e; --todo: #6e6e73; --added: #e3f6e8; --changed: #fff4d6; --removed: #fde8e7; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1c1c1e; --fg: #f2f2f7; --muted: #a1a1a6; --line: #3a3a3c; --card: #2c2c2e;
    --pass: #63d68a; --fail: #ff8a80; --todo: #a1a1a6; --added: #1f3b28; --changed: #3d3418; --removed: #4a2422; }
  .graph svg { background: #f7f7f9; border-radius: 6px; }
}
body { margin: 0 auto; max-width: 64rem; padding: 1.5rem; background: var(--bg); color: var(--fg);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
h1 { font-size: 1.6rem; } h2 { margin-top: 2.5rem; border-bottom: 1px solid var(--line); padding-bottom: .3rem; }
.summary, .after, .why, .empty { color: var(--muted); }
.graph { overflow-x: auto; margin: 1rem 0; } .graph svg { max-width: 100%; height: auto; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .6rem 1rem; margin: .8rem 0; }
.card:target { outline: 2px solid #0a84ff; }
.card h4 { margin: .2rem 0 .4rem; }
.badge { font-size: .75rem; font-weight: normal; border: 1px solid var(--line); border-radius: 4px; padding: 0 .35rem; color: var(--muted); }
ul { padding-left: 1.2rem; } li.exp { list-style: none; margin: .25rem 0 .25rem -1.2rem; }
.mark { display: inline-block; width: 1.1rem; } .o-pass .mark { color: var(--pass); } .o-fail .mark { color: var(--fail); }
.o-todo .mark, .o-skip .mark { color: var(--todo); }
.lvl { font-size: .75rem; color: var(--muted); text-transform: uppercase; }
.diff-added { background: var(--added); } .diff-changed { background: var(--changed); } .diff-removed { background: var(--removed); }
.was { color: var(--muted); margin-left: .5rem; }
.pattern { font-size: .75rem; color: var(--muted); border: 1px dashed var(--line); border-radius: 4px; padding: 0 .3rem; margin-left: .4rem; }
.msg, .note { margin-left: 1.4rem; font-size: .85rem; color: var(--muted); }
.issues .issue { color: var(--fail); }
table { border-collapse: collapse; font-size: .85rem; margin: .3rem 0; }
td, th { border-bottom: 1px solid var(--line); padding: .15rem .6rem; text-align: left; }
a { color: #0a84ff; }
@media print { .card:target { outline: none; } }
`;

export async function renderHtml(reports: FileReport[]): Promise<string> {
  const graphviz = await Graphviz.load();
  const svg = (source: string): string => inlineSvg(graphviz.dot(source));
  const body = reports.map((r) => fileSection(r, svg)).join('\n');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ожидания</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Ожидания</h1>
${body}
</body>
</html>
`;
}
