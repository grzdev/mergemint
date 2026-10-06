import type { Submission, Check } from '@/domain/bounty';

export type GitHubRepo = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  visibility: 'Public' | 'Private';
  language: string;
  openIssuesCount: number;
  updatedAt: string;
  description: string;
  url: string;
};

export type GitHubIssue = {
  number: number;
  title: string;
  description: string;
  labels: string[];
  author: string;
  comments: number;
  updatedAt: string;
  url: string;
};

export type GitHubPullRequest = {
  number: number;
  title: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  mergeState: string;
  merged: boolean;
  review: string;
  url: string;
  checks: Check[];
};

export type GitHubUser = {
  login: string;
  name?: string;
  avatarUrl: string;
  htmlUrl?: string;
};

export type GitHubAuthStatus = {
  mode: 'mock' | 'real';
  configured: boolean;
  connected: boolean;
  user?: GitHubUser | null;
  installed: boolean;
  installUrl?: string;
  error?: string | null;
};

export interface GitHubIntegration {
  getMode(): 'mock' | 'real';
  getAuthStatus(): Promise<GitHubAuthStatus>;
  repositories(): Promise<string[]>;
  getRepositories(): Promise<GitHubRepo[]>;
  issues(repo: string): Promise<GitHubIssue[]>;
  getIssues(repo: string): Promise<GitHubIssue[]>;
  pullRequest(bountyId: string): Promise<Submission>;
  getPullRequest(repo: string, prNumberOrUrl: string | number): Promise<Submission>;
}

export const MOCK_REPOSITORIES = [
  'mergemint/core',
  'mergemint/sdk',
  'mergemint/docs',
] as const;

export function isMockRepo(repo: string | null | undefined): boolean {
  if (!repo) return false;
  const normalized = repo.trim().toLowerCase();
  return MOCK_REPOSITORIES.some(m => m.toLowerCase() === normalized);
}
