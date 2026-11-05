import { createHash } from 'node:crypto';
import path from 'node:path';
import { AUTONOMY_PATH, JOBS_DIR, OPS_PATH, WATCHES_DIR } from '@shahimat/ai-core';

export const OPS_VERSION = 1;
export const PROJECT_OPS = '.oc3';
export const OPS_CONFIG = OPS_PATH;
export const AUTONOMY_FILE = AUTONOMY_PATH;
export const PROJECT_PROVIDERS = '.agents/providers';

export const machineDir = (home: string): string => path.join(home, 'ops');
export const machineFile = (home: string, ...rel: string[]): string =>
  path.join(machineDir(home), ...rel);
export const machineProviders = (home: string): string => path.join(home, 'providers');

export const projectFile = (root: string, ...rel: string[]): string =>
  path.join(root, PROJECT_OPS, ...rel);

export const jobDir = (root: string, short: string): string => path.join(root, JOBS_DIR, short);
export const watchesDir = (root: string): string => path.join(root, WATCHES_DIR);

export const posixRelative = (from: string, to: string): string =>
  path.relative(from, to).split(path.sep).join('/');

export const projectKey = (root: string): string =>
  createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);

export const hashOf = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 32);
