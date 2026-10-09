'use client';

import { useState } from 'react';
import { Drawer } from '@/components/ui/drawer';
import type { ScoutAnalysisResult, ScoutOpportunity } from '@/domain/scout';

interface ScoutDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  repo: string;
  availableRepos?: string[];
  onSelectRepo?: (newRepo: string) => void;
  onRunScan?: (targetRepo: string) => void;
  result: ScoutAnalysisResult | null;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onSelectOpportunity: (opp: ScoutOpportunity, repo: string) => void;
}

export function ScoutDrawer({
  isOpen,
  onClose,
  repo,
  availableRepos = [],
  onSelectRepo,
  onRunScan,
  result,
  loading,
  error,
  onRetry,
  onSelectOpportunity,
}: ScoutDrawerProps) {
  const [expandedCriteriaId, setExpandedCriteriaId] = useState<string | null>(null);

  const toggleCriteria = (id: string) => {
    setExpandedCriteriaId(prev => (prev === id ? null : id));
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="✦ MergeMint Scout · AI Issue Discovery"
      subtitle={`Assistive opportunity analysis for ${repo || 'your GitHub repositories'}`}
      width="560px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Repository Selection Bar */}
        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: '8px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label
              htmlFor="scout-repo-select"
              style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}
            >
              Repository to Scout
            </label>
            {repo && (
              <span style={{ fontSize: '11px', color: 'var(--mint)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '8px' }}>●</span> Active
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {availableRepos.length > 0 ? (
              <select
                id="scout-repo-select"
                value={repo}
                onChange={e => {
                  const nextRepo = e.target.value;
                  onSelectRepo?.(nextRepo);
                  if (nextRepo && onRunScan) {
                    onRunScan(nextRepo);
                  }
                }}
                disabled={loading}
                style={{
                  flex: 1,
                  background: '#181b1d',
                  color: repo ? 'var(--text)' : 'var(--muted)',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '9px 12px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                <option value="">Choose a repository to scout…</option>
                {availableRepos.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="scout-repo-select"
                type="text"
                value={repo}
                placeholder="Choose a repository…"
                readOnly
                style={{
                  flex: 1,
                  background: '#181b1d',
                  color: 'var(--text)',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '9px 12px',
                  fontSize: '12px',
                }}
              />
            )}
            <button
              type="button"
              className="primary"
              disabled={!repo || loading}
              onClick={() => (onRunScan ? onRunScan(repo) : onRetry())}
              style={{
                width: 'auto',
                whiteSpace: 'nowrap',
                fontSize: '11px',
                padding: '9px 14px',
                cursor: !repo || loading ? 'not-allowed' : 'pointer',
                opacity: !repo || loading ? 0.5 : 1,
              }}
            >
              {loading ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span className="spinner" style={{ width: '10px', height: '10px' }} /> Scanning…
                </span>
              ) : result ? (
                '↻ Rescan'
              ) : (
                '⚡ Scan Codebase'
              )}
            </button>
          </div>
        </div>

        {/* Content State */}
        {!repo ? (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '14px',
              background: 'rgba(255, 255, 255, 0.01)',
              borderRadius: '8px',
              border: '1px dashed var(--line)',
            }}
          >
            <span style={{ fontSize: '32px' }}>🔍</span>
            <div>
              <strong style={{ fontSize: '14px', color: 'var(--text)', display: 'block', marginBottom: '4px' }}>
                Select a repository to scan
              </strong>
              <p style={{ color: 'var(--muted)', fontSize: '12px', maxWidth: '380px', margin: 0, lineHeight: 1.5 }}>
                Choose any accessible repository from the dropdown above. Scout AI will analyze code architecture, identify high-leverage gaps, and propose structured bounties with clear acceptance criteria.
              </p>
            </div>
          </div>
        ) : loading ? (
          <div
            style={{
              padding: '36px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '14px',
            }}
          >
            <span className="spinner" style={{ width: '28px', height: '28px' }} />
            <div>
              <strong style={{ fontSize: '14px', color: 'var(--mint)', display: 'block' }}>
                Scout AI is scanning repository…
              </strong>
              <small style={{ color: 'var(--muted)', fontSize: '12px' }}>
                Analyzing code architecture, error recovery, token interfaces & test coverage
              </small>
            </div>
            <div
              style={{
                marginTop: '10px',
                textAlign: 'left',
                width: '100%',
                background: 'var(--panel)',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid var(--line)',
                fontSize: '11px',
                color: 'var(--muted)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div>✓ Indexed repository file layout and config</div>
              <div>✓ Assessed ledger participant communication boundaries</div>
              <div style={{ color: 'var(--mint)', fontWeight: 600 }}>
                ✦ Synthesizing high-leverage bounties and acceptance criteria…
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="error-banner">
            <div>
              <strong>Scout Analysis Failed:</strong> {error}
            </div>
            <button
              type="button"
              className="secondary small"
              onClick={onRetry}
              style={{ marginTop: '10px' }}
            >
              Retry Scout Scan
            </button>
          </div>
        ) : result ? (
          <>
            {/* Health & Summary Header Card */}
            <div
              style={{
                background: 'rgba(88, 203, 168, 0.07)',
                border: '1px solid rgba(88, 203, 168, 0.25)',
                borderRadius: '8px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--mint)' }}>
                    ◈ Repository Analysis Summary
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontWeight: 700,
                      letterSpacing: '0.3px',
                      background: result.engine === 'groq-ai' ? 'rgba(88, 203, 168, 0.2)' : 'rgba(234, 179, 8, 0.15)',
                      color: result.engine === 'groq-ai' ? 'var(--mint)' : '#eab308',
                      border: result.engine === 'groq-ai' ? '1px solid rgba(88, 203, 168, 0.35)' : '1px solid rgba(234, 179, 8, 0.3)',
                    }}
                  >
                    {result.engine === 'groq-ai' ? '✦ Groq AI' : '⚠ Heuristic fallback'}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: 'rgba(88, 203, 168, 0.18)',
                    color: 'var(--mint)',
                    fontWeight: 600,
                  }}
                >
                  Bounded context · maintainer review required
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text)', lineHeight: 1.5 }}>
                {result.summary}
              </p>
              {result.modelUsed && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--muted)', marginTop: '2px', flexWrap: 'wrap' }}>
                  <span>Engine: <strong>{result.modelUsed}</strong></span>
                  {result.contextUsed && result.contextUsed.length > 0 && (
                    <span>· Sources: {result.contextUsed.slice(0, 4).join(', ')}{result.contextUsed.length > 4 ? ` (+${result.contextUsed.length - 4} more)` : ''}</span>
                  )}
                </div>
              )}
            </div>

            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              ✦ Discovered Opportunities ({result.opportunities.length})
            </div>

            {/* Opportunities List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {result.opportunities.map(opp => {
                const isCriteriaExpanded = expandedCriteriaId === opp.id;
                return (
                  <div
                    key={opp.id}
                    style={{
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    {/* Header: Title and Badges */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontWeight: 600,
                              background: 'rgba(88, 203, 168, 0.15)',
                              color: 'var(--mint)',
                              border: '1px solid rgba(88, 203, 168, 0.3)',
                            }}
                          >
                            {opp.badge}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              color: 'var(--muted)',
                              border: '1px solid var(--line)',
                            }}
                          >
                            {opp.difficulty}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              color: opp.confidenceLevel === 'Strong signal' ? 'var(--mint)' : opp.confidenceLevel === 'Medium signal' ? '#eab308' : 'var(--muted)',
                              border: '1px solid var(--line)',
                            }}
                            title={`Signal confidence: ${opp.confidenceLevel}`}
                          >
                            {opp.confidenceLevel} Confidence
                          </span>
                        </div>
                        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
                          {opp.title}
                        </h3>
                      </div>
                      <div
                        style={{
                          textAlign: 'right',
                          flexShrink: 0,
                          background: 'rgba(255, 255, 255, 0.03)',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: '1px solid var(--line)',
                        }}
                      >
                        <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block' }}>Suggested</span>
                        <strong style={{ fontSize: '13px', color: 'var(--mint)' }}>{opp.suggestedAmount} MMT</strong>
                      </div>
                    </div>

                    {/* Description */}
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text)', lineHeight: 1.5 }}>
                      {opp.description}
                    </p>

                    {/* Rationale */}
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--muted)',
                        background: 'rgba(0, 0, 0, 0.2)',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        borderLeft: '3px solid var(--mint)',
                      }}
                    >
                      <strong>Why this matters:</strong> {opp.rationale}
                    </div>

                    {/* Criteria Expandable Section */}
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleCriteria(opp.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: 'var(--mint)',
                          fontSize: '11px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontWeight: 500,
                        }}
                      >
                        <span>{isCriteriaExpanded ? '▾ Hide' : '▸ View'} Suggested Acceptance Criteria ({opp.suggestedCriteria.length})</span>
                      </button>

                      {isCriteriaExpanded && (
                        <ul
                          style={{
                            margin: '8px 0 0 0',
                            paddingLeft: '18px',
                            fontSize: '11px',
                            color: 'var(--text)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                        >
                          {opp.suggestedCriteria.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Action Button: Turn into Bounty */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
                      <button
                        type="button"
                        className="primary small"
                        onClick={() => onSelectOpportunity(opp, repo)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        <span>✦ Turn into Bounty</span> →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="empty-inline">
            Select a repository to run Scout AI analysis.
          </div>
        )}
      </div>
    </Drawer>
  );
}
