import crypto from 'node:crypto';
import type { Bounty, Party } from '@/domain/bounty';
import type { CantonContract, CantonTransactionResult } from '../types';
import { getCantonConfig } from './config';
import { CantonLedgerError, queryRawLedgerContracts, queryLedgerActiveContracts, submitLedgerCommand } from './client';

export function units(value: string): bigint {
  if (!/^(0|[1-9]\d{0,27})(\.\d{1,10})?$/.test(value)) throw new CantonLedgerError('Invalid decimal amount (maximum 10 fractional digits).');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(10 ** 10) + BigInt(fraction.padEnd(10, '0'));
}
export function decimal(value: bigint): string {
  const digits = value.toString().padStart(11, '0');
  return `${digits.slice(0, -10)}.${digits.slice(-10)}`.replace(/\.?0+$/, '');
}
export function template(name: string) {
  const id = getCantonConfig().packageId;
  if (!/^[a-f0-9]{64}$/.test(id)) throw new CantonLedgerError('Configure the freshly deployed CANTON_PACKAGE_ID.', 503);
  return `${id}:MergeMint.Token:${name}`;
}
export async function active(id: string): Promise<CantonContract> {
  const matches = (await queryLedgerActiveContracts()).filter(c => c.bountyId === id);
  if (matches.length !== 1) throw new CantonLedgerError('Bounty is missing or its identifier is ambiguous.', 409);
  return matches[0];
}
async function exercise(contract: CantonContract, choice: string, args: Record<string, unknown>, actors: string[]) {
  return submitLedgerCommand(actors, [contract.sponsor, contract.maintainer, ...(contract.contributor ? [contract.contributor] : [])], {
    ExerciseCommand: { templateId: template('MergeMintBounty'), contractId: contract.contractId, choice, choiceArgument: args },
  }, crypto.randomUUID(), `wf-${choice.toLowerCase()}-${contract.bountyId}`);
}
function result(c: CantonContract, tx: string): CantonTransactionResult {
  return { contractId: c.contractId, reference: tx, transactionId: tx, timestamp: c.settledReceipt?.settledAt || c.createdAt, status: c.status, tokenHoldingId: c.status === 'SETTLED' ? undefined : c.contractId, tokenRecipientHoldingId: c.settledReceipt?.tokenRecipientHoldingId, tokenTransferId: c.status === 'SETTLED' ? tx : undefined };
}
export async function fund(b: Bounty): Promise<CantonTransactionResult> {
  if (b.asset !== 'MMT' || units(b.amount) <= BigInt(0)) throw new CantonLedgerError('Positive MMT amount required.');
  if ((await queryLedgerActiveContracts()).some(c => c.bountyId === b.id)) throw new CantonLedgerError('Bounty ID already exists.', 409);
  const raw = await queryRawLedgerContracts();
  const source = raw.map(c => c.contractEntry?.JsActiveContract?.createdEvent).find(e => e?.templateId === template('MergeMintHolding') && e.createArgument.owner === b.sponsor.partyId && e.createArgument.instrument === 'MMT' && units(String(e.createArgument.amount)) >= units(b.amount));
  if (!source) throw new CantonLedgerError('Insufficient existing MMT holding. Funding does not mint tokens.', 409);
  const { updateId } = await submitLedgerCommand([b.sponsor.partyId, b.maintainer.partyId], [], {
    ExerciseCommand: { templateId: template('MergeMintHolding'), contractId: source.contractId, choice: 'FundBounty', choiceArgument: { bountyId: b.id, maintainer: b.maintainer.partyId, repository: b.repo, issueNumber: String(b.issue), issueUrl: `https://github.com/${b.repo}/issues/${b.issue}`, reward: b.amount, acceptanceCriteria: b.criteria } },
  }, crypto.randomUUID(), `wf-fund-${b.id}`);
  const created = await active(b.id);
  if (created.status !== 'FUNDED' || units(created.amount) !== units(b.amount)) throw new CantonLedgerError('Funding confirmation could not be verified.', 502);
  return result(created, updateId);
}
export async function claim(id: string, contributor: Party) {
  const c = await active(id);
  if (c.status !== 'FUNDED') throw new CantonLedgerError('Bounty is not available to claim.', 409);
  const { updateId } = await exercise(c, 'Claim', { contributorParty: contributor.partyId }, [contributor.partyId]);
  return result(await active(id), updateId);
}
export async function revision(id: string, sha: string, pr: number) {
  const c = await active(id);
  if (!Number.isSafeInteger(pr) || pr < 1 || !/^[a-f0-9]{40}$/.test(sha)) throw new CantonLedgerError('Valid GitHub SHA and PR required.');
  const { updateId } = await exercise(c, 'SubmitRevision', { sha, pullRequest: String(pr) }, [c.maintainer]);
  return result(await active(id), updateId);
}
export async function approve(b: Bounty, sha: string, maintainer: Party) {
  let c = await active(b.id);
  if (maintainer.partyId !== c.maintainer) throw new CantonLedgerError('Wrong maintainer.', 403);
  if (!b.submission || b.submission.sha !== sha) throw new CantonLedgerError('Review this revision before approval.', 409);
  if (c.submissionSha !== sha || !c.prNumber) { await revision(b.id, sha, b.submission.number); c = await active(b.id); }
  const { updateId } = await exercise(c, 'Approve', { approvingMaintainer: c.maintainer, sha }, [c.maintainer]);
  return result(await active(b.id), updateId);
}
export async function settle(b: Bounty, simulateFailure = false) {
  if (simulateFailure) throw new CantonLedgerError('Simulated transient failure; approval remains valid.', 503);
  const c = await active(b.id);
  if (c.status !== 'APPROVED' || !c.contributor || !c.submissionSha || c.submissionSha !== b.approval?.sha) throw new CantonLedgerError('An approval for this exact revision is required.', 409);
  const { updateId } = await exercise(c, 'Settle', { settler: c.maintainer, sha: c.submissionSha, settlementRef: crypto.randomUUID() }, [c.maintainer]);
  const receipt = await active(b.id);
  const recipientId = receipt.settledReceipt?.tokenRecipientHoldingId;
  if (receipt.status !== 'SETTLED' || !recipientId) throw new CantonLedgerError('Settlement receipt is not confirmed.', 502);
  const holding = (await queryRawLedgerContracts()).map(x => x.contractEntry?.JsActiveContract?.createdEvent).find(e => e?.contractId === recipientId);
  if (!holding || holding.templateId !== template('MergeMintHolding') || holding.createArgument.owner !== c.contributor || holding.createArgument.instrument !== c.asset || units(String(holding.createArgument.amount)) !== units(c.amount)) throw new CantonLedgerError('Recipient holding confirmation failed.', 502);
  return result(receipt, updateId);
}
