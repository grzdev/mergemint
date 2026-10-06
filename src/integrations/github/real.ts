import type { Submission } from '@/domain/bounty';
import type { GitHubAuthStatus, GitHubIntegration, GitHubIssue, GitHubRepo } from './types';

export class RealGitHubIntegration implements GitHubIntegration {
  getMode(): 'mock' | 'real' {
    return 'real';
  }

  async getAuthStatus(): Promise<GitHubAuthStatus> {
    try {
      const res = await fetch('/api/github/auth/status', { cache: 'no-store' });
      if (!res.ok) {
        return {
          mode: 'real',
          configured: false,
          connected: false,
          installed: false,
          error: `Server responded with ${res.status}`,
        };
      }
      return (await res.json()) as GitHubAuthStatus;
    } catch {
      return {
        mode: 'real',
        configured: false,
        connected: false,
        installed: false,
        error: 'Failed to contact server API',
      };
    }
  }

  async repositories(): Promise<string[]> {
    const repos = await this.getRepositories();
    return repos.map(r => r.fullName);
  }

  async getRepositories(): Promise<GitHubRepo[]> {
    const res = await fetch('/api/github/repositories', { cache: 'no-store' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to fetch repositories (${res.status})`);
    }
    const data = (await res.json()) as { repositories: GitHubRepo[] };
    return data.repositories || [];
  }

  async issues(repo: string): Promise<GitHubIssue[]> {
    return this.getIssues(repo);
  }

  async getIssues(repo: string): Promise<GitHubIssue[]> {
    if (!repo) return [];
    const res = await fetch(`/api/github/issues?repo=${encodeURIComponent(repo)}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to load issues for ${repo} (${res.status})`);
    }
    const data = (await res.json()) as { issues: GitHubIssue[] };
    return data.issues || [];
  }

  async pullRequest(bountyId: string): Promise<Submission> {
    throw new Error(
      `Direct lookup by bountyId (${bountyId}) is not supported in real mode. Use getPullRequest(repo, prNumber).`
    );
  }

  async getPullRequest(repo: string, prNumberOrUrl: string | number): Promise<Submission> {
    if (!repo) throw new Error('Repository is required to look up a pull request.');
    if (!prNumberOrUrl) throw new Error('Pull request number or URL is required.');

    const res = await fetch('/api/github/pull-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, pr: prNumberOrUrl }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to fetch pull request (${res.status})`);
    }

    const data = (await res.json()) as { submission: Submission };
    if (!data.submission) {
      throw new Error('Server returned an empty pull request submission.');
    }
    return data.submission;
  }
}

export const realGithub = new RealGitHubIntegration();
