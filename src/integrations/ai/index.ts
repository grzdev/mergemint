import type { Bounty, VerificationReport } from '@/domain/bounty';
import { delay } from '@/integrations/github';

export interface AIIntegration {
  criteria(issueTitle: string, issueDescription?: string): Promise<string[]>;
  verify(bounty: Bounty): Promise<VerificationReport>;
}

export const ai: AIIntegration = {
  async criteria(title: string, description?: string): Promise<string[]> {
    await delay(600);
    const text = `${title} ${description ?? ''}`.toLowerCase();

    if (text.includes('query option') || text.includes('204')) {
      return [
        'Reject null and array query values',
        'Add regression tests for invalid inputs',
        'Preserve existing valid query behavior',
      ];
    }

    if (text.includes('participant') || text.includes('canton')) {
      return [
        'Make participant URL configurable via environment variables',
        'Validate host and port inputs before establishing RPC connection',
        'Add integration tests verifying custom node connection',
      ];
    }

    if (text.includes('batch') || text.includes('endpoint')) {
      return [
        'Add CLI batch verification command flag',
        'Return structured JSON error report for failing items',
        'Add test suite coverage for multi-target validation',
      ];
    }

    if (text.includes('token') || text.includes('amount') || text.includes('receipt')) {
      return [
        'Format Canton Coin amounts using locale-aware thousand separators',
        'Enforce fixed decimal precision on receipt cards',
        'Add unit test coverage for edge-case decimal strings',
      ];
    }

    return [
      `Implement solution for: ${title}`,
      'Add comprehensive automated regression tests',
      'Update relevant developer documentation',
    ];
  },

  async verify(bounty: Bounty): Promise<VerificationReport> {
    await delay(700);
    if (!bounty.submission) throw new Error('Link a pull request before verification.');
    return {
      sha: bounty.submission.sha,
      createdAt: new Date().toISOString(),
      criteria: bounty.criteria.map((criterion, index) => ({
        criterion,
        assessment: index === 2 ? 'Needs review' : 'Likely satisfied',
        evidence:
          index === 2
            ? 'No documentation change in the mock evidence.'
            : 'Mock evidence: query.test.ts covers invalid query inputs.',
        limitation:
          'Simulated assessment. Does not replace maintainer approval; integration tests are failing.',
      })),
    };
  },
};
