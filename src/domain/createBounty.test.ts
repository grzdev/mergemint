import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRepositorySelection,
  validateIssueSelection,
  validateTerms,
  createBountyDraft,
  fundBountyDraft,
} from './createBounty';
import { LocalStorageBountyRepository } from '../storage/bountyRepository';
import { ai } from '../integrations/ai';
import type { Party } from './bounty';

const mockSponsor: Party = { handle: 'mergemint-labs', partyId: 'sponsor::demo-labs' };
const mockMaintainer: Party = { handle: 'alexmorgan', partyId: 'maintainer::demo-alex' };

test('cannot continue without selecting a repository', () => {
  assert.equal(validateRepositorySelection(null).valid, false);
  assert.equal(validateRepositorySelection('').valid, false);
  assert.equal(validateRepositorySelection('   ').valid, false);
  assert.equal(validateRepositorySelection('mergemint/core').valid, true);
});

test('cannot continue without selecting an issue', () => {
  assert.equal(validateIssueSelection(null).valid, false);
  assert.equal(validateIssueSelection(0).valid, false);
  assert.equal(validateIssueSelection(-1).valid, false);
  assert.equal(validateIssueSelection(204).valid, true);
});

test('cannot fund without a valid amount', () => {
  const criteria = ['Must pass tests'];

  // Empty or invalid strings
  assert.equal(validateTerms('', criteria, mockSponsor, mockMaintainer).valid, false);
  assert.equal(validateTerms('abc', criteria, mockSponsor, mockMaintainer).valid, false);
  assert.equal(validateTerms('0', criteria, mockSponsor, mockMaintainer).valid, false);
  assert.equal(validateTerms('-50', criteria, mockSponsor, mockMaintainer).valid, false);

  // Valid positive decimal strings
  assert.equal(validateTerms('500', criteria, mockSponsor, mockMaintainer).valid, true);
  assert.equal(validateTerms('250.50', criteria, mockSponsor, mockMaintainer).valid, true);
});

test('cannot fund without acceptance criteria', () => {
  assert.equal(validateTerms('500', [], mockSponsor, mockMaintainer).valid, false);
  assert.equal(validateTerms('500', ['', '   '], mockSponsor, mockMaintainer).valid, false);
  assert.equal(validateTerms('500', ['Criterion 1'], mockSponsor, mockMaintainer).valid, true);
});

test('successful funding transitions DRAFT → FUNDED', () => {
  const draft = createBountyDraft({
    repo: 'mergemint/core',
    issue: 204,
    title: 'Validate query option shape',
    amount: '500',
    criteria: [
      'Reject null and array query values',
      'Add regression tests for invalid inputs',
      'Preserve existing valid query behavior',
    ],
    sponsor: mockSponsor,
    maintainer: mockMaintainer,
  });

  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.fundingRef, undefined);

  const funded = fundBountyDraft(draft, 'mock-canton-lock-204-test');
  assert.equal(funded.status, 'FUNDED');
  assert.equal(funded.fundingRef, 'mock-canton-lock-204-test');
  assert.equal(funded.amount, '500');
  assert.equal(funded.asset, 'MMT');
});

test('failed funding keeps the bounty in DRAFT', () => {
  const draft = createBountyDraft({
    repo: 'mergemint/core',
    issue: 204,
    title: 'Validate query option shape',
    amount: '500',
    criteria: ['Reject null and array query values'],
    sponsor: mockSponsor,
    maintainer: mockMaintainer,
  });

  // Attempting to fund with empty reference fails and leaves draft unchanged
  assert.throws(() => fundBountyDraft(draft, ''));
  assert.throws(() => fundBountyDraft(draft, '   '));
  assert.equal(draft.status, 'DRAFT');
});

test('AI-generated criteria remain editable', async () => {
  // 1. Suggest criteria with AI
  const generated = await ai.criteria('Validate query option shape', 'runtime query validation');
  assert.ok(generated.length >= 3);
  assert.equal(generated[0], 'Reject null and array query values');

  // 2. Maintainer edits, adds, and removes criteria
  const edited = [...generated];
  edited[0] = 'Reject null, array, and symbol query values (maintainer custom edit)';
  edited.push('Ensure backward compatibility with v1.x query configs');
  edited.splice(1, 1); // remove index 1

  assert.equal(edited.length, 3);
  assert.ok(edited[0].includes('maintainer custom edit'));

  // 3. Draft accepts the edited criteria
  const draft = createBountyDraft({
    repo: 'mergemint/core',
    issue: 204,
    title: 'Validate query option shape',
    amount: '500',
    criteria: edited,
    sponsor: mockSponsor,
    maintainer: mockMaintainer,
  });

  assert.deepEqual(draft.criteria, edited);
});

test('sponsor and maintainer remain separate', () => {
  const customSponsor: Party = { handle: 'acme-corp', partyId: 'sponsor::acme-999' };
  const customMaintainer: Party = { handle: 'lead-dev', partyId: 'maintainer::lead-111' };

  const draft = createBountyDraft({
    repo: 'mergemint/core',
    issue: 204,
    title: 'Validate query option shape',
    amount: '500',
    criteria: ['Pass tests'],
    sponsor: customSponsor,
    maintainer: customMaintainer,
  });

  assert.notEqual(draft.sponsor.partyId, draft.maintainer.partyId);
  assert.equal(draft.sponsor.handle, 'acme-corp');
  assert.equal(draft.sponsor.partyId, 'sponsor::acme-999');
  assert.equal(draft.maintainer.handle, 'lead-dev');
  assert.equal(draft.maintainer.partyId, 'maintainer::lead-111');
});

test('newly funded bounty appears in persisted storage', async () => {
  const repo = new LocalStorageBountyRepository();

  const initialCount = (await repo.getAll()).length;

  const draft = createBountyDraft({
    repo: 'mergemint/core',
    issue: 230,
    title: 'Add batch verification endpoint to CLI',
    amount: '400',
    criteria: ['Implement batch command', 'Add regression tests'],
    sponsor: mockSponsor,
    maintainer: mockMaintainer,
  });

  const funded = fundBountyDraft(draft, 'mock-canton-lock-230-persist');
  await repo.save(funded);

  const updatedBounties = await repo.getAll();
  assert.equal(updatedBounties.length, initialCount + 1);

  const retrieved = await repo.getById(funded.id);
  assert.ok(retrieved);
  assert.equal(retrieved.status, 'FUNDED');
  assert.equal(retrieved.amount, '400');
  assert.equal(retrieved.issue, 230);
  assert.equal(retrieved.fundingRef, 'mock-canton-lock-230-persist');
});
