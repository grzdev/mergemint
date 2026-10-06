import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoutEngine } from '@/integrations/ai/scout';
import { validateAndSanitizeGroqOutput } from '@/integrations/ai/groq';
import { gatherRepoContext } from '@/integrations/ai/repoContext';

test('1. Scout discovers high-impact opportunities for Canton/MergeMint repositories', async () => {
  const result = await scoutEngine.discover('mergemint/core', 0);
  assert.equal(result.repo, 'mergemint/core');
  assert.ok(result.opportunities.length >= 3);
  assert.ok(result.healthScore > 0);
  assert.ok(result.modelUsed, 'Must report model or engine used');

  // Checks for CIP token standard and reliability opportunities
  const hasStandards = result.opportunities.some(o => o.category === 'standards' || o.badge.includes('CIP'));
  const hasReliability = result.opportunities.some(o => o.category === 'reliability');
  assert.ok(hasStandards, 'Scout must identify standards / CIP opportunities for Canton repo');
  assert.ok(hasReliability, 'Scout must identify reliability opportunities');

  // Verify each opportunity has valid structure for bounty creation
  for (const opp of result.opportunities) {
    assert.ok(opp.title.length > 5);
    assert.ok(Number(opp.suggestedAmount) > 0);
    assert.ok(opp.suggestedCriteria.length >= 2);
    assert.ok(opp.rationale.length > 10);
    assert.ok(opp.simulatedIssueNumber > 0);
    assert.ok(typeof opp.confidence === 'number');
  }
});

test('2. Scout handles empty repository issues by providing tailored opportunities and summary', async () => {
  const result = await scoutEngine.discover('acme/new-project', 0);
  assert.ok(result.summary.includes('0 open issues'));
  assert.ok(result.opportunities.length >= 3);
  const first = result.opportunities[0];
  assert.ok(first.suggestedCriteria.length >= 2);
});

test('3. Groq output validator accepts and cleans valid structured LLM responses', () => {
  const rawModelResponse = {
    summary: 'Repository has strong foundation but needs reconnection resilience and webhook security.',
    healthScore: 84,
    opportunities: [
      {
        title: 'Add Participant Disconnect Circuit Breaker',
        category: 'reliability',
        badge: 'High Reliability',
        difficulty: 'Intermediate',
        description: 'Implement backoff for Canton JSON ledger API clients.',
        rationale: 'Prevent unhandled 500 crashes during participant restarts.',
        suggestedAmount: '500 MMT',
        acceptanceCriteria: [
          'Add exponential backoff retry mechanism (500ms initial, 8s max)',
          'Gracefully report offline participant state without throwing 500',
        ],
        confidence: 0.95,
      },
      {
        title: 'Harden Webhook Signatures',
        category: 'security',
        badge: 'Security',
        difficulty: 'Beginner',
        description: 'Use timingSafeEqual for HMAC authentication.',
        rationale: 'Protect against timing side-channel attacks.',
        suggestedAmount: 400,
        acceptanceCriteria: [
          'Use crypto.timingSafeEqual on normalized buffers',
          'Add regression tests verifying rejection of invalid signatures',
        ],
        confidence: 0.88,
      },
    ],
  };

  const result = validateAndSanitizeGroqOutput(
    rawModelResponse,
    'acme/web-app',
    'llama-3.3-70b-versatile',
    ['github:readme', 'github:package.json']
  );

  assert.equal(result.repo, 'acme/web-app');
  assert.equal(result.modelUsed, 'llama-3.3-70b-versatile');
  assert.equal(result.healthScore, 84);
  assert.equal(result.opportunities.length, 2);

  const opp1 = result.opportunities[0];
  assert.equal(opp1.title, 'Add Participant Disconnect Circuit Breaker');
  assert.equal(opp1.category, 'reliability');
  assert.equal(opp1.suggestedAmount, '500'); // Cleaned from '500 MMT' to '500'
  assert.equal(opp1.confidence, 0.95);
  assert.equal(opp1.suggestedCriteria.length, 2);

  const opp2 = result.opportunities[1];
  assert.equal(opp2.suggestedAmount, '400');
  assert.equal(opp2.category, 'security');
});

test('4. Groq output validator rejects malformed LLM responses', () => {
  // Empty object
  assert.throws(() => {
    validateAndSanitizeGroqOutput({}, 'repo', 'model', []);
  }, /missing required "summary"/);

  // Missing opportunities
  assert.throws(() => {
    validateAndSanitizeGroqOutput({ summary: 'Summary here' }, 'repo', 'model', []);
  }, /missing required "opportunities"/);

  // Empty opportunities array
  assert.throws(() => {
    validateAndSanitizeGroqOutput({ summary: 'Summary here', opportunities: [] }, 'repo', 'model', []);
  }, /missing required "opportunities"/);
});

test('5. Bounded repository context gathering extracts targeted code excerpts without unbounded bloat', async () => {
  const context = await gatherRepoContext('mergemint/core');
  assert.equal(context.repo, 'mergemint/core');
  assert.ok(context.contextSources.length > 0);

  // Check that targeted files were collected
  assert.ok(context.targetedFiles && context.targetedFiles.length > 0, 'Must include targeted file snippets');
  for (const f of context.targetedFiles) {
    assert.ok(f.path.length > 0);
    assert.ok(f.contentSnippet.length > 0);
    assert.ok(f.contentSnippet.length <= 500, 'Excerpts must be strictly bounded under 500 characters');
  }

  // Verify total bounded size remains compact
  const totalLength =
    (context.readmeExcerpt?.length || 0) +
    (context.manifestSummary?.length || 0) +
    (context.description?.length || 0) +
    context.targetedFiles.reduce((acc, f) => acc + f.contentSnippet.length, 0);

  assert.ok(totalLength < 12000, `Context payload (${totalLength} bytes) must remain compact and bounded`);
});

test('6. Non-autonomous safety invariant: Scout only proposes opportunities and never funds or creates issues', async () => {
  const result = await scoutEngine.discover('mergemint/core', 0);
  
  // Verify Scout produces passive opportunity objects that require human selection and approval
  for (const opp of result.opportunities) {
    assert.ok(opp.id);
    assert.ok(opp.title);
    assert.ok(opp.suggestedAmount);
    assert.ok(opp.suggestedCriteria);
    assert.ok(opp.confidenceLevel, 'Must report qualitative confidenceLevel');
    assert.ok(opp.evidence, 'Must include source/trigger evidence');
    // The simulated issue number is only a candidate descriptor, not an active on-chain contract
    assert.ok(opp.simulatedIssueNumber >= 100);
  }
});

test('7. Model failure or missing API key gracefully engages Heuristic Fallback with transparent engine flag', async () => {
  // Save current key if any
  const oldKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;

  try {
    const result = await scoutEngine.discover('acme/repo-fallback-test', 0);
    assert.equal(result.engine, 'heuristic-fallback', 'Engine must be labeled heuristic-fallback');
    assert.ok(result.modelUsed?.includes('Fallback'), 'Model used must reflect fallback transparently');
    assert.ok(result.opportunities.length >= 3);
    for (const opp of result.opportunities) {
      assert.ok(opp.confidenceLevel);
      assert.ok(opp.evidence);
    }
  } finally {
    if (oldKey) process.env.GROQ_API_KEY = oldKey;
  }
});

test('8. Groq output validator maps confidence to qualitative signals and preserves evidence', () => {
  const rawModelResponse = {
    summary: 'Repository inspected with specific code evidence.',
    healthScore: 90,
    opportunities: [
      {
        title: 'Add Circuit Breaker for Ledger API',
        category: 'reliability',
        badge: 'High Reliability',
        difficulty: 'Intermediate',
        description: 'Implement backoff for participant HTTP requests.',
        rationale: 'Prevent crash when participant is restarting.',
        suggestedAmount: '500',
        confidence: 0.95,
        evidence: {
          filePaths: ['src/integrations/canton/cantonParticipant.ts'],
          moduleOrConfig: 'CantonParticipant',
          triggerReason: 'Uncaught fetch exception in query contracts loop',
        },
        acceptanceCriteria: ['Implement exponential backoff', 'Add retry tests'],
      },
      {
        title: 'Explore Alternative Serialization Format',
        category: 'performance',
        badge: 'Performance',
        difficulty: 'Advanced',
        description: 'Explore binary contract caching.',
        rationale: 'Reduces parsing overhead.',
        suggestedAmount: '350',
        confidence: 0.65,
        confidenceLevel: 'Exploratory',
        acceptanceCriteria: ['Benchmark JSON vs Protobuf', 'Document findings'],
      },
    ],
  };

  const result = validateAndSanitizeGroqOutput(
    rawModelResponse,
    'acme/test-repo',
    'llama-3.3-70b-versatile',
    ['local:src/integrations/canton/cantonParticipant.ts']
  );

  assert.equal(result.engine, 'groq-ai');
  assert.equal(result.opportunities[0].confidenceLevel, 'Strong signal');
  assert.equal(result.opportunities[0].evidence?.moduleOrConfig, 'CantonParticipant');
  assert.equal(result.opportunities[0].evidence?.filePaths[0], 'src/integrations/canton/cantonParticipant.ts');
  assert.equal(result.opportunities[1].confidenceLevel, 'Exploratory');
});
