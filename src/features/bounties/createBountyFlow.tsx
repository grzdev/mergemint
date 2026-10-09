'use client';

import { useState, useEffect } from 'react';
import type { Bounty, Party } from '@/domain/bounty';
import {
  validateRepositorySelection,
  validateIssueSelection,
  validateTerms,
  createBountyDraft,
  fundBountyDraft,
} from '@/domain/createBounty';
import { github, type GitHubRepo, type GitHubIssue, type GitHubAuthStatus, isMockRepo } from '@/integrations/github';
import { ai } from '@/integrations/ai';
import { canton, type CantonStatus } from '@/integrations/canton';
import { bountyRepository } from '@/storage/bountyRepository';
import { ScoutDrawer } from '@/features/scout/scoutDrawer';
import type { ScoutAnalysisResult, ScoutOpportunity } from '@/domain/scout';

interface CreateBountyFlowProps {
  initialRepo?: string;
  initialScout?: boolean;
  initialStep?: 1 | 2 | 3 | 4;
  initialOpportunity?: ScoutOpportunity | null;
  onCancel: () => void;
  onSuccess: (bounty: Bounty) => void;
}

export function CreateBountyFlow({ initialRepo, initialScout, initialStep, initialOpportunity, onCancel, onSuccess }: CreateBountyFlowProps) {
  // Stepper state: 1: Repo, 2: Issue, 3: Terms, 4: Fund
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initialStep || (initialOpportunity ? 2 : 1));

  // Repositories state
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [reposError, setReposError] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  // In real mode, always start with NO repository selected unless a live non-mock repo is explicitly selected
  const [selectedRepo, setSelectedRepo] = useState<string>(initialRepo || '');
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus | null>(null);

  // Issues state
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState('');
  const [issueSearch, setIssueSearch] = useState('');
  const [selectedLabel, setSelectedLabel] = useState<string>('ALL');
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null);

  // Terms state
  const [amount, setAmount] = useState<string>(initialOpportunity?.suggestedAmount || '500');
  const [sponsor, setSponsor] = useState<Party>({
    handle: 'mergemint-labs',
    partyId: 'sponsor::demo-labs',
  });
  const [maintainer, setMaintainer] = useState<Party>({
    handle: 'alexmorgan',
    partyId: 'maintainer::demo-alex',
  });
  const [criteria, setCriteria] = useState<string[]>(
    initialOpportunity?.suggestedCriteria || [
      'Reject null and array query values',
      'Add regression tests for invalid inputs',
      'Preserve existing valid query behavior',
    ]
  );
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(
    initialOpportunity
      ? 'Scout suggested these terms. Select an existing GitHub issue, then review and edit the criteria.'
      : null
  );

  // Scout AI state
  const [scoutResult, setScoutResult] = useState<ScoutAnalysisResult | null>(null);
  const [scoutLoading, setScoutLoading] = useState(false);
  const [scoutError, setScoutError] = useState('');
  const [scoutDrawerOpen, setScoutDrawerOpen] = useState(Boolean(initialScout));

  // Funding & Receipt state
  const [funding, setFunding] = useState(false);
  const [error, setError] = useState<string>('');
  const [createdBounty, setCreatedBounty] = useState<Bounty | null>(null);
  const [cantonStatus, setCantonStatus] = useState<CantonStatus>({
    mode: 'mock',
    connected: true,
    network: 'Canton · Demo',
    ledgerApiUrl: 'internal://mock',
    parties: {
      sponsor: { handle: 'mergemint-labs', partyId: 'mergemint-sponsor::mock' },
      maintainer: { handle: 'alexmorgan', partyId: 'alexmorgan::mock' },
      contributor: { handle: 'juleschen', partyId: 'juleschen::mock' },
    },
  });

  // Load repositories on mount
  useEffect(() => {
    let mounted = true;
    setReposLoading(true);
    setReposError('');

    canton.getStatus().then(st => {
      if (mounted) {
        setCantonStatus(st);
        if (st.mode === 'real') {
          setSponsor(st.parties.sponsor);
          setMaintainer(st.parties.maintainer);
        }
      }
    }).catch(() => {});

    github.getAuthStatus().then(st => {
      if (mounted) setAuthStatus(st);
    }).catch(() => {});

    github.getRepositories().then(data => {
      if (!mounted) return;
      setRepos(data);
      setReposLoading(false);

      const isMockMode = (authStatus?.mode === 'mock') || (data.length > 0 && data.every(r => isMockRepo(r.fullName)));

      if (isMockMode) {
        if (initialRepo && data.some(r => r.fullName === initialRepo)) {
          setSelectedRepo(initialRepo);
        } else if (data.length > 0 && !selectedRepo) {
          setSelectedRepo(data[0].fullName);
        }
      } else {
        // REAL GITHUB MODE:
        // 1. Start with NO repository selected unless a real accessible repository has explicitly been selected by the user.
        // 2. Never use a mock/seed repository such as mergemint/core as the selected repository.
        // 3. Only accept initialRepo if it is a real accessible repository (NOT a mock repo) returned by the GitHub installation.
        if (initialRepo && !isMockRepo(initialRepo) && data.some(r => r.fullName === initialRepo)) {
          setSelectedRepo(initialRepo);
        } else {
          setSelectedRepo('');
        }
      }
    }).catch(err => {
      if (mounted) {
        setReposLoading(false);
        setReposError(err instanceof Error ? err.message : 'Failed to fetch repositories.');
      }
    });

    return () => {
      mounted = false;
    };
  }, [initialRepo, authStatus?.mode]);

  // Discard mock repository selection if in real mode
  useEffect(() => {
    if (authStatus?.mode === 'real' && selectedRepo && isMockRepo(selectedRepo)) {
      setSelectedRepo('');
      setIssues([]);
      setSelectedIssue(null);
    }
  }, [authStatus?.mode, selectedRepo]);

  // Load issues when repository changes
  useEffect(() => {
    // Never fetch issues for an empty repo or a mock repo in real mode
    if (!selectedRepo || (authStatus?.mode === 'real' && isMockRepo(selectedRepo))) {
      setIssues([]);
      setSelectedIssue(null);
      setIssuesLoading(false);
      return;
    }

    let mounted = true;
    setIssuesLoading(true);
    setIssuesError('');

    github.getIssues(selectedRepo).then(data => {
      if (mounted) {
        setIssues(data);
        setIssuesLoading(false);
        // Pre-select first issue or matching issue
        if (data.length > 0) {
          setSelectedIssue(data[0]);
        } else {
          setSelectedIssue(null);
        }
      }
    }).catch(err => {
      if (mounted) {
        setIssues([]);
        setSelectedIssue(null);
        setIssuesLoading(false);
        setIssuesError(err instanceof Error ? err.message : 'Failed to load issues from GitHub.');
      }
    });

    return () => {
      mounted = false;
    };
  }, [selectedRepo, authStatus?.mode]);

  // Handlers for Acceptance Criteria
  const handleAddCriterion = () => {
    setCriteria(prev => [...prev, '']);
  };

  const handleUpdateCriterion = (index: number, value: string) => {
    setCriteria(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleDeleteCriterion = (index: number) => {
    setCriteria(prev => prev.filter((_, i) => i !== index));
  };

  const handleSuggestAI = async () => {
    if (!selectedIssue) return;
    setAiGenerating(true);
    setError('');
    try {
      const suggested = await ai.criteria(selectedIssue.title, selectedIssue.description);
      setCriteria(suggested);
      setAiNote('Suggested from the issue. Review before funding.');
    } catch {
      setError('Could not generate criteria. You can write them manually.');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleRunScout = async (repoToScan?: string) => {
    const targetRepo = repoToScan || selectedRepo;
    if (!targetRepo) return;
    setScoutLoading(true);
    setScoutError('');
    setScoutDrawerOpen(true);
    try {
      const res = await fetch('/api/scout/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: targetRepo, existingIssueCount: issues.length }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Scout discovery failed (${res.status})`);
      }
      const data: ScoutAnalysisResult = await res.json();
      setScoutResult(data);
    } catch (err) {
      setScoutError(err instanceof Error ? err.message : 'Scout failed to analyze repository.');
    } finally {
      setScoutLoading(false);
    }
  };

  const handleSelectScoutOpportunity = (opp: ScoutOpportunity, oppRepo?: string) => {
    if (oppRepo && oppRepo !== selectedRepo) {
      setSelectedRepo(oppRepo);
    }
    setSelectedIssue(null);
    setAmount(opp.suggestedAmount);
    setCriteria(opp.suggestedCriteria);
    setAiNote('Scout suggested these terms. Select an existing GitHub issue, then review and edit the criteria. Scout has not created an issue.');
    setScoutDrawerOpen(false);
    setStep(2);
  };

  // Trigger Scout if opened with initialScout
  useEffect(() => {
    if (initialScout && selectedRepo && !scoutResult && !scoutLoading) {
      handleRunScout(selectedRepo);
    }
  }, [initialScout, selectedRepo]);

  // Step transitions
  const canContinueFromStep1 = validateRepositorySelection(selectedRepo).valid;
  const canContinueFromStep2 = validateIssueSelection(selectedIssue?.number).valid;
  const termsValidation = validateTerms(amount, criteria, sponsor, maintainer);
  const canContinueFromStep3 = termsValidation.valid;

  // Handle funding
  const handleFund = async () => {
    if (!selectedIssue) return;
    setError('');
    setFunding(true);

    try {
      // 1. Create draft
      const draft = createBountyDraft({
        repo: selectedRepo,
        issue: selectedIssue.number,
        title: selectedIssue.title,
        amount,
        criteria,
        sponsor,
        maintainer,
      });

      // 2. Lock funds on Canton (mocked)
      const lockRef = await canton.fund(draft);

      // 3. Transition DRAFT -> FUNDED
      const fundedBounty = fundBountyDraft(draft, lockRef);

      // 4. Save to persistent repository
      await bountyRepository.save(fundedBounty);

      setCreatedBounty(fundedBounty);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Funding failed. Please retry.');
    } finally {
      setFunding(false);
    }
  };

  // Filtered repositories for Step 1
  const filteredRepos = repos.filter(
    r =>
      r.fullName.toLowerCase().includes(repoSearch.toLowerCase()) ||
      r.description.toLowerCase().includes(repoSearch.toLowerCase())
  );

  // Unique labels for Step 2
  const allLabels = Array.from(new Set(issues.flatMap(i => i.labels)));

  // Filtered issues for Step 2
  const filteredIssues = issues.filter(issue => {
    const matchesSearch =
      issue.title.toLowerCase().includes(issueSearch.toLowerCase()) ||
      String(issue.number).includes(issueSearch) ||
      issue.author.toLowerCase().includes(issueSearch.toLowerCase());
    const matchesLabel = selectedLabel === 'ALL' || issue.labels.includes(selectedLabel);
    return matchesSearch && matchesLabel;
  });

  return (
    <div className="create-flow">
      {/* Header bar with Back button and Cancel */}
      <div className="flow-topbar">
        <button className="back" onClick={onCancel} aria-label="Cancel and back to dashboard">
          ← Cancel and return to workspace
        </button>
        <span className="flow-mode-tag">
          {cantonStatus.mode === 'real' ? (
            <span
              className="mock-tag"
              style={{
                background: cantonStatus.connected ? 'rgba(88, 203, 168, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: cantonStatus.connected ? '#58cba8' : '#ef4444',
                borderColor: cantonStatus.connected ? 'rgba(88, 203, 168, 0.3)' : 'rgba(239, 68, 68, 0.3)',
              }}
            >
              Canton LocalNet · {cantonStatus.connected ? 'Connected' : 'Offline'}
            </span>
          ) : (
            <span className="mock-tag">CANTON SIMULATED</span>
          )}
        </span>
      </div>

      <div className="page-heading">
        <div>
          <div className="eyebrow">NEW BOUNTY WORKFLOW</div>
          <h1>Create and fund bounty</h1>
          <p>Define clear acceptance criteria and secure payment through Canton.</p>
        </div>
      </div>

      {/* Stepper Indicator */}
      <div className="stepper-nav" aria-label="Creation progress">
        {[
          { num: 1, label: 'Repository', detail: selectedRepo || 'Select repo' },
          {
            num: 2,
            label: 'Issue',
            detail: selectedIssue ? `#${selectedIssue.number}` : 'Select issue',
          },
          { num: 3, label: 'Terms', detail: `${amount} MMT · criteria` },
          {
            num: 4,
            label: 'Review & Fund',
            detail: createdBounty ? 'Funded' : 'Confirmation',
          },
        ].map(s => {
          const isDone = createdBounty ? true : step > s.num;
          const isCurrent = !createdBounty && step === s.num;
          return (
            <div
              key={s.num}
              className={`stepper-item ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}`}
            >
              <div className="stepper-bubble">{isDone ? '✓' : s.num}</div>
              <div className="stepper-text">
                <strong>{s.label}</strong>
                <small>{s.detail}</small>
              </div>
            </div>
          );
        })}
      </div>

      {/* Flow Body */}
      <div className="flow-body">
        {/* STEP 1: REPOSITORY */}
        {step === 1 && (
          <section className="step-panel" aria-labelledby="step-1-title">
            <div className="step-panel-header">
              <div>
                <h2 id="step-1-title">
                  <span>01</span> Select repository
                </h2>
                <p className="muted">
                  Choose the GitHub repository containing the issue to fund.
                </p>
              </div>
              <input
                type="text"
                placeholder="Search connected repositories…"
                value={repoSearch}
                onChange={e => setRepoSearch(e.target.value)}
                aria-label="Search repositories"
              />
            </div>

            {reposLoading ? (
              <div className="empty-inline">
                <span className="spinner" /> Loading repositories from GitHub…
              </div>
            ) : repos.length === 0 && authStatus?.mode === 'real' && !authStatus.connected ? (
              <div
                className="empty-inline"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  alignItems: 'center',
                  padding: '32px 16px',
                }}
              >
                <strong style={{ fontSize: '13px' }}>GitHub not connected</strong>
                <p className="muted" style={{ maxWidth: '420px', textAlign: 'center', margin: 0 }}>
                  Connect your GitHub account to access repositories with the MergeMint GitHub App.
                </p>
                <button
                  type="button"
                  className="primary"
                  style={{ width: 'auto', marginTop: '6px' }}
                  onClick={() => (window.location.href = '/api/github/auth/login')}
                >
                  Connect GitHub →
                </button>
              </div>
            ) : authStatus?.mode === 'real' && authStatus.connected && !authStatus.installed ? (
              <div
                className="empty-inline"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  alignItems: 'center',
                  padding: '32px 16px',
                }}
              >
                <strong style={{ fontSize: '13px' }}>GitHub App not installed</strong>
                <p className="muted" style={{ maxWidth: '420px', textAlign: 'center', margin: 0 }}>
                  The MergeMint GitHub App is not installed on any repository. Install the app on selected repositories to continue.
                </p>
                <a
                  href={authStatus.installUrl || 'https://github.com/apps/mergemint/installations/new'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="primary"
                  style={{ display: 'inline-block', width: 'auto', textAlign: 'center', marginTop: '6px' }}
                >
                  Install MergeMint on GitHub ↗
                </a>
              </div>
            ) : reposError ? (
              <div className="empty-inline" style={{ color: '#e59f8c' }}>
                <p>{reposError}</p>
                <button
                  type="button"
                  className="secondary"
                  style={{ marginTop: '10px' }}
                  onClick={() => {
                    setReposLoading(true);
                    setReposError('');
                    github
                      .getRepositories()
                      .then(data => {
                        setRepos(data);
                        setReposLoading(false);
                        if (data.length > 0 && !selectedRepo) setSelectedRepo(data[0].fullName);
                      })
                      .catch(err => {
                        setReposLoading(false);
                        setReposError(err instanceof Error ? err.message : 'Failed to fetch repositories.');
                      });
                  }}
                >
                  Retry loading repositories
                </button>
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="empty-inline">
                {repoSearch
                  ? 'No repositories match your search.'
                  : 'No repositories accessible through GitHub App installation. Ensure repositories are selected in your installation.'}
              </div>
            ) : (
              <div className="repo-selection-grid">
                {filteredRepos.map(r => {
                  const isSelected = selectedRepo === r.fullName;
                  return (
                    <button
                      key={r.fullName}
                      type="button"
                      className={`repo-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedRepo(r.fullName)}
                      aria-pressed={isSelected}
                    >
                      <div className="repo-card-top">
                        <span className="repo-card-icon">⌘</span>
                        <div className="repo-card-title">
                          <strong>{r.fullName}</strong>
                          <small>by @{r.owner}</small>
                        </div>
                        <span className="repo-badge">{r.visibility}</span>
                        {isSelected && <span className="selected-indicator">✓ Selected</span>}
                      </div>
                      <p className="repo-card-desc">{r.description}</p>
                      <div className="repo-card-meta">
                        <span>● {r.language}</span>
                        <span>{r.openIssuesCount} open issues</span>
                        <span className="muted">{r.updatedAt}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="step-actions">
              <button className="secondary" onClick={onCancel}>
                Cancel
              </button>
              <button
                className="primary step-next"
                disabled={!canContinueFromStep1}
                onClick={() => setStep(2)}
              >
                Continue to Issue →
              </button>
            </div>
          </section>
        )}

        {/* STEP 2: ISSUE */}
        {step === 2 && (
          <section className="step-panel" aria-labelledby="step-2-title">
            <div className="step-panel-header">
              <div>
                <h2 id="step-2-title">
                  <span>02</span> Select open issue
                </h2>
                <p className="muted">
                  Showing open issues from <strong>{selectedRepo}</strong>.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Search issues by title, # or author…"
                  value={issueSearch}
                  onChange={e => setIssueSearch(e.target.value)}
                  aria-label="Search issues"
                  style={{ margin: 0, minWidth: '220px' }}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => handleRunScout()}
                  disabled={scoutLoading}
                  style={{
                    padding: '8px 14px',
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap',
                    color: 'var(--mint)',
                    borderColor: 'rgba(88, 203, 168, 0.3)',
                  }}
                  title="Run Scout AI codebase analysis to discover fundable tasks"
                >
                  {scoutLoading ? (
                    <>
                      <span className="spinner" /> Scanning…
                    </>
                  ) : (
                    <>
                      <span>✦</span> Scout AI
                    </>
                  )}
                </button>
                {selectedIssue && (
                  <button
                    type="button"
                    className="primary step-next"
                    onClick={() => setStep(3)}
                    style={{ padding: '9px 18px', fontSize: '12px' }}
                  >
                    Continue to Terms →
                  </button>
                )}
              </div>
            </div>

            {/* Label filter tabs */}
            <div className="issue-filter-tabs">
              <button
                className={selectedLabel === 'ALL' ? 'active' : ''}
                onClick={() => setSelectedLabel('ALL')}
              >
                All issues ({issues.length})
              </button>
              {allLabels.map(lbl => (
                <button
                  key={lbl}
                  className={selectedLabel === lbl ? 'active' : ''}
                  onClick={() => setSelectedLabel(lbl)}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {issuesLoading ? (
              <div className="empty-inline">
                <span className="spinner" /> Loading open issues from GitHub…
              </div>
            ) : issuesError ? (
              <div className="error-banner" style={{ marginBottom: 16 }}>
                <div>
                  <strong>GitHub API Error:</strong> {issuesError}
                </div>
                <button
                  type="button"
                  className="secondary small"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    if (!selectedRepo) return;
                    setIssuesLoading(true);
                    setIssuesError('');
                    github
                      .getIssues(selectedRepo)
                      .then(data => {
                        setIssues(data);
                        setIssuesLoading(false);
                        if (data.length > 0) {
                          setSelectedIssue(data[0]);
                        } else {
                          setSelectedIssue(null);
                        }
                      })
                      .catch(err => {
                        setIssues([]);
                        setSelectedIssue(null);
                        setIssuesLoading(false);
                        setIssuesError(
                          err instanceof Error ? err.message : 'Failed to load issues from GitHub.'
                        );
                      });
                  }}
                >
                  Retry loading issues
                </button>
              </div>
            ) : filteredIssues.length === 0 ? (
              <div
                style={{
                  padding: '32px 20px',
                  textAlign: 'center',
                  background: 'rgba(88, 203, 168, 0.04)',
                  border: '1px dashed rgba(88, 203, 168, 0.3)',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--mint)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>✦</span> No open issues found in {selectedRepo}
                </div>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)', maxWidth: '440px', lineHeight: 1.5 }}>
                  MergeMint Scout can autonomously scan this codebase for technical debt, error recovery, and standards-compliant upgrades, turning opportunities into ready-to-fund bounties.
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => handleRunScout()}
                  disabled={scoutLoading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 18px', fontSize: '12px' }}
                >
                  {scoutLoading ? (
                    <>
                      <span className="spinner" /> Analyzing repository…
                    </>
                  ) : (
                    <>
                      <span>✦ Launch Scout AI Discovery</span> →
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="issue-selection-layout">
                {/* Issue list */}
                <div className="issue-list-col">
                  {filteredIssues.map(issue => {
                    const isSelected = selectedIssue?.number === issue.number;
                    return (
                      <button
                        key={issue.number}
                        type="button"
                        className={`issue-picker-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedIssue(issue)}
                        onDoubleClick={() => setStep(3)}
                        aria-pressed={isSelected}
                        title="Click to preview, double-click to continue"
                      >
                        <div className="issue-picker-header">
                          <span className="issue-number">#{issue.number}</span>
                          <strong>{issue.title}</strong>
                          {isSelected && <span className="selected-indicator">✓</span>}
                        </div>
                        <div className="issue-picker-meta">
                          <span>by @{issue.author}</span>
                          <span>💬 {issue.comments} comments</span>
                          <span className="muted">{issue.updatedAt}</span>
                        </div>
                        <div className="issue-labels">
                          {issue.labels.map(l => (
                            <span key={l} className="label-chip">
                              {l}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Contextual issue preview */}
                <div className="issue-preview-col">
                  {selectedIssue ? (
                    <div className="contextual-preview">
                      <div className="eyebrow">SELECTED ISSUE PREVIEW</div>
                      <h3>
                        #{selectedIssue.number} {selectedIssue.title}
                      </h3>
                      <div className="preview-meta">
                        <span>Author: @{selectedIssue.author}</span>
                        <span>Updated: {selectedIssue.updatedAt}</span>
                        <span>Comments: {selectedIssue.comments}</span>
                      </div>
                      <div className="preview-labels">
                        {selectedIssue.labels.map(l => (
                          <span key={l} className="label-chip">
                            {l}
                          </span>
                        ))}
                      </div>
                      <div className="preview-body">
                        <strong>Description excerpt</strong>
                        <p>{selectedIssue.description}</p>
                      </div>
                      <div className="preview-note">
                        ✓ This issue will be linked to the Canton smart contract upon funding.
                      </div>
                      <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--line)' }}>
                        <button
                          type="button"
                          className="primary step-next"
                          style={{ width: '100%', whiteSpace: 'nowrap' }}
                          onClick={() => setStep(3)}
                        >
                          Continue to Terms (#{selectedIssue.number}) →
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-inline">Select an issue from the list to preview.</div>
                  )}
                </div>
              </div>
            )}

            <div className="step-actions">
              <button className="secondary" onClick={() => setStep(1)}>
                ← Back to Repository
              </button>
              <button
                className="primary step-next"
                disabled={!canContinueFromStep2}
                onClick={() => setStep(3)}
              >
                Continue to Terms →
              </button>
            </div>
          </section>
        )}

        {/* STEP 3: TERMS */}
        {step === 3 && (
          <section className="step-panel" aria-labelledby="step-3-title">
            <div className="step-panel-header">
              <div>
                <h2 id="step-3-title">
                  <span>03</span> Define terms & acceptance criteria
                </h2>
                <p className="muted">
                  Bounty terms for <strong>{selectedRepo}</strong> ·{' '}
                  <strong>#{selectedIssue?.number} {selectedIssue?.title}</strong>
                </p>
              </div>
            </div>

            <div className="terms-grid">
              {/* Left Column: Bounty Amount & Parties */}
              <div className="terms-form-col">
                <div className="field-group">
                  <label htmlFor="bounty-amount">
                    <strong>Bounty Amount</strong>
                    <small>Funds locked in Canton settlement contract</small>
                  </label>
                  <div className="amount-input-wrap">
                    <input
                      id="bounty-amount"
                      type="text"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="e.g. 500"
                    />
                    <span className="asset-tag">MMT · Canton IOU Token</span>
                  </div>
                  {termsValidation.errors.amount && (
                    <p className="field-error">{termsValidation.errors.amount}</p>
                  )}
                </div>

                {/* Separate Parties */}
                <div className="parties-card">
                  <div className="eyebrow">PARTIES</div>
                  <div className="party-row">
                    <div>
                      <strong>Sponsor</strong>
                      <small>Funds the locked bounty</small>
                    </div>
                    <div className="party-val">
                      <span>@{sponsor.handle}</span>
                      <code>{sponsor.partyId}</code>
                    </div>
                  </div>
                  <div className="party-row">
                    <div>
                      <strong>Maintainer</strong>
                      <small>Defines criteria & approves PR</small>
                    </div>
                    <div className="party-val">
                      <span>@{maintainer.handle}</span>
                      <code>{maintainer.partyId}</code>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Acceptance Criteria */}
              <div className="criteria-form-col">
                <div className="criteria-header">
                  <div>
                    <strong>Acceptance Criteria ({criteria.length})</strong>
                    <small>Visible to contributors before claiming</small>
                  </div>
                  <div className="criteria-actions">
                    <button
                      type="button"
                      className="ai-suggest-button"
                      disabled={aiGenerating}
                      onClick={handleSuggestAI}
                    >
                      {aiGenerating ? (
                        <>
                          <span className="spinner" /> Analyzing issue…
                        </>
                      ) : (
                        '✨ Suggest with AI'
                      )}
                    </button>
                    <button
                      type="button"
                      className="secondary add-criterion-btn"
                      onClick={handleAddCriterion}
                    >
                      + Add criterion
                    </button>
                  </div>
                </div>

                {aiNote && (
                  <div className="ai-note-box">
                    <span className="mock-tag">ASSISTIVE ONLY</span>
                    <span>{aiNote}</span>
                  </div>
                )}

                {termsValidation.errors.criteria && (
                  <p className="field-error">{termsValidation.errors.criteria}</p>
                )}

                <div className="criteria-inputs-list">
                  {criteria.map((criterion, idx) => (
                    <div key={idx} className="criterion-input-row">
                      <span className="criterion-index">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <input
                        type="text"
                        value={criterion}
                        onChange={e => handleUpdateCriterion(idx, e.target.value)}
                        placeholder={`Acceptance criterion #${idx + 1}…`}
                        aria-label={`Criterion ${idx + 1}`}
                      />
                      <button
                        type="button"
                        className="delete-criterion-btn"
                        onClick={() => handleDeleteCriterion(idx)}
                        aria-label={`Delete criterion ${idx + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {criteria.length === 0 && (
                    <div className="empty-inline">
                      No criteria defined. Click "Suggest with AI" or "+ Add criterion" above.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="step-actions">
              <button className="secondary" onClick={() => setStep(2)}>
                ← Back to Issue
              </button>
              <button
                className="primary step-next"
                disabled={!canContinueFromStep3}
                onClick={() => setStep(4)}
              >
                Continue to Review & Fund →
              </button>
            </div>
          </section>
        )}

        {/* STEP 4: REVIEW & FUND */}
        {step === 4 && (
          <section className="step-panel" aria-labelledby="step-4-title">
            <div className="step-panel-header">
              <div>
                <h2 id="step-4-title">
                  <span>04</span> Review terms & fund on Canton
                </h2>
                <p className="muted">
                  Verify the final bounty terms before locking funds on the Canton Network.
                </p>
              </div>
            </div>

            {createdBounty ? (
              /* Success Receipt */
              <div className="funding-success-receipt">
                <div className="receipt-badge-row">
                  <span className="badge funded">● Funded</span>
                  <span className="receipt-title">Canton Funding Confirmed</span>
                </div>
                <h3>{createdBounty.title}</h3>
                <p className="receipt-explainer">
                  The bounty is now secured and available for contributors to claim on the network.
                </p>

                <div className="receipt-details-grid">
                  <div>
                    <dt>Repository</dt>
                    <dd>{createdBounty.repo}</dd>
                  </div>
                  <div>
                    <dt>GitHub Issue</dt>
                    <dd>#{createdBounty.issue}</dd>
                  </div>
                  <div>
                    <dt>Bounty Amount</dt>
                    <dd>
                      <strong>{createdBounty.amount} MMT</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Funding Lock Reference</dt>
                    <dd>
                      <code>{createdBounty.fundingRef}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Sponsor</dt>
                    <dd>@{createdBounty.sponsor.handle}</dd>
                  </div>
                  <div>
                    <dt>Maintainer</dt>
                    <dd>@{createdBounty.maintainer.handle}</dd>
                  </div>
                </div>

                <div className="receipt-criteria">
                  <strong>Locked Acceptance Criteria ({createdBounty.criteria.length})</strong>
                  <ul>
                    {createdBounty.criteria.map((c, i) => (
                      <li key={i}>✓ {c}</li>
                    ))}
                  </ul>
                </div>

                <div className="receipt-actions">
                  <button className="primary" onClick={() => onSuccess(createdBounty)}>
                    View bounty →
                  </button>
                </div>
              </div>
            ) : (
              /* Review Summary & Fund Button */
              <div className="review-fund-layout">
                <div className="review-summary-card">
                  <div className="eyebrow">BOUNTY SUMMARY</div>
                  <div className="summary-headline">
                    <div>
                      <small className="muted">{selectedRepo} / ISSUE #{selectedIssue?.number}</small>
                      <h3>{selectedIssue?.title}</h3>
                    </div>
                    <div className="summary-amount">
                      {amount} <span>MMT</span>
                    </div>
                  </div>

                  <div className="summary-parties-strip">
                    <span>
                      Sponsor: <strong>@{sponsor.handle}</strong>
                    </span>
                    <span>
                      Maintainer: <strong>@{maintainer.handle}</strong>
                    </span>
                    <span>
                      Network:{' '}
                      <strong>
                        {cantonStatus.mode === 'real' ? cantonStatus.network : 'LocalNet · mock'}
                      </strong>
                    </span>
                  </div>

                  <div className="summary-criteria">
                    <strong>Acceptance Criteria ({criteria.filter(c => c.trim()).length})</strong>
                    <ul>
                      {criteria
                        .filter(c => c.trim())
                        .map((c, idx) => (
                          <li key={idx}>
                            <span className="check-bullet">✓</span>
                            <span>{c}</span>
                          </li>
                        ))}
                    </ul>
                  </div>

                  <div className="funding-callout">
                    <span className="callout-icon">◈</span>
                    <div>
                      <strong>Guaranteed payment through Canton</strong>
                      <p>
                        Funding secures the bounty and makes it available for contributors to claim.
                      </p>
                    </div>
                  </div>

                  {error && <div className="feedback error">{error}</div>}

                  <div
                    className="step-actions"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '32px',
                    }}
                  >
                    <button
                      className="secondary"
                      disabled={funding}
                      onClick={() => setStep(3)}
                      style={{ minWidth: '140px', whiteSpace: 'nowrap' }}
                    >
                      ← Back to Terms
                    </button>
                    <button
                      className="primary step-fund-btn"
                      disabled={funding}
                      onClick={handleFund}
                      style={{ minWidth: '180px', width: 'auto', whiteSpace: 'nowrap' }}
                    >
                      {funding ? (
                        <>
                          <span className="spinner" /> Locking funds on Canton…
                        </>
                      ) : (
                        'Fund bounty →'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Scout AI Discovery Drawer */}
      <ScoutDrawer
        isOpen={scoutDrawerOpen}
        onClose={() => setScoutDrawerOpen(false)}
        repo={selectedRepo}
        availableRepos={repos.map(r => r.fullName)}
        onSelectRepo={newRepo => {
          setSelectedRepo(newRepo);
          if (scoutResult && scoutResult.repo !== newRepo) {
            setScoutResult(null);
          }
        }}
        onRunScan={targetRepo => {
          handleRunScout(targetRepo);
        }}
        result={scoutResult}
        loading={scoutLoading}
        error={scoutError}
        onRetry={() => handleRunScout()}
        onSelectOpportunity={handleSelectScoutOpportunity}
      />
    </div>
  );
}
