// HTML для просмотра plan.md: производное, источник истины — markdown.
// Файл самодостаточный: стили встроены, схема зависимостей отрисована
// в SVG на месте, без внешних скриптов и сети.

import { parsePlan, SCRIPT_SECTIONS, type PlanItem } from './model.ts';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** Минимальный markdown: абзацы, списки, чекбоксы, код. */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list = false;
  let fence: string[] | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push('</ul>');
    list = false;
  };
  for (const line of md.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (fence === null) {
        flush();
        closeList();
        fence = [];
      } else {
        out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`);
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      fence.push(line);
      continue;
    }
    const item = /^(\s*)- (\[[ xX]\] )?(.*)$/.exec(line);
    if (item !== null) {
      flush();
      if (!list) out.push('<ul>');
      list = true;
      const box = item[2];
      const nested = (item[1] ?? '').length > 0 ? ' class="nested"' : '';
      const mark =
        box === undefined
          ? ''
          : `<input type="checkbox" disabled${/x/i.test(box) ? ' checked' : ''}> `;
      out.push(`<li${nested}>${mark}${inline(item[3] ?? '')}</li>`);
      continue;
    }
    if (line.trim() === '') {
      flush();
      closeList();
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  flush();
  closeList();
  if (fence !== null) out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`);
  return out.join('\n');
}

/** Слои графа: пункт стоит правее всех, от кого зависит. */
function layers(items: PlanItem[]): Map<string, number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const depth = new Map<string, number>();
  const visit = (id: string, guard: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (guard.has(id)) return 0;
    guard.add(id);
    const deps = (byId.get(id)?.deps ?? []).filter((d) => byId.has(d));
    const d = deps.length === 0 ? 0 : Math.max(...deps.map((x) => visit(x, guard))) + 1;
    depth.set(id, d);
    return d;
  };
  for (const i of items) visit(i.id, new Set());
  return depth;
}

/** SVG-схема зависимостей пунктов. */
export function dependencySvg(items: PlanItem[]): string {
  if (items.length === 0) return '';
  const depth = layers(items);
  const columns = new Map<number, PlanItem[]>();
  for (const item of items) {
    const d = depth.get(item.id) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), item]);
  }
  const W = 120;
  const H = 40;
  const GX = 60;
  const GY = 20;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, col] of columns)
    col.forEach((item, row) => pos.set(item.id, { x: 10 + d * (W + GX), y: 10 + row * (H + GY) }));
  const width = 20 + (Math.max(...columns.keys()) + 1) * (W + GX) - GX;
  const height = 20 + Math.max(...[...columns.values()].map((c) => c.length)) * (H + GY) - GY;
  const edges = items.flatMap((item) =>
    item.deps.flatMap((dep) => {
      const a = pos.get(dep);
      const b = pos.get(item.id);
      if (a === undefined || b === undefined) return [];
      return [
        `<line x1="${a.x + W}" y1="${a.y + H / 2}" x2="${b.x}" y2="${b.y + H / 2}" marker-end="url(#arrow)"/>`,
      ];
    }),
  );
  const nodes = items.map((item) => {
    const p = pos.get(item.id) ?? { x: 0, y: 0 };
    const cls = item.prefix === 'S' ? 'spike' : 'task';
    const label = item.title.length > 14 ? `${item.title.slice(0, 13)}…` : item.title;
    return `<a href="#${item.id}"><g class="${cls}"><rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="6"/><text x="${p.x + 8}" y="${p.y + 16}">${esc(item.id)}</text><text class="t" x="${p.x + 8}" y="${p.y + 32}">${esc(label)}</text></g></a>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs><g class="edges">${edges.join('')}</g>${nodes.join('')}</svg>`;
}

const STYLE = `body{font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:2em auto;padding:0 1em;color:#1d1d1f}
code{background:#f2f2f4;padding:0 .3em;border-radius:3px}pre{background:#f6f6f8;padding:.8em;overflow:auto}
.meta{color:#666}.item{border:1px solid #ddd;border-radius:8px;padding:.6em 1em;margin:1em 0}
.item.spike{border-color:#c9a227}.item h3{margin:.2em 0}li.nested{margin-left:1.5em;list-style:none}
svg .edges line{stroke:#888}svg path{fill:#888}svg rect{fill:#eef3ff;stroke:#5577cc}
svg .spike rect{fill:#fff6db;stroke:#c9a227}svg text{font-size:12px;font-weight:600}svg text.t{font-weight:400}`;

export function renderPlanHtml(text: string): string {
  const plan = parsePlan(text);
  const title = plan.title ?? 'План';
  const fm = plan.frontmatter;
  const meta = ['session', 'status', 'revision']
    .map((k) => {
      const v = fm[k];
      return typeof v === 'string' || typeof v === 'number' ? `${k}: ${v}` : '';
    })
    .filter((s) => s !== '')
    .join(' · ');
  const body: string[] = [`<h1>${esc(title)}</h1>`, `<p class="meta">${esc(meta)}</p>`];
  for (const section of plan.sections) {
    body.push(`<h2>${esc(section.name)}</h2>`);
    if (section.name === 'Схема') {
      body.push(dependencySvg(plan.items));
      continue;
    }
    const content = section.raw.split('\n').slice(1).join('\n');
    body.push(markdownToHtml(content));
    if (section.name === 'Пункты') {
      for (const item of plan.items) {
        const rest = item.raw.split('\n').slice(1).join('\n');
        body.push(
          `<div class="item ${item.prefix === 'S' ? 'spike' : 'task'}" id="${item.id}"><h3>${esc(item.id)}. ${esc(item.title)}</h3>${markdownToHtml(rest)}</div>`,
        );
      }
    }
  }
  if (!plan.sections.some((s) => s.name === SCRIPT_SECTIONS[0]) && plan.items.length > 0)
    body.splice(2, 0, `<h2>Схема</h2>`, dependencySvg(plan.items));
  return `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>\n${body.join('\n')}\n</body></html>\n`;
}
