import type { Bounty, Submission } from './bounty';
import { transition } from './bounty';
import type { CantonContract } from '@/integrations/canton/types';
export class RevisionChangedError extends Error {
  constructor(message: string, public submission: Submission) { super(message); this.name='RevisionChangedError'; }
}
export function invalidateRevision(b: Bounty, submission: Submission): Bounty {
  return { ...transition(b,{type:'SUBMIT',submission}), settlement:undefined };
}
export function reconcileLedger(c: CantonContract, previous?: Bounty): Bounty {
  const sameRevision=!!previous?.submission && previous.submission.sha===c.submissionSha;
  const hasLocalSubmission=!c.submissionSha && previous?.status==='SUBMITTED';
  const submission=sameRevision || hasLocalSubmission ? previous?.submission : c.submissionSha && c.prNumber ? {number:c.prNumber,title:'GitHub evidence not loaded',branch:'Unknown',sha:c.submissionSha,merged:false,mergeState:'unknown',review:'Fetch current GitHub evidence',checks:[],evidenceLoaded:false} : undefined;
  return {
    ...previous,id:c.bountyId,repo:c.repository,issue:c.issueNumber,title:previous?.title??`Issue #${c.issueNumber} on ${c.repository}`,amount:c.amount,asset:'MMT',
    sponsor:{handle:previous?.sponsor.handle??'sponsor',partyId:c.sponsor},maintainer:{handle:previous?.maintainer.handle??'maintainer',partyId:c.maintainer},contributor:c.contributor?{handle:previous?.contributor?.handle??'contributor',partyId:c.contributor}:undefined,
    criteria:c.acceptanceCriteria.length?c.acceptanceCriteria:previous?.criteria??[],status:hasLocalSubmission?'SUBMITTED':c.status,activity:previous?.activity??'Read from Canton',fundingRef:c.contractId,tokenHoldingContractId:c.tokenHoldingContractId,submission,
    report:sameRevision?previous?.report:undefined,
    approval:c.status==='APPROVED'&&c.submissionSha?{sha:c.submissionSha,maintainerId:c.maintainer,approvedAt:previous?.approval?.approvedAt??c.createdAt}:undefined,
    settlement:c.settledReceipt?{state:'confirmed',recipient:c.contributor!,amount:c.amount,timestamp:c.settledReceipt.settledAt,reference:previous?.settlement?.reference,correlationReference:c.settledReceipt.settlementRef,tokenRecipientHoldingId:c.settledReceipt.tokenRecipientHoldingId,tokenTransferTxId:previous?.settlement?.tokenTransferTxId}:undefined,
  };
}
