import { cliMain, commandTree, runCli } from '@shahimat/ai-core';
import { HARNESS_NODES } from './harnesses/index.ts';

export const HARNESS = commandTree('harness', HARNESS_NODES);

export const main = (argv: string[], now: Date = new Date()): Promise<number> =>
  cliMain(HARNESS, argv, now);

export const run = (argv: string[]): Promise<number> => runCli(HARNESS, argv);
