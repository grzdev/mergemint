import { NextResponse } from 'next/server';
import type { Bounty } from '@/domain/bounty';
import { CantonLedgerError, settleBountyOnLedger } from '@/integrations/canton/server/client';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      bounty?: Bounty;
      simulateFailure?: boolean;
    };

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
    });
  } catch (err) {
    if (err instanceof CantonLedgerError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to settle bounty on Canton.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
