import type { Bounty, Party } from './bounty';
import { transition } from './bounty';

export interface CreateBountyDraftInput {
  repo: string;
  issue: number;
  title: string;
  amount: string;
  criteria: string[];
  sponsor: Party;
  maintainer: Party;
}

export function validateRepositorySelection(repo: string | null | undefined): { valid: boolean; error?: string } {
  if (!repo || !repo.trim()) {
    return { valid: false, error: 'A repository must be selected to continue.' };
  }
  return { valid: true };
}

export function validateIssueSelection(issueNumber: number | null | undefined): { valid: boolean; error?: string } {
  if (!issueNumber || issueNumber <= 0) {
    return { valid: false, error: 'An open issue must be selected to continue.' };
  }
  return { valid: true };
}

export function validateTerms(
  amount: string,
  criteria: string[],
  sponsor: Party,
  maintainer: Party
): { valid: boolean; errors: { amount?: string; criteria?: string; sponsor?: string; maintainer?: string } } {
  const errors: { amount?: string; criteria?: string; sponsor?: string; maintainer?: string } = {};

  const cleanAmount = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(cleanAmount) || Number(cleanAmount) <= 0) {
    errors.amount = 'Bounty amount must be a positive number greater than zero.';
  }

  const validCriteria = criteria.map(c => c.trim()).filter(c => c.length > 0);
  if (validCriteria.length === 0) {
    errors.criteria = 'At least one acceptance criterion is required before funding.';
  }

  if (!sponsor || !sponsor.handle.trim() || !sponsor.partyId.trim()) {
    errors.sponsor = 'Sponsor party must be defined.';
  }

  if (!maintainer || !maintainer.handle.trim() || !maintainer.partyId.trim()) {
    errors.maintainer = 'Maintainer party must be defined.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function createBountyDraft(input: CreateBountyDraftInput): Bounty {
  const repoValid = validateRepositorySelection(input.repo);
  if (!repoValid.valid) throw new Error(repoValid.error);

  const issueValid = validateIssueSelection(input.issue);
  if (!issueValid.valid) throw new Error(issueValid.error);

  const termsValid = validateTerms(input.amount, input.criteria, input.sponsor, input.maintainer);
  if (!termsValid.valid) {
    const firstError = Object.values(termsValid.errors)[0];
    throw new Error(firstError);
  }

  return {
    id: `${input.issue}-${Date.now().toString().slice(-4)}`,
    repo: input.repo,
    issue: input.issue,
    title: input.title,
    amount: input.amount.trim(),
    asset: 'MMT',
    sponsor: { ...input.sponsor },
    maintainer: { ...input.maintainer },
    criteria: input.criteria.map(c => c.trim()).filter(c => c.length > 0),
    status: 'DRAFT',
    activity: 'Draft created just now',
  };
}

export function fundBountyDraft(draft: Bounty, fundingReference: string, tokenHoldingContractId?: string): Bounty {
  if (draft.status !== 'DRAFT') {
    throw new Error(`Cannot fund bounty from status ${draft.status}. Expected DRAFT.`);
  }
  if (!fundingReference || !fundingReference.trim()) {
    throw new Error('Canton funding reference is required to fund bounty.');
  }

  return transition(draft, { type: 'FUND', reference: fundingReference, tokenHoldingContractId });
}
