import { describe, expect, it } from 'vitest';
import {
  titlePlan,
  titleDelta,
  applyTitleAnswer,
  isTitleProof,
  type TitlePlan,
  type TitleProof,
} from '#lib/expect/title-proof';
import type { ProducerContext } from '#lib/expect/proof';
import { ignoredWatchPath } from '#commands/expect/serve';

const producer: ProducerContext = {
  adapter: 'controlled-no-tools',
  complete: true,
  instructions: [{ name: 'system', text: 'evaluate immutable titles only' }],
  contract: 'explicit unary and pair coverage',
  diagnostics: [],
};
const scope = 'example.expect.ts';
const plan = (names = ['first', 'second', 'third'], context = producer) =>
  titlePlan(
    scope,
    names.map((title) => ({ file: scope, path: ['suite'], title })),
    context,
  );
const answer = (review: TitlePlan, problem = false) => ({
  evaluated: review.checks.map((check) => ({
    id: check.id,
    problem,
    reason: problem ? 'conflict' : 'evaluated: no problem',
  })),
});
const proofs = (review: TitlePlan, run?: string): Record<string, TitleProof> =>
  Object.fromEntries(
    applyTitleAnswer(review, answer(review), new Date('2026-11-08'), run).map((proof) => [
      proof.check.id,
      proof,
    ]),
  );

describe('body-independent title proof contract', () => {
  it('requires explicit negative coverage for every unary and unordered pair', () => {
    const review = plan();
    expect(review.complete).toBe(true);
    expect(review.checks.filter((check) => check.kind === 'unary')).toHaveLength(3);
    expect(review.checks.filter((check) => check.kind === 'pair')).toHaveLength(3);
    expect(titleDelta(review, proofs(review)).plan.checks).toHaveLength(0);
    expect(() =>
      applyTitleAnswer(review, { contradictions: [], unmeasurable: [] }, new Date()),
    ).toThrow('MISSING_TITLE_COVERAGE');
    expect(() => applyTitleAnswer(review, { evaluated: [] }, new Date())).toThrow(
      'MISSING_TITLE_COVERAGE',
    );
  });
  it('title edit invalidates own unary and every affected pair, not unchanged pairs', () => {
    const before = plan();
    const delta = titleDelta(plan(['renamed', 'second', 'third']), proofs(before));
    expect(delta.reused).toHaveLength(3);
    expect(delta.plan.checks).toHaveLength(3);
    expect(delta.plan.nodes.map((node) => node.intent.title).sort()).toEqual([
      'renamed',
      'second',
      'third',
    ]);
  });
  it('insertion and deletion change coverage without changing old pair keys', () => {
    const before = plan();
    const saved = proofs(before);
    expect(titleDelta(plan(['new', 'first', 'second', 'third']), saved).reused).toHaveLength(6);
    expect(titleDelta(plan(['new', 'first', 'second', 'third']), saved).plan.checks).toHaveLength(
      4,
    );
    expect(titleDelta(plan(['first', 'third']), saved).plan.checks).toHaveLength(0);
    expect(plan(['first', 'third']).membership).not.toBe(before.membership);
  });
  it('reordering and independent body generations do not affect title-only inputs', () => {
    expect(plan(['third', 'first', 'second'])).toEqual(plan());
    expect(titleDelta(plan(), proofs(plan())).reused).toHaveLength(6);
    expect(JSON.stringify(plan())).not.toContain('registration');
  });
  it('policy and effective instruction changes invalidate explicit coverage', () => {
    const before = plan();
    const changed = plan(undefined, {
      ...producer,
      instructions: [{ name: 'system', text: 'new policy' }],
    });
    expect(titleDelta(changed, proofs(before)).reused).toHaveLength(0);
    expect(changed.policy).not.toBe(before.policy);
  });
  it('force bypasses baseline but retains matching authenticated current-run positive and negative evaluations', () => {
    const review = plan();
    expect(titleDelta(review, proofs(review, 'run-a'), true, 'run-b').reused).toHaveLength(0);
    expect(titleDelta(review, proofs(review, 'run-a'), true, 'run-a').reused).toHaveLength(6);
    const positive = Object.fromEntries(
      applyTitleAnswer(review, answer(review, true), new Date(), 'run-a').map((proof) => [
        proof.check.id,
        proof,
      ]),
    );
    expect(titleDelta(review, positive, true, 'run-a').reused.every((proof) => proof.problem)).toBe(
      true,
    );
  });
  it('rejects missing, duplicate, foreign and corrupted coverage', () => {
    const review = plan();
    const evaluated = answer(review).evaluated;
    expect(() => applyTitleAnswer(review, { evaluated: evaluated.slice(1) }, new Date())).toThrow(
      'MISSING_TITLE_COVERAGE',
    );
    expect(() =>
      applyTitleAnswer(review, { evaluated: [...evaluated, evaluated[0]] }, new Date()),
    ).toThrow('DUPLICATE_OR_FOREIGN');
    expect(() =>
      applyTitleAnswer(
        review,
        { evaluated: [{ id: 'foreign', problem: false, reason: 'no' }] },
        new Date(),
      ),
    ).toThrow('DUPLICATE_OR_FOREIGN');
    const saved = proofs(review);
    const proof = Object.values(saved)[0];
    if (proof === undefined) throw new Error('missing fixture');
    proof.problem = true;
    expect(isTitleProof(proof)).toBe(false);
    expect(titleDelta(review, saved).plan.checks).toHaveLength(1);
  });
  it('does not trust duplicate, unknown group or unbound production context', () => {
    for (const review of [
      plan(['same', 'same']),
      plan(undefined, {
        ...producer,
        complete: false,
        diagnostics: ['unattested inherited context'],
      }),
      titlePlan('', [], producer),
    ]) {
      expect(review.complete).toBe(false);
      expect(() => applyTitleAnswer(review, answer(review), new Date())).toThrow(
        'INCOMPLETE_TITLE_SCOPE',
      );
    }
  });
  it('ignores runtime outputs without hiding semantic inputs under .oc3', () => {
    for (const file of [
      '.oc3/reports/expect/tasks/a.json',
      '.oc3/locks/lease.json',
      'node_modules/.vite-temp/config.mjs',
    ])
      expect(ignoredWatchPath(file)).toBe(true);
    for (const file of [
      '.oc3/goals/a.expect.ts',
      '.oc3/project.yml',
      '.oc3/verdicts/expect/a.json',
      '.oc3/data/behavior/a.yml',
      'node_modules/pkg/a.js',
    ])
      expect(ignoredWatchPath(file)).toBe(false);
  });
});
