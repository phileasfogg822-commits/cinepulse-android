/**
 * CAR v1.1 read-only D1 inventory collector.
 * Done V5 batches are immutable evidence. A failed, queued or unstarted
 * narration segment is UNKNOWN, never automatically "unresolved".
 * No recovery eligibility can be granted from an incomplete source inventory.
 */
import {deepProductionProgress,loadProductionCues,PERMANENT_DEEP_MATCH_EN,PERMANENT_DEEP_MATCH_UR} from './permanent-deep-muse.mjs';
import {verifyCarLiveInventory} from './car-live-inventory.mjs';

export function assembleCarD1Inventory({englishSrt,urduSrt,englishBatches=[],urduBatches=[],jobs=[]}={}){
 const parts={},accepted=[],unknown=[];
 for(const [language,srt,batches] of [['english',englishSrt,englishBatches],['urdu',urduSrt,urduBatches]]){
  if(typeof srt!=='string'||!srt.trim())throw Error('CAR D1 inventory missing '+language+' measured SRT');
  const cues=loadProductionCues(srt);
  const progress=deepProductionProgress(cues,batches);
  const statuses=cues.map((_,i)=>({index:i+1,status:i<progress.reviewedSegments?'accepted':'unknown'}));
  for(const row of statuses){
   const id=language+':'+row.index;
   if(row.status==='accepted')accepted.push(id);else unknown.push(id);
  }
  parts[language]={complete:unknown.every(id=>!id.startsWith(language+':')),total:cues.length,
   reviewed:progress.reviewedSegments,remaining:cues.length-progress.reviewedSegments,segments:statuses};
 }
 const stages=new Set([PERMANENT_DEEP_MATCH_EN,PERMANENT_DEEP_MATCH_UR]);
 const relevantJobs=jobs.filter(j=>stages.has(j.step_id));
 const errorJobs=relevantJobs.filter(j=>j.status==='error').map(j=>({
  id:j.id,stepId:j.step_id,createdAt:j.created_at,error:String(j.error||'').slice(0,300)
 }));
 // Only durable job checkpoints are considered; an error message is not a
 // per-segment unresolved declaration and is never used to pass the CAR cap.
 const snapshotVersion=Math.max(0,...relevantJobs.map(j=>Number(j.created_at)||0));
 let verification={verified:false,reason:'coverage_incomplete'};
 if(unknown.length===0){
  verification=verifyCarLiveInventory({english:parts.english,urdu:parts.urdu,
   accepted,recovered:[],snapshotVersion});
 }
 return {source:'d1_read_only',snapshotVersion,english:parts.english,urdu:parts.urdu,
  acceptedSegmentIds:accepted,unknownSegmentIds:unknown,
  failedJobEvidence:errorJobs,complete:unknown.length===0,
  eligibility:{verified:false,reason:unknown.length?'unverified_segments_remain':verification.reason},
  readOnly:true,mutationPermitted:false};
}
/**
 * A per-segment unresolved state is valid only when accompanied by durable,
 * independently validated Muse evidence. Job failure text and partial batches
 * are not evidence. This is an opt-in pure reconciler; the read-only endpoint
 * deliberately continues to use assembleCarD1Inventory until evidence exists.
 */
/**
 * Validate a per-segment unresolved declaration against the actual D1 job row.
 * This never trusts a client's verifiedByProduction boolean. A failed job is
 * only diagnostic; it cannot certify a segment by itself.
 */
export function verifyCarMuseEvidence(base,jobRows,evidence){
 if(!base||base.source!=='d1_read_only'||!Array.isArray(base.unknownSegmentIds)||
    !Array.isArray(jobRows)||!Array.isArray(evidence))
   return {verified:false,reason:'missing_d1_evidence'};
 const jobs=new Map(jobRows.map(row=>[row.id,row]));
 const seen=new Set(),verified=[];
 for(const item of evidence){
  const job=jobs.get(item?.sourceJobId);
  const language=String(item?.id||'').split(':')[0];
  const expectedStage=language==='english'?PERMANENT_DEEP_MATCH_EN:PERMANENT_DEEP_MATCH_UR;
  if(!job||!base.unknownSegmentIds.includes(item.id)||seen.has(item.id)||
     job.step_id!==expectedStage||job.status!=='done'||
     !Number.isSafeInteger(item.snapshotVersion)||item.snapshotVersion!==base.snapshotVersion||
     item.status!=='unresolved')
   return {verified:false,reason:'unverified_or_stale_job_evidence'};
  let payload;
  try{payload=typeof job.output==='string'?JSON.parse(job.output):job.output}catch{return {verified:false,reason:'corrupt_muse_evidence'}}
  const index=Number(item.id.split(':')[1]);
  const entry=payload?.unresolvedSegments?.find(x=>x?.segmentIndex===index);
  if(!entry||entry.status!=='unresolved'||entry.reviewedByMuse!==true||
     typeof entry.sourceCueQuote!=='string'||!entry.sourceCueQuote.trim()||
     !Array.isArray(entry.sourceCueIds)||entry.sourceCueIds.length===0||
     typeof entry.museRequestId!=='string'||entry.museRequestId.length<6)
   return {verified:false,reason:'missing_explicit_muse_segment_evidence'};
  seen.add(item.id);
  verified.push({id:item.id,status:'unresolved',sourceJobId:job.id,
   snapshotVersion:base.snapshotVersion,verifiedByProduction:true});
 }
 return {verified:true,evidence:verified};
}
export function reconcileCarEvidence(base,evidence=[]){
 if(!base||base.source!=='d1_read_only'||!Array.isArray(base.unknownSegmentIds))
   throw Error('CAR requires live D1 base inventory');
 const allowed=new Set(base.unknownSegmentIds),seen=new Set(),accepted=new Set(base.acceptedSegmentIds);
 const unresolved=[],recovered=[];
 for(const item of evidence){
  if(!item||typeof item.id!=='string'||!allowed.has(item.id)||seen.has(item.id)||
     !['unresolved','recovered'].includes(item.status)||
     item.verifiedByProduction!==true||
     typeof item.sourceJobId!=='string'||!item.sourceJobId.trim()||
     !Number.isSafeInteger(item.snapshotVersion)||item.snapshotVersion!==base.snapshotVersion)
   throw Error('CAR evidence invalid, stale or collides with accepted checkpoint');
  seen.add(item.id);
  (item.status==='unresolved'?unresolved:recovered).push(item.id);
 }
 const copy=structuredClone(base);
 for(const [language,part] of [['english',copy.english],['urdu',copy.urdu]]){
  for(const segment of part.segments){
   const id=language+':'+segment.index;
   if(seen.has(id))segment.status=unresolved.includes(id)?'unresolved':'recovered';
  }
  part.complete=part.segments.every(segment=>segment.status!=='unknown');
 }
 copy.unknownSegmentIds=base.unknownSegmentIds.filter(id=>!seen.has(id));
 copy.recoveredSegmentIds=recovered;
 copy.complete=copy.unknownSegmentIds.length===0;
 const verified=copy.complete?verifyCarLiveInventory({
  english:copy.english,urdu:copy.urdu,accepted:[...accepted],
  recovered,snapshotVersion:copy.snapshotVersion
 }):{verified:false,reason:'unverified_segments_remain'};
 copy.eligibility={...verified};
 copy.mutationPermitted=false;
 copy.readOnly=true;
 return copy;
}
/**
 * Operational read-only evidence audit. Unlike the earlier helpers this
 * discovers declarations from D1 itself, not from a caller-provided list.
 * It cannot grant write access and does not alter ordinary Muse processing.
 */
/**
 * A narrowly scoped recovery candidate may be inspected without requiring
 * the rest of the movie to finish. This is diagnostic only, never write
 * authorization: atomic persistence and source-SRT validation are separate.
 */
export function inspectCarRecoveryCandidate(audit,targetId){
 const base=audit?.inventory;
 if(!base||base.source!=='d1_read_only'||!Array.isArray(base.unknownSegmentIds)||
    typeof targetId!=='string'||! /^(english|urdu):[1-9][0-9]*$/.test(targetId))
   return {eligible:false,reason:'invalid_candidate'};
 if(base.acceptedSegmentIds?.includes(targetId))
   return {eligible:false,reason:'already_accepted'};
 if(!base.unknownSegmentIds.includes(targetId))
   return {eligible:false,reason:'not_unknown'};
 if(audit.evidenceStatus!=='verified'||!Array.isArray(audit.verifiedSegmentIds)||
    !audit.verifiedSegmentIds.includes(targetId))
   return {eligible:false,reason:'no_verified_muse_evidence'};
 if(audit.verifiedSegmentIds.length>3)
   return {eligible:false,reason:'recovery_limit_exceeded'};
 return {eligible:true,reason:'candidate_only',mutationPermitted:false,
  targetId,unrelatedUnknownCount:base.unknownSegmentIds.length-audit.verifiedSegmentIds.length};
}
export async function auditCarD1Evidence(env,projectId,priorOutputs,loadAccepted){
 const base=await collectCarD1Inventory(env,projectId,priorOutputs,loadAccepted);
 const rows=await env.DB.prepare(
  "SELECT id,step_id,status,output,created_at FROM jobs WHERE project_id=? AND step_id IN (?,?) AND status='done' ORDER BY created_at ASC,rowid ASC"
 ).bind(projectId,PERMANENT_DEEP_MATCH_EN,PERMANENT_DEEP_MATCH_UR).all();
 const jobs=rows.results||[],declarations=[];
 for(const job of jobs){
  let payload;
  try{payload=JSON.parse(job.output||'null')}catch{continue}
  const language=job.step_id===PERMANENT_DEEP_MATCH_EN?'english':'urdu';
  for(const entry of (Array.isArray(payload?.unresolvedSegments)?payload.unresolvedSegments:[])){
   if(!Number.isSafeInteger(entry?.segmentIndex))continue;
   const id=language+':'+entry.segmentIndex;
   if(base.unknownSegmentIds.includes(id))
    declarations.push({id,status:'unresolved',sourceJobId:job.id,snapshotVersion:base.snapshotVersion});
  }
 }
 const result=verifyCarMuseEvidence(base,jobs,declarations);
 return {source:'d1_read_only',projectId,inventory:base,
  declaredCount:declarations.length,verifiedCount:result.verified?result.evidence.length:0,
  verifiedSegmentIds:result.verified?result.evidence.map(item=>item.id):[],
  evidenceStatus:result.verified?'verified':'not_verified',
  reason:result.verified?null:result.reason,mutationPermitted:false};
}
export async function collectCarD1Inventory(env,projectId,priorOutputs,loadAccepted){
 const [english,urdu,jobResult]=await Promise.all([
  loadAccepted(env,projectId,PERMANENT_DEEP_MATCH_EN),
  loadAccepted(env,projectId,PERMANENT_DEEP_MATCH_UR),
  env.DB.prepare("SELECT id,step_id,status,error,created_at FROM jobs WHERE project_id=? AND step_id IN (?,?) ORDER BY created_at ASC,rowid ASC")
   .bind(projectId,PERMANENT_DEEP_MATCH_EN,PERMANENT_DEEP_MATCH_UR).all()
 ]);
 return assembleCarD1Inventory({
  englishSrt:priorOutputs.srt_english,urduSrt:priorOutputs.srt_urdu,
  englishBatches:english,urduBatches:urdu,jobs:jobResult.results||[]
 });
}
