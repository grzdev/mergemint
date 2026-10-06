import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/integrations/github/server/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ success: true, connected: false });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
  return response;
}
