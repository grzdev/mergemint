import { RevisionChangedError } from '@/domain/reconciliation';
import type { Bounty, Party } from '@/domain/bounty';
import type {
  CantonBalances,
  CantonContract,
  CantonIntegration,
  CantonStatus,
  CantonTransactionResult,
} from './types';

export class RealCantonIntegration implements CantonIntegration {
  getMode(): 'mock' | 'real' {
    return 'real';
  }

  async getStatus(): Promise<CantonStatus> {
    if (typeof window === 'undefined') {
      const { getCantonStatus } = await import('./server/client');
      return getCantonStatus();
    }

    try {
      const res = await fetch('/api/canton/status', { cache: 'no-store' });
      if (!res.ok) {
        return {
          mode: 'real',
          connected: false,
          network: 'Canton LocalNet (Disconnected)',
          ledgerApiUrl: 'http://127.0.0.1:7575',
          parties: {
            sponsor: { handle: 'mergemint-labs', partyId: 'mergemint-sponsor::12204a91b2c3d4e5' },
            maintainer: { handle: 'alexmorgan', partyId: 'alexmorgan::12204a91b2c3d4e5' },
            contributor: { handle: 'juleschen', partyId: 'juleschen::12204a91b2c3d4e5' },
          },
          error: `Server responded with ${res.status}`,
        };
      }
      return (await res.json()) as CantonStatus;
    } catch {
      return {
        mode: 'real',
        connected: false,
        network: 'Canton LocalNet (Unreachable)',
        ledgerApiUrl: 'http://127.0.0.1:7575',
        parties: {
          sponsor: { handle: 'mergemint-labs', partyId: 'mergemint-sponsor::12204a91b2c3d4e5' },
          maintainer: { handle: 'alexmorgan', partyId: 'alexmorgan::12204a91b2c3d4e5' },
          contributor: { handle: 'juleschen', partyId: 'juleschen::12204a91b2c3d4e5' },
        },
        error: 'Failed to connect to Canton API route',
      };
    }
  }

  async fund(bounty: Bounty): Promise<string> {
    if (typeof window === 'undefined') {
      const { fundBountyOnLedger } = await import('./server/client');
      const res = await fundBountyOnLedger(bounty);
      return res.contractId;
    }

    const res = await fetch('/api/canton/fund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounty }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.code === 'REVISION_CHANGED' && err.submission) throw new RevisionChangedError(err.error, err.submission);
      throw new Error(err.error || `Failed to fund bounty on Canton (${res.status})`);
    }

    const data = (await res.json()) as { contractId: string; reference: string };
    return data.contractId || data.reference;
  }

  async claim(bountyId: string, contributor: Party): Promise<CantonTransactionResult> {
    if (typeof window === 'undefined') {
      const { claimBountyOnLedger } = await import('./server/client');
      return claimBountyOnLedger(bountyId, contributor);
    }

    const res = await fetch('/api/canton/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bountyId, contributor }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.code === 'REVISION_CHANGED' && err.submission) throw new RevisionChangedError(err.error, err.submission);
      throw new Error(err.error || `Failed to claim bounty on Canton (${res.status})`);
    }

    const data = (await res.json()) as { result: CantonTransactionResult };
    return data.result;
  }

  async approve(bounty: Bounty, sha: string, maintainer: Party): Promise<CantonTransactionResult> {
    if (typeof window === 'undefined') {
      const { approveBountyOnLedger } = await import('./server/client');
      return approveBountyOnLedger(bounty, sha, maintainer);
    }

    const res = await fetch('/api/canton/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounty, sha, maintainer }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.code === 'REVISION_CHANGED' && err.submission) throw new RevisionChangedError(err.error, err.submission);
      throw new Error(err.error || `Failed to record approval on Canton (${res.status})`);
    }

    const data = (await res.json()) as { result: CantonTransactionResult };
    return data.result;
  }

  async settle(bounty: Bounty, simulateFailure = false): Promise<string> {
    return (await this.settleDetailed(bounty, simulateFailure)).reference;
  }
  async settleDetailed(bounty: Bounty, simulateFailure = false): Promise<CantonTransactionResult> {
    if (typeof window === 'undefined') {
      const { settleBountyOnLedger } = await import('./server/client');
      const res = await settleBountyOnLedger(bounty, simulateFailure);
      return res;
    }

    const res = await fetch('/api/canton/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounty, simulateFailure }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.code === 'REVISION_CHANGED' && err.submission) throw new RevisionChangedError(err.error, err.submission);
      throw new Error(err.error || `Failed to settle bounty on Canton (${res.status})`);
    }

    const data = await res.json();
    return { ...data, contractId: data.receiptId, status: 'SETTLED' };
  }

  async getActiveBounties(): Promise<CantonContract[]> {
    if (typeof window === 'undefined') {
      const { getActiveLedgerBounties } = await import('./server/client');
      return getActiveLedgerBounties();
    }

    const res = await fetch('/api/canton/bounties', { cache: 'no-store' });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { bounties: CantonContract[] };
    return data.bounties || [];
  }

  async getBalances(): Promise<CantonBalances> {
    if (typeof window === 'undefined') {
      const { queryLedgerBalances } = await import('./server/client');
      return queryLedgerBalances();
    }
    const status = await this.getStatus();
    if (!status.balances) throw new Error('Canton balances are unavailable.');
    return status.balances;
  }
}

export const realCanton = new RealCantonIntegration();
