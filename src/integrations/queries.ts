'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { github, type GitHubAuthStatus, type GitHubRepo, type GitHubIssue, type GitHubPullRequest, isMockRepo } from '@/integrations/github';
import { canton, type CantonStatus, type CantonContract, type CantonTransactionResult } from '@/integrations/canton';
import type { Bounty, Party } from '@/domain/bounty';

export const QUERY_KEYS = {
  githubAuth: ['github', 'auth'] as const,
  githubRepos: ['github', 'repos'] as const,
  githubIssues: (repo: string) => ['github', 'issues', repo] as const,
  githubPr: (repo: string, prNumber: number | string) => ['github', 'pr', repo, String(prNumber)] as const,
  cantonStatus: ['canton', 'status'] as const,
  cantonBounties: ['canton', 'bounties'] as const,
};

/**
 * Server-state hook for GitHub Authentication and Installation status
 */
export function useGitHubAuth() {
  return useQuery<GitHubAuthStatus>({
    queryKey: QUERY_KEYS.githubAuth,
    queryFn: () => github.getAuthStatus(),
    staleTime: 60 * 1000,
  });
}

/**
 * Server-state hook for GitHub Accessible Repositories
 */
export function useGitHubRepositories() {
  return useQuery<GitHubRepo[]>({
    queryKey: QUERY_KEYS.githubRepos,
    queryFn: () => github.getRepositories(),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Server-state hook for GitHub Issues scoped to an active repository
 */
export function useGitHubIssues(repo: string, enabled = true) {
  return useQuery<GitHubIssue[]>({
    queryKey: QUERY_KEYS.githubIssues(repo),
    queryFn: () => github.getIssues(repo),
    enabled: Boolean(repo && enabled && (!isMockRepo(repo) || repo.startsWith('mergemint/'))),
    staleTime: 60 * 1000,
  });
}

/**
 * Server-state hook for Canton Participant status
 */
export function useCantonStatus() {
  return useQuery<CantonStatus>({
    queryKey: QUERY_KEYS.cantonStatus,
    queryFn: () => canton.getStatus(),
    staleTime: 30 * 1000,
  });
}

/**
 * Server-state hook for Canton active on-ledger contracts (ACS)
 */
export function useCantonBounties() {
  return useQuery<CantonContract[]>({
    queryKey: QUERY_KEYS.cantonBounties,
    queryFn: () => canton.getActiveBounties(),
    staleTime: 30 * 1000,
  });
}

/**
 * On-chain Canton Mutations with automatic query cache invalidation
 */
export function useCantonMutations() {
  const queryClient = useQueryClient();

  const invalidateCanton = () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cantonBounties });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cantonStatus });
  };

  const fundMutation = useMutation({
    mutationFn: (draft: Bounty) => canton.fund(draft),
    onSuccess: invalidateCanton,
  });

  const claimMutation = useMutation({
    mutationFn: ({ bountyId, contributor }: { bountyId: string; contributor: Party }) =>
      canton.claim(bountyId, contributor),
    onSuccess: invalidateCanton,
  });

  const approveMutation = useMutation({
    mutationFn: ({ bounty, sha, maintainer }: { bounty: Bounty; sha: string; maintainer: Party }) =>
      canton.approve(bounty, sha, maintainer),
    onSuccess: invalidateCanton,
  });

  const settleMutation = useMutation({
    mutationFn: ({ bounty, simulateFailure }: { bounty: Bounty; simulateFailure?: boolean }) =>
      canton.settle(bounty, simulateFailure),
    onSuccess: invalidateCanton,
  });

  return {
    fundMutation,
    claimMutation,
    approveMutation,
    settleMutation,
    invalidateCanton,
  };
}
