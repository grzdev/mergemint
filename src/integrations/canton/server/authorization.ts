import type { Bounty, Party, Submission } from '@/domain/bounty';
import type { CantonContract } from '../types';
import { getSessionFromRequest } from '@/integrations/github/server/session';
import { getGitHubConfig } from '@/integrations/github/server/config';
import { getPullRequestAndEvidence } from '@/integrations/github/server/client';
import { getCantonConfig } from './config';
import { CantonLedgerError } from './client';
import { active, revision } from './ledger';

export type Role = 'sponsor' | 'maintainer' | 'contributor';
export class RevisionConflict extends CantonLedgerError {
  constructor(public submission: Submission) { super('GitHub revision changed. Refresh the evidence and review the new commit before approving or settling.', 409); }
}
export function roleLogin(role: Role): string {
  const login = process.env[`CANTON_${role.toUpperCase()}_GITHUB_LOGIN`]?.trim().toLowerCase();
  if (!login || !/^[a-z0-9-]+$/.test(login)) throw new CantonLedgerError(`Configure CANTON_${role.toUpperCase()}_GITHUB_LOGIN before real ledger actions.`, 503);
  return login;
}
export function requireActor(request: Request, role: Role) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith('mergemint-dev-')) throw new CantonLedgerError('A strong SESSION_SECRET is required for live mode.', 503);
  if (getGitHubConfig().mode !== 'real') throw new CantonLedgerError('Real GitHub authentication is required for real Canton actions.', 503);
  const session = getSessionFromRequest(request);
  if (!session?.token || !session.user?.login || !Number.isFinite(session.createdAt) || session.createdAt > Date.now() || Date.now() - session.createdAt > 24 * 60 * 60 * 1000) throw new CantonLedgerError('Sign in with GitHub again.', 401);
  if (session.user.login.toLowerCase() !== roleLogin(role)) throw new CantonLedgerError(`This GitHub account is not the configured ${role}.`, 403);
  const expectedOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (!expectedOrigin) throw new CantonLedgerError('Configure NEXT_PUBLIC_APP_URL.', 503);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(expectedOrigin).origin) throw new CantonLedgerError('Cross-origin ledger action rejected.', 403);
  return session;
}
export async function requireRepoAccess(repo: string, token: string, write: boolean) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new CantonLedgerError('Invalid repository.', 400);
  const response = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new CantonLedgerError('Your GitHub session cannot access this repository.', response.status === 401 ? 401 : 403);
  const repository = await response.json();
  if (write && !(repository.permissions?.push || repository.permissions?.maintain || repository.permissions?.admin)) throw new CantonLedgerError('Repository write/maintain permission is required.', 403);
}
export function canonicalBounty(c: CantonContract, input: Bounty): Bounty {
  const cfg = getCantonConfig();
  if (c.sponsor !== cfg.parties.sponsor.partyId || c.maintainer !== cfg.parties.maintainer.partyId || (c.contributor && c.contributor !== cfg.parties.contributor.partyId)) throw new CantonLedgerError('Bounty does not belong to the configured LocalNet parties.', 403);
  return { ...input, id: c.bountyId, repo: c.repository, issue: c.issueNumber, amount: c.amount, asset: 'MMT', sponsor: cfg.parties.sponsor, maintainer: cfg.parties.maintainer, contributor: c.contributor ? cfg.parties.contributor : undefined, status: c.status, criteria: c.acceptanceCriteria, approval: c.status === 'APPROVED' && c.submissionSha ? { sha: c.submissionSha, maintainerId: c.maintainer, approvedAt: c.createdAt } : undefined };
}
export async function checkRevision(c: CantonContract, input: Bounty, token: string, settling: boolean) {
  const pr = c.prNumber ?? input.submission?.number;
  const expected = settling ? c.submissionSha : input.submission?.sha;
  if (!pr || !Number.isSafeInteger(pr) || pr < 1 || !expected || !/^[a-f0-9]{40}$/.test(expected)) throw new CantonLedgerError('A valid linked PR and reviewed commit are required.', 400);
  const fresh = await getPullRequestAndEvidence(c.repository, pr, token);
  if (fresh.author?.toLowerCase() !== roleLogin('contributor')) throw new CantonLedgerError('The PR author must match the configured contributor account.', 403);
  if (fresh.sha !== expected) {
    // A detected change invalidates the ledger approval, not merely the browser state.
    await revision(c.bountyId, fresh.sha, pr);
    throw new RevisionConflict(fresh);
  }
  return fresh;
}
export async function authorizeMutation(request: Request, operation: 'fund' | 'claim' | 'approve' | 'settle', body: { bounty?: Bounty; bountyId?: string; contributor?: Party; maintainer?: Party; sha?: string }) {
  if (getCantonConfig().mode !== 'real') return body;
  const cfg = getCantonConfig();
  const role: Role = operation === 'fund' ? 'sponsor' : operation === 'claim' ? 'contributor' : 'maintainer';
  const session = requireActor(request, role);
  if (operation === 'fund') {
    const b = body.bounty;
    if (!b || !Array.isArray(b.criteria) || !b.criteria.length || b.criteria.some(x => typeof x !== 'string' || !x.trim()) || typeof b.id !== 'string' || !b.id || !Number.isSafeInteger(b.issue) || b.issue <= 0 || typeof b.amount !== 'string' || b.asset !== 'MMT') throw new CantonLedgerError('Invalid bounty funding terms.', 400);
    await requireRepoAccess(b.repo, session.token!, true);
    const issueResponse = await fetch(`https://api.github.com/repos/${b.repo}/issues/${b.issue}`, { headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!issueResponse.ok) throw new CantonLedgerError('Select an existing accessible GitHub issue before funding.', 400);
    const issue = await issueResponse.json();
    if (issue.pull_request || issue.state !== 'open' || issue.number !== b.issue) throw new CantonLedgerError('The selected item must be an open GitHub issue, not a pull request.', 400);
    return { ...body, bounty: { ...b, sponsor: cfg.parties.sponsor, maintainer: cfg.parties.maintainer } };
  }
  const id = operation === 'claim' ? body.bountyId : body.bounty?.id;
  if (!id || typeof id !== 'string') throw new CantonLedgerError('Bounty ID required.', 400);
  const c = await active(id);
  if (operation === 'claim') {
    await requireRepoAccess(c.repository, session.token!, false);
    if (c.sponsor !== cfg.parties.sponsor.partyId || c.maintainer !== cfg.parties.maintainer.partyId) throw new CantonLedgerError('Wrong LocalNet parties.', 403);
    return { ...body, contributor: cfg.parties.contributor };
  }
  const bounty = canonicalBounty(c, body.bounty!);
  await requireRepoAccess(c.repository, session.token!, true);
  if (operation === 'settle' && c.status !== 'APPROVED') throw new CantonLedgerError('Fresh maintainer approval is required.', 409);
  if (operation === 'approve' && body.sha !== body.bounty?.submission?.sha) throw new CantonLedgerError('Approval SHA must match the reviewed submission.', 409);
  const fresh = await checkRevision(c, body.bounty!, session.token!, operation === 'settle');
  return { ...body, bounty: { ...bounty, submission: fresh }, maintainer: cfg.parties.maintainer, sha: fresh.sha };
}
