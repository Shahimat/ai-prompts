import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { errorCode, isRecord } from '#shared/guards';
import { PROJECT_PATH } from '#shared/layout';

export async function legacyModelOverrides(root: string): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(path.join(root, PROJECT_PATH), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return {};
    throw error;
  }
  let data: unknown;
  try {
    data = parse(text);
  } catch {
    return {};
  }
  const roles = isRecord(data) ? data['roles'] : undefined;
  const models = isRecord(roles) ? roles['models'] : undefined;
  return isRecord(models)
    ? Object.fromEntries(
        Object.entries(models).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
}
