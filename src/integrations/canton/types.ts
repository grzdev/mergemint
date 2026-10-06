import type { Bounty, Party, Status } from '@/domain/bounty';

export interface CantonBalances {
  sponsor: string; // e.g. "9500"
  contributor: string; // e.g. "500"
  escrow: string; // e.g. "250"
  currency: string; // "MMT"
}

export interface CantonTokenHolding {
  contractId: string;
  templateId: string;
  payer: string;
  owner: string;
  amount: string;
  currency: string;
  createdAt?: string;
}

export interface CantonStatus {
  mode: 'mock' | 'real' | 'simulated';
  connected: boolean;
  network: string;
  ledgerApiUrl: string;
  parties: {
    sponsor: Party;
    maintainer: Party;
    contributor: Party;
  };
  packageId?: string;
  tokenPackageId?: string;
  balances?: CantonBalances;
  error?: string | null;
}

export interface CantonContract {
  contractId: string;
  templateId: string;
  bountyId: string;
  sponsor: string;
  maintainer: string;
  contributor?: string;
  repository: string;
  issueNumber: number;
  issueUrl: string;
  amount: string;
  asset: string;
  acceptanceCriteria: string[];
  submissionSha?: string;
  status: 'FUNDED' | 'CLAIMED' | 'APPROVED' | 'SETTLED';
  createdAt: string;
  tokenHoldingContractId?: string; // Contract ID of the locked or transferred Canton IOU holding
  settledReceipt?: {
    receiptId: string;
    approvedSha: string;
    settlementRef: string;
    settledAt: string;
    tokenTransferTxId?: string; // Transaction / update ID of the token transfer
    tokenRecipientHoldingId?: string; // Newly created holding contract ID owned by contributor
  };
}

export interface CantonTransactionResult {
  transactionId: string;
  contractId: string;
  reference: string;
  timestamp: string;
  status: Status;
  tokenHoldingId?: string;
  tokenTransferId?: string;
  tokenRecipientHoldingId?: string;
}

export interface CantonIntegration {
  getMode(): 'mock' | 'real' | 'simulated';
  getStatus(): Promise<CantonStatus>;
  fund(bounty: Bounty): Promise<string>;
  claim(bountyId: string, contributor: Party): Promise<CantonTransactionResult>;
  approve(bounty: Bounty, sha: string, maintainer: Party): Promise<CantonTransactionResult>;
  settle(bounty: Bounty, simulateFailure?: boolean): Promise<string>;
  getActiveBounties(): Promise<CantonContract[]>;
  getBalances?(): Promise<CantonBalances>;
}
