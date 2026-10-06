import type { Bounty, Party } from '@/domain/bounty';
import { delay } from '@/integrations/github';
import type {
  CantonBalances,
  CantonContract,
  CantonIntegration,
  CantonStatus,
  CantonTransactionResult,
} from './types';

export class MockCantonIntegration implements CantonIntegration {
  getMode(): 'mock' | 'real' {
    return 'mock';
  }

  async getStatus(): Promise<CantonStatus> {
    await delay(100);
    return {
      mode: 'mock',
      connected: true,
      network: 'Canton · Demo',
      ledgerApiUrl: 'internal://mock',
      parties: {
        sponsor: {
          handle: 'mergemint-labs',
          partyId: 'mergemint-sponsor::mock',
        },
        maintainer: {
          handle: 'alexmorgan',
          partyId: 'alexmorgan::mock',
        },
        contributor: {
          handle: 'juleschen',
          partyId: 'juleschen::mock',
        },
      },
      tokenPackageId: '764252f6c2236376a83c134318e7856e046ff469481b28dcdc84372fa636d91a',
      balances: {
        sponsor: '9500',
        contributor: '500',
        escrow: '250',
        currency: 'MMT',
      },
    };
  }

  async fund(bounty: Bounty): Promise<string> {
    await delay(400);
    return `mock-lock-${bounty.id}-${Date.now()}`;
  }

  async claim(bountyId: string, contributor: Party): Promise<CantonTransactionResult> {
    await delay(300);
    return {
      transactionId: `mock-tx-claim-${bountyId}`,
      contractId: `mock-contract-${bountyId}`,
      reference: `mock-claim-${bountyId}`,
      timestamp: new Date().toISOString(),
      status: 'CLAIMED',
    };
  }

  async approve(bounty: Bounty, sha: string, maintainer: Party): Promise<CantonTransactionResult> {
    await delay(300);
    return {
      transactionId: `mock-tx-approve-${bounty.id}`,
      contractId: bounty.fundingRef || `mock-contract-${bounty.id}`,
      reference: bounty.fundingRef || `mock-contract-${bounty.id}`,
      timestamp: new Date().toISOString(),
      status: 'APPROVED',
    };
  }

  async settle(bounty: Bounty, simulateFailure = false): Promise<string> {
    await delay(500);
    if (simulateFailure) {
      throw new Error('Simulated Canton connection failure. Your approval is still valid. Retry settlement.');
    }
    if (!bounty.approval || bounty.approval.sha !== bounty.submission?.sha) {
      throw new Error('Approval does not match the current revision.');
    }
    return `mock-tx-${bounty.id}-${Date.now()}`;
  }

  async getActiveBounties(): Promise<CantonContract[]> {
    await delay(100);
    return [];
  }

  async getBalances(): Promise<CantonBalances> {
    await delay(50);
    return {
      sponsor: '9500',
      contributor: '500',
      escrow: '250',
      currency: 'CC',
    };
  }
}

export const mockCanton = new MockCantonIntegration();
