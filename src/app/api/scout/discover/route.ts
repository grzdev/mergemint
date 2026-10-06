import { NextResponse } from 'next/server';
import { scoutEngine } from '@/integrations/ai/scout';
import { getSessionFromRequest } from '@/integrations/github/server/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { repo?: string; existingIssueCount?: number };
    const repo = (body.repo || '').trim();

    if (!repo) {
      return NextResponse.json(
        { error: 'Repository name is required for Scout analysis.' },
        { status: 400 }
      );
    }

    const session = getSessionFromRequest(req);
    const result = await scoutEngine.discover(repo, body.existingIssueCount ?? 0, session?.token);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Scout analysis failed: ${message}` },
      { status: 500 }
    );
  }
}
