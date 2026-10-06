import type { Submission } from '@/domain/bounty';
import { mockGithub, mockRepositories, mockIssuesByRepo, delay } from './mock';
import { realGithub } from './real';
import type {
  GitHubAuthStatus,
  GitHubIntegration,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepo,
  GitHubUser,
} from './types';

export * from './types';
export * from './mapper';
export { mockRepositories, mockIssuesByRepo, delay };

class DelegatingGitHubIntegration implements GitHubIntegration {
  private currentMode: 'mock' | 'real' = 'mock';
  private modeResolved = false;

  getMode(): 'mock' | 'real' {
    return this.currentMode;
  }

  setMode(mode: 'mock' | 'real') {
    this.currentMode = mode;
    this.modeResolved = true;
  }

  async getAuthStatus(): Promise<GitHubAuthStatus> {
    try {
      const status = await realGithub.getAuthStatus();
      this.currentMode = status.mode;
      this.modeResolved = true;
      return status;
    } catch {
      this.currentMode = 'mock';
      this.modeResolved = true;
      return mockGithub.getAuthStatus();
    }
  }

  private async ensureMode(): Promise<'mock' | 'real'> {
    if (!this.modeResolved) {
      await this.getAuthStatus();
    }
    return this.currentMode;
  }

  async repositories(): Promise<string[]> {
    const mode = await this.ensureMode();
    return mode === 'real' ? realGithub.repositories() : mockGithub.repositories();
  }

  async getRepositories(): Promise<GitHubRepo[]> {
    const mode = await this.ensureMode();
    return mode === 'real' ? realGithub.getRepositories() : mockGithub.getRepositories();
  }

  async issues(repo: string): Promise<GitHubIssue[]> {
    const mode = await this.ensureMode();
    return mode === 'real' ? realGithub.issues(repo) : mockGithub.issues(repo);
  }

  async getIssues(repo: string): Promise<GitHubIssue[]> {
    const mode = await this.ensureMode();
    return mode === 'real' ? realGithub.getIssues(repo) : mockGithub.getIssues(repo);
  }

  async pullRequest(bountyId: string): Promise<Submission> {
    const mode = await this.ensureMode();
    return mode === 'real' ? realGithub.pullRequest(bountyId) : mockGithub.pullRequest(bountyId);
  }

  async getPullRequest(repo: string, prNumberOrUrl: string | number): Promise<Submission> {
    const mode = await this.ensureMode();
    return mode === 'real'
      ? realGithub.getPullRequest(repo, prNumberOrUrl)
      : mockGithub.getPullRequest(repo, prNumberOrUrl);
  }
}

export const github: GitHubIntegration = new DelegatingGitHubIntegration();
