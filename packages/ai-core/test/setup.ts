import { beforeEach, vi } from 'vitest';
import { fixtureEnvironment } from './environment.ts';

function isolate(): void {
  const env = fixtureEnvironment(process.env);
  for (const key of new Set([...Object.keys(process.env), ...Object.keys(env)]))
    if (process.env[key] !== env[key]) vi.stubEnv(key, env[key]);
}

isolate();
beforeEach(isolate);
