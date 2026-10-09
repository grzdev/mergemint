import { NextResponse } from 'next/server';
import { getGitHubConfig, isGitHubConfigured } from '@/integrations/github/server/config';
import { getSessionFromRequest } from '@/integrations/github/server/session';
import { getPullRequestAndEvidence, GitHubApiError } from '@/integrations/github/server/client';
import { mockGithub } from '@/integrations/github/mock';

export const dynamic = 'force-dynamic';

export function parsePrInput(repoInput: string, prInput: string | number): { repo: string; prNumber: number } {
  let targetRepo = repoInput.trim();
  let prNumber = 0;

  if (typeof prInput === 'number') {
    prNumber = prInput;
  } else {
    const raw = String(prInput).trim();
    // Check if it's a full GitHub PR URL: https://github.com/owner/name/pull/123
    const urlMatch = raw.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
    if (urlMatch) {
      targetRepo = `${urlMatch[1]}/${urlMatch[2]}`;
      prNumber = parseInt(urlMatch[3], 10);
    } else {
      // Strips leading '#' or non-digits
      const digits = raw.replace(/[^0-9]/g, '');
      prNumber = parseInt(digits, 10);
    }
  }

  return { repo: targetRepo, prNumber };
}

export async function POST(request: Request) {
  let body: { repo?: string; pr?: string | number } = {};
  try {
    body = (await request.json()) as { repo?: string; pr?: string | number };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const { repo: repoParam, pr: prParam } = body;
  if (!repoParam && !prParam) {
    return NextResponse.json(
      { error: 'Both "repo" and "pr" (number or URL) are required.' },
      { status: 400 }
    );
  }

  const { repo, prNumber } = parsePrInput(repoParam || '', prParam || '');
  if (!repo || !repo.includes('/')) {
    return NextResponse.json(
      { error: `Invalid repository "${repo}". Expected format "owner/repo".` },
      { status: 400 }
    );
  }
  if (isNaN(prNumber) || prNumber <= 0) {
    return NextResponse.json(
      { error: 'Could not parse a valid pull request number from input.' },
      { status: 400 }
    );
  }

  const cfg = getGitHubConfig();

  if (cfg.mode === 'mock') {
    const submission = await mockGithub.getPullRequest(repo, prNumber);
    return NextResponse.json({ mode: 'mock', submission });
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
    const submission = await getPullRequestAndEvidence(repo, prNumber, session?.token);
    return NextResponse.json({ mode: 'real', submission });
  } catch (err) {
    if (err instanceof GitHubApiError) {
      console.error(`[GitHub Pull Request API] ${err.status} - ${err.message}`);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to fetch pull request from GitHub.';
    console.error('[GitHub Pull Request API] 500 -', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
