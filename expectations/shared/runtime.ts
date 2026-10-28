import { prepare } from '@shahimat/cli';
import { repoRoot } from '@shahimat/ai-core/expect';

await prepare(['--root', repoRoot()]);
