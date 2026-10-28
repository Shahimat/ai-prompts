import { commandTree } from '@shahimat/ai-core';
import { HARNESS_NODES } from './harnesses/index.ts';

export const HARNESS = commandTree('ai', HARNESS_NODES);
