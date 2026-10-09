import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateHash, formatTimeAgo, sumTokenAmounts } from './formatters';
import { transition, type Bounty } from '../domain/bounty';

test('truncateHash formats long cryptographic hashes predictably', () => {
  const contractId = '0073e22b44800f605e5ba8ccc5a48631385fa9385f8b015cf61993fe9f2d229d9cca1212201274cf7a28b27190d2905380a7681ca785bb3d45a3f24c1769f93cf7fdf5dbf6';
  const truncated = truncateHash(contractId, 10, 8);
  assert.equal(truncated, '0073e22b44...fdf5dbf6');
  assert.ok(truncated.length < contractId.length);

  // Short strings remain intact
  assert.equal(truncateHash('short'), 'short');
  assert.equal(truncateHash(''), '');
});

test('formatTimeAgo returns friendly relative time descriptions', () => {
  const now = new Date().toISOString();
  assert.equal(formatTimeAgo(now), 'just now');

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal(formatTimeAgo(tenMinAgo), '10m ago');

  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  assert.equal(formatTimeAgo(twoHoursAgo), '2h ago');
});

test('Exact revision commit SHA is strictly bound during maintainer approval transition', () => {
  const bounty: Bounty = {
    id: 'bounty-1',
    repo: 'owner/repo',
    issue: 101,
    title: 'Test issue',
    amount: '500',
    asset: 'CC',
    status: 'SUBMITTED',
    sponsor: { handle: 'sponsor-user', partyId: 'sponsor::123' },
    maintainer: { handle: 'maintainer-user', partyId: 'maintainer::456' },
    contributor: { handle: 'contributor-user', partyId: 'contributor::789' },
    criteria: ['Criterion 1'],
    submission: {
      number: 12,
      title: 'Fix issue',
      branch: 'fix',
      sha: 'abcdef1234567890abcdef1234567890abcdef12',
      merged: false,
      checks: [{ name: 'test', state: 'passed' }],
      review: 'Pending',
    },
    activity: 'Submitted',
  };

  // Approval requires exact SHA
  const approved = transition(bounty, {
    type: 'APPROVE',
    actor: 'maintainer::456',
    sha: 'abcdef1234567890abcdef1234567890abcdef12',
  });

  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.approval?.sha, 'abcdef1234567890abcdef1234567890abcdef12');

  // Mismatched SHA fails
  assert.throws(() => {
    transition(bounty, {
      type: 'APPROVE',
      actor: 'maintainer::456',
      sha: 'different-sha',
    });
  });
});

test('Replacing or updating PR commit SHA invalidates prior approval and returns to SUBMITTED', () => {
  const approvedBounty: Bounty = {
    id: 'bounty-1',
    repo: 'owner/repo',
    issue: 101,
    title: 'Test issue',
    amount: '500',
    asset: 'CC',
    status: 'APPROVED',
    sponsor: { handle: 'sponsor-user', partyId: 'sponsor::123' },
    maintainer: { handle: 'maintainer-user', partyId: 'maintainer::456' },
    contributor: { handle: 'contributor-user', partyId: 'contributor::789' },
    criteria: ['Criterion 1'],
    submission: {
      number: 12,
      title: 'Fix issue',
      branch: 'fix',
      sha: 'sha-version-1',
      merged: false,
      checks: [{ name: 'test', state: 'passed' }],
      review: 'Pending',
    },
    approval: {
      maintainerId: 'maintainer::456',
      sha: 'sha-version-1',
      approvedAt: new Date().toISOString(),
    },
    activity: 'Approved',
  };

  const updatedPr = {
    ...approvedBounty.submission!,
    sha: 'sha-version-2',
  };

  const resetBounty = transition(approvedBounty, {
    type: 'SUBMIT',
    submission: updatedPr,
  });

  assert.equal(resetBounty.status, 'SUBMITTED');
  assert.equal(resetBounty.approval, undefined);
  assert.equal(resetBounty.submission?.sha, 'sha-version-2');
});

test('dashboard totals preserve fractional ledger values without BigInt conversion errors', () => {
  assert.equal(sumTokenAmounts(Array(6).fill('12.3456789012')), '74.0740734072');
  assert.equal(sumTokenAmounts(['0.9999999999', '0.0000000001']), '1');
  assert.equal(sumTokenAmounts(['9007199254740993', '0.0000000001']), '9007199254740993.0000000001');
  assert.equal(sumTokenAmounts([]), '0');
  assert.equal(sumTokenAmounts(['invalid']), 'Unavailable');
});
