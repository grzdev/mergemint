export type ScoutCategory = 'reliability' | 'security' | 'standards' | 'performance' | 'dx';

export type ScoutConfidenceLevel = 'Strong signal' | 'Medium signal' | 'Exploratory';

export interface ScoutOpportunityEvidence {
  filePaths: string[];
  moduleOrConfig?: string;
  triggerReason: string;
}

export interface ScoutOpportunity {
  id: string;
  repo: string;
  title: string;
  category: ScoutCategory;
  badge: string;
  description: string;
  suggestedAmount: string;
  suggestedCriteria: string[];
  rationale: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  confidence?: number;
  confidenceLevel: ScoutConfidenceLevel;
  evidence?: ScoutOpportunityEvidence;
  simulatedIssueNumber: number;
  createdAt: string;
}

export interface ScoutAnalysisResult {
  repo: string;
  scannedAt: string;
  healthScore: number; // 0 - 100
  summary: string;
  engine: 'groq-ai' | 'heuristic-fallback';
  modelUsed?: string;
  contextUsed?: string[];
  opportunities: ScoutOpportunity[];
}

