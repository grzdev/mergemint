import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME } from '@/integrations/github/server/session';

export const dynamic = 'force-dynamic';

function clearSessionCookies(response: NextResponse) {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  };

  response.cookies.set(SESSION_COOKIE_NAME, '', cookieOptions);
  response.cookies.set(OAUTH_STATE_COOKIE_NAME, '', cookieOptions);
  return response;
}

export async function POST() {
  const response = NextResponse.json({ success: true, connected: false });
  return clearSessionCookies(response);
}

export async function GET(request: Request) {
  const homeUrl = new URL('/', process.env.NEXT_PUBLIC_APP_URL || request.url);
  homeUrl.searchParams.set('signed_out', '1');
  const response = NextResponse.redirect(homeUrl.toString());
  return clearSessionCookies(response);
}
