import { NextResponse } from 'next/server';
import { getGitHubConfig } from '@/integrations/github/server/config';
import {
  encryptSession,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type UserSession,
} from '@/integrations/github/server/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const redirectHome = (errCode?: string) => {
    const homeUrl = new URL('/', process.env.NEXT_PUBLIC_APP_URL || request.url);
    if (errCode) {
      homeUrl.searchParams.set('github_error', errCode);
    }
    return homeUrl.toString();
  };

  if (error) {
    return NextResponse.redirect(redirectHome(error === 'access_denied' ? 'access_denied' : 'auth_failed'));
  }

  // Validate state
  const cookieHeader = request.headers.get('cookie') || '';
  const storedState = cookieHeader
    .split(';')
    .find(c => c.trim().startsWith(`${OAUTH_STATE_COOKIE_NAME}=`))
    ?.split('=')[1];


  const stateMatches = Boolean(state && storedState && decodeURIComponent(storedState.trim()) === state);

  if (!stateMatches) {
    return NextResponse.redirect(redirectHome('csrf_state_mismatch'));
  }

  if (!code) {
    return NextResponse.redirect(redirectHome('missing_code'));
  }

  const cfg = getGitHubConfig();

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        state,
        redirect_uri: new URL('/api/github/auth/callback', process.env.NEXT_PUBLIC_APP_URL || request.url).toString(),
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(redirectHome('token_exchange_failed'));
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      return NextResponse.redirect(redirectHome(tokenData.error || 'token_exchange_rejected'));
    }

    const accessToken = tokenData.access_token;

    // Fetch user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'MergeMint-Bounty-Workflow',
      },
    });

    if (!userRes.ok) {
      return NextResponse.redirect(redirectHome('user_fetch_failed'));
    }

    const userData = (await userRes.json()) as {
      login: string;
      name?: string;
      avatar_url?: string;
      html_url?: string;
    };

    const session: UserSession = {
      user: {
        login: userData.login,
        name: userData.name || undefined,
        avatarUrl: userData.avatar_url || '',
        htmlUrl: userData.html_url || '',
      },
      token: accessToken,
      createdAt: Date.now(),
    };

    const encryptedCookie = encryptSession(session, cfg.sessionSecret);

    const response = NextResponse.redirect(redirectHome());
    response.cookies.set(SESSION_COOKIE_NAME, encryptedCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });
    // Clear state cookie
    response.cookies.set(OAUTH_STATE_COOKIE_NAME, '', {
      httpOnly: true,
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch {
    return NextResponse.redirect(redirectHome('server_error'));
  }
}
