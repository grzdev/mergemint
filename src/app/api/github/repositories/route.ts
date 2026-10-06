import { NextResponse } from 'next/server';
import { getGitHubConfig, isGitHubConfigured } from '@/integrations/github/server/config';
import { getSessionFromRequest } from '@/integrations/github/server/session';
import { getAccessibleRepositories, GitHubApiError } from '@/integrations/github/server/client';
import { mockRepositories } from '@/integrations/github/mock';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cfg = getGitHubConfig();

  if (cfg.mode === 'mock') {
    return NextResponse.json({
      mode: 'mock',
      installed: true,
      repositories: mockRepositories,
    });
  }

  if (!isGitHubConfigured()) {
    return NextResponse.json(
      {
        error:
          'GitHub App credentials missing. Configure GITHUB_APP_ID, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and GITHUB_PRIVATE_KEY.',
      },
      { status: 500 }
    );
  }

  const session = getSessionFromRequest(request);

  try {
    const result = await getAccessibleRepositories(session?.token);
    return NextResponse.json({
      mode: 'real',
      installed: result.installed,
      installUrl: result.installUrl,
      repositories: result.repositories,
    });
  } catch (err) {
    if (err instanceof GitHubApiError) {
      console.error(`[GitHub Repositories API] ${err.status} - ${err.message}`);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to fetch repositories from GitHub.';
    console.error('[GitHub Repositories API] 500 -', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
