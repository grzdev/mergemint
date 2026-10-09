import { NextResponse } from 'next/server';
import { getGitHubConfig, isGitHubConfigured } from '@/integrations/github/server/config';
import { getSessionFromRequest } from '@/integrations/github/server/session';
import { getRepositoryIssues, GitHubApiError } from '@/integrations/github/server/client';
import { mockGithub } from '@/integrations/github/mock';
import { isMockRepo } from '@/integrations/github/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const repoParam = url.searchParams.get('repo');

  if (!repoParam || !repoParam.trim()) {
    return NextResponse.json({ error: 'Query parameter "repo" is required.' }, { status: 400 });
  }

  const repo = repoParam.trim();
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    return NextResponse.json(
      { error: `Invalid repository "${repo}". Expected format "owner/repo".` },
      { status: 400 }
    );
  }

  const cfg = getGitHubConfig();

  if (cfg.mode === 'mock') {
    const issues = await mockGithub.getIssues(repo);
    return NextResponse.json({ mode: 'mock', issues, repository: repo });
  }

  // Real GitHub mode:
  // If a mock repository (e.g. mergemint/core) is requested, reject it gracefully as not accessible
  if (isMockRepo(repo)) {
    return NextResponse.json(
      {
        error: `Repository "${repo}" is a mock demo repository and cannot be queried in real GitHub mode.`,
      },
      { status: 404 }
    );
  }

  if (!isGitHubConfigured()) {
    return NextResponse.json(
      { error: 'GitHub App is not configured on the server.' },
      { status: 500 }
    );
  }

  const session = getSessionFromRequest(request);
  if (!session?.token) return NextResponse.json({ error: "Sign in with GitHub." }, { status: 401 });

  try {
    const issues = await getRepositoryIssues(repo, session?.token);
    return NextResponse.json({ mode: 'real', issues, repository: repo });
  } catch (err) {
    if (err instanceof GitHubApiError) {
      console.error(`[GitHub Issues API] ${err.status} - ${err.message}`);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to fetch issues from GitHub.';
    console.error('[GitHub Issues API] 500 -', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

