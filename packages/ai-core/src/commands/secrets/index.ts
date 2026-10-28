import path from 'node:path';
import { checkSecrets, scanSecretsFile } from './secrets.ts';
import { loadConfig } from '#shared/config';
import { report } from '#shared/report';
import type { CommandArgs } from '#shared/args';

export async function runSecretsScan(args: CommandArgs): Promise<number> {
  if (args.file !== undefined)
    return report('secrets', await scanSecretsFile(path.resolve(args.file)));
  const config = await loadConfig(args.root);
  return report('secrets', await checkSecrets(args.root, config?.checks.secrets ?? { allow: [] }));
}

export { checkSecrets, scanSecrets, scanSecretsFile } from './secrets.ts';
