import type { Submission } from '@/domain/bounty';
import { repositories, seeds } from '@/mocks/seed';
import type { GitHubIntegration, GitHubRepo, GitHubIssue, GitHubAuthStatus } from './types';

export const delay = (ms = 500) => new Promise<void>(resolve => setTimeout(resolve, ms));

export const mockRepositories: GitHubRepo[] = [
  {
    id: 101,
    fullName: 'mergemint/core',
    name: 'core',
    owner: 'mergemint',
    visibility: 'Public',
    language: 'TypeScript',
    openIssuesCount: 5,
    updatedAt: '12m ago',
    description: 'Core bounty state machine, Canton settlement client, and GitHub verification runtime.',
    url: 'https://github.com/mergemint/core',
  },
  {
    id: 102,
    fullName: 'mergemint/sdk',
    name: 'sdk',
    owner: 'mergemint',
    visibility: 'Public',
    language: 'TypeScript',
    openIssuesCount: 3,
    updatedAt: '2h ago',
    description: 'Developer SDK for programmatic Canton bounty locking and receipt verification.',
    url: 'https://github.com/mergemint/sdk',
  },
  {
    id: 103,
    fullName: 'mergemint/docs',
    name: 'docs',
    owner: 'mergemint',
    visibility: 'Public',
    language: 'Markdown',
    openIssuesCount: 2,
    updatedAt: 'Yesterday',
    description: 'Architecture guides, Canton deployment specifications, and contributor workflows.',
    url: 'https://github.com/mergemint/docs',
  },
];

export const mockIssuesByRepo: Record<string, GitHubIssue[]> = {
  'mergemint/core': [
    {
      number: 204,
      title: 'Validate query option shape',
      description:
        'Query options currently accept raw untyped objects, which leads to runtime errors when null or array query values are provided. We need runtime shape validation with clear errors before execution.',
      labels: ['bug', 'help wanted'],
      author: 'alexmorgan',
      comments: 4,
      updatedAt: '12m ago',
      url: 'https://github.com/mergemint/core/issues/204',
    },
    {
      number: 230,
      title: 'Add batch verification endpoint to CLI',
      description:
        'Enable maintainers and automated CI pipelines to execute verification checks against multiple commits or test suites at once before triggering settlement.',
      labels: ['enhancement', 'good first issue'],
      author: 'alexmorgan',
      comments: 2,
      updatedAt: '3h ago',
      url: 'https://github.com/mergemint/core/issues/230',
    },
    {
      number: 242,
      title: 'Support custom Canton participant nodes',
      description:
        'Participant node endpoints are currently defaulted to localhost:5011. Allow participant host, port, and TLS certificates to be configured dynamically via environment variables.',
      labels: ['integration', 'canton'],
      author: 'daml-dev',
      comments: 5,
      updatedAt: 'Yesterday',
      url: 'https://github.com/mergemint/core/issues/242',
    },
    {
      number: 249,
      title: 'Format CC token amounts with locale precision',
      description:
        'Standardize display of Canton Coin amounts on settlement receipts and cards using locale-aware thousand separators and fixed decimal precision.',
      labels: ['ui', 'good first issue'],
      author: 'sarah-k',
      comments: 1,
      updatedAt: '2d ago',
      url: 'https://github.com/mergemint/core/issues/249',
    },
    {
      number: 255,
      title: 'Support multi-file regression test coverage reporting',
      description:
        'The verification report currently only checks for single-file diff coverage. Extend the parser to detect test files matching *.test.ts and *.spec.ts across directories.',
      labels: ['enhancement'],
      author: 'alexmorgan',
      comments: 3,
      updatedAt: '3d ago',
      url: 'https://github.com/mergemint/core/issues/255',
    },
  ],
  'mergemint/sdk': [
    {
      number: 42,
      title: 'Add client retry logic for Canton JSON RPC ledger submissions',
      description:
        'Implement exponential backoff when Canton participant node returns transient backpressure or connection timeout errors.',
      labels: ['canton', 'core'],
      author: 'alexmorgan',
      comments: 3,
      updatedAt: '2h ago',
      url: 'https://github.com/mergemint/sdk/issues/42',
    },
    {
      number: 45,
      title: 'Export TypeScript types for Canton settlement receipts',
      description:
        'Provide strongly typed interfaces for SettlementReceipt and FundingLock objects in the public package export.',
      labels: ['typescript', 'good first issue'],
      author: 'juleschen',
      comments: 1,
      updatedAt: '5h ago',
      url: 'https://github.com/mergemint/sdk/issues/45',
    },
    {
      number: 48,
      title: 'Implement zero-dependency browser client bundle',
      description:
        'Optimize the web distribution of the SDK by externalizing heavy dependencies and providing an ES module bundle.',
      labels: ['packaging'],
      author: 'samrivera',
      comments: 2,
      updatedAt: '1d ago',
      url: 'https://github.com/mergemint/sdk/issues/48',
    },
  ],
  'mergemint/docs': [
    {
      number: 12,
      title: 'Document Daml smart contract lifecycle and Canton settlement flow',
      description:
        'Add sequence diagrams and architectural documentation detailing how Canton contracts transition between DRAFT, FUNDED, and SETTLED states.',
      labels: ['documentation'],
      author: 'alexmorgan',
      comments: 4,
      updatedAt: 'Yesterday',
      url: 'https://github.com/mergemint/docs/issues/12',
    },
    {
      number: 15,
      title: 'Create quickstart guide for open-source contributors',
      description:
        'Step-by-step tutorial explaining how contributors find funded bounties, link their pull requests, and verify CI status before maintainer payout.',
      labels: ['documentation', 'good first issue'],
      author: 'sarah-k',
      comments: 2,
      updatedAt: '3d ago',
      url: 'https://github.com/mergemint/docs/issues/15',
    },
  ],
};

export const mockGithub: GitHubIntegration = {
  getMode() {
    return 'mock';
  },
  async getAuthStatus(): Promise<GitHubAuthStatus> {
    await delay(100);
    return {
      mode: 'mock',
      configured: true,
      connected: true,
      user: {
        login: 'alexmorgan',
        name: 'Alex Morgan',
        avatarUrl: '',
        htmlUrl: 'https://github.com/alexmorgan',
      },
      installed: true,
    };
  },
  async repositories(): Promise<string[]> {
    await delay(300);
    return repositories;
  },
  async getRepositories(): Promise<GitHubRepo[]> {
    await delay(300);
    return mockRepositories;
  },
  async issues(repo: string): Promise<GitHubIssue[]> {
    await delay(300);
    return mockIssuesByRepo[repo] ?? seeds.filter(b => b.repo === repo).map(b => ({
      number: b.issue,
      title: b.title,
      description: 'Issue description for ' + b.title,
      labels: ['help wanted'],
      author: 'alexmorgan',
      comments: 3,
      updatedAt: '2026-09-28T09:00:00Z',
      url: `https://github.com/${repo}/issues/${b.issue}`,
    }));
  },
  async getIssues(repo: string): Promise<GitHubIssue[]> {
    await delay(300);
    return mockIssuesByRepo[repo] ?? [];
  },
  async pullRequest(bountyId: string): Promise<Submission> {
    await delay(300);
    const pr = seeds.find(b => b.id === bountyId)?.submission;
    if (!pr) throw new Error('No pull request linked.');
    return structuredClone(pr);
  },
  async getPullRequest(repo: string, prNumberOrUrl: string | number): Promise<Submission> {
    await delay(300);
    const num =
      typeof prNumberOrUrl === 'number'
        ? prNumberOrUrl
        : parseInt(String(prNumberOrUrl).replace(/[^0-9]/g, ''), 10);

    const found = seeds.find(b => b.repo === repo && b.submission?.number === num)?.submission;
    if (found) return structuredClone(found);

    // Fallback simulated submission for mock mode if user tests linking another PR
    return {
      number: isNaN(num) || num <= 0 ? 218 : num,
      title: `Simulated PR #${num || 218} for ${repo}`,
      branch: 'feature/mock-fix',
      sha: `c7e091b48d21${String(num).padStart(4, '0')}`,
      merged: false,
      review: 'Awaiting review',
      checks: [
        { name: 'unit-tests', state: 'passed', conclusion: 'success' },
        { name: 'lint', state: 'passed', conclusion: 'success' },
        { name: 'typecheck', state: 'passed', conclusion: 'success' },
      ],
      author: 'contributor',
      baseBranch: 'main',
      headBranch: 'feature/mock-fix',
      url: `https://github.com/${repo}/pull/${num || 218}`,
      mergeState: 'clean',
    };
  },
};
