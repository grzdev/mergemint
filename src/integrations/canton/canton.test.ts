import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CantonLedgerError,
  fundBountyOnLedger,
  claimBountyOnLedger,
  approveBountyOnLedger,
  settleBountyOnLedger,
  getActiveLedgerBounties,
  getCantonStatus,
} from './server/client';
import { getCantonConfig } from './server/config';
import { mockCanton } from './mock';
import { realCanton } from './real';
import { canton } from './index';
import { transition } from '@/domain/bounty';
import type { Bounty, Party, Submission } from '@/domain/bounty';

const mockSponsor: Party = {
  handle: 'mergemint-labs',
  partyId: 'mergemint-sponsor::12204a91b2c3d4e5',
};

const mockMaintainer: Party = {
  handle: 'alexmorgan',
  partyId: 'alexmorgan::12204a91b2c3d4e5',
};

const mockContributor: Party = {
  handle: 'juleschen',
  partyId: 'juleschen::12204a91b2c3d4e5',
};

function createTestBounty(id = 'bounty-test-101'): Bounty {
  return {
    id,
    repo: 'mergemint/core',
    issue: 204,
    title: 'Validate query option shape',
    amount: '500',
    asset: 'MMT',
    sponsor: mockSponsor,
    maintainer: mockMaintainer,
    criteria: [
      'Reject null and array query values',
      'Add regression tests for invalid inputs',
    ],
    status: 'DRAFT',
    activity: 'Created draft',
  };
}

// 1. Canton Configuration & Status
test('Canton configuration parses defaults and environment variables', () => {
  const cfg = getCantonConfig();
  assert.ok(cfg.network);
  assert.ok(cfg.packageId);
  assert.ok(cfg.ledgerApiUrl);
  assert.ok(cfg.parties.sponsor.partyId);
  assert.ok(cfg.parties.maintainer.partyId);
  assert.ok(cfg.parties.contributor.partyId);
});

test('Mock Canton returns mock status with internal endpoint', async () => {
  const status = await mockCanton.getStatus();
  assert.equal(status.mode, 'mock');
  assert.equal(status.connected, true);
  assert.equal(status.network, 'Canton · Demo');
  assert.equal(status.ledgerApiUrl, 'internal://mock');
});

// 2. Mock mode funding and settlement preserves legacy contracts
test('Mock Canton produces mock-lock and mock-tx identifiers', async () => {
  const bounty = createTestBounty();
  const lockRef = await mockCanton.fund(bounty);
  assert.ok(lockRef.startsWith(`mock-lock-${bounty.id}-`));

  const fundedBounty = transition(bounty, { type: 'FUND', reference: lockRef });
  const claimedBounty = transition(fundedBounty, { type: 'CLAIM', contributor: mockContributor });
  const submission: Submission = {
    number: 218,
    title: 'Fix query validation',
    branch: 'feature/query-validation',
    sha: 'c7e091b48d21',
    merged: false,
    review: 'Approved',
    checks: [{ name: 'unit-tests', state: 'passed' }],
  };
  const submittedBounty = transition(claimedBounty, { type: 'SUBMIT', submission });
  const approvedBounty = transition(submittedBounty, {
    type: 'APPROVE',
    actor: mockMaintainer.partyId,
    sha: 'c7e091b48d21',
  });

  const txRef = await mockCanton.settle(approvedBounty);
  assert.ok(txRef.startsWith(`mock-tx-${bounty.id}-`));
});

test('Mock Canton settle enforces exact revision match', async () => {
  const bounty = createTestBounty();
  const submission: Submission = {
    number: 218,
    title: 'Fix query validation',
    branch: 'feature/query-validation',
    sha: 'c7e091b48d21',
    merged: false,
    review: 'Approved',
    checks: [{ name: 'unit-tests', state: 'passed' }],
  };
  const approvedBounty: Bounty = {
    ...bounty,
    status: 'APPROVED',
    contributor: mockContributor,
    submission,
    approval: {
      sha: 'different-sha-1234',
      maintainerId: mockMaintainer.partyId,
      approvedAt: new Date().toISOString(),
    },
  };

  await assert.rejects(
    () => mockCanton.settle(approvedBounty),
    /Approval does not match the current revision/
  );
});

// 3. Simulated Canton LocalNet ledger execution
test('fundBountyOnLedger creates cryptographic contract ID adhering to Canton format', async () => {
  // Ensure simulated mode for offline unit test
  process.env.CANTON_INTEGRATION_MODE = 'simulated';
  const bounty = createTestBounty('bounty-real-e2e-1');
  const result = await fundBountyOnLedger(bounty);

  assert.ok(result.contractId.startsWith('c:001220'));
  assert.ok(result.transactionId.startsWith('tx_canton_'));
  assert.equal(result.status, 'FUNDED');

  const activeBounties = await getActiveLedgerBounties();
  const found = activeBounties.find(b => b.bountyId === bounty.id);
  assert.ok(found);
  assert.equal(found.contractId, result.contractId);
  assert.equal(found.status, 'FUNDED');
  assert.equal(found.amount, '500');
  assert.equal(found.asset, 'MMT');
  assert.equal(found.maintainer, mockMaintainer.partyId);
});

test('claimBountyOnLedger archives FUNDED contract and transitions to CLAIMED', async () => {
  const bounty = createTestBounty('bounty-real-claim-1');
  const fundRes = await fundBountyOnLedger(bounty);

  const claimRes = await claimBountyOnLedger(bounty.id, mockContributor);
  assert.ok(claimRes.contractId.startsWith('c:001220'));
  // Canton consuming choice archives old contract ID and issues a new contract ID
  assert.notEqual(claimRes.contractId, fundRes.contractId);
  assert.equal(claimRes.status, 'CLAIMED');

  const active = await getActiveLedgerBounties();
  const contract = active.find(b => b.bountyId === bounty.id);
  assert.ok(contract);
  assert.equal(contract.contractId, claimRes.contractId);
  assert.equal(contract.status, 'CLAIMED');
  assert.equal(contract.contributor, mockContributor.partyId);
});

test('claimBountyOnLedger prevents double claiming by another contributor', async () => {
  const bounty = createTestBounty('bounty-real-claim-2');
  await fundBountyOnLedger(bounty);
  await claimBountyOnLedger(bounty.id, mockContributor);

  const anotherContributor: Party = {
    handle: 'other-user',
    partyId: 'other-user::12209999',
  };

  await assert.rejects(
    () => claimBountyOnLedger(bounty.id, anotherContributor),
    /Cannot claim bounty in state "CLAIMED"/
  );
});

test('approveBountyOnLedger records maintainer approval for exact commit SHA', async () => {
  const bounty = createTestBounty('bounty-real-approve-1');
  await fundBountyOnLedger(bounty);
  await claimBountyOnLedger(bounty.id, mockContributor);

  const commitSha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';
  const bountyWithContributor: Bounty = {
    ...bounty,
    contributor: mockContributor,
  };

  const approveRes = await approveBountyOnLedger(bountyWithContributor, commitSha, mockMaintainer);
  assert.ok(approveRes.contractId.startsWith('c:001220'));
  assert.equal(approveRes.status, 'APPROVED');

  const active = await getActiveLedgerBounties();
  const contract = active.find(b => b.bountyId === bounty.id);
  assert.ok(contract);
  assert.equal(contract.status, 'APPROVED');
  assert.equal(contract.submissionSha, commitSha);
});

test('approveBountyOnLedger rejects unauthorized approver', async () => {
  const bounty = createTestBounty('bounty-real-unauth-1');
  await fundBountyOnLedger(bounty);
  await claimBountyOnLedger(bounty.id, mockContributor);

  const impostor: Party = {
    handle: 'impostor',
    partyId: 'impostor::99999999',
  };

  await assert.rejects(
    () => approveBountyOnLedger({ ...bounty, contributor: mockContributor }, 'abc1234', impostor),
    /Unauthorized: only designated maintainer/
  );
});

test('settleBountyOnLedger consumes contract, creates SettledReceipt and prevents double settlement', async () => {
  const bounty = createTestBounty('bounty-real-settle-1');
  await fundBountyOnLedger(bounty);
  await claimBountyOnLedger(bounty.id, mockContributor);

  const sha = 'fa4891b2c3d4e5f6';
  const bountyWithContributor: Bounty = {
    ...bounty,
    contributor: mockContributor,
  };
  await approveBountyOnLedger(bountyWithContributor, sha, mockMaintainer);

  const approvedBounty: Bounty = {
    ...bountyWithContributor,
    status: 'APPROVED',
    approval: {
      sha,
      maintainerId: mockMaintainer.partyId,
      approvedAt: new Date().toISOString(),
    },
  };

  const settleRes = await settleBountyOnLedger(approvedBounty);
  assert.ok(settleRes.reference.startsWith('canton_tx_'));
  assert.ok(settleRes.contractId.startsWith('c:001220')); // SettledReceipt contract ID
  assert.equal(settleRes.status, 'SETTLED');

  // Consuming choice: Active bounties should no longer contain this contract
  const active = await getActiveLedgerBounties();
  const stillActive = active.find(b => b.bountyId === bounty.id);
  assert.equal(stillActive, undefined);

  // Attempting to settle again must fail (prevent double spend / double settlement)
  await assert.rejects(
    () => settleBountyOnLedger(approvedBounty),
    /Cannot settle bounty in state "SETTLED"/
  );
});

test('settleBountyOnLedger handles simulated transient failure without archiving approval', async () => {
  const bounty = createTestBounty('bounty-real-retry-1');
  await fundBountyOnLedger(bounty);
  await claimBountyOnLedger(bounty.id, mockContributor);
  await approveBountyOnLedger({ ...bounty, contributor: mockContributor }, 'sha123', mockMaintainer);

  const approvedBounty: Bounty = {
    ...bounty,
    status: 'APPROVED',
    contributor: mockContributor,
    approval: {
      sha: 'sha123',
      maintainerId: mockMaintainer.partyId,
      approvedAt: new Date().toISOString(),
    },
  };

  // Simulate network glitch during settlement
  await assert.rejects(
    () => settleBountyOnLedger(approvedBounty, true),
    /Simulated Canton connection failure. Your approval is still valid./
  );

  // Contract remains in APPROVED status on ledger
  const active = await getActiveLedgerBounties();
  const contract = active.find(b => b.bountyId === bounty.id);
  assert.ok(contract);
  assert.equal(contract.status, 'APPROVED');

  // Retry succeeds
  const retryRes = await settleBountyOnLedger(approvedBounty, false);
  assert.equal(retryRes.status, 'SETTLED');
  assert.ok(retryRes.reference.startsWith('canton_tx_'));
});

// 4. End-to-End Lifecycle through Canton Integration Delegator
test('Full End-to-End bounty lifecycle through delegating Canton integration', async () => {
  const bounty = createTestBounty('bounty-full-e2e');

  // 1. Create and Fund on Canton
  const lockRef = await canton.fund(bounty);
  assert.ok(lockRef.startsWith('c:001220'));
  let state = transition(bounty, { type: 'FUND', reference: lockRef });
  assert.equal(state.status, 'FUNDED');
  assert.equal(state.fundingRef, lockRef);

  // 2. Contributor claims on Canton
  const claimResult = await canton.claim(state.id, mockContributor);
  assert.ok(claimResult.contractId.startsWith('c:001220'));
  state = transition(state, { type: 'CLAIM', contributor: mockContributor });
  assert.equal(state.status, 'CLAIMED');
  assert.equal(state.contributor?.handle, mockContributor.handle);

  // 3. Contributor links real GitHub PR
  const submission: Submission = {
    number: 218,
    title: 'Validate query options with comprehensive error feedback',
    branch: 'feature/validate-query',
    sha: '9f83c18b14a2',
    merged: false,
    review: 'Ready for review',
    checks: [
      { name: 'unit-tests', state: 'passed' },
      { name: 'lint', state: 'passed' },
      { name: 'typecheck', state: 'passed' },
    ],
    url: 'https://github.com/mergemint/core/pull/218',
  };
  state = transition(state, { type: 'SUBMIT', submission });
  assert.equal(state.status, 'SUBMITTED');

  // 4. Maintainer approves exact PR revision on Canton
  const approveResult = await canton.approve(state, submission.sha, mockMaintainer);
  assert.ok(approveResult.contractId.startsWith('c:001220'));
  state = transition(state, {
    type: 'APPROVE',
    actor: mockMaintainer.partyId,
    sha: submission.sha,
  });
  assert.equal(state.status, 'APPROVED');
  assert.equal(state.approval?.sha, submission.sha);

  // 5. Settle on Canton
  const settlementRef = await canton.settle(state);
  assert.ok(settlementRef.startsWith('canton_tx_'));
  state = transition(state, { type: 'SETTLE', reference: settlementRef });
  assert.equal(state.status, 'SETTLED');
  assert.equal(state.settlement?.state, 'confirmed');
  assert.equal(state.settlement?.reference, settlementRef);
  assert.equal(state.settlement?.recipient, mockContributor.partyId);
});

// 5. Level C: CIP-56 Fungible Token Holding Integration
test('Level C: CIP-56 Holding-compatible token transfers atomically on settlement', async () => {
  process.env.CANTON_INTEGRATION_MODE = 'simulated';
  const bounty = createTestBounty('bounty-level-c-sim');

  // 1. Initial status reports balances and tokenPackageId
  const initialStatus = await getCantonStatus();
  assert.ok(initialStatus.tokenPackageId);
  assert.ok(initialStatus.balances);

  // 2. Funding creates on-ledger locked token holding
  const fundRes = await fundBountyOnLedger(bounty);
  assert.ok(fundRes.tokenHoldingId, 'fundBountyOnLedger must produce a tokenHoldingId');

  // Verify escrow balance increased by bounty amount
  const afterFundStatus = await getCantonStatus();
  assert.ok(Number(afterFundStatus.balances?.escrow) >= 500);

  // 3. Contributor claims and maintainer approves
  await claimBountyOnLedger(bounty.id, mockContributor);
  const sha = 'aabb00112233';
  await approveBountyOnLedger({ ...bounty, contributor: mockContributor }, sha, mockMaintainer);

  // 4. Settle executes atomic choice transferring token holding to contributor
  const approvedBounty: Bounty = {
    ...bounty,
    contributor: mockContributor,
    status: 'APPROVED',
    fundingRef: fundRes.contractId,
    tokenHoldingContractId: fundRes.tokenHoldingId,
    approval: {
      sha,
      maintainerId: mockMaintainer.partyId,
      approvedAt: new Date().toISOString(),
    },
  };

  const settleRes = await settleBountyOnLedger(approvedBounty);
  assert.equal(settleRes.status, 'SETTLED');
  assert.ok(settleRes.tokenHoldingId, 'Must reference original token holding');
  assert.ok(settleRes.tokenTransferId, 'Must provide token transfer transaction ID');

  // 5. Contributor on-ledger balance receives the 500 MMT
  const finalStatus = await getCantonStatus();
  assert.ok(Number(finalStatus.balances?.contributor) >= 500);

  // Verify SettledReceipt and token recipient holding audit trail
  assert.ok(settleRes.tokenRecipientHoldingId, 'Must track contributor recipient holding ID');
});
