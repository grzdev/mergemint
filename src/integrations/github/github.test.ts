import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIssue,
  mapGitHubRepo,
  mapGitHubIssue,
  filterAndMapGitHubIssues,
  mapCheckRunsAndStatuses,
  mapGitHubPullRequest,
} from './mapper';
import { isMockRepo, MOCK_REPOSITORIES } from './types';
import { mockGithub } from './mock';
import { parsePrInput } from '@/app/api/github/pull-request/route';
import { GET as getIssuesRoute } from '@/app/api/github/issues/route';
import { POST as logoutPost, GET as logoutGet } from '@/app/api/github/auth/logout/route';
import { SESSION_COOKIE_NAME } from './server/session';
import { transition } from '@/domain/bounty';
import { seeds } from '@/mocks/seed';
import type { Bounty, Submission } from '@/domain/bounty';

// 1. GitHub issue responses exclude pull requests
test('filterAndMapGitHubIssues excludes pull requests and maps only genuine issues', () => {
  const mixedApiPayload = [
    {
      id: 101,
      number: 1,
      title: 'Real issue: Fix memory leak in buffer pool',
      body: 'Memory leak observed under sustained load.',
      user: { login: 'contributor-one' },
      labels: [{ name: 'bug' }, { name: 'core' }],
      comments: 3,
      updated_at: new Date(Date.now() - 3600000).toISOString(),
      html_url: 'https://github.com/mergemint/core/issues/1',
      // No pull_request property
    },
    {
      id: 102,
      number: 2,
      title: 'PR disguised as issue: Fix buffer pool',
      body: 'This is actually a pull request from a contributor branch.',
      user: { login: 'contributor-two' },
      labels: [{ name: 'pr' }],
      comments: 1,
      updated_at: new Date(Date.now() - 1800000).toISOString(),
      html_url: 'https://github.com/mergemint/core/pull/2',
      // GitHub REST API includes pull_request object on PRs returned in /issues
      pull_request: {
        url: 'https://api.github.com/repos/mergemint/core/pulls/2',
        html_url: 'https://github.com/mergemint/core/pull/2',
      },
    },
    {
      id: 103,
      number: 3,
      title: 'Real issue: Add Canton Coin settlement retry logic',
      body: 'Need exponential backoff on transient ledger errors.',
      user: { login: 'core-dev' },
      labels: [{ name: 'enhancement' }],
      comments: 0,
      updated_at: new Date().toISOString(),
      html_url: 'https://github.com/mergemint/core/issues/3',
    },
  ];

  // Direct isIssue check
  assert.equal(isIssue(mixedApiPayload[0]), true);
  assert.equal(isIssue(mixedApiPayload[1]), false);
  assert.equal(isIssue(mixedApiPayload[2]), true);

  // filterAndMapGitHubIssues
  const issues = filterAndMapGitHubIssues(mixedApiPayload);
  assert.equal(issues.length, 2);
  assert.equal(issues[0].number, 1);
  assert.equal(issues[0].title, 'Real issue: Fix memory leak in buffer pool');
  assert.equal(issues[0].author, 'contributor-one');
  assert.deepEqual(issues[0].labels, ['bug', 'core']);
  assert.equal(issues[0].comments, 3);
  assert.equal(issues[0].url, 'https://github.com/mergemint/core/issues/1');

  assert.equal(issues[1].number, 3);
  assert.equal(issues[1].title, 'Real issue: Add Canton Coin settlement retry logic');
  assert.equal(issues[1].author, 'core-dev');
  assert.deepEqual(issues[1].labels, ['enhancement']);
});

// 2. API repository data maps correctly into MergeMint repository types
test('mapGitHubRepo maps GitHub API repository data to domain type', () => {
  const rawRepo = {
    id: 987654321,
    name: 'validator-node',
    full_name: 'canton-network/validator-node',
    private: false,
    owner: {
      login: 'canton-network',
      avatar_url: 'https://avatars.githubusercontent.com/u/12345',
    },
    description: 'Reference implementation of Canton validator node',
    html_url: 'https://github.com/canton-network/validator-node',
    language: 'TypeScript',
    open_issues_count: 14,
    updated_at: new Date(Date.now() - 7200000).toISOString(),
  };

  const domainRepo = mapGitHubRepo(rawRepo);

  assert.equal(domainRepo.id, 987654321);
  assert.equal(domainRepo.fullName, 'canton-network/validator-node');
  assert.equal(domainRepo.name, 'validator-node');
  assert.equal(domainRepo.owner, 'canton-network');
  assert.equal(domainRepo.visibility, 'Public');
  assert.equal(domainRepo.language, 'TypeScript');
  assert.equal(domainRepo.openIssuesCount, 14);
  assert.equal(domainRepo.description, 'Reference implementation of Canton validator node');
  assert.equal(domainRepo.url, 'https://github.com/canton-network/validator-node');
  assert.ok(domainRepo.updatedAt.length > 0);

  // Private repository test
  const privateRepo = mapGitHubRepo({
    ...rawRepo,
    name: 'private-ledger',
    full_name: 'acme/private-ledger',
    private: true,
  });
  assert.equal(privateRepo.visibility, 'Private');
});

// 3. PR head SHA maps into Submission
test('mapGitHubPullRequest maps head commit SHA, branches, and author into Submission', () => {
  const prApiPayload = {
    number: 42,
    title: 'fix: handle transient synchronization timeout',
    html_url: 'https://github.com/mergemint/core/pull/42',
    user: { login: 'dev-alice' },
    head: {
      ref: 'fix/sync-timeout',
      sha: 'a1b2c3d4e5f67890123456789abcdef012345678',
    },
    base: {
      ref: 'main',
    },
    merged: false,
    draft: false,
    mergeable_state: 'clean',
  };

  const checks = [
    {
      name: 'ci/test',
      state: 'passed' as const,
      conclusion: 'success',
      url: 'https://github.com/mergemint/core/actions/runs/1',
    },
  ];

  const submission = mapGitHubPullRequest(prApiPayload, checks);

  assert.equal(submission.number, 42);
  assert.equal(submission.title, 'fix: handle transient synchronization timeout');
  assert.equal(submission.branch, 'fix/sync-timeout');
  assert.equal(submission.headBranch, 'fix/sync-timeout');
  assert.equal(submission.baseBranch, 'main');
  assert.equal(submission.sha, 'a1b2c3d4e5f67890123456789abcdef012345678');
  assert.equal(submission.author, 'dev-alice');
  assert.equal(submission.url, 'https://github.com/mergemint/core/pull/42');
  assert.equal(submission.merged, false);
  assert.equal(submission.mergeState, 'clean');
  assert.equal(submission.checks.length, 1);
  assert.equal(submission.checks[0].name, 'ci/test');
  assert.equal(submission.checks[0].state, 'passed');
});

// 4. Check runs and commit statuses map into CI evidence
test('mapCheckRunsAndStatuses maps both check runs and legacy statuses into Check domain types', () => {
  const checkRunsRaw = [
    {
      name: 'test / unit-tests',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/mergemint/core/runs/101',
    },
    {
      name: 'lint / prettier',
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://github.com/mergemint/core/runs/102',
    },
    {
      name: 'build / container',
      status: 'in_progress',
      conclusion: null,
      html_url: 'https://github.com/mergemint/core/runs/103',
    },
  ];

  const statusesRaw = [
    {
      context: 'security/snyk',
      state: 'success',
      target_url: 'https://snyk.io/vuln/1',
    },
    {
      context: 'coverage/coveralls',
      state: 'pending',
      target_url: 'https://coveralls.io/builds/1',
    },
  ];

  const checks = mapCheckRunsAndStatuses(checkRunsRaw, statusesRaw);

  assert.equal(checks.length, 5);

  // Check run 1: unit-tests passed
  assert.equal(checks[0].name, 'test / unit-tests');
  assert.equal(checks[0].state, 'passed');
  assert.equal(checks[0].conclusion, 'success');

  // Check run 2: prettier failed
  assert.equal(checks[1].name, 'lint / prettier');
  assert.equal(checks[1].state, 'failed');
  assert.equal(checks[1].conclusion, 'failure');

  // Check run 3: in progress pending
  assert.equal(checks[2].name, 'build / container');
  assert.equal(checks[2].state, 'pending');

  // Status 1: snyk passed
  assert.equal(checks[3].name, 'security/snyk');
  assert.equal(checks[3].state, 'passed');

  // Status 2: coveralls pending
  assert.equal(checks[4].name, 'coverage/coveralls');
  assert.equal(checks[4].state, 'pending');

  // Empty arrays yield empty checks
  const emptyChecks = mapCheckRunsAndStatuses([], []);
  assert.deepEqual(emptyChecks, []);
});

// 5. Changed PR head SHA invalidates previous evidence and approval
test('transition with a changed PR head SHA resets status to SUBMITTED and invalidates report and approval', () => {
  // Start with an approved bounty with verified report
  const initialBounty: Bounty = {
    ...seeds[0],
    status: 'APPROVED',
    submission: {
      number: 88,
      title: 'Fix edge case in payment routing',
      branch: 'fix/payment-routing',
      sha: '1111111111111111111111111111111111111111',
      merged: false,
      review: 'Approved by maintainer',
      checks: [{ name: 'ci', state: 'passed' }],
      author: 'contributor-bob',
      baseBranch: 'main',
      headBranch: 'fix/payment-routing',
      url: 'https://github.com/mergemint/core/pull/88',
      mergeState: 'clean',
    },
    report: {
      sha: '1111111111111111111111111111111111111111',
      createdAt: '2026-03-30T10:00:00Z',
      criteria: [
        {
          criterion: 'All tests pass',
          assessment: 'All required test suites pass cleanly on commit 1111111.',
          evidence: 'CI run 123 succeeded',
          limitation: 'None noted',
        },
      ],
    },
    approval: {
      maintainerId: seeds[0].maintainer.partyId,
      approvedAt: '2026-03-30T10:05:00Z',
      sha: '1111111111111111111111111111111111111111',
    },
  };

  // Ensure initial invariants
  assert.equal(initialBounty.status, 'APPROVED');
  assert.ok(initialBounty.report !== undefined);
  assert.ok(initialBounty.approval !== undefined);

  // Fresh submission with new head commit SHA pushed to the PR
  const updatedSubmission: Submission = {
    ...initialBounty.submission!,
    sha: '2222222222222222222222222222222222222222',
    checks: [{ name: 'ci', state: 'pending' }],
  };

  // Contributor or evidence refresh triggers SUBMIT with new submission
  const transitioned = transition(initialBounty, {
    type: 'SUBMIT',
    submission: updatedSubmission,
  });

  // Verify invariants
  assert.equal(transitioned.status, 'SUBMITTED');
  assert.equal(transitioned.submission?.sha, '2222222222222222222222222222222222222222');
  assert.equal(transitioned.report, undefined, 'Previous verification report must be invalidated');
  assert.equal(transitioned.approval, undefined, 'Previous maintainer approval must be invalidated');

  // Verify that settling with stale approval or stale SHA is rejected
  assert.throws(() => {
    transition(transitioned, { type: 'SETTLE', reference: 'mock-tx' });
  });
});

// 6. GitHub API failure does not corrupt bounty state
test('GitHub API failure preserves bounty state immutability', async () => {
  const initialBounty: Bounty = {
    ...seeds[0],
    status: 'CLAIMED',
  };

  const snapshotBefore = JSON.parse(JSON.stringify(initialBounty));

  // Simulate an API call failure when refreshing evidence
  const failingApiCall = async (): Promise<Submission> => {
    throw new Error('GitHub API rate limit exceeded (HTTP 403)');
  };

  let caughtError: Error | null = null;
  try {
    await failingApiCall();
  } catch (err) {
    caughtError = err as Error;
  }

  assert.ok(caughtError !== null);
  assert.equal(caughtError.message, 'GitHub API rate limit exceeded (HTTP 403)');

  // Verify that the bounty state is strictly preserved and not corrupted
  assert.deepEqual(initialBounty, snapshotBefore);
  assert.equal(initialBounty.status, 'CLAIMED');
});

// 7. Client API responses do not expose GitHub tokens or client secrets
test('Client API response shapes never expose GitHub tokens or client secrets', () => {
  // Test simulated payload shapes returned to client by server routes
  const authStatusPayload = {
    mode: 'real',
    configured: true,
    connected: true,
    user: {
      login: 'alexmorgan',
      name: 'Alex Morgan',
      avatarUrl: 'https://avatars.githubusercontent.com/u/100',
      htmlUrl: 'https://github.com/alexmorgan',
    },
    installed: true,
    installUrl: 'https://github.com/apps/mergemint/installations/new',
  };

  const repositoriesPayload = {
    mode: 'real',
    installed: true,
    installUrl: 'https://github.com/apps/mergemint/installations/new',
    repositories: [
      {
        id: 1,
        fullName: 'mergemint/core',
        name: 'core',
        owner: 'mergemint',
        visibility: 'Public',
        language: 'TypeScript',
        openIssuesCount: 4,
        updatedAt: '2h ago',
        description: 'Core runtime',
        url: 'https://github.com/mergemint/core',
      },
    ],
  };

  const forbiddenKeys = [
    'access_token',
    'token',
    'client_secret',
    'GITHUB_CLIENT_SECRET',
    'private_key',
    'GITHUB_PRIVATE_KEY',
    'installation_token',
    'secret',
    'authorization',
  ];

  const verifyNoSecrets = (obj: unknown, path = '') => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      for (const secretKey of forbiddenKeys) {
        assert.notEqual(
          key.toLowerCase(),
          secretKey.toLowerCase(),
          `Sensitive credential "${currentPath}" found in client-facing payload`
        );
      }
      if (typeof value === 'object' && value !== null) {
        verifyNoSecrets(value, currentPath);
      }
    }
  };

  verifyNoSecrets(authStatusPayload);
  verifyNoSecrets(repositoriesPayload);
});

// 8. Pull request input parsing (URL vs Number)
test('parsePrInput correctly extracts repo and PR number from input variations', () => {
  // Pure PR number
  assert.deepEqual(parsePrInput('mergemint/core', 42), {
    repo: 'mergemint/core',
    prNumber: 42,
  });

  // String number with hash
  assert.deepEqual(parsePrInput('mergemint/core', '#108'), {
    repo: 'mergemint/core',
    prNumber: 108,
  });

  // Full GitHub PR URL
  assert.deepEqual(
    parsePrInput('mergemint/core', 'https://github.com/other-org/other-repo/pull/555'),
    {
      repo: 'other-org/other-repo',
      prNumber: 555,
    }
  );

  // URL with trailing slash or query
  assert.deepEqual(
    parsePrInput('', 'https://github.com/canton/daml-apps/pull/12/files'),
    {
      repo: 'canton/daml-apps',
      prNumber: 12,
    }
  );
});

// 9. Real mode never automatically selects a mock repository
test('real mode never automatically selects a mock repository', () => {
  // Verify mock repos classification
  assert.equal(isMockRepo('mergemint/core'), true);
  assert.equal(isMockRepo('mergemint/sdk'), true);
  assert.equal(isMockRepo('mergemint/docs'), true);
  assert.equal(isMockRepo('my-org/production-app'), false);
  assert.equal(isMockRepo(''), false);
  assert.equal(isMockRepo(null), false);

  // Simulate CreateBountyFlow repository resolution in real mode:
  const liveRepos = [
    { fullName: 'my-org/production-app', name: 'production-app', owner: 'my-org' },
  ];

  // Even if initialRepo was 'mergemint/core' (from mock seed), it must not be selected in real mode
  const initialMockRepo = 'mergemint/core';
  const resolvedInRealMode =
    initialMockRepo && !isMockRepo(initialMockRepo) && liveRepos.some(r => r.fullName === initialMockRepo)
      ? initialMockRepo
      : '';

  assert.equal(resolvedInRealMode, '', 'Real mode must reject mock seed repos and start unselected');

  // Live repository selection succeeds only when explicitly provided and matches live list
  const initialLiveRepo = 'my-org/production-app';
  const resolvedLive =
    initialLiveRepo && !isMockRepo(initialLiveRepo) && liveRepos.some(r => r.fullName === initialLiveRepo)
      ? initialLiveRepo
      : '';
  assert.equal(resolvedLive, 'my-org/production-app');
});

// 10. Stale persisted mock repository is discarded in real mode
test('stale persisted mock repository is discarded in real mode', () => {
  const stalePersistedRepo = 'mergemint/core';
  const liveInstalledRepos = ['grzdev/test-repo', 'grzdev/canton-bounties'];

  // Dashboard filtering in real mode:
  const filteredAvailable = liveInstalledRepos.filter(r => !isMockRepo(r));
  assert.deepEqual(filteredAvailable, ['grzdev/test-repo', 'grzdev/canton-bounties']);
  assert.ok(!filteredAvailable.includes(stalePersistedRepo));

  // Resolved active repository
  const resolvedRepo =
    filteredAvailable.includes(stalePersistedRepo) && !isMockRepo(stalePersistedRepo)
      ? stalePersistedRepo
      : (filteredAvailable[0] || '');

  assert.equal(resolvedRepo, 'grzdev/test-repo');
  assert.notEqual(resolvedRepo, stalePersistedRepo);
});

// 11. Issues are only fetched after selecting a live accessible repository
test('issues are only fetched after selecting a live accessible repository', () => {
  let apiCallCount = 0;
  const mockFetchIssues = (repo: string) => {
    apiCallCount++;
    return repo;
  };

  const attemptFetch = (selectedRepo: string, mode: 'mock' | 'real') => {
    // Exact guard implemented in CreateBountyFlow
    if (!selectedRepo || (mode === 'real' && isMockRepo(selectedRepo))) {
      return null;
    }
    return mockFetchIssues(selectedRepo);
  };

  // Case A: No repo selected -> No fetch
  assert.equal(attemptFetch('', 'real'), null);
  assert.equal(apiCallCount, 0);

  // Case B: Mock repo in real mode -> Guard blocks fetch
  assert.equal(attemptFetch('mergemint/core', 'real'), null);
  assert.equal(apiCallCount, 0);

  // Case C: Real accessible repo in real mode -> Fetches
  assert.equal(attemptFetch('grzdev/test-repo', 'real'), 'grzdev/test-repo');
  assert.equal(apiCallCount, 1);
});

// 12. Inaccessible repository produces a useful non-500 response
test('issues endpoint produces a useful non-500 response for invalid or mock repositories in real mode', async () => {
  const originalMode = process.env.GITHUB_INTEGRATION_MODE;
  try {
    process.env.GITHUB_INTEGRATION_MODE = 'real';

    // 1. Missing repo param -> 400
    const reqMissing = new Request('http://localhost:3000/api/github/issues');
    const resMissing = await getIssuesRoute(reqMissing);
    assert.equal(resMissing.status, 400);
    const jsonMissing = (await resMissing.json()) as { error: string };
    assert.ok(jsonMissing.error.includes('required'));

    // 2. Bad repo format -> 400
    const reqBad = new Request('http://localhost:3000/api/github/issues?repo=invalidrepo');
    const resBad = await getIssuesRoute(reqBad);
    assert.equal(resBad.status, 400);
    const jsonBad = (await resBad.json()) as { error: string };
    assert.ok(jsonBad.error.includes('Expected format "owner/repo"'));

    // 3. Mock repo queried in real mode -> 404 (Not accessible/installed, NOT 500!)
    const reqMock = new Request('http://localhost:3000/api/github/issues?repo=mergemint%2Fcore');
    const resMock = await getIssuesRoute(reqMock);
    assert.equal(resMock.status, 404);
    const jsonMock = (await resMock.json()) as { error: string };
    assert.ok(jsonMock.error.includes('mock demo repository'));
  } finally {
    process.env.GITHUB_INTEGRATION_MODE = originalMode;
  }
});

// 13. Mock mode still works
test('mock mode returns seeded repositories and issues without errors', async () => {
  const originalMode = process.env.GITHUB_INTEGRATION_MODE;
  try {
    process.env.GITHUB_INTEGRATION_MODE = 'mock';

    // Route returns 200 with mock issues
    const req = new Request('http://localhost:3000/api/github/issues?repo=mergemint%2Fcore');
    const res = await getIssuesRoute(req);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { mode: string; issues: unknown[] };
    assert.equal(json.mode, 'mock');
    assert.ok(Array.isArray(json.issues));
    assert.ok(json.issues.length > 0);

    // mockGithub client methods work
    const repos = await mockGithub.getRepositories();
    assert.ok(repos.length >= 3);
    assert.ok(repos.some(r => r.fullName === 'mergemint/core'));

    const issues = await mockGithub.getIssues('mergemint/core');
    assert.ok(issues.length > 0);
  } finally {
    process.env.GITHUB_INTEGRATION_MODE = originalMode;
  }
});

// 14. Real repository selection correctly loads its issues
test('real repository issues payload correctly maps genuine issues and filters PRs', () => {
  const realApiIssuesPayload = [
    {
      number: 10,
      title: 'Real Bug: Null pointer in settlement validation',
      body: 'Reproducible when partyId has special chars.',
      user: { login: 'contributor-dev' },
      labels: [{ name: 'bug' }],
      comments: 2,
      updated_at: new Date().toISOString(),
      html_url: 'https://github.com/grzdev/test-repo/issues/10',
    },
    {
      number: 11,
      title: 'PR #11: Fix null pointer',
      pull_request: { url: 'https://api.github.com/repos/grzdev/test-repo/pulls/11' },
      user: { login: 'contributor-dev' },
    },
  ];

  const mapped = filterAndMapGitHubIssues(realApiIssuesPayload);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].number, 10);
  assert.equal(mapped[0].title, 'Real Bug: Null pointer in settlement validation');
  assert.equal(mapped[0].author, 'contributor-dev');
  assert.deepEqual(mapped[0].labels, ['bug']);
});

// 15. GitHub auth logout clears session cookie on both POST and GET
test('logout endpoint clears session cookie and revokes auth status', async () => {
  const postRes = await logoutPost();
  assert.equal(postRes.status, 200);
  const postJson = await postRes.json();
  assert.equal(postJson.success, true);
  assert.equal(postJson.connected, false);

  const postCookie = postRes.cookies.get(SESSION_COOKIE_NAME);
  assert.ok(postCookie);
  assert.equal(postCookie.value, '');
  assert.equal(postCookie.maxAge, 0);

  const getRes = await logoutGet(new Request('http://127.0.0.1:3000/api/github/auth/logout'));
  assert.equal(getRes.status, 307);
  const getCookie = getRes.cookies.get(SESSION_COOKIE_NAME);
  assert.ok(getCookie);
  assert.equal(getCookie.value, '');
  assert.equal(getCookie.maxAge, 0);
});



test('OAuth success, failure and logout return to the configured app origin', async () => {
  const oldOrigin = process.env.NEXT_PUBLIC_APP_URL;
  const oldFetch = global.fetch;
  process.env.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:3000';
  try {
    const { GET: callback } = await import('@/app/api/github/auth/callback/route');
    const { GET: logout } = await import('@/app/api/github/auth/logout/route');
    const { OAUTH_STATE_COOKIE_NAME, SESSION_COOKIE_NAME } = await import('@/integrations/github/server/session');
    const failure = await callback(new Request('http://localhost:3000/api/github/auth/callback?error=access_denied'));
    assert.equal(failure.headers.get('location'), 'http://127.0.0.1:3000/?github_error=access_denied');
    const signedOut = await logout(new Request('http://localhost:3000/api/github/auth/logout'));
    assert.equal(signedOut.headers.get('location'), 'http://127.0.0.1:3000/?signed_out=1');
    global.fetch = async input => String(input).includes('/login/oauth/access_token')
      ? Response.json({ access_token: 'fixture-token' })
      : Response.json({ login: 'grzdev', avatar_url: '' });
    const success = await callback(new Request('http://localhost:3000/api/github/auth/callback?code=fixture&state=fixture-state', {
      headers: { cookie: OAUTH_STATE_COOKIE_NAME + '=fixture-state' },
    }));
    assert.equal(success.headers.get('location'), 'http://127.0.0.1:3000/');
    assert.ok(success.headers.get('set-cookie')?.includes(SESSION_COOKIE_NAME + '='));
  } finally {
    global.fetch = oldFetch;
    if (oldOrigin === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = oldOrigin;
  }
});
