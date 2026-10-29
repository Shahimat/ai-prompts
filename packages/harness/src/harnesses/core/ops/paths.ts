import { createHash } from 'node:crypto';
import path from 'node:path';

export const OPS_VERSION = 1;
export const PROJECT_OPS = '.ops';
export const OPS_CONFIG = 'context/ops.yml';
export const AUTONOMY_FILE = 'context/autonomy.yml';
export const PROJECT_PROVIDERS = '.agents/providers';

export const machineDir = (home: string): string => path.join(home, 'ops');
export const machineFile = (home: string, ...rel: string[]): string =>
  path.join(machineDir(home), ...rel);
export const machineProviders = (home: string): string => path.join(home, 'providers');

export const projectFile = (root: string, ...rel: string[]): string =>
  path.join(root, PROJECT_OPS, ...rel);

export const jobDir = (root: string, short: string): string => projectFile(root, 'jobs', short);
export const watchesDir = (root: string): string => projectFile(root, 'watches');

export const projectKey = (root: string): string =>
  createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);

export const hashOf = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 32);
