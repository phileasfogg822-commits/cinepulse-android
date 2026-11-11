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
