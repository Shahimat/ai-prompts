import path from 'node:path';
import { runModels } from '@shahimat/ai-core';

const command = process.argv[2];
if (command !== 'apply' && command !== 'check') throw new Error('ожидается apply или check');
process.exitCode = await runModels(command, { root: path.dirname(import.meta.dirname), now: new Date() });
