import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SecretsOptions } from '#shared/config';
import { UsageError, type Diagnostic } from '#shared/diagnostics';
import { normalizeEol } from '#shared/frontmatter';
import { errorCode } from '#shared/guards';

const MAX_BYTES = 1024 * 1024;

interface Rule {
  kind: string;
  pattern: RegExp;
  group?: number;
}

const RULES: readonly Rule[] = [
  { kind: 'приватный ключ', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { kind: 'ключ API AWS', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'токен GitHub', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{60,})\b/ },
  { kind: 'токен GitLab', pattern: /\bglpat-[\w-]{20,}\b/ },
  { kind: 'токен Slack', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'ключ API Anthropic', pattern: /\bsk-ant-[\w-]{20,}\b/ },
  { kind: 'ключ API OpenAI', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { kind: 'ключ API Google', pattern: /\bAIza[\w-]{35}\b/ },
  { kind: 'токен npm', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { kind: 'JWT', pattern: /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}\b/ },
  {
    kind: 'пароль или секрет в присваивании',
    pattern:
      /\b[\w-]*?(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret|token)\b["']?\s*[:=]\s*["']?([^\s"'`,;]{8,})/i,
    group: 1,
  },
];

function isPlaceholder(value: string): boolean {
  if (/^[<{$%[(]|^env:|^vault:|^op:\/\//i.test(value)) return true;
  if (/^(.)\1+$/.test(value)) return true;
  if (/^(?:x+|changeme|example|placeholder|redacted|none|null|true|false)$/i.test(value))
    return true;
  return !/[A-Za-z]/.test(value) || !/[0-9\W_]/.test(value);
}

export function scanSecrets(text: string, file: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
  normalizeEol(text)
    .split('\n')
    .forEach((line, i) => {
      for (const rule of RULES) {
        const m = rule.pattern.exec(line);
        if (m === null) continue;
        if (rule.group !== undefined && isPlaceholder(m[rule.group] ?? '')) continue;
        diags.push({ file, line: i + 1, message: `секрет: ${rule.kind}` });
        break;
      }
    });
  return diags;
}

const SKIP_DIRS = new Set(['.git', 'node_modules']);

async function projectFiles(root: string): Promise<string[]> {
  const git = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (git.status === 0) return git.stdout.split('\0').filter((f) => f !== '');
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .filter((f) => !f.split('/').some((seg) => SKIP_DIRS.has(seg)));
}

async function readText(file: string): Promise<string | null> {
  let data: Buffer;
  try {
    data = await readFile(file);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (data.length > MAX_BYTES || data.includes(0)) return null;
  return data.toString('utf8');
}

const allowed = (d: Diagnostic, options: SecretsOptions): boolean =>
  options.allow.some((a) => a.path === d.file && (a.line === undefined || a.line === d.line));

export async function checkSecrets(root: string, options: SecretsOptions): Promise<Diagnostic[]> {
  const diags: Diagnostic[] = [];
  for (const file of await projectFiles(root)) {
    const text = await readText(path.join(root, file));
    if (text !== null) diags.push(...scanSecrets(text, file));
  }
  return diags.filter((d) => !allowed(d, options));
}

export async function scanSecretsFile(file: string): Promise<Diagnostic[]> {
  const text = await readText(file);
  if (text === null)
    throw new UsageError(`secrets: ${file} — нет файла, он бинарный или больше 1 MB`);
  return scanSecrets(text, file);
}
