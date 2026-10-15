import { Graphviz } from '@hpcc-js/wasm-graphviz';
import type { Budget, PlanDecl, Question, StepDef } from '#lib/expect/levels';
import { graphOf, type MachineGraph } from '#lib/expect/plan';
import { diffTitles, type DiffMark, type Titled } from './head.ts';
import {
  outcomeOf,
  stepStatusOf,
  type MachineDecl,
  type Remark,
  type Outcome,
  type TestResult,
} from './results.ts';

export interface FileReport {
  file: string;
  all: TestResult[];
  tests: TestResult[];
  steps: StepDef[];
  machines: MachineDecl[];
  issues: Remark[];
  budget: Budget;
  count: { crit: number; warn: number; info: number; pending: number };
  head?: Titled[];
  plan?: PlanDecl;
}

type NodeStatus = Outcome | 'none';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dot = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const attrs = (a: Record<string, string>): string =>
  `[${Object.entries(a)
    .map(([k, v]) => `${k}=${dot(v)}`)
    .join(' ')}]`;

const MARK: Record<Outcome, string> = { pass: '✓', fail: '✗', todo: '○', wip: '◐', skip: '-' };

const FILL: Record<string, string> = {
  pass: '#d9f2df',
  fail: '#f9d6d5',
  todo: '#ececec',
  wip: '#fff1c2',
  none: '#ffffff',
  skip: '#ffffff',
  done: '#d9f2df',
  active: '#fff1c2',
};

function statusOf(tests: TestResult[]): NodeStatus {
  const outcomes = tests.map(outcomeOf);
  if (outcomes.includes('fail')) return 'fail';
  if (outcomes.includes('wip')) return 'wip';
  if (outcomes.includes('todo')) return 'todo';
  if (outcomes.includes('pass')) return 'pass';
  return 'none';
}

const ENTRY = '#16a34a';
const EXIT = '#2563eb';

const GRAPH_HEAD = [
  'rankdir=LR',
  'bgcolor="transparent"',
  'node [shape=box style="rounded,filled" fontname="Helvetica" fontsize=11 color="#555555"]',
  'edge [fontname="Helvetica" fontsize=10 color="#777777"]',
];

const USER = '#7c3aed';

function nodeStatus(machine: string, s: MachineGraph['states'][number], tests: TestResult[]) {
  const mine = (node: string) =>
    tests.filter((t) => t.node?.machine === machine && t.node.node === node);
  const own = mine(`state:${s.name}`);
  if (own.length > 0) return statusOf(own);
  return statusOf(
    Object.keys(s.on).flatMap((event) =>
      tests.filter(
        (t) =>
          t.node?.machine === machine &&
          (t.node.node === `tr:${s.name}:${event}` ||
            t.node.node.startsWith(`tr:${s.name}:${event}:`)),
      ),
    ),
  );
}

const slugId = (x: string): string => x.replace(/[^\p{L}\p{N}_-]+/gu, '_');

const stateCard = (state: string): string => `state-${slugId(state)}`;
const trCard = (from: string, event: string, to?: string): string =>
  `tr-${slugId(from)}-${slugId(event)}${to === undefined ? '' : `--${slugId(to)}`}`;
const entryCard = (machine: string): string => `entry-${slugId(machine)}`;
const nodeId = (machine: string, state: string): string =>
  `g-${slugId(machine)}-s-${slugId(state)}`;
const edgeId = (machine: string, from: string, event: string): string =>
  `g-${slugId(machine)}-t-${slugId(from)}-${slugId(event)}`;
const entryEdgeId = (machine: string): string => `g-${slugId(machine)}-entry`;

interface DotOptions {
  focus?: string;
}

type Variant = MachineGraph['states'][number]['on'][string][number];

function edgeLabel(
  g: MachineGraph,
  event: string,
  t: Variant,
  earlier: readonly Variant[] = [],
): string {
  if (t.label !== undefined) return t.label;
  return [
    event,
    t.count === undefined ? '' : `${t.count}≤${g.limits[t.count] ?? '?'}`,
    t.count === undefined && earlier.some((e) => e.count !== undefined) ? 'лимит исчерпан' : '',
    ...t.reset.map((r) => `${r}=0`),
  ]
    .filter((p) => p !== '')
    .join(' · ');
}

function machineDot(
  name: string,
  g: MachineGraph,
  tests: TestResult[],
  opts: DotOptions = {},
): string {
  const own = (node: string) =>
    tests.filter((t) => t.node?.machine === name && t.node.node === node);
  const local = opts.focus;
  const near = new Set<string>();
  if (local !== undefined) {
    near.add(local);
    for (const s of g.states)
      for (const list of Object.values(s.on))
        for (const t of list) {
          if (s.name === local) near.add(t.to);
          if (t.to === local) near.add(s.name);
        }
  }
  const shown = (state: string) => local === undefined || near.has(state);
  const keepEdge = (from: string, to: string) =>
    local === undefined || from === local || to === local;
  const userState = new Set(g.states.filter((s) => s.actor === 'user').map((s) => s.name));
  const lines = [...GRAPH_HEAD];
  if (local === undefined || local === g.initial) {
    const entry: Record<string, string> = {
      shape: 'circle',
      label: '',
      width: '0.3',
      style: 'filled',
      fillcolor: ENTRY,
      color: ENTRY,
      tooltip: 'вход',
      URL: `#${entryCard(name)}`,
    };
    const edge: Record<string, string> = {
      label: g.start ?? '',
      color: ENTRY,
      fontcolor: ENTRY,
      penwidth: '2',
      URL: `#${entryCard(name)}`,
      tooltip: `вход → ${g.initial}`,
    };
    if (local === undefined) {
      entry['id'] = `${entryEdgeId(name)}-node`;
      edge['id'] = entryEdgeId(name);
    }
    lines.push(`"__start" ${attrs(entry)}`, `"__start" -> ${dot(g.initial)} ${attrs(edge)}`);
  }
  for (const s of g.states) {
    if (!shown(s.name)) continue;
    const status = nodeStatus(name, s, tests);
    const a: Record<string, string> = {
      label: s.name,
      URL: `#${stateCard(s.name)}`,
      class: status,
      fillcolor: FILL[status] ?? '#ffffff',
      tooltip: s.description ?? s.name,
    };
    if (local === undefined) a['id'] = nodeId(name, s.name);
    if (userState.has(s.name)) {
      a['color'] = USER;
      a['penwidth'] = '2.5';
      a['fontcolor'] = USER;
    }
    if (s.name === local) a['penwidth'] = '3';
    if (s.final) {
      a['peripheries'] = '2';
      a['fillcolor'] = EXIT;
      a['color'] = EXIT;
      a['fontcolor'] = '#ffffff';
    }
    lines.push(`${dot(s.name)} ${attrs(a)}`);
  }
  for (const s of g.states)
    for (const [event, list] of Object.entries(s.on))
      list.forEach((t, i) => {
        if (!keepEdge(s.name, t.to)) return;
        const multi = list.length > 1;
        const card = [
          ...own(`tr:${s.name}:${event}:${t.to}`),
          ...(!multi || i === 0 ? own(`tr:${s.name}:${event}`) : []),
        ];
        const a: Record<string, string> = {
          label: edgeLabel(g, event, t, list.slice(0, i)),
          URL: `#${trCard(s.name, event, multi ? t.to : undefined)}`,
          tooltip: `${s.name} → ${t.to} [${event}]`,
        };
        if (card.length > 0) a['class'] = statusOf(card);
        if (local === undefined)
          a['id'] = `${edgeId(name, s.name, event)}${i === 0 ? '' : `-${i}`}`;
        if (userState.has(s.name)) {
          a['color'] = USER;
          a['fontcolor'] = USER;
          a['penwidth'] = '1.8';
        }
        lines.push(`${dot(s.name)} -> ${dot(t.to)} ${attrs(a)}`);
      });
  return `digraph ${dot(name)} {\n  ${lines.join(';\n  ')};\n}`;
}

const BAR = {
  shape: 'box',
  label: '',
  height: '0.04',
  width: '0.9',
  style: 'filled',
  fillcolor: '#333333',
  color: '#333333',
};

function stepsDot(steps: StepDef[], tests: TestResult[]): string {
  const ids = new Set(steps.map((s) => s.id));
  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  for (const s of steps)
    for (const dep of s.after.filter((d) => ids.has(d))) {
      succ.set(dep, [...(succ.get(dep) ?? []), s.id]);
      pred.set(s.id, [...(pred.get(s.id) ?? []), dep]);
    }
  const lines = [
    ...GRAPH_HEAD.map((l) => (l === 'rankdir=LR' ? 'rankdir=TB' : l)),
    `"__initial" ${attrs({ shape: 'circle', label: '', width: '0.22', style: 'filled', fillcolor: '#333333' })}`,
    `"__final" ${attrs({ shape: 'doublecircle', label: '', width: '0.16', style: 'filled', fillcolor: '#333333' })}`,
  ];
  const bars = new Set<string>();
  const bar = (name: string): string => {
    if (!bars.has(name)) {
      bars.add(name);
      lines.push(`${dot(name)} ${attrs(BAR)}`);
    }
    return dot(name);
  };
  const out = (id: string): string => {
    if ((succ.get(id) ?? []).length < 2) return dot(id);
    const fork = bar(`__fork_${id}`);
    if (!bars.has(`__forked_${id}`)) {
      bars.add(`__forked_${id}`);
      lines.push(`${dot(id)} -> ${fork}`);
    }
    return fork;
  };
  const into = (id: string): string => {
    if ((pred.get(id) ?? []).length < 2) return dot(id);
    const join = bar(`__join_${id}`);
    if (!bars.has(`__joined_${id}`)) {
      bars.add(`__joined_${id}`);
      lines.push(`${join} -> ${dot(id)}`);
    }
    return join;
  };
  for (const s of steps) {
    const status = stepStatusOf(s.id, tests);
    lines.push(
      `${dot(s.id)} ${attrs({
        label: `${s.id}\n${s.title}`,
        URL: `#step-${s.id}`,
        class: status,
        fillcolor: FILL[status] ?? '#ffffff',
        tooltip: `${s.id}. ${s.title} — ${status}`,
      })}`,
    );
  }
  for (const s of steps)
    for (const next of succ.get(s.id) ?? []) lines.push(`${out(s.id)} -> ${into(next)}`);
  const roots = steps.filter((s) => (pred.get(s.id) ?? []).length === 0).map((s) => s.id);
  const leaves = steps.filter((s) => (succ.get(s.id) ?? []).length === 0).map((s) => s.id);
  if (roots.length > 1) {
    const fork = bar('__fork_initial');
    lines.push(`"__initial" -> ${fork}`);
    for (const r of roots) lines.push(`${fork} -> ${dot(r)}`);
  } else for (const r of roots) lines.push(`"__initial" -> ${dot(r)}`);
  if (leaves.length > 1) {
    const join = bar('__join_final');
    for (const l of leaves) lines.push(`${dot(l)} -> ${join}`);
    lines.push(`${join} -> "__final"`);
  } else for (const l of leaves) lines.push(`${dot(l)} -> "__final"`);
  return `digraph "steps" {\n  ${lines.join(';\n  ')};\n}`;
}

const inlineSvg = (svg: string): string =>
  svg
    .replace(/<\?xml[^>]*\?>\s*/, '')
    .replace(/<!DOCTYPE[^>]*>\s*/, '')
    .trim();

let pageEntry: string | undefined;

function item(t: TestResult, mark: DiffMark | undefined): string {
  const outcome = outcomeOf(t);
  const cls = ['exp', `o-${outcome}`, `lvl-${t.level}`];
  if (mark !== undefined) cls.push(`diff-${mark.kind}`);
  const was =
    mark?.kind === 'changed' ? ` <del class="was" title="было в HEAD">${esc(mark.was)}</del>` : '';
  const msg =
    outcome === 'fail' && t.message !== '' ? `<div class="msg">${esc(t.message)}</div>` : '';
  const notes = t.notes.map((n) => `<div class="note">ℹ ${esc(n)}</div>`).join('');
  const origin = t.defined ?? t.file;
  const defined =
    pageEntry === undefined || origin === pageEntry
      ? ''
      : ` <span class="from">из ${esc(origin)}</span>`;
  const from =
    t.pattern === undefined ? '' : ` <span class="pattern">паттерн ${esc(t.pattern)}</span>`;
  return `<li class="${cls.join(' ')}"><span class="mark">${MARK[outcome]}</span> <span class="lvl">${t.level}</span> <span class="title">${esc(t.title)}</span>${from}${defined}${was}${msg}${notes}</li>`;
}

const list = (tests: TestResult[], marks: Map<Titled, DiffMark>): string =>
  tests.length === 0
    ? '<p class="empty">ожиданий нет</p>'
    : `<ul>${tests.map((t) => item(t, marks.get(t))).join('')}</ul>`;

function chip(href: string, text: string, cls: string): string {
  return `<a class="chip ${cls}" href="#${href}">${esc(text)}</a>`;
}

const LEGEND = `<p class="legend"><span class="lg user">действие пользователя</span><span class="lg auto">автоматика</span><span class="lg entry">вход</span><span class="lg exit">выход</span></p>`;

function machineSection(
  m: MachineDecl,
  svg: (source: string) => string,
  tests: TestResult[],
  marks: Map<Titled, DiffMark>,
): string {
  const g = graphOf(m.def);
  const own = (node: string) =>
    tests.filter((t) => t.node?.machine === m.name && t.node.node === node);
  const kind = (state: string): string => {
    const s = g.states.find((x) => x.name === state);
    const status = s === undefined ? 'none' : nodeStatus(m.name, s, tests);
    return `s-${status}${s?.actor === 'user' ? ' user' : ''}${s?.final === true ? ' exit' : ''}`;
  };
  const stateChip = (state: string) => chip(stateCard(state), state, kind(state));
  const back = (id: string) => `to-${id}`;
  const anchors = [
    entryEdgeId(m.name),
    ...g.states.map((s) => nodeId(m.name, s.name)),
    ...g.states.flatMap((s) =>
      Object.entries(s.on).flatMap(([event, l]) =>
        l.map((_t, i) => `${edgeId(m.name, s.name, event)}${i === 0 ? '' : `-${i}`}`),
      ),
    ),
  ];
  const parts = [
    `<div class="graph main">${anchors.map((id) => `<span class="anchor" id="to-${id}"></span>`).join('')}${svg(machineDot(m.name, g, tests))}</div>`,
    `<style>${anchors.map((id) => `.graph:has(#to-${id}:target) #${id} :is(path, polygon, ellipse)`).join(',\n')} { animation: flash 1.4s ease-in-out 2; }</style>`,
    LEGEND,
    `<section class="whole" id="machine-${esc(m.name)}">${list(own('machine'), marks)}</section>`,
  ];
  const entry = `<section class="card transition" id="${entryCard(m.name)}"><h4>${chip(back(entryEdgeId(m.name)), 'вход', 'entry')} → ${stateChip(g.initial)} ${chip(back(entryEdgeId(m.name)), `[${g.start ?? 'start'}]`, `ev s-${statusOf(own('entry'))}`)}</h4>${list(own('entry'), marks)}</section>`;
  parts.push('<h3 class="fsm-part">Состояния</h3>');
  for (const s of g.states) {
    const badges = [
      s.final ? 'final' : (s.actor ?? ''),
      g.initial === s.name ? 'initial' : '',
    ].filter((b) => b !== '');
    parts.push(
      `<section class="card state ${kind(s.name)}" id="${stateCard(s.name)}"><h4>${chip(back(nodeId(m.name, s.name)), s.name, kind(s.name))} ${badges.map((b) => `<span class="badge">${esc(b)}</span>`).join(' ')}</h4>${s.description === undefined ? '' : `<p class="why">${esc(s.description)}</p>`}<details class="local"><summary>соседи на схеме</summary><div class="graph">${svg(machineDot(m.name, g, tests, { focus: s.name }))}</div></details>${list(own(`state:${s.name}`), marks)}</section>`,
    );
  }
  parts.push('<h3 class="fsm-part">Переходы</h3>', entry);
  for (const s of g.states)
    for (const [event, targets] of Object.entries(s.on))
      targets.forEach((t, i) => {
        const multi = targets.length > 1;
        const card = [
          ...own(`tr:${s.name}:${event}:${t.to}`),
          ...(!multi || i === 0 ? own(`tr:${s.name}:${event}`) : []),
        ];
        const label = edgeLabel(g, event, t, targets.slice(0, i));
        const edge = `${edgeId(m.name, s.name, event)}${i === 0 ? '' : `-${i}`}`;
        parts.push(
          `<section class="card transition" id="${trCard(s.name, event, multi ? t.to : undefined)}"><h4>${stateChip(s.name)} → ${stateChip(t.to)} ${chip(back(edge), `[${label}]`, `ev s-${statusOf(card)}`)}</h4>${list(card, marks)}</section>`,
        );
      });
  return parts.join('\n');
}

function stepSection(s: StepDef, tests: TestResult[], marks: Map<Titled, DiffMark>): string {
  const status = stepStatusOf(s.id, tests);
  const after =
    s.after.length === 0
      ? ''
      : `<p class="after">после: ${s.after.map((d) => `<a href="#step-${esc(d)}">${esc(d)}</a>`).join(', ')}</p>`;
  const why = s.why === undefined ? '' : `<p class="why">${esc(s.why)}</p>`;
  return `<section class="card step st-${status}" id="step-${esc(s.id)}"><h4>${esc(s.id)}. ${esc(s.title)} <span class="badge">${status}</span></h4>${after}${why}${list(
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

interface Counts {
  passed: number;
  stubs: number;
  failed: number;
  total: number;
}

function countsOf(tests: TestResult[], level: string): Counts {
  const own = tests.filter((t) => t.level === level);
  const outcomes = own.map(outcomeOf);
  return {
    passed: outcomes.filter((o) => o === 'pass').length,
    stubs: outcomes.filter((o) => o === 'todo' || o === 'wip').length,
    failed: outcomes.filter((o) => o === 'fail').length,
    total: own.length,
  };
}

function statsWidget(level: string, page: TestResult[]): string {
  const c = countsOf(page, level);
  const cell = (kind: string, value: number, label: string) =>
    `<div class="stat ${kind}${value > 0 ? ' on' : ''}"><span class="value">${value}</span><span class="label">${label}</span></div>`;
  return `<div class="stats lvl-${esc(level)}"><div class="stats-level">${esc(level)}</div>${cell('passed', c.passed, 'пройдено')}${cell('stubs', c.stubs, 'заглушки')}${cell('failed', c.failed, 'не пройдено')}${cell('total', c.total, 'всего')}</div>`;
}

function questionsBlock(questions: readonly Question[]): string {
  const answer = (a: Question['answers'][number]) =>
    `<li class="answer${a.recommended === true ? ' rec' : ''}">${esc(a.text)}${a.comment === undefined ? '' : `<span class="tip">${esc(a.comment)}</span>`}</li>`;
  return `<section class="block questions"><h3>Вопросы и предложения</h3><ol>${questions
    .map(
      (q) =>
        `<li class="question">${esc(q.text)}<ol class="answers">${q.answers.map(answer).join('')}</ol></li>`,
    )
    .join('')}</ol></section>`;
}

let pageRemarks: Remark[] = [];

function remarksBlock(remarks: readonly Remark[]): string {
  if (remarks.length === 0) return '';
  return `<section class="block remarks"><h3>Замечания</h3><ol>${remarks
    .map(
      (r) =>
        `<li class="remark">${esc(r.text)}${r.detail === undefined ? '' : `<ul><li class="detail">${esc(r.detail)}</li></ul>`}</li>`,
    )
    .join('')}</ol></section>`;
}

function fileSection(r: FileReport, svg: (source: string) => string, page: TestResult[]): string {
  const { marks, removed } = diffTitles(r.tests, r.head);
  const parts: string[] = [];
  const rest = r.tests.filter((t) => t.step === undefined && t.node === undefined);
  const restPath = (t: TestResult): string => t.path.join(' › ');
  const placed = new Set<string>();
  let stepsPlaced = r.steps.length === 0;
  for (const t of r.all) {
    if (t.doc !== undefined) {
      if (t.doc.kind === 'subtitle') parts.push(`<h2 class="subtitle">${esc(t.doc.text)}</h2>`);
      if (t.doc.kind === 'text') parts.push(`<p class="text">${esc(t.doc.text)}</p>`);
      if (t.doc.kind === 'stats') parts.push(statsWidget(t.doc.text, page));
      if (t.doc.kind === 'questions') parts.push(questionsBlock(t.doc.questions ?? []));
      if (t.doc.kind === 'remarks') parts.push(remarksBlock(pageRemarks));
      continue;
    }
    if (t.machine !== undefined) {
      const m = t.machine;
      parts.push(machineSection(m, svg, r.tests, marks));
      continue;
    }
    if (t.stepDef !== undefined && !stepsPlaced) {
      stepsPlaced = true;
      parts.push(
        `<div class="graph">${svg(stepsDot(r.steps, r.tests))}</div>`,
        ...r.steps.map((st) => stepSection(st, r.tests, marks)),
      );
      continue;
    }
    if (!rest.includes(t) || placed.has(restPath(t))) continue;
    placed.add(restPath(t));
    parts.push(
      groups(
        rest.filter((x) => restPath(x) === restPath(t)),
        marks,
      ),
    );
  }
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
.o-wip .mark { color: #b7791f; }
.from { font-size: .75rem; color: var(--muted); margin-left: .4rem; }
.stats { display: inline-flex; gap: .4rem; align-items: stretch; margin: .4rem .8rem .4rem 0; padding: .4rem; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
.stats-level { align-self: center; font-size: .75rem; text-transform: uppercase; color: var(--muted); padding: 0 .3rem; }
.stats.lvl-crit .stats-level { color: var(--fail); font-weight: 700; }
.stats.lvl-warn .stats-level { color: #d97706; font-weight: 700; }
.stat { display: flex; flex-direction: column; align-items: center; min-width: 4.2rem; padding: .2rem .4rem; border-radius: 6px; }
.stat .value { font-size: 1.5rem; font-weight: 600; line-height: 1.2; }
.stat .label { font-size: .7rem; color: var(--muted); }
.stat.passed.on .value { color: var(--pass); }
.stat.stubs.on .value { color: var(--todo); }
.stat.failed.on .value { color: var(--fail); }
.stat.total.on .value { color: var(--fg); font-weight: 700; }
h2.subtitle { border-bottom: none; margin-top: 2rem; }
p.text { font-size: 1.05rem; }
.lvl { font-size: .75rem; color: var(--muted); text-transform: uppercase; }
.diff-added { background: var(--added); } .diff-changed { background: var(--changed); } .diff-removed { background: var(--removed); }
.was { color: var(--muted); margin-left: .5rem; }
.pattern { font-size: .75rem; color: var(--muted); border: 1px dashed var(--line); border-radius: 4px; padding: 0 .3rem; margin-left: .4rem; }
.msg, .note { margin-left: 1.4rem; font-size: .85rem; color: var(--muted); }
.legend { display: flex; justify-content: center; align-items: center; gap: .8rem; font-size: .8rem; color: var(--muted); margin: -.4rem 0 .6rem; }
.lg { display: inline-flex; align-items: center; }
h3.fsm-part { margin-top: 1.6rem; }
.lg::before { content: ''; display: inline-block; width: .8rem; height: .8rem; border-radius: 3px; margin-right: .3rem; border: 2px solid #555555; background: #ffffff; }
.lg.user::before { border-color: #7c3aed; }
.lg.entry::before { border-color: #16a34a; background: #16a34a; border-radius: 50%; }
.lg.exit::before { border-color: #2563eb; background: #2563eb; }
.whole ul { margin-top: 0; }
.chip { display: inline-block; padding: 0 .45rem; border: 2px solid #9ca3af; border-radius: 999px; text-decoration: none; color: var(--fg); font-weight: 600; font-size: .9rem; }
.chip:hover { background: rgba(10, 132, 255, .08); }
.chip.s-pass { border-color: var(--pass); } .chip.s-fail { border-color: var(--fail); }
.chip.s-todo { border-color: #9ca3af; } .chip.s-wip { border-color: #d97706; }
.chip.user { color: #7c3aed; } .chip.exit { border-color: #2563eb; } .chip.entry { border-color: #16a34a; color: #16a34a; }
.chip.ev { font-weight: normal; border-style: dashed; }
details.local summary { cursor: pointer; color: var(--muted); font-size: .85rem; margin: .2rem 0; }
.graph.main { position: relative; }
.card { scroll-margin-top: 6rem; }
.graph .anchor { position: absolute; top: 0; left: 0; width: 1px; height: 1px; scroll-margin-top: .8rem; }
@keyframes flash { 0%, 100% { stroke-width: 1; } 50% { stroke: #f59e0b; stroke-width: 6; } }
.block { border: 2px solid var(--line); border-radius: 10px; padding: .4rem 1rem .6rem; margin: 1rem 0; }
.block h3 { margin: .3rem 0 .4rem; }
.block.remarks { border-color: var(--fail); }
.block.questions { border-color: #14b8a6; }
.block ol { padding-left: 1.4rem; } .block li { margin: .3rem 0; }
.remark .detail { color: var(--muted); list-style: disc; }
.answers { list-style: lower-alpha; }
.answer { position: relative; }
.answer.rec { font-weight: 600; background: rgba(20, 184, 166, .15); border-radius: 4px; padding: 0 .3rem; }
.answer .tip { display: none; position: absolute; left: 0; top: 100%; z-index: 2; max-width: 32rem; font-weight: normal; background: var(--bg); border: 1px solid #14b8a6; border-radius: 6px; padding: .4rem .6rem; box-shadow: 0 4px 14px rgba(0,0,0,.15); }
.answer:hover .tip { display: block; }
.answer:has(.tip) { cursor: help; text-decoration: underline dotted; }
table { border-collapse: collapse; font-size: .85rem; margin: .3rem 0; }
td, th { border-bottom: 1px solid var(--line); padding: .15rem .6rem; text-align: left; }
a { color: #0a84ff; }
@media print { .card:target { outline: none; } }
`;

export async function renderHtml(reports: FileReport[], entry?: string): Promise<string> {
  pageEntry = entry;
  const title = reports.flatMap((r) => r.all).find((t) => t.doc?.kind === 'title')?.doc?.text;
  const heading = title ?? reports.find((r) => r.plan !== undefined)?.plan?.name ?? 'Ожидания';
  const graphviz = await Graphviz.load();
  const svg = (source: string): string => inlineSvg(graphviz.dot(source));
  const page = reports.flatMap((r) => r.tests);
  pageRemarks = reports.flatMap((r) => r.issues);
  const declared = reports.some((r) => r.all.some((t) => t.doc?.kind === 'remarks'));
  const body = reports.map((r) => fileSection(r, svg, page)).join('\n');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${esc(heading)}</h1>
${declared ? '' : remarksBlock(pageRemarks)}
${body}
</body>
</html>
`;
}
