import type { ScoutAnalysisResult, ScoutOpportunity } from '@/domain/scout';
import { gatherRepoContext, type BoundedRepoContext } from './repoContext';
import { executeGroqScout } from './groq';

export function fallbackSuggestions(context: BoundedRepoContext): ScoutOpportunity[] {
  // Suggestions are review prompts, never invented findings about unseen code.
  const files=context.targetedFiles ?? [];
  const source=files.find(f=>f.category==='source' || f.category==='validation');
  const test=files.find(f=>f.category==='test');
  const token=files.find(f=>f.category==='interface' || /\.daml$/.test(f.path));
  const suggestions=[
    {title:'Review failure handling at a source boundary',category:'reliability' as const,file:source},
    {title:token?'Review token workflow invariants':'Review test coverage for one user-facing behavior',category:token?'standards' as const:'reliability' as const,file:token??test},
    {title:'Verify contributor setup instructions',category:'dx' as const,file:undefined},
  ];
  return suggestions.map((s,i)=>({id:`scout-${context.repo}-${i}`,repo:context.repo,title:s.title,category:s.category,badge:'Exploratory review',description:'A suggested review task, not a detected defect. Inspect the complete files and confirm the need before funding.',suggestedAmount:'250',suggestedCriteria:['Confirm and document a specific reproducible gap','Agree on a scoped change and regression evidence before funding'],rationale:s.file?`A bounded excerpt of ${s.file.path} was available. It does not establish that a defect exists.`:'No source evidence establishes this task is needed. Treat this as a general review prompt.',difficulty:'Intermediate',confidenceLevel:'Exploratory',evidence:{filePaths:s.file?[s.file.path]:[],triggerReason:'Heuristic review prompt; not a verified finding.'},simulatedIssueNumber:310+i,createdAt:new Date().toISOString()}));
}
export interface ScoutEngine { discover(repo:string,existingIssueCount?:number,userToken?:string):Promise<ScoutAnalysisResult> }
export const scoutEngine:ScoutEngine={async discover(repo,existingIssueCount=0,userToken){
 const context=await gatherRepoContext(repo,userToken);
 if(process.env.GROQ_API_KEY?.trim()) {const response=await executeGroqScout(context);if(response.ok)return response.result;}
 return {repo,scannedAt:new Date().toISOString(),healthScore:0,summary:`${existingIssueCount} open issues reported. Heuristic fallback offers exploratory review prompts, not verified defects or a repository health assessment.`,engine:'heuristic-fallback',modelUsed:'Heuristic Fallback Engine',contextUsed:context.contextSources,opportunities:fallbackSuggestions(context)};
}};
