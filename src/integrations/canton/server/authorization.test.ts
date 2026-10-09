import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSession, SESSION_COOKIE_NAME } from '@/integrations/github/server/session';
import { POST as approve } from '@/app/api/canton/approve/route';
import { POST as settle } from '@/app/api/canton/settle/route';
import { POST as fund } from '@/app/api/canton/fund/route';
import { requireActor } from './authorization';
import { reconcileLedger, invalidateRevision } from '@/domain/reconciliation';
import { fallbackSuggestions } from '@/integrations/ai/scout';
import { gatherRepoContext } from '@/integrations/ai/repoContext';
import type { Bounty } from '@/domain/bounty';
import type { CantonContract } from '../types';

const secret='0123456789abcdef0123456789abcdef';
const sha='a'.repeat(40), changed='b'.repeat(40), packageId='c'.repeat(64);
const parties={sponsor:{handle:'sponsor-user',partyId:'sponsor::test'},maintainer:{handle:'maintainer-user',partyId:'maintainer::test'},contributor:{handle:'contributor-user',partyId:'contributor::test'}};
const bounty:Bounty={id:'route-proof',repo:'example/core-utils',issue:1,title:'Real issue',amount:'10',asset:'MMT',...parties,status:'SUBMITTED',activity:'test',criteria:['Validate input'],submission:{number:9,title:'PR',sha,branch:'fix',merged:false,checks:[],review:'Pending'},approval:{sha,maintainerId:parties.maintainer.partyId,approvedAt:new Date().toISOString()}};
function configure(){Object.assign(process.env,{CANTON_INTEGRATION_MODE:'real',GITHUB_INTEGRATION_MODE:'real',SESSION_SECRET:secret,NEXT_PUBLIC_APP_URL:'http://localhost:3000',CANTON_LEDGER_API_URL:'http://ledger.test',CANTON_PACKAGE_ID:packageId,GITHUB_APP_ID:'',GITHUB_PRIVATE_KEY:'',GITHUB_PRIVATE_KEY_PATH:'',GROQ_API_KEY:''});for(const role of ['sponsor','maintainer','contributor'] as const){process.env[`CANTON_${role.toUpperCase()}_PARTY`]=parties[role].partyId;process.env[`CANTON_${role.toUpperCase()}_GITHUB_LOGIN`]=parties[role].handle;}}
function request(body:unknown,login='maintainer-user',origin='http://localhost:3000'){
 const cookie=encryptSession({user:{login,avatarUrl:''},token:'fixture-only-token',createdAt:Date.now()},secret);
 return new Request('http://localhost:3000/api/canton/approve',{method:'POST',headers:{'Content-Type':'application/json',origin,...(login?{cookie:`${SESSION_COOKIE_NAME}=${cookie}`}:{})},body:JSON.stringify(body)});
}

test('HTTP boundaries reject anonymous, wrong role and foreign origin before any ledger/network command',async()=>{
 configure();const saved=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Unexpected external call');};
 try{
  assert.equal((await approve(request({bounty,sha,maintainer:parties.maintainer},''))).status,401);
  assert.equal((await approve(request({bounty,sha,maintainer:parties.maintainer},'contributor-user'))).status,403);
  assert.equal((await approve(request({bounty,sha,maintainer:parties.maintainer},'maintainer-user','https://foreign.test'))).status,403);
  assert.equal(requireActor(request({},'sponsor-user'),'sponsor').user.login,'sponsor-user');
  assert.throws(()=>requireActor(request({},'sponsor-user'),'maintainer'));
  assert.equal(calls,0);
 }finally{global.fetch=saved;}
});

test('Approve and settle HTTP routes re-attest GitHub SHA and invalidate changed revisions on the ledger',async()=>{
 configure();const saved=global.fetch;let head=changed,status='APPROVED',ledgerSha=sha,cid=0;let commands:string[]=[];let prReads=0;
 global.fetch=async(input,options)=>{
  const url=String(input);
  if(url.endsWith('/v2/state/active-contracts-page'))return Response.json({activeContracts:[{contractEntry:{JsActiveContract:{createdEvent:{contractId:`bounty-${cid}`,templateId:`${packageId}:MergeMint.Token:MergeMintBounty`,createdAt:new Date().toISOString(),createArgument:{bountyId:bounty.id,sponsor:parties.sponsor.partyId,maintainer:parties.maintainer.partyId,contributor:parties.contributor.partyId,repository:bounty.repo,issueNumber:'1',amount:'10',asset:'MMT',acceptanceCriteria:bounty.criteria,submissionSha:ledgerSha,prNumber:'9',status}}}}}]});
  if(url.endsWith('/v2/commands/submit-and-wait')){const payload=JSON.parse(String(options?.body));const c=payload.commands[0].ExerciseCommand;commands.push(c.choice);if(c.choice==='SubmitRevision'){ledgerSha=c.choiceArgument.sha;status='SUBMITTED';}if(c.choice==='Approve')status='APPROVED';cid++;return Response.json({updateId:'ledger-update'});}
  if(url.endsWith('/user/installations'))return Response.json({installations:[]});
  if(url.endsWith('/pulls/9')){prReads++;assert.equal(options?.cache,'no-store');return Response.json({number:9,title:'PR',head:{sha:head,ref:'fix'},base:{ref:'main'},user:{login:'contributor-user'},merged:false,state:'open'});}
  if(url.includes('/check-runs'))return Response.json({check_runs:[]});
  if(url.endsWith('/status'))return Response.json({statuses:[]});
  if(url.endsWith('/repos/example/core-utils'))return Response.json({permissions:{push:true}});
  throw Error('Unexpected request '+url);
 };
 try{
  let r: Response=await settle(request({bounty}));assert.equal(r.status,409);assert.equal((await r.json()).code,'REVISION_CHANGED');assert.equal(status,'SUBMITTED');assert.deepEqual(commands,['SubmitRevision']);
  status='SUBMITTED';ledgerSha=sha;commands=[];
  r=await approve(request({bounty,sha,maintainer:parties.maintainer}));assert.equal(r.status,409);assert.deepEqual(commands,['SubmitRevision']);
  head=changed;commands=[];
  r=await approve(request({bounty:{...bounty,submission:{...bounty.submission!,sha:changed}},sha:changed,maintainer:parties.maintainer}));assert.equal(r.status,200);assert.deepEqual(commands,['Approve']);assert.equal(prReads,3);
 }finally{global.fetch=saved;}
});

test('Funding rejects fictional issue numbers and pull requests posing as issues',async()=>{
 configure();const saved=global.fetch;
 try{for(const response of [new Response('{}',{status:404}),Response.json({number:1,state:'open',pull_request:{}})]){
 global.fetch=async input=>String(input).includes('/issues/')?response:Response.json({permissions:{push:true}});
 assert.equal((await fund(request({bounty},'sponsor-user'))).status,400);
 }}finally{global.fetch=saved;}
});

test('Ledger reload does not fabricate PR, merge or CI evidence; conflicts clear approval/report',()=>{
 const c:CantonContract={contractId:'locked',templateId:'t',bountyId:bounty.id,sponsor:parties.sponsor.partyId,maintainer:parties.maintainer.partyId,contributor:parties.contributor.partyId,repository:bounty.repo,issueNumber:1,issueUrl:'',amount:'10',asset:'MMT',acceptanceCriteria:[],submissionSha:changed,prNumber:9,status:'SUBMITTED',createdAt:''};
 const restored=reconcileLedger(c,bounty);assert.equal(restored.submission?.number,9);assert.equal(restored.submission?.evidenceLoaded,false);assert.deepEqual(restored.submission?.checks,[]);assert.equal(restored.approval,undefined);
 const invalidated=invalidateRevision({...bounty,status:'APPROVED',report:{sha,createdAt:'',criteria:[]}}, {...bounty.submission!,sha:changed});assert.equal(invalidated.status,'SUBMITTED');assert.equal(invalidated.approval,undefined);assert.equal(invalidated.report,undefined);
});

test('Unrelated core repository never receives local context or invented Canton findings',async()=>{
 configure();const saved=global.fetch;global.fetch=async()=>new Response('{}',{status:404});
 try{const context=await gatherRepoContext('unrelated/core-utils');assert.ok(!context.contextSources.some(p=>p.startsWith('local:')));const suggestions=fallbackSuggestions(context);for(const s of suggestions){assert.equal(s.confidenceLevel,'Exploratory');assert.deepEqual(s.evidence?.filePaths,[]);assert.ok(!s.description.includes('Canton'));}}finally{global.fetch=saved;}
});

