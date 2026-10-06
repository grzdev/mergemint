import { NextResponse } from 'next/server';
import type { Party } from '@/domain/bounty';
import { CantonLedgerError, claimBountyOnLedger } from '@/integrations/canton/server/client';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      bountyId?: string;
      contributor?: Party;
    };

    if (!body.bountyId) {
      return NextResponse.json({ error: 'bountyId is required to claim a bounty.' }, { status: 400 });
    }
    if (!body.contributor || !body.contributor.partyId) {
      return NextResponse.json(
        { error: 'contributor with valid partyId is required to claim a bounty.' },
        { status: 400 }
      );
    }

    const result = await claimBountyOnLedger(body.bountyId, body.contributor);
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof CantonLedgerError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to claim bounty on Canton.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
