import { describe } from 'vitest';
import { budget, crit, warn } from '@shahimat/ai-core/expect';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
void warn;
void writeFileSync;
void path;
budget({ crit: 0, warn: 0 });
describe('план', () => { crit('вне expectations', () => {}); });
