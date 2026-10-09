import { NextResponse } from 'next/server';
import { getGitHubConfig, isGitHubConfigured } from '@/integrations/github/server/config';
import { getSessionFromRequest } from '@/integrations/github/server/session';
import { getAccessibleRepositories } from '@/integrations/github/server/client';
import type { GitHubAuthStatus } from '@/integrations/github/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cfg = getGitHubConfig();

  if (cfg.mode === 'mock') {
    const status: GitHubAuthStatus = {
      mode: 'mock',
      configured: true,
      connected: true,
      user: {
        login: 'alexmorgan',
        name: 'Alex Morgan',
        avatarUrl: '',
        htmlUrl: 'https://github.com/alexmorgan',
      },
      installed: true,
    };
    return NextResponse.json(status);
  }

  // Real GitHub mode
  if (!isGitHubConfigured()) {
    const status: GitHubAuthStatus = {
      mode: 'real',
      configured: false,
      connected: false,
      installed: false,
      error:
        'GitHub App configuration missing. Required: GITHUB_APP_ID, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and GITHUB_PRIVATE_KEY.',
    };
    return NextResponse.json(status);
  }

  const session = getSessionFromRequest(request);
  const installUrl = `https://github.com/apps/${cfg.appSlug}/installations/new`;

  if (!session?.token) return NextResponse.json({ mode: 'real', configured: true, connected: false, user: null, installed: false, installUrl });

  let installed = false;
  try {
    const repoInfo = await getAccessibleRepositories(session?.token);
    installed = repoInfo.installed;
  } catch {
    // If checking installations fails, still report connection state
  }

  const status: GitHubAuthStatus = {
    mode: 'real',
    configured: true,
    connected: Boolean(session?.user),
    user: session?.user || null,
    installed,
    installUrl,
  };

  return NextResponse.json(status);
}
