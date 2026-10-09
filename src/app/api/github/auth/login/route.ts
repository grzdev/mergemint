import { NextResponse } from 'next/server';
import { getGitHubConfig, isGitHubConfigured } from '@/integrations/github/server/config';
import { createRandomState, OAUTH_STATE_COOKIE_NAME } from '@/integrations/github/server/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cfg = getGitHubConfig();

  if (!isGitHubConfigured()) {
    const url = new URL('/', request.url);
    url.searchParams.set('github_error', 'config_missing');
    return NextResponse.redirect(url);
  }

  const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
  if ((request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host) !== new URL(appOrigin).host) {
    return NextResponse.redirect(new URL('/api/github/auth/login', appOrigin));
  }
  const state = createRandomState();
  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('redirect_uri', new URL('/api/github/auth/callback', appOrigin).toString());
  authUrl.searchParams.set('scope', 'read:user');

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  return response;
}


