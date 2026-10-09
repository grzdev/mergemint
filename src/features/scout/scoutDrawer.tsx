'use client';

import { useState } from 'react';
import { Drawer } from '@/components/ui/drawer';
import type { ScoutAnalysisResult, ScoutOpportunity } from '@/domain/scout';

interface ScoutDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  repo: string;
  result: ScoutAnalysisResult | null;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onSelectOpportunity: (opp: ScoutOpportunity) => void;
}

export function ScoutDrawer({
  isOpen,
  onClose,
  repo,
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
      subtitle={`Assistive opportunity analysis for ${repo || 'selected repository'}`}
      width="560px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {loading ? (
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
              Discovered Opportunities ({result.opportunities.length})
            </div>

            {/* Opportunities List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {result.opportunities.map(opp => {
                const isCriteriaOpen = expandedCriteriaId === opp.id;
                const signalColor =
                  opp.confidenceLevel === 'Strong signal'
                    ? 'var(--mint)'
                    : opp.confidenceLevel === 'Medium signal'
                    ? '#38bdf8'
                    : 'var(--muted)';
                const signalBg =
                  opp.confidenceLevel === 'Strong signal'
                    ? 'rgba(88, 203, 168, 0.12)'
                    : opp.confidenceLevel === 'Medium signal'
                    ? 'rgba(56, 189, 248, 0.12)'
                    : 'rgba(255, 255, 255, 0.05)';

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
                      transition: 'border-color 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: 'rgba(88, 203, 168, 0.15)',
                              color: 'var(--mint)',
                            }}
                          >
                            {opp.badge}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              color: 'var(--muted)',
                              border: '1px solid var(--line)',
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            {opp.difficulty}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              color: signalColor,
                              background: signalBg,
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            {opp.confidenceLevel || 'Strong signal'}
                          </span>
                        </div>
                        <h4 style={{ margin: '4px 0 0', fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
                          {opp.title}
                        </h4>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <strong style={{ fontSize: '14px', color: 'var(--mint)' }}>
                          {opp.suggestedAmount} MMT
                        </strong>
                        <small style={{ display: 'block', fontSize: '10px', color: 'var(--muted)' }}>
                          Suggested Bounty
                        </small>
                      </div>
                    </div>

                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)', lineHeight: 1.5 }}>
                      {opp.description}
                    </p>

                    {/* Evidence & Trigger Preview */}
                    {opp.evidence && (
                      <div
                        style={{
                          background: 'rgba(0, 0, 0, 0.2)',
                          border: '1px solid var(--line)',
                          borderRadius: '6px',
                          padding: '8px 10px',
                          fontSize: '11px',
                          color: 'var(--muted)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <strong style={{ color: 'var(--text)', fontSize: '11px' }}>Code Context:</strong>
                          {opp.evidence.moduleOrConfig && (
                            <span style={{ color: 'var(--mint)', fontFamily: 'monospace' }}>
                              [{opp.evidence.moduleOrConfig}]
                            </span>
                          )}
                          {opp.evidence.filePaths.map((fp, i) => (
                            <span
                              key={i}
                              style={{
                                fontFamily: 'monospace',
                                color: 'var(--muted)',
                                background: 'rgba(255, 255, 255, 0.05)',
                                padding: '1px 4px',
                                borderRadius: '3px',
                              }}
                            >
                              {fp}
                            </span>
                          ))}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text)' }}>
                          <em>Trigger:</em> {opp.evidence.triggerReason}
                        </div>
                      </div>
                    )}

                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '6px',
                        padding: '8px 10px',
                        fontSize: '11px',
                        color: 'var(--muted)',
                        borderLeft: '2px solid var(--mint)',
                      }}
                    >
                      <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '2px' }}>
                        Scout Rationale:
                      </strong>
                      {opp.rationale}
                    </div>

                    {/* Criteria Accordion */}
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
                        }}
                      >
                        {isCriteriaOpen ? '▼ Hide Acceptance Criteria' : '► View Suggested Acceptance Criteria (' + opp.suggestedCriteria.length + ')'}
                      </button>

                      {isCriteriaOpen && (
                        <ul
                          style={{
                            margin: '8px 0 0',
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

                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
                      <button
                        type="button"
                        className="primary small"
                        onClick={() => onSelectOpportunity(opp)}
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
