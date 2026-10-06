import type { Bounty } from '@/domain/bounty';
import { seeds } from '@/mocks/seed';

export interface BountyRepository {
  getAll(): Promise<Bounty[]>;
  getById(id: string): Promise<Bounty | null>;
  save(bounty: Bounty): Promise<void>;
  saveAll(bounties: Bounty[]): Promise<void>;
  resetToSeeds(): Promise<Bounty[]>;
}

export class LocalStorageBountyRepository implements BountyRepository {
  private storageKey = 'mergemint_bounties_v1';
  private memoryStore: Map<string, Bounty> | null = null;

  private isLocalStorageAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  async getAll(): Promise<Bounty[]> {
    if (this.isLocalStorageAvailable()) {
      try {
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Bounty[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
        // Initialize with default seeds if storage is empty
        window.localStorage.setItem(this.storageKey, JSON.stringify(seeds));
        return structuredClone(seeds);
      } catch {
        // Fallback to in-memory store if localStorage read fails
      }
    }

    if (!this.memoryStore) {
      this.memoryStore = new Map(seeds.map(b => [b.id, structuredClone(b)]));
    }
    return Array.from(this.memoryStore.values());
  }

  async getById(id: string): Promise<Bounty | null> {
    const all = await this.getAll();
    return all.find(b => b.id === id) ?? null;
  }

  async save(bounty: Bounty): Promise<void> {
    const all = await this.getAll();
    const index = all.findIndex(b => b.id === bounty.id);
    let updated: Bounty[];
    if (index >= 0) {
      updated = [...all];
      updated[index] = bounty;
    } else {
      updated = [bounty, ...all];
    }
    await this.saveAll(updated);
  }

  async saveAll(bounties: Bounty[]): Promise<void> {
    if (this.isLocalStorageAvailable()) {
      try {
        window.localStorage.setItem(this.storageKey, JSON.stringify(bounties));
      } catch {
        // Fallback
      }
    }
    this.memoryStore = new Map(bounties.map(b => [b.id, structuredClone(b)]));
  }

  async resetToSeeds(): Promise<Bounty[]> {
    const fresh = structuredClone(seeds);
    await this.saveAll(fresh);
    return fresh;
  }
}

export const bountyRepository: BountyRepository = new LocalStorageBountyRepository();
