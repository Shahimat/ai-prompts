import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage, isRecord, loadModelManifest, resolveManifestModel } from '@shahimat/ai-core';
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from 'jsonc-parser';

const nativeAgents = ['build', 'plan', 'general', 'explore', 'compaction', 'title', 'summary'];

function configModel(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    (isRecord(value) &&
      typeof value['providerID'] === 'string' &&
      typeof value['model'] === 'string' &&
      (value['variant'] === undefined || typeof value['variant'] === 'string'))
  );
}

export async function projectModels(root: string, mode: 'apply' | 'check'): Promise<boolean> {
  const manifest = await loadModelManifest(root);
  if (manifest === null) throw new Error('manifest.json: обязательный manifest отсутствует');
  const configPath = path.join(root, 'opencode.jsonc');
  const original = await readFile(configPath, 'utf8');
  const errors: ParseError[] = [];
  const config: unknown = parse(original, errors, { allowTrailingComma: true });
  if (errors.length !== 0) {
    throw new Error(
      `opencode.jsonc: невалидный JSONC (${errors.map((error) => printParseErrorCode(error.error)).join(', ')})`,
    );
  }
  if (!isRecord(config)) throw new Error('opencode.jsonc: ожидается объект');
  if (config['model'] !== undefined && !configModel(config['model']))
    throw new Error('opencode.jsonc: model должен быть ссылкой на модель');
  const agents = config['agents'];
  if (agents !== undefined && !isRecord(agents))
    throw new Error('opencode.jsonc: agents должен быть объектом');
  const explicitAgents = isRecord(agents) ? Object.entries(agents) : [];
  for (const [id, agent] of explicitAgents) {
    if (!isRecord(agent))
      throw new Error(`opencode.jsonc: agents.${id} должен быть объектом`);
    if (agent['model'] !== undefined && !configModel(agent['model']))
      throw new Error(`opencode.jsonc: agents.${id}.model должен быть ссылкой на модель`);
  }
  let projected = original;
  function setModel(location: string[], model: string): void {
    projected = applyEdits(
      projected,
      modify(projected, location, model, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
          eol: original.includes('\r\n') ? '\r\n' : '\n',
        },
      }),
    );
  }
  setModel(['model'], manifest.default.split('#')[0] ?? manifest.default);
  const ids = new Set([...nativeAgents, ...explicitAgents.map(([id]) => id)]);
  for (const id of ids) {
    setModel(['agents', id, 'model'], resolveManifestModel(manifest, id).model);
  }
  if (projected === original) return false;
  if (mode === 'check')
    throw new Error('opencode.jsonc: модели расходятся с manifest.json; выполните npm run models:apply');
  await writeFile(configPath, projected);
  return true;
}

if (import.meta.main) {
  try {
    const mode = process.argv[2];
    if ((mode !== 'apply' && mode !== 'check') || process.argv.length !== 3)
      throw new Error('ожидается apply или check');
    await projectModels(path.dirname(import.meta.dirname), mode);
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
