export type Status = 'DRAFT' | 'FUNDED' | 'CLAIMED' | 'SUBMITTED' | 'APPROVED' | 'SETTLED';
export type Party = { handle: string; partyId: string };
export type Check = { name: string; state: 'passed' | 'failed' | 'pending'; url?: string; conclusion?: string };
export type Submission = {
  number: number;
  title: string;
  branch: string;
  sha: string;
  merged: boolean;
  review: string;
  checks: Check[];
  author?: string;
  baseBranch?: string;
  headBranch?: string;
  url?: string;
  mergeState?: string;
};
export type VerificationReport = { sha: string; createdAt: string; criteria: { criterion: string; assessment: string; evidence: string; limitation: string }[] };
export type Bounty = {
  id: string; repo: string; issue: number; title: string; amount: string; asset: 'MMT' | 'CC';
  sponsor: Party; maintainer: Party; contributor?: Party; claimedAt?: string;
  criteria: string[]; status: Status; activity: string; fundingRef?: string;
  tokenHoldingContractId?: string;
  submission?: Submission; report?: VerificationReport;
  approval?: { sha: string; maintainerId: string; approvedAt: string };
  settlement?: {
    state: 'failed' | 'confirmed';
    recipient: string;
    amount: string;
    reference?: string;
    timestamp: string;
    tokenRecipientHoldingId?: string;
    tokenTransferTxId?: string;
  };
};
export type Event =
  | { type: 'FUND'; reference: string; tokenHoldingContractId?: string }
  | { type: 'CLAIM'; contributor: Party }
  | { type: 'SUBMIT'; submission: Submission }
  | { type: 'APPROVE'; actor: string; sha: string }
  | { type: 'SETTLE'; reference: string; tokenRecipientHoldingId?: string; tokenTransferTxId?: string };
export function transition(bounty: Bounty, event: Event): Bounty {
  const now = new Date().toISOString();
  switch (event.type) {
    case 'FUND':
      if (bounty.status === 'DRAFT' && event.reference && /^\d+(\.\d+)?$/.test(bounty.amount) && Number(bounty.amount) > 0 && bounty.criteria.length) {
        return {
          ...bounty,
          status: 'FUNDED',
          fundingRef: event.reference,
          tokenHoldingContractId: event.tokenHoldingContractId,
        };
      }
      break;
    case 'CLAIM':
      if (bounty.status === 'FUNDED' && event.contributor.partyId) return { ...bounty, status: 'CLAIMED', contributor: event.contributor, claimedAt: now };
      break;
    case 'SUBMIT':
      if (['CLAIMED', 'SUBMITTED', 'APPROVED'].includes(bounty.status) && event.submission.sha) return { ...bounty, status: 'SUBMITTED', submission: event.submission, report: undefined, approval: undefined };
      break;
    case 'APPROVE':
      if (bounty.status === 'SUBMITTED' && bounty.contributor && event.actor === bounty.maintainer.partyId && event.sha === bounty.submission?.sha) return { ...bounty, status: 'APPROVED', approval: { sha: event.sha, maintainerId: event.actor, approvedAt: now } };
      break;
    case 'SETTLE':
      if (bounty.status === 'APPROVED' && bounty.contributor && bounty.approval?.sha === bounty.submission?.sha && event.reference) {
        return {
          ...bounty,
          status: 'SETTLED',
          settlement: {
            state: 'confirmed',
            recipient: bounty.contributor.partyId,
            amount: bounty.amount,
            reference: event.reference,
            timestamp: now,
            tokenRecipientHoldingId: event.tokenRecipientHoldingId,
            tokenTransferTxId: event.tokenTransferTxId,
          },
        };
      }
      break;
  }
  throw new Error(`Cannot ${event.type.toLowerCase()} this bounty in its current state.`);
}
