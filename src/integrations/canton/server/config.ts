import type { Party } from '@/domain/bounty';

export interface CantonServerConfig {
  mode: 'mock' | 'real' | 'simulated';
  ledgerApiUrl: string;
  network: string;
  packageId: string;
  tokenPackageId: string;
  authToken?: string;
  parties: {
    sponsor: Party;
    maintainer: Party;
    contributor: Party;
  };
}

export function getCantonConfig(): CantonServerConfig {
  const configuredMode = (process.env.CANTON_INTEGRATION_MODE || 'mock').toLowerCase();
  const mode: 'mock' | 'real' | 'simulated' =
    configuredMode === 'real' ? 'real' : configuredMode === 'simulated' ? 'simulated' : 'mock';

  const ledgerApiUrl = (process.env.CANTON_LEDGER_API_URL || 'http://127.0.0.1:7575').replace(/\/+$/, '');
  const network = process.env.CANTON_NETWORK || 'Canton LocalNet';
  const packageId = process.env.CANTON_PACKAGE_ID || '7309f3262f96db67e0e9562be63715734eebc9d09696b62f5bfdbeeba63b4d60';
  const tokenPackageId = process.env.CANTON_TOKEN_PACKAGE_ID || '718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b';
  const authToken = process.env.CANTON_AUTH_TOKEN || undefined;

  const sponsor: Party = {
    handle: process.env.CANTON_SPONSOR_GITHUB_LOGIN || 'mergemint-labs',
    partyId: process.env.CANTON_SPONSOR_PARTY || 'sponsor::1220bce5deccad474f1d1afa5f6af9d028cd4c1922c62903b1a5c4178e67a91f1e3b',
  };

  const maintainer: Party = {
    handle: process.env.CANTON_MAINTAINER_GITHUB_LOGIN || 'alexmorgan',
    partyId: process.env.CANTON_MAINTAINER_PARTY || 'maintainer::1220bce5deccad474f1d1afa5f6af9d028cd4c1922c62903b1a5c4178e67a91f1e3b',
  };

  const contributor: Party = {
    handle: process.env.CANTON_CONTRIBUTOR_GITHUB_LOGIN || 'juleschen',
    partyId: process.env.CANTON_CONTRIBUTOR_PARTY || 'contributor::1220bce5deccad474f1d1afa5f6af9d028cd4c1922c62903b1a5c4178e67a91f1e3b',
  };

  return {
    mode,
    ledgerApiUrl,
    network,
    packageId,
    tokenPackageId,
    authToken,
    parties: {
      sponsor,
      maintainer,
      contributor,
    },
  };
}
