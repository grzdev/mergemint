import type { Check, Submission } from '@/domain/bounty';
import type { GitHubIssue, GitHubRepo } from './types';

export function formatRelativeTime(dateInput: string | Date | undefined): string {
  if (!dateInput) return 'Recently';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return 'Recently';

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function mapGitHubRepo(raw: Record<string, unknown>): GitHubRepo {
  const owner =
    typeof raw.owner === 'object' && raw.owner !== null
      ? String((raw.owner as Record<string, unknown>).login ?? '')
      : String(raw.owner ?? '');

  return {
    id: typeof raw.id === 'number' ? raw.id : 0,
    fullName: String(raw.full_name ?? `${owner}/${raw.name ?? ''}`),
    name: String(raw.name ?? ''),
    owner,
    visibility: raw.private ? 'Private' : 'Public',
    language: String(raw.language || 'Plain Text'),
    openIssuesCount: typeof raw.open_issues_count === 'number' ? raw.open_issues_count : 0,
    updatedAt: formatRelativeTime(raw.updated_at as string),
    description: String(raw.description || 'No description provided.'),
    url: String(raw.html_url || ''),
  };
}

export function isIssue(item: Record<string, unknown>): boolean {
  // GitHub REST API returns pull requests in the issues endpoint with a "pull_request" object.
  // Entries containing the pull_request field MUST be excluded so only actual issues remain.
  return item !== null && typeof item === 'object' && !('pull_request' in item && item.pull_request);
}

export function mapGitHubIssue(item: Record<string, unknown>): GitHubIssue {
  const author =
    typeof item.user === 'object' && item.user !== null
      ? String((item.user as Record<string, unknown>).login ?? 'unknown')
      : 'unknown';

  const labels = Array.isArray(item.labels)
    ? item.labels
        .map(l => {
          if (typeof l === 'string') return l;
          if (typeof l === 'object' && l !== null && 'name' in l) {
            return String((l as Record<string, unknown>).name);
          }
          return '';
        })
        .filter(Boolean)
    : [];

  return {
    number: typeof item.number === 'number' ? item.number : 0,
    title: String(item.title || ''),
    description: String(item.body || 'No description provided.'),
    labels,
    author,
    comments: typeof item.comments === 'number' ? item.comments : 0,
    updatedAt: formatRelativeTime(item.updated_at as string),
    url: String(item.html_url || ''),
  };
}

export function filterAndMapGitHubIssues(rawItems: unknown[]): GitHubIssue[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter(isIssue)
    .map(mapGitHubIssue);
}

export function mapCheckRunsAndStatuses(
  checkRunsRaw: unknown[],
  statusesRaw: unknown[]
): Check[] {
  const checks: Check[] = [];

  if (Array.isArray(checkRunsRaw)) {
    for (const raw of checkRunsRaw) {
      if (typeof raw !== 'object' || raw === null) continue;
      const run = raw as Record<string, unknown>;
      const name = String(run.name || 'unnamed-check');
      const conclusion = run.conclusion ? String(run.conclusion) : null;
      const status = String(run.status || 'in_progress');
      const url = run.html_url ? String(run.html_url) : undefined;

      let state: Check['state'] = 'pending';
      if (conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped') {
        state = 'passed';
      } else if (
        conclusion === 'failure' ||
        conclusion === 'timed_out' ||
        conclusion === 'action_required' ||
        conclusion === 'cancelled'
      ) {
        state = 'failed';
      } else if (status === 'completed' && !conclusion) {
        state = 'passed';
      }

      checks.push({
        name,
        state,
        conclusion: conclusion || status,
        url,
      });
    }
  }

  if (Array.isArray(statusesRaw)) {
    for (const raw of statusesRaw) {
      if (typeof raw !== 'object' || raw === null) continue;
      const st = raw as Record<string, unknown>;
      const name = String(st.context || 'status-check');
      const rawState = String(st.state || 'pending');
      const url = st.target_url ? String(st.target_url) : undefined;

      let state: Check['state'] = 'pending';
      if (rawState === 'success') {
        state = 'passed';
      } else if (rawState === 'failure' || rawState === 'error') {
        state = 'failed';
      }

      checks.push({
        name,
        state,
        conclusion: rawState,
        url,
      });
    }
  }

  return checks;
}

export function mapGitHubPullRequest(
  prRaw: Record<string, unknown>,
  checks: Check[] = []
): Submission {
  const head = (typeof prRaw.head === 'object' && prRaw.head !== null
    ? prRaw.head
    : {}) as Record<string, unknown>;
  const base = (typeof prRaw.base === 'object' && prRaw.base !== null
    ? prRaw.base
    : {}) as Record<string, unknown>;
  const user = (typeof prRaw.user === 'object' && prRaw.user !== null
    ? prRaw.user
    : {}) as Record<string, unknown>;

  const merged = Boolean(prRaw.merged);
  let review = 'Awaiting review';
  if (merged) {
    review = 'Merged into main';
  } else if (prRaw.draft) {
    review = 'Draft pull request';
  }

  return {
    number: typeof prRaw.number === 'number' ? prRaw.number : 0,
    title: String(prRaw.title || ''),
    branch: String(head.ref || 'feature-branch'),
    sha: String(head.sha || ''),
    merged,
    review,
    checks,
    author: String(user.login || 'contributor'),
    baseBranch: String(base.ref || 'main'),
    headBranch: String(head.ref || 'feature-branch'),
    url: String(prRaw.html_url || ''),
    mergeState: String(prRaw.mergeable_state || (merged ? 'merged' : 'clean')),
  };
}
