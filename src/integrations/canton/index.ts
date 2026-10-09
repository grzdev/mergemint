import type { Bounty, Party } from '@/domain/bounty';
import { mockCanton } from './mock';
import { realCanton } from './real';
import type {
  CantonContract,
  CantonIntegration,
  CantonStatus,
  CantonTransactionResult,
} from './types';

export * from './types';
export { mockCanton, realCanton };

class DelegatingCantonIntegration implements CantonIntegration {
  private currentMode: 'mock' | 'real' | 'simulated' = 'mock';
  private modeResolved = false;

  getMode(): 'mock' | 'real' | 'simulated' {
    return this.currentMode;
  }

  setMode(mode: 'mock' | 'real' | 'simulated') {
    this.currentMode = mode;
    this.modeResolved = true;
  }

  async getStatus(): Promise<CantonStatus> {
    try {
      const status = await realCanton.getStatus();
      this.currentMode = status.mode;
      this.modeResolved = true;
      return status;
    } catch {
      this.currentMode = 'mock';
      this.modeResolved = true;
      return mockCanton.getStatus();
    }
  }

  private async ensureMode(): Promise<'mock' | 'real' | 'simulated'> {
    if (!this.modeResolved) {
      await this.getStatus();
    }
    return this.currentMode;
  }

  async fund(bounty: Bounty): Promise<string> {
    const mode = await this.ensureMode();
    return mode !== 'mock' ? realCanton.fund(bounty) : mockCanton.fund(bounty);
  }

  async claim(bountyId: string, contributor: Party): Promise<CantonTransactionResult> {
    const mode = await this.ensureMode();
    return mode !== 'mock'
      ? realCanton.claim(bountyId, contributor)
      : mockCanton.claim(bountyId, contributor);
  }

  async approve(bounty: Bounty, sha: string, maintainer: Party): Promise<CantonTransactionResult> {
    const mode = await this.ensureMode();
    return mode !== 'mock'
      ? realCanton.approve(bounty, sha, maintainer)
      : mockCanton.approve(bounty, sha, maintainer);
  }

  async settle(bounty: Bounty, simulateFailure = false): Promise<string> {
    const mode = await this.ensureMode();
    return mode !== 'mock'
      ? realCanton.settle(bounty, simulateFailure)
      : mockCanton.settle(bounty, simulateFailure);
  }

  async settleDetailed(bounty: Bounty, simulateFailure = false): Promise<CantonTransactionResult> {
    const mode=await this.ensureMode();
    if (mode !== 'mock') return realCanton.settleDetailed(bounty,simulateFailure);
    const reference=await mockCanton.settle(bounty,simulateFailure);
    return {reference,transactionId:reference,contractId:reference,timestamp:new Date().toISOString(),status:'SETTLED'};
  }
  async getActiveBounties(): Promise<CantonContract[]> {
    const mode = await this.ensureMode();
    return mode !== 'mock' ? realCanton.getActiveBounties() : mockCanton.getActiveBounties();
  }

  async getBalances(): Promise<import('./types').CantonBalances> {
    const mode = await this.ensureMode();
    return mode !== 'mock' ? realCanton.getBalances() : mockCanton.getBalances();
  }
}

export const canton = new DelegatingCantonIntegration();

