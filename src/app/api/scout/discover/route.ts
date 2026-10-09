import { NextResponse } from 'next/server';
import { scoutEngine } from '@/integrations/ai/scout';
import { getSessionFromRequest } from '@/integrations/github/server/session';

import { getGitHubConfig } from '@/integrations/github/server/config';
import { requireRepoAccess } from '@/integrations/canton/server/authorization';

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
    if (getGitHubConfig().mode === 'real') {
      if (!session?.token) return NextResponse.json({ error: 'Sign in with GitHub.' }, { status: 401 });
      await requireRepoAccess(repo, session.token, false);
    }
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
