import path from 'node:path';
import { checkSecrets, scanSecretsFile } from '../checks/secrets.ts';
import { loadConfig } from '../config.ts';
import { report } from './report.ts';
import type { CommandArgs } from './types.ts';

/**
 * `secrets scan`: без `--file` — отслеживаемые файлы проекта с исключениями
 * из конфига (работает и без harness.yml и при `secrets: false`); с `--file` —
 * один файл по пути, без исключений.
 */
export async function runSecretsScan(args: CommandArgs): Promise<number> {
  if (args.file !== undefined)
    return report('secrets', await scanSecretsFile(path.resolve(args.file)));
  const config = await loadConfig(args.root);
  return report('secrets', await checkSecrets(args.root, config?.checks.secrets ?? { allow: [] }));
}
