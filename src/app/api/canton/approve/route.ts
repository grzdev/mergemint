import { authorizeMutation, RevisionConflict } from '@/integrations/canton/server/authorization';
import { NextResponse } from 'next/server';
import type { Bounty, Party } from '@/domain/bounty';
import { CantonLedgerError, approveBountyOnLedger } from '@/integrations/canton/server/client';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    let body = (await request.json().catch(() => ({}))) as {
      bounty?: Bounty;
      sha?: string;
      maintainer?: Party;
    };


    body = await authorizeMutation(request, 'approve', body);
    if (!body.bounty || !body.bounty.id) {
      return NextResponse.json({ error: 'Valid bounty object is required for approval.' }, { status: 400 });
    }
    if (!body.sha) {
      return NextResponse.json({ error: 'Git commit sha is required for approval.' }, { status: 400 });
    }
    if (!body.maintainer || !body.maintainer.partyId) {
      return NextResponse.json(
        { error: 'maintainer with valid partyId is required for approval.' },
        { status: 400 }
      );
    }

    const result = await approveBountyOnLedger(body.bounty, body.sha, body.maintainer);
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof RevisionConflict) return NextResponse.json({ error: err.message, submission: err.submission, code: 'REVISION_CHANGED' }, { status: 409 });
    if (err instanceof CantonLedgerError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Failed to record approval on Canton.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
