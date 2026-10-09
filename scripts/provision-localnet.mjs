// Read-only endpoints plus isolated LocalNet party allocation and demo token issuance.
// This script never connects to public networks. Existing bounties are untouched.
import fs from 'node:fs';
import crypto from 'node:crypto';

const packageId = process.argv[2];
if (!/^[a-f0-9]{64}$/.test(packageId || '')) {
  throw new Error('Pass DAR main package ID.');
}

fs.mkdirSync('scratch/localnet-correctness', { recursive: true });
if (!fs.existsSync('.env.local')) {
  fs.copyFileSync('.env.example', '.env.local');
}

const base = 'http://127.0.0.1:7675';
async function api(path, body) {
  const r = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const parties = {};
for (const role of ['sponsor', 'maintainer', 'contributor']) {
  const existing = (await api('/v2/parties')).partyDetails.find(p => p.party.startsWith(role + '::'));
  parties[role] = existing?.party || (await api('/v2/parties', { partyIdHint: role, localMetadata: { annotations: {} }, identityProviderId: '' })).partyDetails?.party;
  if (!parties[role]) throw new Error('Party allocation returned no party for ' + role);
}

const env = {
  CANTON_INTEGRATION_MODE: 'real',
  CANTON_LEDGER_API_URL: base,
  CANTON_PACKAGE_ID: packageId,
  CANTON_NETWORK: 'Canton LocalNet (single-operator demo)',
  CANTON_SPONSOR_PARTY: parties.sponsor,
  CANTON_MAINTAINER_PARTY: parties.maintainer,
  CANTON_CONTRIBUTOR_PARTY: parties.contributor,
  CANTON_SPONSOR_GITHUB_LOGIN: 'grzdev',
  CANTON_MAINTAINER_GITHUB_LOGIN: 'grzdev',
  CANTON_CONTRIBUTOR_GITHUB_LOGIN: 'grzdev',
};

const old = fs.readFileSync('.env.local', 'utf8');
if (!fs.existsSync('scratch/localnet-correctness/original.env')) {
  fs.writeFileSync('scratch/localnet-correctness/original.env', old);
}

let next = old;
for (const [key, value] of Object.entries(env)) {
  const line = `${key}=${value}`;
  const rx = new RegExp(`^${key}=.*$`, 'm');
  next = rx.test(next) ? next.replace(rx, line) : next + '\n' + line;
}
fs.writeFileSync('.env.local', next + '\n');

const acs = await api('/v2/state/active-contracts-page', { eventFormat: { filtersForAnyParty: { cumulative: [] }, verbose: true } });
const hasIssued = (acs.activeContracts || []).some(c => c.contractEntry?.JsActiveContract?.createdEvent?.templateId === `${packageId}:MergeMint.Token:MergeMintHolding`);
if (!hasIssued) {
  await api('/v2/commands/submit-and-wait', {
    userId: 'participant_admin',
    commandId: crypto.randomUUID(),
    actAs: [parties.sponsor],
    readAs: [],
    commands: [{
      CreateCommand: {
        templateId: `${packageId}:MergeMint.Token:MergeMintHolding`,
        createArguments: { admin: parties.sponsor, owner: parties.sponsor, instrument: 'MMT', amount: '10000.0' }
      }
    }]
  });
}

console.log(`LocalNet configured; three ledger parties allocated. ${hasIssued ? 'Existing holdings retained.' : 'Issued 10,000 demo MMT.'} GitHub login grzdev maps separately to each role. Set GitHub real mode and credentials, then restart the app.`);
