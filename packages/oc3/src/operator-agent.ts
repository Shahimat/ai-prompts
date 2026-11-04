import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { isRecord } from '@shahimat/ai-core';

export const CONFIGS = [
  'opencode.json',
  'opencode.jsonc',
  '.opencode/opencode.json',
  '.opencode/opencode.jsonc',
];

const OPERATOR_AGENT = path.join('.opencode', 'agents', 'operator.md');
const DEFAULT_CONFIG = 'opencode.jsonc';
const SCHEMA = 'https://opencode.ai/config.json';
const OPERATOR = 'operator';
const PLUGIN = '@shahimat/oc3';

export const OPERATOR_PROMPT =
  'Маршрут, правила и сценарии — AGENTS.md; брифинг и протоколы — skill workflow; первое сообщение сессии — брифинг схемы (дефолтная или кастомная), после ответа вызови oc3.briefing_done';

export function operatorAgentMd(): string {
  return [
    '---',
    'description: Оператор — маршрутизатор сессии контракта v3: маршрут и правила в AGENTS.md, брифинг и сценарии — skill workflow',
    'mode: primary',
    '---',
    OPERATOR_PROMPT,
    '',
  ].join('\n');
}

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

export async function ensureOperatorAgent(root: string): Promise<string> {
  const abs = path.join(root, OPERATOR_AGENT);
  const template = operatorAgentMd();
  const current = await readOrNull(abs);
  if (current === null) {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, template, 'utf8');
    return `${OPERATOR_AGENT} создан (mode: primary, промпт — только маршрутизация)`;
  }
  if (current === template) return `${OPERATOR_AGENT} соответствует шаблону — без изменений`;
  return `${OPERATOR_AGENT} содержит пользовательские правки — не перетираю`;
}

interface StringToken {
  start: number;
  end: number;
  value: string;
}

const isSpace = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';

export const parseJsonc = (text: string): unknown => {
  let out = '';
  let inString = false;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (lineComment) {
      if (ch === '\n') {
        lineComment = false;
        out += ch;
      }
      continue;
    }
    if (blockComment) {
      if (ch === '*' && text.charAt(i + 1) === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && text.charAt(i + 1) === '/') {
      lineComment = true;
      continue;
    }
    if (ch === '/' && text.charAt(i + 1) === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  try {
    const data: unknown = JSON.parse(out);
    return data;
  } catch {
    return undefined;
  }
};

const topLevelBrace = (text: string): number => {
  let inString = false;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && text.charAt(i + 1) === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      escape = false;
      continue;
    }
    if (ch === '/' && text.charAt(i + 1) === '/') {
      lineComment = true;
      continue;
    }
    if (ch === '/' && text.charAt(i + 1) === '*') {
      blockComment = true;
      continue;
    }
    if (ch === '{') return i;
  }
  return -1;
};

const findDefaultAgentValue = (text: string): StringToken | undefined => {
  let depth = 0;
  let inString = false;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  let stringStart = 0;
  let armed = false;
  let capturing = false;
  let last = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && text.charAt(i + 1) === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') {
        inString = false;
        if (capturing)
          return { start: stringStart, end: i + 1, value: text.slice(stringStart + 1, i) };
        if (
          depth === 1 &&
          (last === '{' || last === ',') &&
          text.slice(stringStart + 1, i) === 'default_agent'
        )
          armed = true;
        last = '"';
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      escape = false;
      stringStart = i;
      if (armed) capturing = true;
      continue;
    }
    if (ch === '/' && text.charAt(i + 1) === '/') {
      lineComment = true;
      continue;
    }
    if (ch === '/' && text.charAt(i + 1) === '*') {
      blockComment = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    if (armed && ch !== ':' && !isSpace(ch)) armed = false;
    if (!isSpace(ch)) last = ch;
  }
  return undefined;
};

const insertAfterBrace = (text: string, snippet: string): string | null => {
  const brace = topLevelBrace(text);
  if (brace < 0) return null;
  const after = text.slice(brace + 1);
  if (/^[ \t\r\n]*}/.test(after)) {
    const rest = after.replace(/^[ \t\r\n]*}/, '}');
    return `${text.slice(0, brace)}{\n${snippet}\n${rest}`;
  }
  return `${text.slice(0, brace + 1)}\n${snippet},${after}`;
};

export function applyDefaultAgent(text: string): { text: string; report: string } {
  const existing = findDefaultAgentValue(text);
  if (existing !== undefined) {
    if (existing.value === OPERATOR)
      return { text, report: `"default_agent": "${OPERATOR}" уже стоит — без изменений` };
    return {
      text,
      report: `"default_agent": "${existing.value}" — не перетираю чужой агент, переключение вручную`,
    };
  }
  const inserted = insertAfterBrace(text, `  "default_agent": "${OPERATOR}"`);
  if (inserted === null)
    return {
      text,
      report: 'в конфиге нет JSON-объекта — добавь "default_agent": "operator" вручную',
    };
  return { text: inserted, report: `добавил "default_agent": "${OPERATOR}"` };
}

const newConfig = (): string =>
  `{\n  "$schema": "${SCHEMA}",\n  "default_agent": "${OPERATOR}",\n  "plugins": ["${PLUGIN}"]\n}\n`;

export async function ensureDefaultAgent(root: string): Promise<string> {
  for (const rel of CONFIGS) {
    const abs = path.join(root, rel);
    const text = await readOrNull(abs);
    if (text === null) continue;
    const applied = applyDefaultAgent(text);
    if (applied.text !== text) await writeFile(abs, applied.text, 'utf8');
    return `${rel}: ${applied.report}`;
  }
  await writeFile(path.join(root, DEFAULT_CONFIG), newConfig(), 'utf8');
  return `${DEFAULT_CONFIG}: создан ($schema + "default_agent": "${OPERATOR}" + plugins)`;
}

export async function ensurePluginEntry(root: string): Promise<string> {
  for (const rel of CONFIGS) {
    const abs = path.join(root, rel);
    const text = await readOrNull(abs);
    if (text === null) continue;
    let data: unknown = parseJsonc(text);
    if (data === undefined) {
      try {
        data = parse(text);
      } catch {
        return `${rel}: конфиг не разбирается — добавь "plugins": ["${PLUGIN}"] вручную`;
      }
    }
    if (isRecord(data) && Array.isArray(data['plugins'])) {
      if (data['plugins'].includes(PLUGIN)) return `${rel}: плагин ${PLUGIN} подключён`;
      return `${rel}: ключ plugins есть, но без ${PLUGIN} — добавь запись вручную`;
    }
    const wrongKey = isRecord(data) && 'plugin' in data;
    const inserted = insertAfterBrace(text, `  "plugins": ["${PLUGIN}"]`);
    if (inserted === null) return `${rel}: нет JSON-объекта — добавь "${PLUGIN}" в plugins вручную`;
    await writeFile(abs, inserted, 'utf8');
    if (wrongKey)
      return `${rel}: ключ plugin вместо plugins (нужен plugins) — добавил "plugins": ["${PLUGIN}"], удали ключ plugin сам`;
    return `${rel}: добавил "plugins": ["${PLUGIN}"]`;
  }
  return 'конфиг opencode не найден — создай его (oc3 init) и повтори';
}
