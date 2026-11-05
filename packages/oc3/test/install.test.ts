import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRecord } from '@shahimat/ai-core';
import { parse } from 'yaml';
import {
  detectState,
  ensureAgentsMd,
  ensureContextSkeleton,
  ensureGitFiles,
  ensurePackageJson,
  ensureProjectYml,
  humanQuestions,
  migrationReport,
  resolveRuntime,
  toolHints,
  upsertRuntimeYaml,
  ensureSyncContractYaml,
  pins,
} from '#install';
import {
  AGENTS_PIECES,
  CORE_MANIFEST,
  GITIGNORE_LINES,
  ROLE_NAMES,
  SKILL_PRESET,
} from '#templates';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'oc3-install-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(rel: string, text: string): Promise<void> {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, text, 'utf8');
}

const read = async (rel: string): Promise<string> => readFile(path.join(root, rel), 'utf8');

const V3_PROJECT =
  'name: demo\nsync:\n  contract:\n    key: agent-operational-contract-v3\n    edition: operator-centric\n';

describe('detectState', () => {
  it('пустой проект — nothing', async () => {
    expect((await detectState(root)).state).toBe('nothing');
  });

  it('маркеры v2 без v3 — v2', async () => {
    await put('context/workflow.md', '# v2 workflow\n');
    await mkdir(path.join(root, 'context', 'views'));
    await writeFile(path.join(root, 'context', 'views', 'queue.yml'), 'items: []\n', 'utf8');
    const detection = await detectState(root);
    expect(detection.state).toBe('v2');
  });

  it('project.yml v3 есть, остального нет — v3-partial с деталями', async () => {
    await put('.oc3/project.yml', V3_PROJECT);
    const detection = await detectState(root);
    expect(detection.state).toBe('v3-partial');
    expect(detection.details.join(' ')).toContain('AGENTS.md');
    expect(detection.details.join(' ')).toContain('package.json');
    expect(detection.details.join(' ')).toContain('@shahimat/oc3');
  });

  it('все маркеры v3 без лок-маркера — v3-ok', async () => {
    await put('.oc3/project.yml', V3_PROJECT);
    await put('AGENTS.md', 'правила\n<!-- module:worktrees -->\nсвой блок\n');
    await put(
      'package.json',
      '{"devDependencies":{"@shahimat/ai-core":"0.1.6","@shahimat/oc3":"0.1.3"}}',
    );
    await put('opencode.jsonc', '{"plugins":["@shahimat/oc3"]}');
    expect((await detectState(root)).state).toBe('v3-ok');
  });

  it('JSONC с комментариями в plugins — v3-ok', async () => {
    await put('.oc3/project.yml', V3_PROJECT);
    await put('AGENTS.md', '<!-- module:worktrees -->\n');
    await put(
      'package.json',
      '{"devDependencies":{"@shahimat/ai-core":"0.1.6","@shahimat/oc3":"0.1.3"}}',
    );
    await put(
      'opencode.jsonc',
      '{\n  // плагин контракта\n  "$schema": "https://opencode.ai/config.json",\n  "plugins": ["@shahimat/oc3"],\n}',
    );
    expect((await detectState(root)).state).toBe('v3-ok');
  });

  it('ключ plugin вместо plugins с пакетом — не v3-ok, детект называет причину', async () => {
    await put('.oc3/project.yml', V3_PROJECT);
    await put('AGENTS.md', '<!-- module:worktrees -->\n');
    await put(
      'package.json',
      '{"devDependencies":{"@shahimat/ai-core":"0.1.6","@shahimat/oc3":"0.1.3"}}',
    );
    await put('opencode.jsonc', '{\n  "plugin": ["@shahimat/oc3@0.1.4"]\n}');
    const detection = await detectState(root);
    expect(detection.state).not.toBe('v3-ok');
    expect(detection.details.join(' ')).toContain(
      'плагин не загрузится — ключ plugin вместо plugins (нужен plugins)',
    );
  });

  it('plugins есть, но пакета в нём нет — не v3-ok', async () => {
    await put('.oc3/project.yml', V3_PROJECT);
    await put('AGENTS.md', '<!-- module:worktrees -->\n');
    await put(
      'package.json',
      '{"devDependencies":{"@shahimat/ai-core":"0.1.6","@shahimat/oc3":"0.1.3"}}',
    );
    await put('opencode.jsonc', '{"plugins":["другой-плагин"]}');
    const detection = await detectState(root);
    expect(detection.state).not.toBe('v3-ok');
    expect(detection.details.join(' ')).toContain('в plugins нет "@shahimat/oc3"');
  });

  it('все маркеры v3, но лок-маркер установки — v3-partial', async () => {
    await put('.oc3/project.yml', V3_PROJECT);
    await put('AGENTS.md', '<!-- module:worktrees -->\n');
    await put(
      'package.json',
      '{"devDependencies":{"@shahimat/ai-core":"0.1.6","@shahimat/oc3":"0.1.3"}}',
    );
    await put('opencode.jsonc', '{"plugins":["@shahimat/oc3"]}');
    await put('.oc3/locks/install', 'x\n');
    const detection = await detectState(root);
    expect(detection.state).toBe('v3-partial');
    expect(detection.details.join(' ')).toContain('.oc3/locks/install');
  });

  it('detectState помечает v2-хвосты при готовом ядре и отдаёт v2Leftovers', async () => {
    await put('.oc3/project.yml', V3_PROJECT);
    await put('AGENTS.md', '<!-- module:worktrees -->\n');
    await put(
      'package.json',
      '{"devDependencies":{"@shahimat/ai-core":"0.1.6","@shahimat/oc3":"0.1.3"}}',
    );
    await put('opencode.jsonc', '{"plugins":["@shahimat/oc3"]}');
    await put('context/workflow.md', 'старое\n');
    const detection = await detectState(root);
    expect(detection.state).toBe('v3-partial');
    expect(detection.v2Leftovers).toBe(true);
    expect(detection.details.join(' ')).toContain('артефакты v2');
  });
});

describe('runtime', () => {
  it('онлайн — full с пояснением, offline — degraded с шагами', () => {
    const full = resolveRuntime(true);
    expect(full.runtime).toBe('full');
    expect(full.lines.join(' ')).toContain('cold-start');
    const degraded = resolveRuntime(false);
    expect(degraded.runtime).toBe('degraded');
    expect(degraded.lines.join(' ')).toContain('реестр npm недоступен');
    expect(degraded.lines.join(' ')).toContain('runtime: full');
  });

  it('детект node/npm переводится в подсказки', () => {
    expect(toolHints({ node: true, npm: true })).toEqual([]);
    expect(toolHints({ node: false, npm: true }).join(' ')).toContain('ai CLI');
    expect(toolHints({ node: true, npm: false }).join(' ')).toContain('npm не найден');
    expect(toolHints({ node: true, npm: false }).join(' ')).toContain('установит сам');
  });

  it('upsertRuntimeYaml вставляет и обновляет runtime', () => {
    expect(upsertRuntimeYaml('name: x\n', 'degraded')).toBe('name: x\nruntime: degraded\n');
    expect(upsertRuntimeYaml('name: x\nruntime: full\n', 'degraded')).toBe(
      'name: x\nruntime: degraded\n',
    );
  });

  it('pins отдаёт точные версии из собственного пакета', async () => {
    const resolved = await pins();
    expect(resolved.aiCore).toMatch(/^\d+\.\d+\.\d+$/);
    expect(resolved.oc3).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('ensureAgentsMd', () => {
  it('нет файла — пишет шаблон целиком со всеми секциями и module-блоком', async () => {
    const lines = await ensureAgentsMd(root);
    expect(lines[0]).toContain('записан по шаблону');
    const text = await read('AGENTS.md');
    for (const piece of AGENTS_PIECES) expect(text).toContain(piece.marker);
  });

  it('есть файл — дописывает только недостающее, своё не трогает', async () => {
    await put('AGENTS.md', '# мой проект\n\n## Мои правила\n\n- не удалять моё\n');
    const lines = await ensureAgentsMd(root);
    expect(lines[0]).toContain('дописаны секции');
    const text = await read('AGENTS.md');
    expect(text).toContain('# мой проект');
    expect(text).toContain('не удалять моё');
    for (const piece of AGENTS_PIECES) expect(text).toContain(piece.marker);
    const second = await ensureAgentsMd(root);
    expect(second[0]).toContain('без изменений');
  });

  it('v2-упоминание в шапке остаётся и попадает в отчёт', async () => {
    await put('AGENTS.md', '# проект\nagent-operational-contract-v2\n');
    const lines = await ensureAgentsMd(root);
    expect(lines.join(' ')).toContain('v2');
    expect(await read('AGENTS.md')).toContain('agent-operational-contract-v2');
  });
});

describe('ensureProjectYml', () => {
  it('нет файла — каркас с плейсхолдерами, edition operator-centric', async () => {
    const lines = await ensureProjectYml(root, 'full');
    expect(lines[0]).toContain('каркас');
    const text = await read('.oc3/project.yml');
    expect(text).toContain('edition: operator-centric');
    expect(text).toContain('runtime: full');
    expect(text).toContain('ЗАПОЛНИ');
    const data: unknown = parse(text);
    if (!isRecord(data)) throw new Error('каркас не YAML-объект');
    expect(isRecord(data['sync'])).toBe(true);
  });

  it('есть v2-project.yml — дописывает runtime и sync.contract, своё сохраняет', async () => {
    await put('.oc3/project.yml', 'name: legacy\nroles:\n  models: {}\n');
    const lines = await ensureProjectYml(root, 'degraded');
    expect(lines.join(' ')).toContain('runtime: degraded');
    const text = await read('.oc3/project.yml');
    expect(text).toContain('name: legacy');
    expect(text).toContain('runtime: degraded');
    expect(text).toContain('key: agent-operational-contract-v3');
    expect(text).toContain('edition: operator-centric');
  });

  it('битый YAML не переписывается', async () => {
    await put('.oc3/project.yml', 'briefing: [unclosed\n');
    const lines = await ensureProjectYml(root, 'full');
    expect(lines[0]).toContain('невалидный YAML');
    expect(await read('.oc3/project.yml')).toBe('briefing: [unclosed\n');
  });

  it('ensureSyncContractYaml вставляет contract под существующий sync, не дублирует', () => {
    const first = ensureSyncContractYaml('name: x\nsync:\n  index_source: https://a\n');
    expect(first.changed).toBe(true);
    expect(first.text).toContain('  contract:\n    key: agent-operational-contract-v3');
    expect(first.text).toContain('index_source: https://a');
    const second = ensureSyncContractYaml(first.text);
    expect(second.changed).toBe(false);
    expect(second.text.match(/contract:/g)?.length).toBe(1);
  });
});

describe('ensurePackageJson и git-файлы', () => {
  it('нет package.json — создаёт с точными пинами', async () => {
    const lines = await ensurePackageJson(root);
    expect(lines[0]).toContain('точными пинами');
    const data: unknown = JSON.parse(await read('package.json'));
    if (!isRecord(data) || !isRecord(data['devDependencies']))
      throw new Error('package.json не объект');
    expect(data['devDependencies']['@shahimat/ai-core']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(data['devDependencies']['@shahimat/oc3']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('диапазонные версии заменяются точными пинами, остальное сохраняется', async () => {
    await put(
      'package.json',
      '{"name":"x","devDependencies":{"typescript":"^5","@shahimat/ai-core":"^0.1.0"}}',
    );
    const lines = await ensurePackageJson(root);
    expect(lines[0]).toContain('точные пины');
    const text = await read('package.json');
    expect(text).toContain('"typescript": "^5"');
    expect(text).toContain('"@shahimat/ai-core": "');
    expect(text).not.toContain('^0.1.0');
    const second = await ensurePackageJson(root);
    expect(second[0]).toContain('на месте');
  });

  it('gitignore и gitattributes создаются и дополняются без дублей', async () => {
    await put('.gitignore', 'node_modules/\nсвоё-правило\n');
    const first = await ensureGitFiles(root);
    expect(first.join(' ')).toContain('.gitignore: дописаны');
    const text = await read('.gitignore');
    expect(text).toContain('своё-правило');
    for (const line of GITIGNORE_LINES) expect(text).toContain(line);
    expect(await read('.gitattributes')).toContain('eol=lf');
    const second = await ensureGitFiles(root);
    expect(second.join(' ')).toContain('на месте');
    const hits = (await read('.gitignore')).match(/node_modules\//g) ?? [];
    expect(hits.length).toBe(1);
  });
});

describe('migrationReport и вопросы', () => {
  it('v2 views и workflow.md попадают в отчёт без конверсии', async () => {
    await mkdir(path.join(root, 'context', 'views'), { recursive: true });
    await writeFile(path.join(root, 'context', 'views', 'queue.yml'), 'items: []\n', 'utf8');
    await writeFile(path.join(root, 'context', 'views', 'plan.json'), '{}\n', 'utf8');
    await writeFile(path.join(root, 'context', 'workflow.md'), '# v2\n', 'utf8');
    const lines = await migrationReport(root);
    const text = lines.join('\n');
    expect(text).toContain('НЕ конвертируется молча');
    expect(text).toContain('context/views/queue.yml → .oc3/goals/queue.expect.ts');
    expect(text).toContain('context/views/plan.json → .oc3/goals/plan.expect.ts');
    expect(text).toContain('context/workflow.md');
    expect(existsSync(path.join(root, '.oc3/goals'))).toBe(false);
  });

  it('пустой views — отчёт с «переносить нечего»', async () => {
    await mkdir(path.join(root, 'context', 'views'), { recursive: true });
    const lines = await migrationReport(root);
    expect(lines.join(' ')).toContain('переносить нечего');
  });

  it('без артефактов v2 отчёт пуст', async () => {
    expect(await migrationReport(root)).toEqual([]);
  });

  it('вопросы человеку — нумерованный список: reality и реквизиты', async () => {
    const lines = await humanQuestions(true);
    expect(lines[0]).toContain('вопросы человеку');
    const text = lines.join('\n');
    expect(text).toContain('reality');
    expect(text).toContain('sync.index_source');
    expect(text).toContain('oc3 models set');
    expect(text).toContain('name и summary');
    expect(text).toMatch(/1\./);
  });

  it('отчёт печатает канонический состав ядра: оба списка и пометка про SHA', async () => {
    const lines = await humanQuestions(true, true);
    const text = lines.join('\n');
    expect(text).toContain('канонический состав ядра operator-centric');
    for (const skill of CORE_MANIFEST.skills) expect(text).toContain(skill);
    expect(text).toContain(
      'skills — research, executor, judge, librarian, operator-feedback, workflow, contract-setup, source-sync, cli, domain, manuals',
    );
    expect(text).toContain('агенты — researcher, executor, judge, librarian');
    expect(text).toContain(
      'SHA заполнят первые source-sync update; до них части считаются не скачанными',
    );
  });

  it('CORE_MANIFEST совпадает с пресетом привязок и встроенными ролями', () => {
    expect([...CORE_MANIFEST.skills].sort()).toEqual(SKILL_PRESET.map((entry) => entry.key).sort());
    expect(CORE_MANIFEST.agents).toEqual(ROLE_NAMES);
  });
});

describe('каркас .oc3', () => {
  it('autonomy и skills пишутся один раз', async () => {
    const first = await ensureContextSkeleton(root);
    expect(first.join(' ')).toContain('autonomy.yml');
    expect(first.join(' ')).toContain('skills.yml');
    expect(await read('.oc3/autonomy.yml')).toContain('external: deny');
    const second = await ensureContextSkeleton(root);
    expect(second.join(' ')).toContain('не трогаю');
    const names = await readdir(path.join(root, '.oc3'));
    expect(names).toContain('skills.yml');
    expect(names).toContain('autonomy.yml');
  });
});
