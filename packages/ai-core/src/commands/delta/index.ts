import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  ACCEPTED_FILE,
  LEGACY_ACCEPTED_FILE,
  acceptedOf,
  checkDelta,
  matchesTarget,
  revisionLines,
  unfinishedItems,
  type Accepted,
} from './delta.ts';
import { DELTA_DIR } from '#shared/layout';
import { UsageError, type Diagnostic } from '#shared/diagnostics';
import { report, warn } from '#shared/report';
import type { CommandArgs } from '#shared/args';
import {
  acquireLease,
  contentHash,
  digestOf,
  publishProjectJson,
  topologyOf,
} from '#lib/local-store';

const currentAccepted = (items: Accepted[], still: string[]): Accepted[] => [
  ...new Map(
    items.filter((item) => still.includes(item.file)).map((item) => [digestOf(item), item]),
  ).values(),
];

export async function runDelta(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command === 'close') {
    const lease = await acquireLease(args.root, 'delta-close', 'runtime');
    try {
      return await deltaOperation(command, args);
    } finally {
      await lease.release();
    }
  }
  return deltaOperation(command, args);
}

async function deltaOperation(command: string | undefined, args: CommandArgs): Promise<number> {
  if (command !== 'check' && command !== 'close')
    throw new UsageError(`неизвестная команда: delta ${command ?? ''}`.trimEnd());
  const result = await checkDelta(args.root);
  const ownFile = args.name === undefined ? undefined : `${DELTA_DIR}/${args.name}.yml`;
  const own =
    ownFile === undefined ? result.deltas : result.deltas.filter((d) => d.file === ownFile);
  const targets = own.flatMap((d) => d.items.map((i) => i.target));
  const isForeign = (d: Diagnostic): boolean =>
    ownFile !== undefined && d.file.startsWith(`${DELTA_DIR}/`) && d.file !== ownFile;
  const isOutside = (d: Diagnostic): boolean =>
    ownFile !== undefined &&
    own.length > 0 &&
    result.revisions.some((r) => r.file === d.file) &&
    !targets.some((t) => matchesTarget(t, d.file));
  const foreign = result.diagnostics.filter(isForeign);
  const outside = result.diagnostics.filter((d) => !isForeign(d) && isOutside(d));
  const errors = result.diagnostics.filter((d) => !isForeign(d) && !isOutside(d));
  warn(result.warnings);
  if (foreign.length > 0) {
    warn(foreign);
    const files = new Set(foreign.map((d) => d.file)).size;
    console.error(
      `дельты прошлых сессий с нарушениями (${files}): исправь их или удали, если их сессии не продолжатся — сессию ${args.name ?? ''} они не валят`,
    );
  }
  if (outside.length > 0) {
    warn(outside);
    console.error(
      `изменения вне целей дельты ${args.name ?? ''} без пункта revise (${outside.length}): правки других сессий — сессию ${args.name ?? ''} они не валят; свои — добавь пункт revise в дельту`,
    );
  }
  for (const line of revisionLines(own)) console.log(line);
  if (command === 'check') return report('delta check', errors);

  if (
    ownFile !== undefined &&
    own.length === 0 &&
    result.accepted.some((accepted) => accepted.delta === ownFile)
  )
    return report('delta close', []);
  if (ownFile !== undefined && own.length === 0 && !existsSync(path.join(args.root, ownFile)))
    return report('delta close', [{ file: ownFile, message: 'дельты нет — закрывать нечего' }]);
  const diagnostics = [...errors, ...unfinishedItems(args.root, result, own)];
  if (diagnostics.length > 0) return report('delta close', diagnostics);
  const still = result.revisions.map((r) => r.file);
  const newAccepted = await acceptedOf(args.root, own, still);
  const accepted = currentAccepted([...result.accepted, ...newAccepted], still);
  const before = digestOf({ result, accepted });
  const hashes = await Promise.all(
    own.map(async (d) => [d.file, await contentHash(args.root, d.file)]),
  );
  const checked = await checkDelta(args.root);
  const acceptedAgain = currentAccepted(
    [
      ...checked.accepted,
      ...(await acceptedOf(
        args.root,
        own,
        checked.revisions.map((r) => r.file),
      )),
    ],
    checked.revisions.map((revision) => revision.file),
  );
  if (
    before !== digestOf({ result: checked, accepted: acceptedAgain }) ||
    digestOf(hashes) !==
      digestOf(
        await Promise.all(own.map(async (d) => [d.file, await contentHash(args.root, d.file)])),
      )
  )
    throw new UsageError('delta close: STALE');
  const ledger = path.join(args.root, ACCEPTED_FILE);
  if (accepted.length === 0) await rm(ledger, { force: true });
  else {
    const topology = await topologyOf(args.root);
    const body = {
      version: 2,
      root: topology.project,
      worktree: topology.worktree,
      head: topology.head,
      items: accepted,
    };
    await publishProjectJson(args.root, ACCEPTED_FILE, { ...body, digest: digestOf(body) }, false);
  }
  await rm(path.join(args.root, LEGACY_ACCEPTED_FILE), { force: true });
  for (const d of own) {
    if (
      digestOf(await acceptedOf(args.root, own, still)) !== digestOf(newAccepted) ||
      (await contentHash(args.root, d.file)) !== hashes.find((entry) => entry[0] === d.file)?.[1]
    )
      throw new UsageError('delta close: STALE');
    await rm(path.join(args.root, d.file), { force: true });
    console.error(`removed ${d.file}`);
  }
  return report('delta close', []);
}

export {
  ACCEPTED_FILE,
  checkDelta,
  readAccepted,
  type Accepted,
  DELTA_SCHEMA,
  matchesTarget,
  revisionLines,
  unfinishedItems,
  type Delta,
  type DeltaItem,
  type DeltaResult,
  type Revision,
} from './delta.ts';
