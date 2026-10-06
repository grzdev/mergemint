import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transition } from './bounty';
import { seeds } from '../mocks/seed';
test('approval requires the maintainer and the current revision', () => {
  const b = seeds[0];
  assert.throws(() => transition(b, { type: 'APPROVE', actor: 'stranger', sha: b.submission!.sha }));
  assert.throws(() => transition(b, { type: 'APPROVE', actor: b.maintainer.partyId, sha: 'stale' }));
  const approved = transition(b, { type: 'APPROVE', actor: b.maintainer.partyId, sha: b.submission!.sha });
  assert.equal(approved.status, 'APPROVED');
  assert.throws(() => transition(approved, { type: 'SETTLE', reference: '' }));
  assert.equal(transition(approved, { type: 'SETTLE', reference: 'mock-confirmed' }).status, 'SETTLED');
});
test('unapproved and changed revisions cannot settle', () => {
  const b = seeds[0];
  assert.throws(() => transition(b, { type: 'SETTLE', reference: 'tx' }));
  const approved = transition(b, { type: 'APPROVE', actor: b.maintainer.partyId, sha: b.submission!.sha });
  assert.throws(() => transition({ ...approved, submission: { ...approved.submission!, sha: 'new' } }, { type: 'SETTLE', reference: 'tx' }));
});
test('funding needs a confirmation and claiming needs confirmed funding', () => {
  const draft = seeds[3];
  assert.throws(() => transition(draft, { type: 'FUND', reference: '' }));
  assert.throws(() => transition(draft, { type: 'CLAIM', contributor: seeds[0].contributor! }));
  const funded = transition(draft, { type: 'FUND', reference: 'confirmed-lock' });
  assert.equal(funded.status, 'FUNDED');
  const claimed = transition(funded, { type: 'CLAIM', contributor: seeds[0].contributor! });
  assert.equal(claimed.status, 'CLAIMED');
  assert.throws(() => transition(claimed, { type: 'CLAIM', contributor: seeds[0].contributor! }));
});
test('a replacement submission invalidates previous evidence', () => {
  const submitted = { ...seeds[0], report: { sha: seeds[0].submission!.sha, createdAt: '', criteria: [] } };
  const next = transition(submitted, { type: 'SUBMIT', submission: { ...submitted.submission!, sha: 'new-revision' } });
  assert.equal(next.report, undefined);
  assert.equal(next.approval, undefined);
  assert.equal(next.status, 'SUBMITTED');
});
