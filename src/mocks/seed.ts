import type { Bounty, Party } from '@/domain/bounty';
export const maintainer: Party = { handle: 'alexmorgan', partyId: 'maintainer::demo-alex' };
export const repositories = ['mergemint/core', 'mergemint/sdk', 'mergemint/docs'];
const base = { repo: repositories[0], asset: 'CC' as const, sponsor: { handle: 'mergemint-labs', partyId: 'sponsor::demo-labs' }, maintainer, criteria: ['Reject null and array query values', 'Add regression tests for invalid inputs', 'Update the query options documentation'], fundingRef: 'mock-lock-204' };
export const seeds: Bounty[] = [
  { ...base, id: '204', issue: 204, title: 'Validate query option shape', amount: '500', status: 'SUBMITTED', activity: '12 minutes ago', contributor: { handle: 'samrivera', partyId: 'contributor::demo-sam' }, claimedAt: '2026-09-26T10:30:00Z', submission: { number: 218, title: 'fix: validate query options before execution', branch: 'fix/query-validation', sha: 'abc1234d5e6f789012345678901234567890abcd12', merged: false, review: 'Awaiting maintainer review', checks: [{ name: 'unit-tests', state: 'passed' }, { name: 'lint', state: 'passed' }, { name: 'typecheck', state: 'passed' }, { name: 'integration-tests', state: 'failed' }] } },
  { ...base, id: '198', issue: 198, title: 'Handle reconnects in the event stream', amount: '350', status: 'CLAIMED', activity: '1 hour ago', contributor: { handle: 'juleschen', partyId: 'contributor::demo-jules' }, claimedAt: '2026-09-27T11:00:00Z' },
  { ...base, id: '211', issue: 211, title: 'Add cursor pagination to the issue adapter', amount: '250', status: 'FUNDED', activity: '3 hours ago' },
  { ...base, id: '215', issue: 215, title: 'Document local development setup', amount: '150', status: 'DRAFT', fundingRef: undefined, activity: 'Yesterday' },
];
