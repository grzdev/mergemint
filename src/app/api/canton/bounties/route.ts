import { NextResponse } from 'next/server';
import { getActiveLedgerBounties } from '@/integrations/canton/server/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const bounties = await getActiveLedgerBounties();
    return NextResponse.json({ bounties, connected: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve active Canton bounties.';
    return NextResponse.json(
      { bounties: [], error: message, connected: false },
      { status: 503 }
    );
  }
}
