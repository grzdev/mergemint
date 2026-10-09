import type { ScoutAnalysisResult, ScoutCategory, ScoutOpportunity } from '@/domain/scout';
import type { BoundedRepoContext } from './repoContext';

const VALID_CATEGORIES: Set<ScoutCategory> = new Set([
  'reliability',
  'security',
  'standards',
  'performance',
  'dx',
]);

const VALID_DIFFICULTIES = new Set(['Beginner', 'Intermediate', 'Advanced']);

interface GroqRawOpportunityEvidence {
  filePaths?: unknown;
  moduleOrConfig?: unknown;
  triggerReason?: unknown;
}

interface GroqRawOpportunity {
  title?: unknown;
  category?: unknown;
  badge?: unknown;
  difficulty?: unknown;
  description?: unknown;
  rationale?: unknown;
  suggestedAmount?: unknown;
  acceptanceCriteria?: unknown;
  confidence?: unknown;
  confidenceLevel?: unknown;
  evidence?: GroqRawOpportunityEvidence;
}

interface GroqRawResponse {
  summary?: unknown;
  healthScore?: unknown;
  opportunities?: unknown;
}

/**
 * Validates and transforms raw LLM output into typed, safe Scout opportunities.
 */
export function validateAndSanitizeGroqOutput(
  raw: unknown,
  repo: string,
  modelName: string,
  contextSources: string[]
): ScoutAnalysisResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Groq model response is not a valid JSON object.');
  }

  const obj = raw as GroqRawResponse;

  if (typeof obj.summary !== 'string' || !obj.summary.trim()) {
    throw new Error('Groq response missing required "summary" string.');
  }

  const healthScore =
    typeof obj.healthScore === 'number' && obj.healthScore >= 0 && obj.healthScore <= 100
      ? Math.round(obj.healthScore)
      : 88;

  if (!Array.isArray(obj.opportunities) || obj.opportunities.length === 0) {
    throw new Error('Groq response missing required "opportunities" array.');
  }

  const now = new Date().toISOString();
  const opportunities: ScoutOpportunity[] = [];

  for (let i = 0; i < obj.opportunities.length; i++) {
    const rawOpp = obj.opportunities[i] as GroqRawOpportunity;
    if (typeof rawOpp !== 'object' || rawOpp === null) continue;

    const title = typeof rawOpp.title === 'string' ? rawOpp.title.trim() : '';
    if (!title) continue;

    const rawCategory = typeof rawOpp.category === 'string' ? rawOpp.category.toLowerCase().trim() : '';
    const category: ScoutCategory = VALID_CATEGORIES.has(rawCategory as ScoutCategory)
      ? (rawCategory as ScoutCategory)
      : 'reliability';

    const badge =
      typeof rawOpp.badge === 'string' && rawOpp.badge.trim()
        ? rawOpp.badge.trim()
        : category === 'security'
        ? 'Security'
        : category === 'standards'
        ? 'Standards'
        : category === 'performance'
        ? 'Performance'
        : category === 'dx'
        ? 'Developer Experience'
        : 'High Reliability';

    const rawDiff = typeof rawOpp.difficulty === 'string' ? rawOpp.difficulty.trim() : '';
    const difficulty: 'Beginner' | 'Intermediate' | 'Advanced' = VALID_DIFFICULTIES.has(rawDiff)
      ? (rawDiff as 'Beginner' | 'Intermediate' | 'Advanced')
      : 'Intermediate';

    const description = typeof rawOpp.description === 'string' ? rawOpp.description.trim() : title;
    const rationale =
      typeof rawOpp.rationale === 'string'
        ? rawOpp.rationale.trim()
        : 'Opportunity identified from repository architecture and code inspection.';

    const suggestedAmount =
      typeof rawOpp.suggestedAmount === 'string' || typeof rawOpp.suggestedAmount === 'number'
        ? String(rawOpp.suggestedAmount).replace(/[^\d.]/g, '') || '500'
        : '500';

    let criteria: string[] = [];
    if (Array.isArray(rawOpp.acceptanceCriteria)) {
      criteria = rawOpp.acceptanceCriteria
        .filter((c): c is string => typeof c === 'string' && Boolean(c.trim()))
        .map(c => c.trim());
    }
    if (criteria.length < 2) {
      criteria = [
        `Implement core solution for: ${title}`,
        'Add comprehensive automated regression tests verifying the change',
        'Ensure backwards compatibility with existing configuration',
      ];
    }

    const confidence =
      typeof rawOpp.confidence === 'number' && rawOpp.confidence >= 0 && rawOpp.confidence <= 1
        ? Number(rawOpp.confidence.toFixed(2))
        : 0.9;

    // Qualitative signal mapping: Strong signal (>= 0.88), Medium signal (>= 0.75), Exploratory (< 0.75)
    let confidenceLevel: ScoutOpportunity['confidenceLevel'] = 'Medium signal';
    const rawLevel = typeof rawOpp.confidenceLevel === 'string' ? rawOpp.confidenceLevel.trim() : '';
    if (rawLevel === 'Strong signal' || rawLevel === 'Medium signal' || rawLevel === 'Exploratory') {
      confidenceLevel = rawLevel;
    } else {
      confidenceLevel = confidence >= 0.88 ? 'Strong signal' : confidence >= 0.75 ? 'Medium signal' : 'Exploratory';
    }

    // Parse evidence/source context
    let evidence: ScoutOpportunity['evidence'] | undefined;
    if (typeof rawOpp.evidence === 'object' && rawOpp.evidence !== null) {
      const ev = rawOpp.evidence as GroqRawOpportunityEvidence;
      const filePaths = Array.isArray(ev.filePaths)
        ? ev.filePaths.filter((p): p is string => typeof p === 'string' && Boolean(p.trim())).map(p => p.trim()).filter(p => contextSources.includes(`github:${p}`) || contextSources.includes(`local:${p}`))
        : [];
      const moduleOrConfig = typeof ev.moduleOrConfig === 'string' ? ev.moduleOrConfig.trim() : undefined;
      const triggerReason = typeof ev.triggerReason === 'string' ? ev.triggerReason.trim() : rationale;

      if (filePaths.length > 0 || moduleOrConfig) {
        evidence = {
          filePaths,
          moduleOrConfig,
          triggerReason: triggerReason || 'Identified via code inspection',
        };
      }
    }

    if (!evidence?.filePaths.length) {
      confidenceLevel = 'Exploratory';
      evidence = { filePaths: [], triggerReason: 'Model suggestion has no cited file from the inspected context. Maintainer validation required.' };
    }
    opportunities.push({
      id: `scout-${repo.replace(/[^a-zA-Z0-9-]/g, '-')}-${i + 1}`,
      repo,
      title,
      category,
      badge,
      description,
      suggestedAmount,
      suggestedCriteria: criteria,
      rationale,
      difficulty,
      confidence,
      confidenceLevel,
      evidence,
      simulatedIssueNumber: 310 + i,
      createdAt: now,
    });
  }

  if (opportunities.length === 0) {
    throw new Error('Groq model failed to produce any valid structured opportunities.');
  }

  return {
    repo,
    scannedAt: now,
    healthScore,
    summary: obj.summary.trim(),
    engine: 'groq-ai',
    modelUsed: modelName,
    contextUsed: contextSources,
    opportunities,
  };
}

/**
 * Executes a structured Scout discovery prompt against Groq API.
 * Server-side only. Never exposes GROQ_API_KEY to the client.
 */
export async function executeGroqScout(
  context: BoundedRepoContext
): Promise<{ ok: true; result: ScoutAnalysisResult } | { ok: false; error: string }> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'GROQ_API_KEY is not configured in server environment.',
    };
  }

  const model = process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile';

  const systemPrompt = `You are MergeMint Scout, an expert AI software architect and open-source bounty scout.
Your goal is to inspect a software repository and discover high-impact, actionable, fundable work opportunities that can be turned into bounties paid in Canton tokens (MMT).

You must analyze the repository context (metadata, manifest, README excerpt, targeted code/test excerpts, recent activity) and output 3 to 4 distinct, high-value opportunities across categories:
- "reliability" (e.g. error handling, reconnects, race condition guards, regression test coverage)
- "security" (e.g. boundary validation, signature verification, sanitization, secret leaks)
- "standards" (e.g. token interfaces such as CIP-56/CIP-0112, open standards adherence)
- "performance" (e.g. caching, pagination, overfetching reduction, latency optimization)
- "dx" (e.g. developer tooling, runbooks, architectural clarity)

IMPORTANT GUIDELINES:
1. Propose opportunities ONLY. Do NOT auto-create issues or auto-fund bounties; the repository maintainer will review your proposals.
2. Ground suggestions in actual files/modules where available. Every opportunity should provide specific evidence: relevant file path(s), module name, and the specific trigger reason.
3. Suggested rewards must be reasonable token amounts: typically between 250 and 1000 MMT.
4. Each opportunity MUST include 2 to 4 crisp, verifiable acceptance criteria.
5. Provide a qualitative "confidenceLevel" ('Strong signal' | 'Medium signal' | 'Exploratory') based on how directly the code evidence indicates the need.
6. Output MUST be valid JSON matching the exact schema requested. Do not include markdown or commentary outside the JSON object.`;

  const targetedFilesBlock = (context.targetedFiles || [])
    .map(
      f =>
        `FILE: ${f.path} [${f.category}]\nEXCERPT:\n${f.contentSnippet}\n---`
    )
    .join('\n');

  const userPrompt = `Analyze the following repository context and propose 3 to 4 fundable bounty opportunities:

REPOSITORY: ${context.repo}
DESCRIPTION: ${context.description || 'None provided'}
LANGUAGE: ${context.language || 'Unknown'}
TOPICS: ${(context.topics || []).join(', ') || 'None'}

MANIFEST / CONFIG SUMMARY:
${context.manifestSummary || 'Not available'}

README EXCERPT:
${context.readmeExcerpt || 'Not available'}

TARGETED CODE & TEST EXCERPTS:
${targetedFilesBlock || 'No targeted file snippets available'}

RECENT COMMITS:
${(context.recentCommits || []).map(c => `- ${c}`).join('\n') || 'None available'}

EXISTING OPEN ISSUES (Avoid duplicating these):
${(context.existingIssueTitles || []).map(i => `- ${i}`).join('\n') || 'None'}

Respond with a JSON object adhering to this schema:
{
  "summary": "High-level summary of findings and repository health",
  "healthScore": 88,
  "opportunities": [
    {
      "title": "Clear actionable task title",
      "category": "reliability | security | standards | performance | dx",
      "badge": "Short badge text (e.g. Security, High Reliability, CIP-0112 Standard)",
      "difficulty": "Beginner | Intermediate | Advanced",
      "description": "2-sentence overview of the work to be done",
      "rationale": "Why this matters to the codebase based on the code inspected",
      "suggestedAmount": "500",
      "confidenceLevel": "Strong signal | Medium signal | Exploratory",
      "evidence": {
        "filePaths": ["path/to/relevant/file.ts"],
        "moduleOrConfig": "ModuleNameOrConfig",
        "triggerReason": "Why this code triggered the proposal (e.g. unhandled error path, missing retry)"
      },
      "acceptanceCriteria": [
        "First verifiable criteria",
        "Second verifiable criteria",
        "Third verifiable criteria"
      ]
    }
  ]
}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Groq API responded with HTTP ${res.status}: ${errText.slice(0, 150)}`,
      };
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        error: 'Groq API returned an empty completion.',
      };
    }

    const parsed = JSON.parse(content);
    const sanitized = validateAndSanitizeGroqOutput(
      parsed,
      context.repo,
      model,
      context.contextSources
    );

    return {
      ok: true,
      result: sanitized,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
