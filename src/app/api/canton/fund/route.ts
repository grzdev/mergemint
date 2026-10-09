import { authorizeMutation, RevisionConflict } from '@/integrations/canton/server/authorization';
import { NextResponse } from 'next/server';
import type { Bounty } from '@/domain/bounty';
import { CantonLedgerError, fundBountyOnLedger } from '@/integrations/canton/server/client';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    let body = (await request.json().catch(() => ({}))) as { bounty?: Bounty };

    body = await authorizeMutation(request, 'fund', body);
    if (!body.bounty || !body.bounty.id || !body.bounty.amount) {
      return NextResponse.json(
        { error: 'Valid bounty object with id and amount is required.' },
        { status: 400 }
      );
    }

    const result = await fundBountyOnLedger(body.bounty);
    return NextResponse.json({
      contractId: result.contractId,
      transactionId: result.transactionId,
      reference: result.reference,
      timestamp: result.timestamp,
      tokenHoldingId: result.tokenHoldingId,
    });
  } catch (err) {
    if (err instanceof RevisionConflict) return NextResponse.json({ error: err.message, submission: err.submission, code: 'REVISION_CHANGED' }, { status: 409 });
    if (err instanceof CantonLedgerError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to fund bounty on Canton.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
