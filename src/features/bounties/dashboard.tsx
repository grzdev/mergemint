'use client';

import { useState, useEffect } from 'react';
import type { Bounty, Status } from '@/domain/bounty';
import { transition } from '@/domain/bounty';
import { seeds, repositories } from '@/mocks/seed';
import { ai } from '@/integrations/ai';
import { canton, type CantonStatus } from '@/integrations/canton';
import { github, type GitHubAuthStatus, isMockRepo } from '@/integrations/github';
import { bountyRepository } from '@/storage/bountyRepository';
import {
  useGitHubAuth,
  useGitHubRepositories,
  useCantonStatus,
  useCantonBounties,
  useCantonMutations,
} from '@/integrations/queries';
import { CreateBountyFlow } from './createBountyFlow';
import { Drawer } from '@/components/ui/drawer';
import { Modal } from '@/components/ui/modal';
import { truncateHash } from '@/utils/formatters';

const labels: Record<string, string> = {
  DRAFT: 'Draft',
  FUNDED: 'Funded',
  CLAIMED: 'Claimed',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  SETTLED: 'Settled',
};

const actions: Record<string, string> = {
  DRAFT: 'Continue setup',
  FUNDED: 'View bounty',
  CLAIMED: 'View contributor',
  SUBMITTED: 'Review submission',
  APPROVED: 'Settle bounty',
  SETTLED: 'View receipt',
};

function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      <span aria-hidden="true">{status === 'SETTLED' ? '✓' : '●'}</span> {labels[status] ?? status}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function CopyableHash({ hash, label }: { hash: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard?.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <span className="hash-pill" title={hash}>
      <span>{truncateHash(hash, 10, 8)}</span>
      <button
        type="button"
        className="copy-pill-btn"
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
}

const STAGES = [
  { key: 'DRAFT', label: 'Draft' },
  { key: 'FUNDED', label: 'Funded' },
  { key: 'CLAIMED', label: 'Claimed' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'SETTLED', label: 'Settled' },
];

function CompactTimeline({ currentStatus }: { currentStatus: Status }) {
  const stageOrder = ['DRAFT', 'FUNDED', 'CLAIMED', 'SUBMITTED', 'APPROVED', 'SETTLED'];
  const currentIndex = stageOrder.indexOf(currentStatus);

  return (
    <div className="timeline-strip" aria-label="Bounty lifecycle progress">
      {STAGES.map((s, idx) => {
        const isCurrent = s.key === currentStatus;
        const isDone = currentIndex > idx;
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
            <div className={`timeline-step ${isCurrent ? 'active' : isDone ? 'done' : ''}`}>
              <div className="timeline-indicator">
                {isDone ? '✓' : idx + 1}
              </div>
              <span>{s.label}</span>
            </div>
            {idx < STAGES.length - 1 && (
              <div className={`timeline-sep ${currentIndex > idx ? 'done' : ''}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard() {
  // --- Local UI State (isolated from background remote refetches) ---
  const [bounties, setBounties] = useState<Bounty[]>(seeds);
  const [repo, setRepo] = useState<string>('ALL');
  const [page, setPage] = useState('Dashboard');
  const [selected, setSelected] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      if (p.get('view') === 'bounty' || (!p.get('view') && p.get('id'))) {
        return p.get('id') || '204';
      }
    }
    return null;
  });
  const [creating, setCreating] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      return p.get('view') === 'create' || p.get('view') === 'new';
    }
    return false;
  });
  const [createStep, setCreateStep] = useState<1 | 2 | 3 | 4>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const st = p.get('step');
      if (st && ['1', '2', '3', '4'].includes(st)) {
        return Number(st) as 1 | 2 | 3 | 4;
      }
    }
    return 1;
  });
  const [startWithScout, setStartWithScout] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      return p.get('scout') === 'true' || p.get('scout') === '1';
    }
    return false;
  });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [linkingPr, setLinkingPr] = useState(false);
  const [prInput, setPrInput] = useState('');

  // Local Drawer states
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);
  const [receiptDrawerOpen, setReceiptDrawerOpen] = useState(false);

  // Local Modal states
  const [modalAction, setModalAction] = useState<'fund' | 'claim' | 'approve' | 'settle' | null>(null);
  const [failSimulation, setFailSimulation] = useState(false);

  const [activity, setActivity] = useState<string[]>([
    'PR #218 submitted for issue #204',
    'Contributor @juleschen claimed issue #198',
    '250 MMT locked for issue #211',
  ]);

  // --- TanStack Query Remote Server State ---
  const authQuery = useGitHubAuth();
  const reposQuery = useGitHubRepositories();
  const cantonStatusQuery = useCantonStatus();
  const cantonBountiesQuery = useCantonBounties();
  const mutations = useCantonMutations();

  const authStatus: GitHubAuthStatus = authQuery.data ?? {
    mode: 'mock',
    configured: true,
    connected: true,
    user: { login: 'alexmorgan', name: 'Alex Morgan', avatarUrl: '' },
    installed: true,
  };

  const authLoading = authQuery.isLoading;

  const cantonStatus: CantonStatus = cantonStatusQuery.data ?? {
    mode: 'mock',
    connected: true,
    network: 'Canton · Demo',
    ledgerApiUrl: 'internal://mock',
    parties: {
      sponsor: { handle: 'mergemint-labs', partyId: 'mergemint-sponsor::mock' },
      maintainer: { handle: 'alexmorgan', partyId: 'alexmorgan::mock' },
      contributor: { handle: 'juleschen', partyId: 'juleschen::mock' },
    },
  };

  const cantonOffline = !cantonStatus.connected;

  // Filter available repositories safely from query
  const rawRepos = reposQuery.data?.map(r => r.fullName) ?? repositories;
  const isReal = authStatus.mode === 'real' || rawRepos.some(n => !isMockRepo(n));
  const availableRepos = isReal ? rawRepos.filter(r => !isMockRepo(r)) : rawRepos;

  // Load persistent local bounties on mount
  useEffect(() => {
    let mounted = true;
    bountyRepository.getAll().then(data => {
      if (mounted && data.length > 0) {
        setBounties(data);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Synchronize on-chain contracts safely without erasing current UI interaction state
  useEffect(() => {
    const onLedger = cantonBountiesQuery.data;
    if (cantonStatus.mode === 'real' && cantonStatus.connected && onLedger && onLedger.length > 0) {
      setBounties(prev => {
        const updated = [...prev];
        let hasChanges = false;
        for (const contract of onLedger) {
          const existingIdx = updated.findIndex(b => b.id === contract.bountyId);
          if (existingIdx >= 0) {
            if (
              updated[existingIdx].status !== contract.status ||
              updated[existingIdx].fundingRef !== contract.contractId ||
              updated[existingIdx].tokenHoldingContractId !== contract.tokenHoldingContractId
            ) {
              updated[existingIdx] = {
                ...updated[existingIdx],
                status: contract.status as Status,
                fundingRef: contract.contractId,
                tokenHoldingContractId: contract.tokenHoldingContractId || updated[existingIdx].tokenHoldingContractId,
                settlement: contract.settledReceipt
                  ? {
                      state: 'confirmed',
                      recipient: contract.contributor || '',
                      amount: contract.amount,
                      timestamp: contract.settledReceipt.settledAt,
                      reference: contract.settledReceipt.settlementRef,
                      tokenRecipientHoldingId: contract.settledReceipt.tokenRecipientHoldingId,
                      tokenTransferTxId: contract.settledReceipt.tokenTransferTxId,
                    }
                  : updated[existingIdx].settlement,
              };
              hasChanges = true;
            }
          } else {
            updated.push({
              id: contract.bountyId,
              repo: contract.repository,
              issue: contract.issueNumber,
              title: `Issue #${contract.issueNumber} on ${contract.repository}`,
              amount: contract.amount,
              asset: (contract.asset === 'CC' ? 'CC' : 'MMT'),
              status: contract.status as Status,
              sponsor: {
                handle: 'sponsor',
                partyId: contract.sponsor,
              },
              maintainer: {
                handle: 'maintainer',
                partyId: contract.maintainer,
              },
              contributor: contract.contributor
                ? { handle: 'contributor', partyId: contract.contributor }
                : undefined,
              criteria: contract.acceptanceCriteria || [],
              fundingRef: contract.contractId,
              tokenHoldingContractId: contract.tokenHoldingContractId,
              submission: contract.submissionSha
                ? {
                    number: contract.issueNumber,
                    title: `Fix for issue #${contract.issueNumber}`,
                    branch: 'patch',
                    sha: contract.submissionSha,
                    merged: contract.status === 'SETTLED',
                    review: 'Approved on Canton',
                    checks: [{ name: 'ci/cd', state: 'passed' }],
                  }
                : undefined,
              settlement: contract.settledReceipt
                ? {
                    state: 'confirmed',
                    recipient: contract.contributor || '',
                    amount: contract.amount,
                    timestamp: contract.settledReceipt.settledAt,
                    reference: contract.settledReceipt.settlementRef,
                    tokenRecipientHoldingId: contract.settledReceipt.tokenRecipientHoldingId,
                    tokenTransferTxId: contract.settledReceipt.tokenTransferTxId,
                  }
                : undefined,
              activity: contract.status === 'SETTLED' ? 'Settled on Canton' : 'Active on Canton',
            });
            hasChanges = true;
          }
        }
        return hasChanges ? updated : prev;
      });
    }
  }, [cantonBountiesQuery.data, cantonStatus.mode, cantonStatus.connected]);

  // URL query error handler and deep-link routing
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const ghErr = params.get('github_error');
      if (ghErr) {
        if (ghErr === 'access_denied') {
          setError('GitHub authorization request was cancelled or denied.');
        } else if (ghErr === 'config_missing') {
          setError('GitHub App credentials missing in server environment.');
        } else if (ghErr === 'csrf_state_mismatch') {
          setError('Security verification failed during GitHub sign-in. Please retry.');
        } else {
          setError(`GitHub connection error (${ghErr}).`);
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      // Deep link navigation for screenshots, direct linking and browser automation
      const viewParam = params.get('view');
      const idParam = params.get('id');
      const scoutParam = params.get('scout');
      const stepParam = params.get('step');

      if (viewParam === 'create' || viewParam === 'new') {
        setSelected(null);
        setCreating(true);
        if (stepParam && ['1', '2', '3', '4'].includes(stepParam)) {
          setCreateStep(Number(stepParam) as 1 | 2 | 3 | 4);
        }
        if (scoutParam === 'true' || scoutParam === '1') {
          setStartWithScout(true);
        }
      } else if (viewParam === 'bounty' || idParam) {
        setCreating(false);
        setSelected(idParam || '204');
        if (params.get('drawer') === 'evidence') {
          setEvidenceDrawerOpen(true);
        } else if (params.get('drawer') === 'receipt') {
          setReceiptDrawerOpen(true);
        }
      }
    }
  }, []);

  const handleConnectGitHub = () => {
    window.location.href = '/api/github/auth/login';
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/github/auth/logout', { method: 'POST' });
      await authQuery.refetch();
      setMessage('Disconnected from GitHub.');
    } catch {
      setError('Failed to disconnect from GitHub.');
    }
  };

  const handleLinkPR = () => {
    if (!current || !prInput.trim()) return;
    run('Linking pull request...', async () => {
      const submission = await github.getPullRequest(current.repo, prInput.trim());
      if (!submission.sha) {
        throw new Error('Pull request does not report a valid commit SHA.');
      }
      const updated = transition(current, { type: 'SUBMIT', submission });
      setLinkingPr(false);
      setPrInput('');
      setMessage(`PR #${submission.number} successfully linked with commit ${submission.sha.slice(0, 10)}.`);
      return updated;
    });
  };

  const list = repo === 'ALL' || !repo ? bounties : bounties.filter(b => b.repo === repo);
  const visible = list.filter(
    b =>
      (filter === 'ALL' || b.status === filter) &&
      `${b.title} ${b.issue} ${b.contributor?.handle} ${b.repo}`.toLowerCase().includes(query.toLowerCase())
  );
  const current = bounties.find(b => b.id === selected);

  // Compute stats
  const activeBountiesCount = list.filter(b => !['DRAFT', 'SETTLED'].includes(b.status)).length;
  const pendingReviewsCount = list.filter(b => b.status === 'SUBMITTED').length;
  const totalFundedMMT = list
    .filter(b => !['DRAFT'].includes(b.status))
    .reduce((sum, b) => sum + BigInt(b.amount), BigInt(0))
    .toString();

  // Actionable items for "Needs your attention"
  const actionableItems = list.filter(b => ['SUBMITTED', 'APPROVED', 'CLAIMED'].includes(b.status));

  function open(id: string) {
    setSelected(id);
    setCreating(false);
    setModalAction(null);
    setEvidenceDrawerOpen(false);
    setReceiptDrawerOpen(false);
    setMessage('');
    setError('');
  }

  async function run(label: string, work: () => Promise<Bounty>) {
    setBusy(label);
    setError('');
    setMessage('');
    try {
      const updated = await work();
      await bountyRepository.save(updated);
      setBounties(all => all.map(b => (b.id === updated.id ? updated : b)));
      mutations.invalidateCanton();
      setMessage('Action completed successfully.');
      setActivity(all => [`${label.replace('...', '')} completed for issue #${updated.issue}`, ...all]);
      setModalAction(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please retry.');
    } finally {
      setBusy('');
    }
  }

  const handleResetDemo = async () => {
    const fresh = await bountyRepository.resetToSeeds();
    setBounties(fresh);
    setSelected(null);
    setCreating(false);
    setMessage('Demo state reset to initial seed data.');
  };

  return (
    <div className="shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="MergeMint home">
          <span className="brand-mark">m</span>MergeMint<span className="beta">BETA</span>
        </a>
        <div className="workspace">
          <Avatar name="MergeMint" />
          <div>
            MergeMint Labs<small>Maintainer workspace</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {['Dashboard', 'Bounties', 'Activity'].map((name, i) => (
            <button
              key={name}
              className={page === name && !creating ? 'nav-active' : ''}
              onClick={() => {
                setPage(name);
                setSelected(null);
                setCreating(false);
              }}
            >
              <span aria-hidden="true">{['◫', '◇', '≋'][i]}</span>
              {name}
              {name === 'Bounties' && <small>{list.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-label">BUILT FOR CONTRIBUTORS</span>
          <p>
            Good work deserves
            <br />a clear path to payment.
          </p>
          <span className="network">◈ Powered by Canton</span>
        </div>
        <div className="sidebar-bottom">
          {authStatus.mode === 'mock' ? (
            <div className="connection">
              <span>●</span> GitHub connected <small>Mock</small>
            </div>
          ) : authLoading ? (
            <div className="connection">
              <span className="spinner" /> GitHub connecting...
            </div>
          ) : authStatus.connected && authStatus.user ? (
            <div>
              <div className="connection">
                <span style={{ color: 'var(--mint)' }}>●</span> Connected as @{authStatus.user.login}
              </div>
              {!authStatus.installed && authStatus.installUrl && (
                <a
                  href={authStatus.installUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-button"
                  style={{ display: 'block', padding: '4px 7px', fontSize: '11px', color: 'var(--mint)' }}
                >
                  + Install App on repos ↗
                </a>
              )}
            </div>
          ) : authStatus.installed ? (
            <div>
              <div className="connection">
                <span style={{ color: 'var(--mint)' }}>●</span> GitHub App active
              </div>
              <button
                className="secondary"
                style={{ width: '100%', marginTop: '6px', fontSize: '11px' }}
                onClick={handleConnectGitHub}
              >
                Sign in with personal GitHub →
              </button>
            </div>
          ) : authStatus.error ? (
            <div>
              <div className="connection" style={{ color: '#e59f8c' }}>
                <span>×</span> GitHub connection failed
              </div>
              <button
                className="secondary"
                style={{ width: '100%', marginTop: '6px', fontSize: '11px' }}
                onClick={handleConnectGitHub}
              >
                Connect GitHub
              </button>
            </div>
          ) : (
            <div>
              <div className="connection">
                <span style={{ color: 'var(--muted)' }}>○</span> GitHub not connected
              </div>
              <button
                className="secondary"
                style={{ width: '100%', marginTop: '6px', fontSize: '11px' }}
                onClick={handleConnectGitHub}
              >
                Connect GitHub
              </button>
            </div>
          )}

          <button
            className="demo-button"
            onClick={() => setDemo(!demo)}
            aria-expanded={demo}
          >
            ◉ {authStatus.mode === 'real' ? 'Real GitHub mode' : 'Demo mode'} <span>ⓘ</span>
          </button>
          {demo && (
            <div className="demo-explanation">
              <p>
                {authStatus.mode === 'real' && cantonStatus.mode === 'real'
                  ? 'Real GitHub App and real Canton LocalNet modes enabled. AI remains simulated.'
                  : authStatus.mode === 'real'
                    ? 'Real GitHub App mode enabled. Canton and AI remain simulated.'
                    : cantonStatus.mode === 'real'
                      ? 'Real Canton LocalNet mode enabled. GitHub and AI remain simulated.'
                      : 'GitHub, AI, and Canton actions are simulated in this build.'}
              </p>
              {authStatus.mode === 'real' && authStatus.connected && (
                <button
                  className="secondary"
                  style={{ marginTop: '8px', width: '100%', fontSize: '10px' }}
                  onClick={handleDisconnect}
                >
                  Disconnect GitHub
                </button>
              )}
              <button
                className="secondary"
                style={{ marginTop: '8px', width: '100%', fontSize: '10px' }}
                onClick={handleResetDemo}
              >
                Reset demo data
              </button>
            </div>
          )}
          <div className="profile">
            {authStatus.user?.avatarUrl ? (
              <img
                src={authStatus.user.avatarUrl}
                alt={authStatus.user.login}
                className="avatar"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <Avatar name={authStatus.user?.name || authStatus.user?.login || 'Alex Morgan'} />
            )}
            <div>
              {authStatus.user?.name || (authStatus.user ? `@${authStatus.user.login}` : 'Alex Morgan')}
              <small>@{authStatus.user?.login || 'alexmorgan'}</small>
            </div>
          </div>
        </div>
      </aside>

      <main>
        {/* Topbar */}
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <span>
              Workspace <span className="slash">/</span>{' '}
              {creating ? 'Create bounty' : current ? 'Bounty detail' : page}
            </span>
            {cantonStatus.balances && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  padding: '3px 10px',
                  borderRadius: '16px',
                  border: '1px solid var(--line)',
                  fontSize: '11px',
                }}
                title="Canton Ledger Token Balances (MMT · CIP-56 Compatible)"
              >
                <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: 'var(--mint)' }}>◈</span> Canton Tokens:
                </span>
                <span style={{ color: 'var(--text)' }}>
                  Sponsor <strong>{cantonStatus.balances.sponsor} MMT</strong>
                </span>
                {parseInt(cantonStatus.balances.escrow || '0', 10) > 0 && (
                  <>
                    <span style={{ color: 'var(--line)' }}>·</span>
                    <span style={{ color: '#eab308' }}>
                      Escrow <strong>{cantonStatus.balances.escrow} MMT</strong>
                    </span>
                  </>
                )}
                <span style={{ color: 'var(--line)' }}>·</span>
                <span style={{ color: 'var(--mint)' }}>
                  Contributor <strong>{cantonStatus.balances.contributor} MMT</strong>
                </span>
              </div>
            )}
          </div>
          <span className="top-right">
            {cantonStatus.mode === 'real' ? (
              <>
                {cantonStatus.network} ·{' '}
                <span
                  className="mock-tag"
                  style={{
                    background: cantonStatus.connected ? 'rgba(88, 203, 168, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: cantonStatus.connected ? '#58cba8' : '#ef4444',
                    borderColor: cantonStatus.connected ? 'rgba(88, 203, 168, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                  }}
                >
                  {cantonStatus.connected ? 'Connected' : 'Offline'}
                </span>
              </>
            ) : (
              <>
                Canton LocalNet <span className="mock-tag">SIMULATED</span>
              </>
            )}
          </span>
        </header>

        <div className="content">
          {/* Offline Banner if Canton is down */}
          {cantonOffline && (
            <div className="offline-banner" role="alert">
              <span style={{ fontSize: '18px' }}>⚠️</span>
              <div>
                <strong>Canton participant is temporarily unavailable.</strong> Existing local data is still visible. On-chain actions (funding, claiming, approving, settling) are paused until the node is restored.
              </div>
            </div>
          )}

          {/* VIEW 1: CREATE BOUNTY STEPPER */}
          {creating ? (
            <CreateBountyFlow
              initialRepo={
                authStatus.mode === 'real'
                  ? (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('repo')) ||
                    (!isMockRepo(repo) && availableRepos.includes(repo) ? repo : availableRepos.find(r => r.includes('patchpilot')) || availableRepos[0])
                  : repo === 'ALL'
                  ? 'mergemint/core'
                  : repo
              }
              initialScout={startWithScout}
              initialStep={createStep}
              onCancel={() => {
                setCreating(false);
                setStartWithScout(false);
              }}
              onSuccess={newBounty => {
                setBounties(all => [newBounty, ...all.filter(b => b.id !== newBounty.id)]);
                setRepo(newBounty.repo);
                setCreating(false);
                setStartWithScout(false);
                setSelected(newBounty.id);
                setActivity(all => [
                  `Funded ${newBounty.amount} MMT for issue #${newBounty.issue}`,
                  ...all,
                ]);
              }}
            />
          ) : current ? (
            /* VIEW 2: PROGRESSIVE BOUNTY DETAIL */
            <>
              <button className="back" onClick={() => setSelected(null)}>
                ← Back to bounties
              </button>

              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {current.repo} <span>/ ISSUE #{current.issue}</span>
                  </div>
                  <h1>{current.title}</h1>
                  <p>Clear terms. Visible evidence. Your final approval.</p>
                </div>
                <div className="amount">
                  {current.amount} <span>MMT</span>
                  <Badge status={current.status} />
                </div>
              </div>

              <div className="party-strip">
                <span>
                  Sponsor <strong>@{current.sponsor.handle}</strong>
                </span>
                <span>
                  Maintainer <strong>@{current.maintainer.handle}</strong>
                </span>
                <span>
                  Network <strong>{cantonStatus.mode === 'real' ? cantonStatus.network : 'LocalNet · mock'}</strong>
                </span>
              </div>

              {/* Compact Horizontal Timeline */}
              <CompactTimeline currentStatus={current.status} />

              <div className="detail-grid">
                <div>
                  {/* Clean Acceptance Criteria Checklist */}
                  <section className="section">
                    <div className="section-title">
                      <h2>Acceptance criteria</h2>
                      <span className="muted">{current.criteria.length} requirements</span>
                    </div>
                    {current.criteria.map((criterion, i) => (
                      <div className="criterion" key={criterion}>
                        <span className="check-square">
                          {current.report?.criteria[i]?.assessment === 'Likely satisfied'
                            ? '✓'
                            : '○'}
                        </span>
                        <div>
                          {criterion}
                          <small>
                            {current.report
                              ? current.report.criteria[i]?.assessment
                              : 'Awaiting submission & verification'}
                          </small>
                        </div>
                      </div>
                    ))}
                  </section>

                  {/* Contribution & PR Summary */}
                  <section className="section">
                    <div className="section-title">
                      <h2>Contribution summary</h2>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {current.submission && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setEvidenceDrawerOpen(true)}
                          >
                            View evidence ↗
                          </button>
                        )}
                        {['CLAIMED', 'SUBMITTED', 'APPROVED'].includes(current.status) && (
                          <button
                            type="button"
                            className="text-button"
                            style={{ color: 'var(--mint)', whiteSpace: 'nowrap' }}
                            onClick={() => setLinkingPr(true)}
                          >
                            {current.submission ? 'Link different PR' : '+ Link PR'}
                          </button>
                        )}
                      </div>
                    </div>

                    {current.contributor ? (
                      <div className="contributor" style={{ marginBottom: current.submission ? '16px' : '0' }}>
                        <Avatar name={current.contributor.handle} />
                        <div>
                          <strong>@{current.contributor.handle}</strong>
                          <small>
                            Claimed on Canton
                            {current.claimedAt && ` · ${new Date(current.claimedAt).toLocaleDateString()}`}
                          </small>
                        </div>
                        <span className="muted">✓ Claimed</span>
                      </div>
                    ) : (
                      <div className="empty-inline">
                        {current.status === 'DRAFT'
                          ? 'Fund this bounty to enable claims.'
                          : 'Available for contributors to claim.'}
                      </div>
                    )}

                    {current.submission && (
                      <div className="summary-box">
                        <div className="summary-box-header">
                          <div>
                            <strong>PR #{current.submission.number} · {current.submission.title}</strong>
                            <small style={{ display: 'block', color: 'var(--muted)', marginTop: '2px' }}>
                              {current.submission.branch} → {current.submission.baseBranch || 'main'}
                            </small>
                          </div>
                          <span
                            className={
                              current.submission.checks.every(c => c.state === 'passed')
                                ? 'pass'
                                : current.submission.checks.some(c => c.state === 'failed')
                                  ? 'warning'
                                  : 'muted'
                            }
                            style={{ fontSize: '11px', fontWeight: 500 }}
                          >
                            {current.submission.checks.filter(c => c.state === 'passed').length}/
                            {current.submission.checks.length} checks passing
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px' }}>
                          <span>Head commit:</span>
                          <CopyableHash hash={current.submission.sha} label="Commit SHA" />
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Settlement Summary Section */}
                  <section className="section">
                    <div className="section-title">
                      <h2>Settlement record</h2>
                      {current.settlement && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setReceiptDrawerOpen(true)}
                        >
                          View receipt ↗
                        </button>
                      )}
                    </div>
                    {current.settlement ? (
                      <div className="summary-box">
                        <div className="summary-box-header">
                          <strong>
                            {current.settlement.state === 'confirmed'
                              ? 'Settlement confirmed on Canton LocalNet'
                              : 'Settlement failed'}
                          </strong>
                          <Badge status={current.settlement.state === 'confirmed' ? 'SETTLED' : 'Failed'} />
                        </div>
                        <div className="summary-box-content">
                          <div style={{ color: 'var(--mint)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>◈</span> +{current.amount} MMT transferred on-ledger to contributor
                          </div>
                          <div>Recipient: <strong>{current.settlement.recipient}</strong></div>
                          {current.settlement.reference && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span>Transaction ref:</span>
                              <CopyableHash hash={current.settlement.reference} label="Transaction Ref" />
                            </div>
                          )}
                          {current.settlement.tokenRecipientHoldingId && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span>Token holding ID:</span>
                              <CopyableHash hash={current.settlement.tokenRecipientHoldingId} label="Token Holding ID" />
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="empty-inline">
                        No settlement yet. Settlement is executed on Canton once maintainer approves the work.
                      </div>
                    )}
                  </section>
                </div>

                {/* Single Primary Action Column */}
                <aside className="approval-column">
                  <section className="approval-card">
                    <div className="eyebrow">NEXT ACTION</div>
                    <h2>
                      {current.status === 'SETTLED'
                        ? 'Settled on Canton'
                        : current.status === 'APPROVED'
                          ? 'Ready for settlement'
                          : current.status === 'SUBMITTED'
                            ? 'Review & approval'
                            : current.status === 'CLAIMED'
                              ? 'Work in progress'
                              : current.status === 'FUNDED'
                                ? 'Available to claim'
                                : 'Draft bounty'}
                    </h2>
                    <p>
                      {current.status === 'SUBMITTED'
                        ? 'Inspect the pull request evidence and AI assessment before approving this exact revision.'
                        : current.status === 'APPROVED'
                          ? 'Approval is committed for this exact commit. Settle to consume the on-ledger bounty.'
                          : current.status === 'SETTLED'
                            ? 'Bounty terms settled on-ledger. Receipt is recorded.'
                            : current.status === 'CLAIMED'
                              ? 'Contributor is working on a solution. Waiting for PR submission.'
                              : current.status === 'FUNDED'
                                ? 'Bounty is locked on Canton. Contributor can claim.'
                                : 'Fund on Canton to lock terms and open to contributors.'}
                    </p>

                    <dl>
                      <div>
                        <dt>Bounty amount</dt>
                        <dd>{current.amount} MMT</dd>
                      </div>
                      <div>
                        <dt>Recipient</dt>
                        <dd>{current.contributor ? `@${current.contributor.handle}` : 'Unclaimed'}</dd>
                      </div>
                      <div>
                        <dt>Network</dt>
                        <dd>{cantonStatus.mode === 'real' ? cantonStatus.network : 'LocalNet · mock'}</dd>
                      </div>
                      {current.fundingRef && (
                        <div>
                          <dt>Contract ID</dt>
                          <dd>
                            <CopyableHash hash={current.fundingRef} label="Contract ID" />
                          </dd>
                        </div>
                      )}
                    </dl>

                    {/* Primary CTA button according to state */}
                    {current.status === 'DRAFT' && (
                      <button
                        className="primary"
                        disabled={!!busy || cantonOffline}
                        onClick={() => setModalAction('fund')}
                      >
                        {cantonOffline ? 'Canton unavailable' : 'Fund bounty →'}
                      </button>
                    )}

                    {current.status === 'FUNDED' && (
                      <button
                        className="primary"
                        disabled={!!busy || cantonOffline}
                        onClick={() => setModalAction('claim')}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {cantonOffline
                          ? 'Canton unavailable'
                          : cantonStatus.parties.contributor.handle.length > 12
                            ? 'Claim as contributor →'
                            : `Claim as @${cantonStatus.parties.contributor.handle} →`}
                      </button>
                    )}

                    {current.status === 'CLAIMED' && (
                      <button
                        className="primary"
                        disabled={!!busy}
                        onClick={() => setLinkingPr(true)}
                      >
                        Link pull request →
                      </button>
                    )}

                    {current.status === 'SUBMITTED' && (
                      <button
                        className="primary"
                        disabled={!!busy || cantonOffline}
                        onClick={() => setModalAction('approve')}
                      >
                        {cantonOffline ? 'Canton unavailable' : 'Approve work →'}
                      </button>
                    )}

                    {current.status === 'APPROVED' && (
                      <button
                        className="primary"
                        disabled={!!busy || cantonOffline}
                        onClick={() => setModalAction('settle')}
                      >
                        {cantonOffline ? 'Canton unavailable' : 'Settle bounty →'}
                      </button>
                    )}

                    {current.status === 'SETTLED' && (
                      <button
                        className="secondary"
                        onClick={() => setReceiptDrawerOpen(true)}
                      >
                        View receipt details ↗
                      </button>
                    )}
                  </section>
                </aside>
              </div>

              {/* PR EVIDENCE DRAWER */}
              <Drawer
                isOpen={evidenceDrawerOpen}
                onClose={() => setEvidenceDrawerOpen(false)}
                title="Pull Request Evidence"
                subtitle={`${current.repo} · PR #${current.submission?.number}`}
                width="540px"
              >
                {current.submission ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{current.submission.title}</strong>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!!busy}
                        onClick={() =>
                          run('Refreshing evidence...', async () => {
                            const fresh = await github.getPullRequest(current.repo, current.submission!.number);
                            if (fresh.sha !== current.submission?.sha) {
                              const updated = transition(current, { type: 'SUBMIT', submission: fresh });
                              setMessage(`Revision updated to ${fresh.sha.slice(0, 10)}. Previous approval invalidated.`);
                              return updated;
                            }
                            setMessage('Evidence refreshed for current revision.');
                            return { ...current, submission: fresh };
                          })
                        }
                      >
                        {busy === 'Refreshing evidence...' ? 'Refreshing...' : 'Refresh ↻'}
                      </button>
                    </div>

                    <div className="summary-box">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div>Branch: <code>{current.submission.branch}</code> → <code>{current.submission.baseBranch || 'main'}</code></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>Exact commit SHA:</span>
                          <CopyableHash hash={current.submission.sha} label="Commit SHA" />
                        </div>
                        <div>Merged: {current.submission.merged ? 'Yes' : 'No'}</div>
                        {current.submission.url && (
                          <div>
                            <a href={current.submission.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mint)', textDecoration: 'underline' }}>
                              Open on GitHub ↗
                            </a>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <h4 style={{ margin: '0 0 10px', fontSize: '13px' }}>CI Check Runs</h4>
                      {current.submission.checks.length > 0 ? (
                        <div className="checks">
                          {current.submission.checks.map((check, idx) => (
                            <div key={`${check.name}-${idx}`}>
                              <span className={check.state === 'passed' ? 'pass' : check.state === 'failed' ? 'warning' : 'muted'}>
                                {check.state === 'passed' ? '✓' : check.state === 'failed' ? '×' : '○'}
                              </span>
                              <div style={{ flex: 1 }}>
                                {check.url ? (
                                  <a href={check.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                                    {check.name}
                                  </a>
                                ) : (
                                  check.name
                                )}
                              </div>
                              <small>{check.conclusion || check.state}</small>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">No CI check runs reported for this commit.</p>
                      )}
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <h4 style={{ margin: 0, fontSize: '13px' }}>AI Assistive Assessment</h4>
                        <span className="mock-tag">ASSISTIVE ONLY</span>
                      </div>
                      {current.report ? (
                        current.report.criteria.map(item => (
                          <article className="report-item" key={item.criterion}>
                            <strong>{item.criterion}</strong>
                            <span className={item.assessment === 'Needs review' ? 'warning' : 'pass'}>
                              {item.assessment}
                            </span>
                            <p>{item.evidence}</p>
                            <small>{item.limitation}</small>
                          </article>
                        ))
                      ) : (
                        <p className="muted">Run AI verification to generate criteria satisfaction report.</p>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        style={{ marginTop: '12px' }}
                        disabled={!!busy}
                        onClick={() =>
                          run('Checking evidence...', async () => ({
                            ...current,
                            report: await ai.verify(current),
                          }))
                        }
                      >
                        {current.report ? 'Re-run AI verification' : 'Run AI verification'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted">No pull request currently linked.</p>
                )}
              </Drawer>

              {/* CANTON RECEIPT DRAWER */}
              <Drawer
                isOpen={receiptDrawerOpen}
                onClose={() => setReceiptDrawerOpen(false)}
                title="Canton Settlement Receipt"
                subtitle={`Recorded on ${cantonStatus.mode === 'real' ? cantonStatus.network : 'LocalNet · mock'}`}
                width="500px"
              >
                {current.settlement ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="summary-box">
                      <div className="summary-box-header">
                        <strong>Settlement Status</strong>
                        <Badge status={current.settlement.state === 'confirmed' ? 'SETTLED' : 'Failed'} />
                      </div>
                      <div>Amount: <strong>{current.amount} MMT</strong></div>
                      <div>Settled at: {new Date(current.settlement.timestamp).toLocaleString()}</div>
                    </div>

                    {/* Level C-Lite Fungible Token Transfer Highlight */}
                    <div
                      style={{
                        background: 'rgba(88, 203, 168, 0.08)',
                        border: '1px solid rgba(88, 203, 168, 0.25)',
                        borderRadius: '8px',
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <strong style={{ color: 'var(--mint)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>◈</span> Fungible Canton Ledger Token Transfer
                        </strong>
                        <span style={{ fontSize: '10px', background: 'rgba(88, 203, 168, 0.15)', color: 'var(--mint)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                          LEVEL C · CIP-56 HOLDING-COMPATIBLE
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text)' }}>
                        <strong>+{current.amount} MMT</strong> transferred directly to @{current.contributor?.handle || 'contributor'} on Canton ledger.
                      </p>
                      <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
                        Classification: Level C — CIP-56 Holding-compatible token settlement on Canton LocalNet. Implements official <code>Splice.Api.Token.HoldingV1:Holding</code> interface via <code>MergeMint.Token:MergeMintHolding</code> with application-specific escrow and settlement choices.
                      </small>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {current.settlement.tokenRecipientHoldingId && (
                        <div>
                          <small className="muted" style={{ display: 'block', marginBottom: '4px' }}>
                            Transferred Token Holding ID (CIP-56 Holding)
                          </small>
                          <CopyableHash
                            hash={current.settlement.tokenRecipientHoldingId}
                            label="Token Holding Contract ID"
                          />
                        </div>
                      )}

                      {current.tokenHoldingContractId && (
                        <div>
                          <small className="muted" style={{ display: 'block', marginBottom: '4px' }}>
                            Original Escrow Holding Contract ID
                          </small>
                          <CopyableHash
                            hash={current.tokenHoldingContractId}
                            label="Escrow Holding ID"
                          />
                        </div>
                      )}

                      <div>
                        <small className="muted" style={{ display: 'block', marginBottom: '4px' }}>Recipient Party ID</small>
                        <CopyableHash hash={current.settlement.recipient} label="Recipient Party ID" />
                      </div>

                      {current.fundingRef && (
                        <div>
                          <small className="muted" style={{ display: 'block', marginBottom: '4px' }}>Original Bounty Contract ID</small>
                          <CopyableHash hash={current.fundingRef} label="Contract ID" />
                        </div>
                      )}

                      {current.settlement.reference && (
                        <div>
                          <small className="muted" style={{ display: 'block', marginBottom: '4px' }}>Canton Transaction Reference</small>
                          <CopyableHash hash={current.settlement.reference} label="Transaction Reference" />
                        </div>
                      )}

                      <div>
                        <small className="muted" style={{ display: 'block', marginBottom: '4px' }}>Participant Endpoint</small>
                        <code>{cantonStatus.ledgerApiUrl}</code>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="muted">No settlement has occurred yet.</p>
                )}
              </Drawer>

              {/* ACTION MODALS */}
              {/* 0. LINK PULL REQUEST MODAL */}
              <Modal
                isOpen={linkingPr}
                onClose={() => {
                  setLinkingPr(false);
                  setPrInput('');
                }}
                title="Link GitHub Pull Request"
                subtitle={`${current.repo} · Target Issue #${current.issue}`}
                width="540px"
              >
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6 }}>
                  Linking a pull request binds its git commit SHA directly to this Canton bounty. Once linked, MergeMint verifies CI test checks and automated acceptance criteria before maintainer approval.
                </p>

                {/* Quick Selection Presets */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <small className="tiny-label" style={{ letterSpacing: '1.2px' }}>
                    QUICK PRESETS
                  </small>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {(isReal
                      ? [
                          { label: `PR #${current.issue} (Fix for issue #${current.issue})`, val: String(current.issue) },
                        ]
                      : [
                          { label: `PR #${current.issue} (Direct issue fix)`, val: String(current.issue) },
                          { label: `PR #${Number(current.issue) + 1} (Alternative fix)`, val: String(Number(current.issue) + 1) },
                        ]
                    ).map(preset => (
                      <button
                        key={preset.val}
                        type="button"
                        className="secondary"
                        style={{
                          fontSize: '11px',
                          padding: '6px 12px',
                          background: prInput.trim() === preset.val ? '#1f2e24' : '#141718',
                          borderColor: prInput.trim() === preset.val ? 'var(--mint)' : 'var(--line)',
                          color: prInput.trim() === preset.val ? 'var(--mint)' : 'var(--text)',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                        onClick={() => setPrInput(preset.val)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Manual Input */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="pr-input-modal" style={{ fontSize: '11px', fontWeight: 600 }}>
                    Pull Request Number or GitHub URL
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      id="pr-input-modal"
                      type="text"
                      placeholder="e.g. 218 or https://github.com/owner/repo/pull/218"
                      value={prInput}
                      onChange={e => setPrInput(e.target.value)}
                      style={{ flex: 1, margin: 0, padding: '10px 12px', fontSize: '12px' }}
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter' && prInput.trim() && !busy) {
                          handleLinkPR();
                        }
                      }}
                    />
                    {prInput && (
                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: '0 12px', whiteSpace: 'nowrap' }}
                        onClick={() => setPrInput('')}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Real-time Detection Preview Card */}
                {prInput.trim() ? (
                  <div
                    style={{
                      background: '#121614',
                      border: '1px solid #2d4536',
                      borderRadius: '6px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    <span style={{ fontSize: '20px', color: 'var(--mint)' }}>⎇</span>
                    <div style={{ fontSize: '11px', flex: 1 }}>
                      <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '2px' }}>
                        Target: Pull Request #{prInput.replace(/[^0-9]/g, '') || prInput.trim()}
                      </strong>
                      <span style={{ color: 'var(--muted)' }}>
                        Will inspect commit SHA, check runs, and PR status on {current.repo}.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      background: '#151819',
                      border: '1px dashed var(--line)',
                      borderRadius: '6px',
                      padding: '12px 14px',
                      fontSize: '11px',
                      color: 'var(--muted)',
                    }}
                  >
                    💡 Tip: Pick a preset above or paste any pull request URL from GitHub.
                  </div>
                )}

                <div className="modal-actions" style={{ marginTop: '12px' }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setLinkingPr(false);
                      setPrInput('');
                    }}
                    disabled={!!busy}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary"
                    style={{ width: 'auto', minWidth: '150px', whiteSpace: 'nowrap' }}
                    disabled={!prInput.trim() || !!busy}
                    onClick={handleLinkPR}
                  >
                    {busy === 'Linking pull request...' ? (
                      <>
                        <span className="spinner" /> Linking PR…
                      </>
                    ) : (
                      'Link PR to Bounty →'
                    )}
                  </button>
                </div>
              </Modal>

              {/* 1. FUND MODAL */}
              <Modal
                isOpen={modalAction === 'fund'}
                onClose={() => setModalAction(null)}
                title="Confirm Bounty Funding"
                subtitle={`Issue #${current.issue} · ${current.title}`}
              >
                <p>
                  You are locking <strong>{current.amount} MMT</strong> on the Canton ledger under party <code>@{current.sponsor.handle}</code>.
                </p>
                <div className="summary-box">
                  <div>Acceptance criteria: <strong>{current.criteria.length} items</strong></div>
                  <div>Network: <strong>{cantonStatus.network}</strong></div>
                </div>
                <div className="modal-actions">
                  <button type="button" className="secondary" onClick={() => setModalAction(null)} disabled={!!busy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!!busy}
                    onClick={() =>
                      run('Locking bounty on Canton...', async () =>
                        transition(current, {
                          type: 'FUND',
                          reference: await canton.fund(current),
                        })
                      )
                    }
                  >
                    {busy ? 'Locking...' : 'Confirm Funding →'}
                  </button>
                </div>
              </Modal>

              {/* 2. CLAIM MODAL */}
              <Modal
                isOpen={modalAction === 'claim'}
                onClose={() => setModalAction(null)}
                title="Claim Bounty"
                subtitle={`Issue #${current.issue} · ${current.amount} MMT`}
              >
                <p>
                  Exercising the on-ledger Claim choice as contributor <code>@{cantonStatus.parties.contributor.handle}</code>.
                </p>
                <div className="modal-actions">
                  <button type="button" className="secondary" onClick={() => setModalAction(null)} disabled={!!busy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!!busy}
                    onClick={() =>
                      run('Claiming bounty on Canton...', async () => {
                        const contributorParty = cantonStatus.parties.contributor;
                        await canton.claim(current.id, contributorParty);
                        return transition(current, {
                          type: 'CLAIM',
                          contributor: contributorParty,
                        });
                      })
                    }
                  >
                    {busy ? 'Claiming...' : 'Confirm Claim →'}
                  </button>
                </div>
              </Modal>

              {/* 3. APPROVE MODAL (Exact revision binding) */}
              <Modal
                isOpen={modalAction === 'approve'}
                onClose={() => setModalAction(null)}
                title="Maintainer Work Approval"
                subtitle={`PR #${current.submission?.number} · Issue #${current.issue}`}
              >
                <p>
                  You are approving this exact revision:
                </p>
                <div className="summary-box">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>Commit SHA:</span>
                    <CopyableHash hash={current.submission?.sha || ''} label="Commit SHA" />
                  </div>
                  <div>Contributor: <strong>@{current.contributor?.handle}</strong></div>
                  <div>Amount to award: <strong>{current.amount} MMT</strong></div>
                </div>
                {current.submission?.checks.some(c => c.state === 'failed') && (
                  <p className="warning-note">
                    ⚠️ CI contains failed check runs. Approval commits your acceptance of this work on-ledger.
                  </p>
                )}
                <div className="modal-actions">
                  <button type="button" className="secondary" onClick={() => setModalAction(null)} disabled={!!busy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!!busy}
                    onClick={() =>
                      run('Recording approval on Canton...', async () => {
                        await canton.approve(
                          current,
                          current.submission!.sha,
                          current.maintainer
                        );
                        return transition(current, {
                          type: 'APPROVE',
                          actor: current.maintainer.partyId,
                          sha: current.submission!.sha,
                        });
                      })
                    }
                  >
                    {busy ? 'Approving...' : 'Confirm Approval →'}
                  </button>
                </div>
              </Modal>

              {/* 4. SETTLE MODAL */}
              <Modal
                isOpen={modalAction === 'settle'}
                onClose={() => setModalAction(null)}
                title="Settle Bounty & Settle CIP-56 Holding"
                subtitle={`Release & transfer ${current.amount} MMT directly to @${current.contributor?.handle || 'contributor'}`}
              >
                <p>
                  This executes an atomic transaction on Canton: consuming the bounty contract, generating an on-chain SettledReceipt, and settling the CIP-56 token holding (<code>MergeMint.Token:MergeMintHolding</code> implementing <code>Splice.Api.Token.HoldingV1:Holding</code>) directly to contributor <code>@{current.contributor?.handle || 'contributor'}</code>.
                </p>
                <label className="failure-toggle" style={{ marginTop: '12px' }}>
                  <input
                    type="checkbox"
                    checked={failSimulation}
                    onChange={e => setFailSimulation(e.target.checked)}
                    disabled={!!busy}
                  />{' '}
                  Simulate transient settlement failure
                </label>
                <div className="modal-actions">
                  <button type="button" className="secondary" onClick={() => setModalAction(null)} disabled={!!busy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!!busy}
                    onClick={() =>
                      run('Submitting settlement on Canton...', async () => {
                        try {
                          return transition(current, {
                            type: 'SETTLE',
                            reference: await canton.settle(current, failSimulation),
                          });
                        } catch (e) {
                          const failedBounty: Bounty = {
                            ...current,
                            settlement: {
                              state: 'failed',
                              recipient: current.contributor!.partyId,
                              amount: current.amount,
                              timestamp: new Date().toISOString(),
                            },
                          };
                          await bountyRepository.save(failedBounty);
                          setBounties(all => all.map(b => (b.id === current.id ? failedBounty : b)));
                          throw e;
                        }
                      })
                    }
                  >
                    {busy ? 'Settling...' : 'Execute Settlement →'}
                  </button>
                </div>
              </Modal>
            </>
          ) : (
            /* VIEW 3: STREAMLINED DASHBOARD OVERVIEW */
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MAINTAINER WORKSPACE</div>
                  <h1>
                    {page === 'Activity'
                      ? 'Every step, accounted for.'
                      : page === 'Bounties'
                        ? 'Your funded work.'
                        : 'Move good work forward.'}
                  </h1>
                  <p>From open issue to rewarded contribution. One connected workflow.</p>
                </div>
                <div className="heading-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setStartWithScout(true);
                      setCreating(true);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      color: 'var(--mint)',
                      borderColor: 'rgba(88, 203, 168, 0.3)',
                    }}
                    title="Launch Scout AI codebase analysis to discover fundable tasks"
                  >
                    <span>✦ Scout Repo</span>
                  </button>
                  <button
                    className="btn-create-bounty"
                    onClick={() => {
                      setStartWithScout(false);
                      setCreating(true);
                    }}
                  >
                    + Create bounty
                  </button>
                </div>
              </div>

              {/* Repo Bar */}
              <div className="repo-bar">
                <div className="repo-picker">
                  <span className="repo-icon">⌘</span>
                  <label className="sr-only" htmlFor="repo">
                    Selected repository
                  </label>
                  <select id="repo" value={repo} onChange={e => setRepo(e.target.value)}>
                    <option value="ALL">All repositories ({bounties.length})</option>
                    {availableRepos.map(r => {
                      const repoCount = bounties.filter(b => b.repo === r).length;
                      return (
                        <option key={r} value={r}>
                          {r} {repoCount > 0 ? `(${repoCount})` : ''}
                        </option>
                      );
                    })}
                  </select>
                  <span className="connected">
                    {authStatus.mode === 'real' ? (
                      authStatus.connected ? (
                        <span style={{ color: 'var(--mint)' }}>● Connected · @{authStatus.user?.login}</span>
                      ) : authStatus.installed ? (
                        <span style={{ color: 'var(--mint)' }}>● Connected · GitHub App</span>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>○ Disconnected</span>
                      )
                    ) : (
                      <span>● Connected · mock</span>
                    )}
                  </span>
                </div>
              </div>

              {/* 3 Compact Metric Cards */}
              <div className="stats-cards">
                <div className="stat-card">
                  <small>Active Bounties</small>
                  <strong>{activeBountiesCount}</strong>
                  <span className="stat-card-sub">In progress or funded</span>
                </div>
                <div className="stat-card">
                  <small>Pending Reviews</small>
                  <strong>{pendingReviewsCount}</strong>
                  <span className="stat-card-sub">PRs awaiting your review</span>
                </div>
                <div className="stat-card">
                  <small>Total Funded</small>
                  <strong>{totalFundedMMT} MMT</strong>
                  <span className="stat-card-sub">On-ledger commitments</span>
                </div>
              </div>

              {page === 'Activity' ? (
                <section className="activity-list">
                  <h2>Workspace activity</h2>
                  {activity.map((item, i) => (
                    <div key={`${item}-${i}`}>
                      <span className="activity-dot">✓</span>
                      <p>
                        {item}
                        <small>{cantonStatus.mode === 'real' ? 'Recorded on Canton' : 'Workspace event'}</small>
                      </p>
                    </div>
                  ))}
                </section>
              ) : (
                <>
                  {/* Needs Your Attention Section */}
                  {actionableItems.length > 0 && page === 'Dashboard' && (
                    <section className="needs-attention-section">
                      <div className="section-title">
                        <h2>Needs your attention</h2>
                        <span className="muted">{actionableItems.length} actionable</span>
                      </div>
                      <div className="attention-grid">
                        {actionableItems.map(b => (
                          <div
                            key={b.id}
                            className="attention-row"
                            onClick={() => open(b.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={e => {
                              if (e.key === 'Enter') open(b.id);
                            }}
                          >
                            <span
                              className={`attention-badge ${
                                b.status === 'SUBMITTED' ? 'review' : b.status === 'APPROVED' ? 'settle' : 'claim'
                              }`}
                            >
                              {b.status === 'SUBMITTED' ? 'PR REVIEW' : b.status === 'APPROVED' ? 'READY TO SETTLE' : 'CLAIMED'}
                            </span>
                            <div className="attention-title">
                              <strong>#{b.issue} · {b.title}</strong>
                              <small>
                                {b.submission ? `PR #${b.submission.number} linked · ` : ''}
                                {b.amount} MMT to @{b.contributor?.handle || 'contributor'}
                              </small>
                            </div>
                            <span className="attention-action">{actions[b.status]} →</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Clean Bounties Table */}
                  <section className="bounties-section">
                    <div className="section-title">
                      <h2>
                        Bounties <span className="count">{list.length}</span>
                      </h2>
                      <span className="muted">Amounts in MergeMint Token (MMT) · Canton CIP-56 Holding</span>
                    </div>

                    <div className="table-tools">
                      <div className="tabs">
                        <button
                          className={filter === 'ALL' ? 'selected' : ''}
                          onClick={() => setFilter('ALL')}
                        >
                          All bounties
                        </button>
                        <button
                          className={filter === 'SUBMITTED' ? 'selected' : ''}
                          onClick={() => setFilter('SUBMITTED')}
                        >
                          Needs review{' '}
                          <span>{list.filter(b => b.status === 'SUBMITTED').length}</span>
                        </button>
                      </div>
                      <input
                        aria-label="Search bounties"
                        placeholder="Search issues or contributors…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                      />
                    </div>

                    {visible.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Issue / repository</th>
                              <th>Amount</th>
                              <th>Status</th>
                              <th>Contributor</th>
                              <th>PR / CI</th>
                              <th>Activity</th>
                              <th>
                                <span className="sr-only">Action</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map(b => (
                              <tr key={b.id}>
                                <td>
                                  <button className="issue-link" onClick={() => open(b.id)}>
                                    <span className="issue-number">#{b.issue}</span> {b.title}
                                  </button>
                                  <small>{b.repo}</small>
                                </td>
                                <td className="money">
                                  {b.amount} <span>MMT</span>
                                </td>
                                <td>
                                  <Badge status={b.status} />
                                </td>
                                <td>
                                  {b.contributor ? (
                                    `@${b.contributor.handle}`
                                  ) : (
                                    <span className="muted">Unassigned</span>
                                  )}
                                </td>
                                <td>
                                  {b.submission ? (
                                    <>
                                      <span>⑂ #{b.submission.number}</span>
                                      <small className="warning">
                                        {b.submission.checks.filter(c => c.state === 'passed').length}/
                                        {b.submission.checks.length} passing
                                      </small>
                                    </>
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </td>
                                <td className="muted">{b.activity}</td>
                                <td>
                                  <button className="row-action" onClick={() => open(b.id)}>
                                    {actions[b.status]} ↗
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty">
                        <span>◇</span>
                        <h3>
                          {query || filter !== 'ALL'
                            ? 'No matching bounties'
                            : repo && repo !== 'ALL'
                              ? `No bounties for ${repo} yet`
                              : 'No bounties yet'}
                        </h3>
                        <p>
                          {query || filter !== 'ALL'
                            ? 'Try another search or view all bounties.'
                            : repo && repo !== 'ALL'
                              ? 'Turn an open issue from this repository into your first funded bounty.'
                              : 'Turn an open GitHub issue into your first funded bounty.'}
                        </p>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setStartWithScout(true);
                              setCreating(true);
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              color: 'var(--mint)',
                              borderColor: 'rgba(88, 203, 168, 0.3)',
                            }}
                          >
                            <span>✦ Scout Repo</span>
                          </button>
                          {authStatus.mode !== 'real' && (
                            <button
                              className="secondary"
                              onClick={() => {
                                setRepo(repositories[0]);
                                setQuery('');
                                setFilter('ALL');
                              }}
                            >
                              View demo bounties
                            </button>
                          )}
                          <button
                            className="btn-create-bounty"
                            onClick={() => {
                              setStartWithScout(false);
                              setCreating(true);
                            }}
                          >
                            + Create bounty
                          </button>
                        </div>
                      </div>
                    )}
                  </section>

                  <div className="bottom-note">
                    <span>
                      ◈ Funding lives on Canton. Evidence lives on GitHub. Approval stays with you.
                    </span>
                    <span>
                      {cantonStatus.mode === 'real'
                        ? 'Settlement confirmed on Canton LocalNet.'
                        : 'Simulated preview mode.'}
                    </span>
                  </div>
                </>
              )}
            </>
          )}

          {/* Feedback Toast */}
          {(busy || message || error) && (
            <div
              className={`feedback ${error ? 'error' : ''}`}
              role={error ? 'alert' : 'status'}
            >
              {busy ? (
                <>
                  <span className="spinner" />
                  {busy}
                </>
              ) : (
                error || message
              )}
              {!busy && (
                <button
                  aria-label="Dismiss notification"
                  onClick={() => {
                    setMessage('');
                    setError('');
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
