import { getGitHubConfig } from './config';
import { createGitHubAppJwt } from './jwt';
import {
  filterAndMapGitHubIssues,
  mapCheckRunsAndStatuses,
  mapGitHubPullRequest,
  mapGitHubRepo,
} from '../mapper';
import type { GitHubIssue, GitHubRepo } from '../types';
import type { Submission } from '@/domain/bounty';

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<number, CachedToken>();

async function githubFetch(url: string, token: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('User-Agent', 'MergeMint-Bounty-Workflow');
  headers.set('X-GitHub-Api-Version', '2022-11-28');

  try {
    const res = await fetch(url, { ...options, headers, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    return res;
  } catch {
    throw new Error('Unable to connect to GitHub API. Please check your network connection.');
  }
}

/**
 * Obtain an installation access token for a given installation ID.
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }

  const cfg = getGitHubConfig();
  const jwt = createGitHubAppJwt(cfg.appId, cfg.privateKey);

  const res = await githubFetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    jwt,
    { method: 'POST' }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error(`GitHub App authentication failed (${res.status}): Please verify GITHUB_APP_ID and private key.`);
    }
    throw new Error(`GitHub App installation token request failed (${res.status}): ${errText.slice(0, 120)}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();
  tokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

/**
 * Returns all installations for the GitHub App.
 */
export async function getAllAppInstallations(): Promise<Array<{ id: number; account?: { login?: string } }>> {
  const cfg = getGitHubConfig();
  const jwt = createGitHubAppJwt(cfg.appId, cfg.privateKey);

  const res = await githubFetch('https://api.github.com/app/installations?per_page=100', jwt);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Invalid GitHub App credentials or App private key.');
    }
    return [];
  }
  return (await res.json()) as Array<{ id: number; account?: { login?: string } }>;
}

/**
 * Returns all installations accessible by the signed-in user.
 */
export async function getUserInstallations(userToken: string): Promise<Array<{ id: number; account?: { login?: string } }>> {
  const res = await githubFetch('https://api.github.com/user/installations?per_page=100', userToken);
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as { installations?: Array<{ id: number; account?: { login?: string } }> };
  return data.installations || [];
}

/**
 * Find an installation token that has access to owner/repo.
 */
export async function getTokenForRepo(owner: string, repo: string, userToken?: string): Promise<string> {
  const cfg = getGitHubConfig();

  // If user token is available, see if user installations cover it
  if (userToken) {
    try {
      const userInstalls = await getUserInstallations(userToken);
      for (const inst of userInstalls) {
        try {
          const token = await getInstallationToken(inst.id);
          const checkRes = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`, token);
          if (checkRes.ok) return token;
        } catch {
          // Continue to next installation
        }
      }
    } catch {
      // Ignore user installations check failure
    }
  }

  // Check all app installations
  if (cfg.appId && cfg.privateKey) {
    const allInstalls = await getAllAppInstallations();
    for (const inst of allInstalls) {
      try {
        const token = await getInstallationToken(inst.id);
        const checkRes = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`, token);
        if (checkRes.ok) return token;
      } catch {
        // Continue
      }
    }
  }

  // If user token exists, fall back to user token
  if (userToken) {
    return userToken;
  }

  throw new GitHubApiError(
    `Repository "${owner}/${repo}" is not accessible through your GitHub App installation. Ensure the repository is selected in your GitHub App installation settings.`,
    404
  );
}

/**
 * Fetches all repositories accessible through the GitHub App installations.
 */
export async function getAccessibleRepositories(userToken?: string): Promise<{
  installed: boolean;
  repositories: GitHubRepo[];
  installUrl: string;
}> {
  const cfg = getGitHubConfig();
  const installUrl = `https://github.com/apps/${cfg.appSlug}/installations/new`;

  let installations: Array<{ id: number }> = [];

  if (userToken) {
    installations = await getUserInstallations(userToken);
  }

  // If no user installations found or no user token, check App installations
  if (installations.length === 0 && cfg.appId && cfg.privateKey) {
    try {
      installations = await getAllAppInstallations();
    } catch {
      // Not configured or network error
    }
  }

  if (installations.length === 0) {
    return {
      installed: false,
      repositories: [],
      installUrl,
    };
  }

  const repoMap = new Map<number, GitHubRepo>();

  for (const inst of installations) {
    try {
      const token = await getInstallationToken(inst.id);
      const res = await githubFetch('https://api.github.com/installation/repositories?per_page=100', token);
      if (res.ok) {
        const data = (await res.json()) as { repositories?: Array<Record<string, unknown>> };
        if (Array.isArray(data.repositories)) {
          for (const raw of data.repositories) {
            const mapped = mapGitHubRepo(raw);
            repoMap.set(mapped.id, mapped);
          }
        }
      }
    } catch {
      // Continue to next installation
    }
  }

  return {
    installed: true,
    repositories: Array.from(repoMap.values()),
    installUrl,
  };
}

/**
 * Fetches open issues for a repository, strictly excluding pull requests.
 */
export async function getRepositoryIssues(
  fullName: string,
  userToken?: string
): Promise<GitHubIssue[]> {
  const parts = fullName.trim().split('/');
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    throw new GitHubApiError(`Invalid repository name "${fullName}". Expected format "owner/repo".`, 400);
  }
  const [owner, name] = parts.map(p => p.trim());

  const token = await getTokenForRepo(owner, name, userToken);
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${name}/issues?state=open&per_page=100`,
    token
  );

  if (res.status === 401) {
    throw new GitHubApiError('GitHub authentication failed or expired session. Please sign in again.', 401);
  }
  if (res.status === 404) {
    throw new GitHubApiError(`Repository "${fullName}" was not found or is not accessible.`, 404);
  }
  if (res.status === 403) {
    const isRateLimit = res.headers.get('x-ratelimit-remaining') === '0';
    if (isRateLimit) {
      throw new GitHubApiError('GitHub API rate limit exceeded. Please retry in a few moments.', 429);
    }
    throw new GitHubApiError(`Access forbidden for repository "${fullName}". Ensure the GitHub App has Issues (Read-only) permissions.`, 403);
  }
  if (res.status === 429) {
    throw new GitHubApiError('GitHub API rate limit exceeded. Please retry in a few moments.', 429);
  }
  if (!res.ok) {
    throw new GitHubApiError(`Failed to load issues from GitHub (HTTP ${res.status}).`, res.status >= 400 && res.status < 500 ? res.status : 500);
  }

  const data = (await res.json()) as unknown[];
  return filterAndMapGitHubIssues(data);
}

/**
 * Fetches a pull request and its associated check runs / commit statuses.
 */
export async function getPullRequestAndEvidence(
  fullName: string,
  prNumber: number,
  userToken?: string
): Promise<Submission> {
  const parts = fullName.trim().split('/');
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    throw new GitHubApiError(`Invalid repository name "${fullName}". Expected format "owner/repo".`, 400);
  }
  const [owner, name] = parts.map(p => p.trim());
  if (isNaN(prNumber) || prNumber <= 0) {
    throw new GitHubApiError('A valid positive pull request number is required.', 400);
  }

  const token = await getTokenForRepo(owner, name, userToken);

  // 1. Fetch Pull Request details
  const prRes = await githubFetch(`https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}`, token);
  if (prRes.status === 401) {
    throw new GitHubApiError('GitHub authentication failed or expired session.', 401);
  }
  if (prRes.status === 404) {
    throw new GitHubApiError(`Pull request #${prNumber} was not found in "${fullName}".`, 404);
  }
  if (prRes.status === 403) {
    const isRateLimit = prRes.headers.get('x-ratelimit-remaining') === '0';
    if (isRateLimit) {
      throw new GitHubApiError('GitHub API rate limit exceeded. Please retry in a few moments.', 429);
    }
    throw new GitHubApiError(`Access forbidden for pull request #${prNumber} in "${fullName}".`, 403);
  }
  if (prRes.status === 429) {
    throw new GitHubApiError('GitHub API rate limit exceeded. Please retry in a few moments.', 429);
  }
  if (!prRes.ok) {
    throw new GitHubApiError(`Failed to load pull request #${prNumber} from GitHub (HTTP ${prRes.status}).`, prRes.status >= 400 && prRes.status < 500 ? prRes.status : 500);
  }

  const prRaw = (await prRes.json()) as Record<string, unknown>;
  const head = (prRaw.head as Record<string, unknown>) || {};
  const sha = String(head.sha || '');

  if (!sha) {
    throw new Error(`Pull request #${prNumber} does not report a valid head commit SHA.`);
  }

  // 2. Fetch Check Runs for head SHA
  let checkRuns: unknown[] = [];
  try {
    const checksRes = await githubFetch(
      `https://api.github.com/repos/${owner}/${name}/commits/${sha}/check-runs?per_page=100`,
      token
    );
    if (checksRes.ok) {
      const checksData = (await checksRes.json()) as { check_runs?: unknown[] };
      checkRuns = checksData.check_runs || [];
    }
  } catch {
    // If checks API fails or is not enabled, continue to status API
  }

  // 3. Fetch Commit Statuses for head SHA
  let statuses: unknown[] = [];
  try {
    const statusRes = await githubFetch(
      `https://api.github.com/repos/${owner}/${name}/commits/${sha}/status`,
      token
    );
    if (statusRes.ok) {
      const statusData = (await statusRes.json()) as { statuses?: unknown[] };
      statuses = statusData.statuses || [];
    }
  } catch {
    // Ignore
  }

  const mappedChecks = mapCheckRunsAndStatuses(checkRuns, statuses);
  return mapGitHubPullRequest(prRaw, mappedChecks);
}
