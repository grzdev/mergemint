import { NextResponse } from 'next/server';
import { getCantonStatus } from '@/integrations/canton/server/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getCantonStatus();
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve Canton status.';
    return NextResponse.json({ error: message, connected: false }, { status: 500 });
  }
}
