import { UsageError } from '#shared/diagnostics';

export function testArguments(provided: string[]): { force: boolean; argv: string[] } {
  const argv: string[] = [];
  const valueFlags = new Set([
    '-t',
    '--testNamePattern',
    '--reporter',
    '--outputFile',
    '--exclude',
    '--config',
  ]);
  const booleanFlags = new Set(['--silent', '--no-file-parallelism', '--passWithNoTests']);
  let force = false;
  for (let index = 0; index < provided.length; index++) {
    const argument = provided[index];
    if (argument === undefined) throw new UsageError('missing argument');
    if (argument === '--force') {
      force = true;
      continue;
    }
    if (valueFlags.has(argument)) {
      const value = provided[++index];
      if (value === undefined || value.startsWith('-'))
        throw new UsageError(`${argument} requires a value`);
      argv.push(argument, value);
    } else if (booleanFlags.has(argument) || !argument.startsWith('-')) argv.push(argument);
    else throw new UsageError(`unsupported test option: ${argument}`);
  }
  return { force, argv };
}
