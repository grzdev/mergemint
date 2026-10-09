import { authorizeMutation, RevisionConflict } from '@/integrations/canton/server/authorization';
import { NextResponse } from 'next/server';
import type { Bounty } from '@/domain/bounty';
import { CantonLedgerError, settleBountyOnLedger } from '@/integrations/canton/server/client';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    let body = (await request.json().catch(() => ({}))) as {
      bounty?: Bounty;
      simulateFailure?: boolean;
    };


    body = await authorizeMutation(request, 'settle', body);
    if (!body.bounty || !body.bounty.id) {
      return NextResponse.json({ error: 'Valid bounty object is required for settlement.' }, { status: 400 });
    }

    const result = await settleBountyOnLedger(body.bounty, body.simulateFailure);
    return NextResponse.json({
      reference: result.reference,
      receiptId: result.contractId,
      transactionId: result.transactionId,
      timestamp: result.timestamp,
      tokenHoldingId: result.tokenHoldingId,
      tokenTransferId: result.tokenTransferId,
      tokenRecipientHoldingId: result.tokenRecipientHoldingId,
    });
  } catch (err) {
    if (err instanceof RevisionConflict) return NextResponse.json({ error: err.message, submission: err.submission, code: 'REVISION_CHANGED' }, { status: 409 });
    if (err instanceof CantonLedgerError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to settle bounty on Canton.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
