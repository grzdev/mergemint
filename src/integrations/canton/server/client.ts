import crypto from 'node:crypto';
import { getCantonConfig } from './config';
import type { Bounty, Party } from '@/domain/bounty';
import type { CantonBalances, CantonContract, CantonStatus, CantonTransactionResult } from '../types';

export class CantonLedgerError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'CantonLedgerError';
  }
}

interface ActiveContractRecord {
  contractId: string;
  templateId: string;
  data: CantonContract;
  archived: boolean;
}

interface SimulatedHolding {
  contractId: string;
  admin: string;
  owner: string;
  amount: number;
  currency: string;
  bountyId?: string;
  isSettled: boolean;
  archived: boolean;
  lock?: {
    holders: string[];
    context: string;
  };
}

// In-process ledger state for simulated offline/mock execution
class CantonLocalNetLedger {
  private contracts = new Map<string, ActiveContractRecord>();
  private holdings = new Map<string, SimulatedHolding>();
  private transactionCounter = 100;
  private offset = 1;

  private generateContractId(): string {
    const hash = crypto.randomBytes(16).toString('hex');
    const idx = ++this.transactionCounter;
    return `c:001220${hash}#${idx}`;
  }

  private generateTxId(): string {
    return `tx_canton_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  createBounty(bounty: Bounty): { contractId: string; transactionId: string; record: CantonContract; tokenHoldingId: string } {
    const cfg = getCantonConfig();
    const contractId = this.generateContractId();
    const transactionId = this.generateTxId();
    const templateId = `${cfg.packageId}:MergeMint.Bounty:MergeMintBounty`;
    const tokenHoldingId = this.generateContractId();

    const amountNum = parseFloat(String(bounty.amount)) || 500;
    const asset = bounty.asset || 'MMT';
    const sponsorParty = bounty.sponsor.partyId || cfg.parties.sponsor.partyId;

    // Simulated CIP-56 escrow token holding
    this.holdings.set(tokenHoldingId, {
      contractId: tokenHoldingId,
      admin: sponsorParty,
      owner: sponsorParty,
      amount: amountNum,
      currency: asset,
      bountyId: bounty.id,
      isSettled: false,
      archived: false,
      lock: {
        holders: [sponsorParty],
        context: `Bounty ${bounty.id} Escrow`,
      },
    });

    const record: CantonContract = {
      contractId,
      templateId,
      bountyId: bounty.id,
      sponsor: bounty.sponsor.partyId || cfg.parties.sponsor.partyId,
      maintainer: bounty.maintainer.partyId || cfg.parties.maintainer.partyId,
      contributor: bounty.contributor?.partyId,
      repository: bounty.repo,
      issueNumber: bounty.issue,
      issueUrl: `https://github.com/${bounty.repo}/issues/${bounty.issue}`,
      amount: bounty.amount,
      asset,
      acceptanceCriteria: bounty.criteria || [],
      submissionSha: bounty.submission?.sha,
      status: 'FUNDED',
      createdAt: new Date().toISOString(),
      tokenHoldingContractId: tokenHoldingId,
    };

    this.contracts.set(contractId, {
      contractId,
      templateId,
      data: record,
      archived: false,
    });

    this.offset++;
    return { contractId, transactionId, record, tokenHoldingId };
  }

  claimBounty(contractId: string, contributorParty: string): { contractId: string; transactionId: string; record: CantonContract } {
    const entry = this.contracts.get(contractId);
    if (!entry || entry.archived) {
      throw new CantonLedgerError(`Active contract not found on Canton ledger: ${contractId}`, 404);
    }

    if (entry.data.status !== 'FUNDED') {
      throw new CantonLedgerError(`Cannot claim bounty in state "${entry.data.status}". Only FUNDED bounties can be claimed.`, 400);
    }
    if (entry.data.contributor) {
      throw new CantonLedgerError('Bounty has already been claimed by another contributor.', 409);
    }

    entry.archived = true;
    const nextContractId = this.generateContractId();
    const transactionId = this.generateTxId();

    const updated: CantonContract = {
      ...entry.data,
      contractId: nextContractId,
      contributor: contributorParty,
      status: 'CLAIMED',
    };

    this.contracts.set(nextContractId, {
      contractId: nextContractId,
      templateId: entry.templateId,
      data: updated,
      archived: false,
    });

    this.offset++;
    return { contractId: nextContractId, transactionId, record: updated };
  }

  submitRevision(contractId: string, contributorParty: string, sha: string): { contractId: string; transactionId: string; record: CantonContract } {
    const entry = this.contracts.get(contractId);
    if (!entry || entry.archived) {
      throw new CantonLedgerError(`Active contract not found on Canton ledger: ${contractId}`, 404);
    }

    if (entry.data.contributor !== contributorParty) {
      throw new CantonLedgerError(`Unauthorized: only assigned contributor ${entry.data.contributor} can submit work.`, 403);
    }

    entry.archived = true;
    const nextContractId = this.generateContractId();
    const transactionId = this.generateTxId();

    const updated: CantonContract = {
      ...entry.data,
      contractId: nextContractId,
      submissionSha: sha,
      status: 'CLAIMED',
    };

    this.contracts.set(nextContractId, {
      contractId: nextContractId,
      templateId: entry.templateId,
      data: updated,
      archived: false,
    });

    this.offset++;
    return { contractId: nextContractId, transactionId, record: updated };
  }

  approveBounty(contractId: string, maintainerParty: string, sha: string): { contractId: string; transactionId: string; record: CantonContract } {
    const entry = this.contracts.get(contractId);
    if (!entry || entry.archived) {
      throw new CantonLedgerError(`Active contract not found on Canton ledger: ${contractId}`, 404);
    }

    if (entry.data.maintainer !== maintainerParty) {
      throw new CantonLedgerError(`Unauthorized: only designated maintainer ${entry.data.maintainer} can approve.`, 403);
    }

    if (!entry.data.contributor) {
      throw new CantonLedgerError('Cannot approve an unclaimed bounty.', 400);
    }

    if (entry.data.submissionSha !== sha) {
      throw new CantonLedgerError(
        `Revision mismatch on ledger: Contract submission SHA is "${entry.data.submissionSha || 'none'}", but approval requested for "${sha}".`,
        400
      );
    }

    entry.archived = true;
    const nextContractId = this.generateContractId();
    const transactionId = this.generateTxId();

    const updated: CantonContract = {
      ...entry.data,
      contractId: nextContractId,
      status: 'APPROVED',
    };

    this.contracts.set(nextContractId, {
      contractId: nextContractId,
      templateId: entry.templateId,
      data: updated,
      archived: false,
    });

    this.offset++;
    return { contractId: nextContractId, transactionId, record: updated };
  }

  settleBounty(contractId: string, settlerParty: string, settlementRef: string): { receiptId: string; transactionId: string; record: CantonContract; tokenRecipientHoldingId?: string } {
    const entry = this.contracts.get(contractId);
    if (!entry || entry.archived) {
      throw new CantonLedgerError(`Active contract not found or already settled on Canton ledger: ${contractId}`, 404);
    }

    if (entry.data.maintainer !== settlerParty && entry.data.sponsor !== settlerParty) {
      throw new CantonLedgerError('Unauthorized: only maintainer or sponsor can settle this bounty.', 403);
    }

    if (entry.data.status !== 'APPROVED') {
      throw new CantonLedgerError(`Cannot settle bounty in state "${entry.data.status}". Bounty must be APPROVED before settlement.`, 400);
    }

    if (!entry.data.contributor) {
      throw new CantonLedgerError('Cannot settle bounty without an assigned contributor.', 400);
    }

    entry.archived = true;
    const receiptId = this.generateContractId();
    const transactionId = this.generateTxId();
    const settledAt = new Date().toISOString();

    // Settle / transfer CIP-56 token holding to contributor
    let tokenRecipientHoldingId: string | undefined;
    for (const holding of this.holdings.values()) {
      if (holding.bountyId === entry.data.bountyId && !holding.archived) {
        holding.archived = true;
        tokenRecipientHoldingId = this.generateContractId();
        this.holdings.set(tokenRecipientHoldingId, {
          contractId: tokenRecipientHoldingId,
          admin: holding.admin,
          owner: entry.data.contributor,
          amount: holding.amount,
          currency: holding.currency,
          bountyId: entry.data.bountyId,
          isSettled: true,
          archived: false,
          lock: undefined,
        });
        break;
      }
    }

    const settledRecord: CantonContract = {
      ...entry.data,
      contractId: receiptId,
      status: 'SETTLED',
      settledReceipt: {
        receiptId,
        approvedSha: entry.data.submissionSha || '',
        settlementRef,
        settledAt,
        tokenTransferTxId: transactionId,
        tokenRecipientHoldingId,
      },
    };

    this.contracts.set(receiptId, {
      contractId: receiptId,
      templateId: `${getCantonConfig().packageId}:MergeMint.Bounty:SettledReceipt`,
      data: settledRecord,
      archived: false,
    });

    this.offset++;
    return { receiptId, transactionId, record: settledRecord, tokenRecipientHoldingId };
  }

  getBalances(_sponsorParty?: string, _contributorParty?: string): CantonBalances {
    const initialPool = 10000;
    let escrowSum = 0;
    let contributorSum = 0;

    for (const holding of this.holdings.values()) {
      if (!holding.archived) {
        if (holding.isSettled) {
          contributorSum += holding.amount;
        } else {
          // Locked in escrow for active bounty
          escrowSum += holding.amount;
        }
      }
    }

    const sponsorAvailable = Math.max(0, initialPool - escrowSum - contributorSum);
    return {
      sponsor: sponsorAvailable.toFixed(0),
      contributor: contributorSum.toFixed(0),
      escrow: escrowSum.toFixed(0),
      currency: 'MMT',
    };
  }

  getActiveContracts(): CantonContract[] {
    return Array.from(this.contracts.values())
      .filter(c => !c.archived && c.data.status !== 'SETTLED')
      .map(c => c.data);
  }

  findContractByBountyId(bountyId: string): CantonContract | null {
    for (const entry of this.contracts.values()) {
      if (entry.data.bountyId === bountyId && !entry.archived) {
        return entry.data;
      }
    }
    for (const entry of this.contracts.values()) {
      if (entry.data.bountyId === bountyId && entry.data.status === 'SETTLED') {
        return entry.data;
      }
    }
    return null;
  }
}

// Global in-memory ledger singleton for offline/mock testing
const localLedger = new CantonLocalNetLedger();

// --- Live Canton JSON Ledger API v2 HTTP Client ---

interface SubmitCommandResponse {
  updateId: string;
  completionOffset: number;
}

interface RawActiveContract {
  workflowId?: string;
  contractEntry?: {
    JsActiveContract?: {
      createdEvent?: {
        contractId: string;
        templateId: string;
        createArgument: Record<string, any>;
        createdAt?: string;
      };
    };
  };
}

export async function submitLedgerCommand(
  actAs: string[],
  readAs: string[],
  command: Record<string, unknown> | Array<Record<string, unknown>>,
  commandId: string,
  workflowId: string
): Promise<SubmitCommandResponse> {
  const cfg = getCantonConfig();
  const url = `${cfg.ledgerApiUrl}/v2/commands/submit-and-wait`;
  const commands = Array.isArray(command) ? command : [command];
  const body = {
    userId: 'participant_admin',
    commandId,
    workflowId,
    applicationId: 'mergemint',
    actAs,
    readAs,
    commands,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cfg.authToken) {
    headers['Authorization'] = `Bearer ${cfg.authToken}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new CantonLedgerError(`Canton command failed (${res.status}): ${errorText}`, res.status, errorText);
  }

  return (await res.json()) as SubmitCommandResponse;
}

export async function queryRawLedgerContracts(): Promise<RawActiveContract[]> {
  const cfg = getCantonConfig();
  const url = `${cfg.ledgerApiUrl}/v2/state/active-contracts-page`;
  const body = {
    eventFormat: {
      filtersForAnyParty: {
        cumulative: [],
      },
      verbose: true,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cfg.authToken) {
    headers['Authorization'] = `Bearer ${cfg.authToken}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new CantonLedgerError(`Failed to query active contracts from Canton (${res.status}): ${errText}`, res.status);
  }

  const data = await res.json();
  return (data.activeContracts || []) as RawActiveContract[];
}

export async function queryLedgerActiveContracts(): Promise<CantonContract[]> {
  const cfg = getCantonConfig();
  if (cfg.mode === 'simulated') {
    return localLedger.getActiveContracts();
  }
  if (cfg.mode === 'mock') {
    return [];
  }

  const rawList = await queryRawLedgerContracts();
  const results: CantonContract[] = [];

  for (const entry of rawList) {
    const active = entry.contractEntry?.JsActiveContract;
    if (!active?.createdEvent) continue;
    const evt = active.createdEvent;
    const templateId: string = evt.templateId || '';
    const arg = evt.createArgument || {};

    if (templateId === `${cfg.packageId}:MergeMint.Token:MergeMintBounty`) {
      const tokenHoldingContractId = evt.contractId;
      results.push({
        contractId: evt.contractId,
        templateId,
        bountyId: arg.bountyId,
        sponsor: arg.sponsor,
        maintainer: arg.maintainer,
        contributor: arg.contributor || undefined,
        repository: arg.repository,
        issueNumber: parseInt(arg.issueNumber, 10) || 0,
        issueUrl: arg.issueUrl,
        amount: String(arg.amount || '0'),
        asset: arg.asset || 'MMT',
        acceptanceCriteria: arg.acceptanceCriteria || [],
        submissionSha: arg.submissionSha || undefined,
        prNumber: arg.prNumber ? Number(arg.prNumber) : undefined,
        status: arg.status,
        createdAt: evt.createdAt || new Date().toISOString(),
        tokenHoldingContractId,
      });
    } else if (templateId === `${cfg.packageId}:MergeMint.Token:SettledReceipt`) {
      const tokenRecipientHoldingId = arg.tokenRecipientHoldingId;
      results.push({
        contractId: evt.contractId,
        templateId,
        bountyId: arg.bountyId,
        sponsor: arg.sponsor,
        maintainer: arg.maintainer,
        contributor: arg.contributor,
        repository: arg.repository,
        issueNumber: parseInt(arg.issueNumber, 10) || 0,
        issueUrl: `https://github.com/${arg.repository}/issues/${arg.issueNumber}`,
        amount: String(arg.amount || '0'),
        asset: arg.asset || 'MMT',
        acceptanceCriteria: [],
        submissionSha: arg.approvedSha,
        prNumber: Number(arg.prNumber),
        status: 'SETTLED',
        createdAt: evt.createdAt || new Date().toISOString(),
        settledReceipt: {
          receiptId: evt.contractId,
          approvedSha: arg.approvedSha,
          settlementRef: arg.settlementRef,
          settledAt: arg.settledAt,
          tokenRecipientHoldingId,
        },
      });
    }
  }

  return results;
}

export async function queryLedgerBalances(): Promise<CantonBalances> {
  const cfg = getCantonConfig();
  if (cfg.mode === 'mock') {
    return {
      sponsor: '9500',
      contributor: '500',
      escrow: '250',
      currency: 'MMT',
    };
  }
  if (cfg.mode === 'simulated') {
    return localLedger.getBalances(cfg.parties.sponsor.partyId, cfg.parties.contributor.partyId);
  }

  const { units, decimal, template } = await import('./ledger');
  let sponsor = BigInt(0), contributor = BigInt(0), escrow = BigInt(0);
  for (const entry of await queryRawLedgerContracts()) {
    const e = entry.contractEntry?.JsActiveContract?.createdEvent;
    if (!e) continue;
    const a = e.createArgument;
    if (e.templateId === template('MergeMintBounty') && a.asset === 'MMT') escrow += units(String(a.amount));
    if (e.templateId === template('MergeMintHolding') && a.instrument === 'MMT') {
      if (a.owner === cfg.parties.sponsor.partyId) sponsor += units(String(a.amount));
      if (a.owner === cfg.parties.contributor.partyId) contributor += units(String(a.amount));
    }
  }
  return { sponsor: decimal(sponsor), contributor: decimal(contributor), escrow: decimal(escrow), currency: 'MMT' };
}

async function findActiveContractByBountyId(bountyId: string): Promise<CantonContract | null> {
  const contracts = await queryLedgerActiveContracts();
  const active = contracts.find(c => c.bountyId === bountyId && c.status !== 'SETTLED');
  if (active) return active;
  return contracts.find(c => c.bountyId === bountyId) || null;
}

// --- Public Operations ---

/**
 * Check connectivity and status of the Canton ledger.
 */
export async function getCantonStatus(): Promise<CantonStatus> {
  const cfg = getCantonConfig();
  if (cfg.mode === 'mock') {
    return {
      mode: 'mock',
      connected: true,
      network: 'Canton · Demo',
      ledgerApiUrl: 'internal://mock',
      parties: cfg.parties,
      tokenPackageId: cfg.tokenPackageId,
      balances: {
        sponsor: '9500',
        contributor: '500',
        escrow: '250',
        currency: 'MMT',
      },
    };
  }
  if (cfg.mode === 'simulated') {
    return {
      mode: 'simulated',
      connected: true,
      network: 'Canton LocalNet (Simulated)',
      ledgerApiUrl: 'internal://simulated',
      parties: cfg.parties,
      packageId: cfg.packageId,
      tokenPackageId: cfg.tokenPackageId,
      balances: localLedger.getBalances(cfg.parties.sponsor.partyId, cfg.parties.contributor.partyId),
    };
  }

  try {
    const res = await fetch(`${cfg.ledgerApiUrl}/v2/parties`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const connected = res.ok;
    const parties = cfg.parties;

    const balances = connected ? await queryLedgerBalances() : undefined;

    return {
      mode: 'real',
      connected,
      network: cfg.network,
      ledgerApiUrl: cfg.ledgerApiUrl,
      parties,
      packageId: cfg.packageId,
      tokenPackageId: cfg.tokenPackageId,
      balances,
    };
  } catch (err) {
    return {
      mode: 'real',
      connected: false,
      network: cfg.network,
      ledgerApiUrl: cfg.ledgerApiUrl,
      parties: cfg.parties,
      packageId: cfg.packageId,
      tokenPackageId: cfg.tokenPackageId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Creates and funds a bounty on Canton with Level C Token Holding.
 */
export async function fundBountyOnLedger(bounty: Bounty): Promise<CantonTransactionResult> {
  const cfg = getCantonConfig();
  if (cfg.mode === 'mock') {
    const timestamp = new Date().toISOString();
    return {
      transactionId: `mock-tx-${bounty.id}`,
      contractId: `mock-lock-${bounty.id}-${Date.now()}`,
      reference: `mock-lock-${bounty.id}-${Date.now()}`,
      timestamp,
      status: 'FUNDED',
      tokenHoldingId: `mock-iou-${bounty.id}`,
    };
  }
  if (cfg.mode === 'simulated') {
    const res = localLedger.createBounty(bounty);
    return {
      transactionId: res.transactionId,
      contractId: res.contractId,
      reference: res.contractId,
      timestamp: res.record.createdAt,
      status: 'FUNDED',
      tokenHoldingId: res.tokenHoldingId,
    };
  }

  return (await import('./ledger')).fund(bounty);
}

/**
 * Exercises the Claim choice on the Canton ledger.
 */
export async function claimBountyOnLedger(bountyId: string, contributor: Party): Promise<CantonTransactionResult> {
  const cfg = getCantonConfig();
  if (cfg.mode === 'mock') {
    return {
      transactionId: `mock-tx-claim-${bountyId}`,
      contractId: `mock-contract-${bountyId}`,
      reference: `mock-claim-${bountyId}`,
      timestamp: new Date().toISOString(),
      status: 'CLAIMED',
    };
  }
  if (cfg.mode === 'simulated') {
    const existing = localLedger.findContractByBountyId(bountyId);
    if (!existing) {
      throw new CantonLedgerError(`No active bounty contract found on Canton for ID "${bountyId}".`, 404);
    }
    const res = localLedger.claimBounty(existing.contractId, contributor.partyId || cfg.parties.contributor.partyId);
    return {
      transactionId: res.transactionId,
      contractId: res.contractId,
      reference: res.contractId,
      timestamp: new Date().toISOString(),
      status: 'CLAIMED',
    };
  }

  return (await import('./ledger')).claim(bountyId, contributor);
}

/**
 * Submits PR commit revision on the Canton ledger.
 */
export async function submitRevisionOnLedger(bountyId: string, contributor: Party, sha: string, prNumber = 0): Promise<CantonTransactionResult> {
  const cfg = getCantonConfig();
  if (cfg.mode === 'simulated') {
    const existing = localLedger.findContractByBountyId(bountyId);
    if (!existing) {
      throw new CantonLedgerError(`No active bounty contract found on Canton for ID "${bountyId}".`, 404);
    }
    const res = localLedger.submitRevision(existing.contractId, contributor.partyId || cfg.parties.contributor.partyId, sha);
    return {
      transactionId: res.transactionId,
      contractId: res.contractId,
      reference: res.contractId,
      timestamp: new Date().toISOString(),
      status: 'CLAIMED',
    };
  }
  return (await import('./ledger')).revision(bountyId, sha, prNumber);
}

/**
 * Exercises the Approve choice on the Canton ledger.
 */
export async function approveBountyOnLedger(bounty: Bounty, sha: string, maintainer: Party): Promise<CantonTransactionResult> {
  const cfg = getCantonConfig();
  if (cfg.mode === 'mock') {
    return {
      transactionId: `mock-tx-approve-${bounty.id}`,
      contractId: bounty.fundingRef || `mock-contract-${bounty.id}`,
      reference: bounty.fundingRef || `mock-contract-${bounty.id}`,
      timestamp: new Date().toISOString(),
      status: 'APPROVED',
    };
  }
  if (cfg.mode === 'simulated') {
    const existing = localLedger.findContractByBountyId(bounty.id);
    if (!existing) {
      throw new CantonLedgerError(`No active contract found on Canton for bounty "${bounty.id}".`, 404);
    }
    if (existing.submissionSha !== sha && bounty.contributor) {
      localLedger.submitRevision(existing.contractId, bounty.contributor.partyId || cfg.parties.contributor.partyId, sha);
    }
    const current = localLedger.findContractByBountyId(bounty.id)!;
    const res = localLedger.approveBounty(current.contractId, maintainer.partyId || cfg.parties.maintainer.partyId, sha);
    return {
      transactionId: res.transactionId,
      contractId: res.contractId,
      reference: res.contractId,
      timestamp: new Date().toISOString(),
      status: 'APPROVED',
    };
  }

  return (await import('./ledger')).approve(bounty, sha, maintainer);
}

/**
 * Exercises the Settle choice on the Canton ledger.
 */
export async function settleBountyOnLedger(bounty: Bounty, simulateFailure = false): Promise<CantonTransactionResult> {
  const cfg = getCantonConfig();
  if (cfg.mode === 'mock') {
    if (simulateFailure) {
      throw new Error('Simulated Canton connection failure. Your approval is still valid. Retry settlement.');
    }
    const timestamp = new Date().toISOString();
    return {
      transactionId: `mock-tx-${bounty.id}-${Date.now()}`,
      contractId: `mock-receipt-${bounty.id}`,
      reference: `mock-tx-${bounty.id}-${Date.now()}`,
      timestamp,
      status: 'SETTLED',
      tokenHoldingId: bounty.tokenHoldingContractId || `mock-iou-${bounty.id}`,
      tokenTransferId: `mock-transfer-${Date.now()}`,
    };
  }
  if (cfg.mode === 'simulated') {
    if (simulateFailure) {
      throw new CantonLedgerError('Simulated Canton connection failure. Your approval is still valid. Retry settlement.', 503);
    }
    const existing = localLedger.findContractByBountyId(bounty.id);
    if (!existing) {
      throw new CantonLedgerError(`No active approved contract found on Canton for bounty "${bounty.id}".`, 404);
    }
    const settlementRef = `canton_tx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const settler = bounty.maintainer.partyId || cfg.parties.maintainer.partyId;
    const res = localLedger.settleBounty(existing.contractId, settler, settlementRef);
    return {
      transactionId: res.transactionId,
      contractId: res.receiptId,
      reference: settlementRef,
      timestamp: res.record.settledReceipt?.settledAt || new Date().toISOString(),
      status: 'SETTLED',
      tokenHoldingId: res.record.tokenHoldingContractId,
      tokenTransferId: res.transactionId,
      tokenRecipientHoldingId: res.tokenRecipientHoldingId,
    };
  }

  return (await import('./ledger')).settle(bounty, simulateFailure);
}

/**
 * Fetches all active contracts from the Canton ledger.
 */
export async function getActiveLedgerBounties(): Promise<CantonContract[]> {
  const cfg = getCantonConfig();
  if (cfg.mode === 'mock') {
    return [];
  }
  if (cfg.mode === 'simulated') {
    return localLedger.getActiveContracts();
  }
  return queryLedgerActiveContracts();
}
