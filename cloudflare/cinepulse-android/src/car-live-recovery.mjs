/** Controlled CAR rollout. Existing completed jobs are immutable.
 * Failed source-reuse evidence must be supplied by the assigned worker and
 * independently checked against the current failed batch and original SRT.
 */
import {deepProductionProgress,loadProductionCues,validateProductionDeepBatch,deepLanguage} from './permanent-deep-muse.mjs';
import {sha256} from './helpers.mjs';
export const CAR_LIVE_BUILD='car-live-recovery-v1.1';
export const CAR_LIVE_MARKER='[CAR-LIVE-V1.1]';
// A project allowlist alone is NOT deployment authorization. Keep all recovery
// mutation routes inert until a separately approved runtime activation is set.
export const carLiveEnabled=(env,id)=>!!id&&env.CAR_LIVE_EXECUTOR_ENABLED==='true'&&env.CAR_LIVE_PROJECT_ID===id;
const overlap=(a,b)=>a.sourceStartSeconds<b.sourceEndSeconds-.001&&a.sourceEndSeconds>b.sourceStartSeconds+.001;
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
export function verifyFailedCarTargets({failed,language,cues,accepted,sourceSrt,targets}){
 if(failed?.status!=='error'||deepLanguage(failed.step_id)!==language||!failed.error)
  throw Error('A persisted failed matching job is required');
 const progress=deepProductionProgress(cues,accepted),source=loadProductionCues(sourceSrt);
 if(!Array.isArray(targets)||targets.length<1||targets.length>3)throw Error('Declare one to three failed targets');
 // A recovery POST cannot invent an earlier failure. Require exact decisions
 // durably recorded on the original leased Muse job at failure time.
 let persisted;
 try{persisted=JSON.parse(failed.output||'null')?.carFailureEvidence;}catch{}
 if(persisted?.failedJobId!==failed.id||persisted?.stepId!==failed.step_id||
    !Array.isArray(persisted.rejectedDecisions)||persisted.rejectedDecisions.length!==targets.length)
  throw Error('Durable original failed-job decision evidence required');
 const proofByIndex=new Map();
 for(const decision of persisted.rejectedDecisions){
  if(!Number.isInteger(decision?.segmentIndex)||proofByIndex.has(decision.segmentIndex))
   throw Error('Invalid or duplicate durable failed-job decision');
  proofByIndex.set(decision.segmentIndex,decision);
 }
 const seen=new Set();
 return targets.map(t=>{
  const d=t?.rejectedDecision,index=t?.segmentIndex,proof=proofByIndex.get(index);
  if(!proof||!d||['segmentIndex','museRequestId','evidenceQuote','sourceStartSeconds','sourceEndSeconds']
      .some(key=>d[key]!==proof[key])||JSON.stringify(d.sourceCueIds)!==JSON.stringify(proof.sourceCueIds))
   throw Error('Recovery declaration differs from durable failed-job decision');
  if(!Number.isInteger(index)||index<=progress.reviewedSegments||index>Math.min(cues.length,progress.reviewedSegments+5)||seen.has(index)||d?.segmentIndex!==index)
   throw Error('Target must be unique and inside the unfinished batch');
  // A textual failure alone cannot authorize CAR: require matching original
  // source evidence and a demonstrable collision with a completed checkpoint.
  if(!Array.isArray(d.sourceCueIds)||d.sourceCueIds.length!==1||!Number.isInteger(d.sourceCueIds[0]))throw Error('One rejected literal source cue required');
  const cue=source[d.sourceCueIds[0]-1];
  if(!cue||norm(d.evidenceQuote)!==norm(cue.text)||!Number.isFinite(d.sourceStartSeconds)||!Number.isFinite(d.sourceEndSeconds)||
   d.sourceStartSeconds<0||d.sourceEndSeconds>source.at(-1).endSeconds+.01||d.sourceEndSeconds-d.sourceStartSeconds>30||
   d.sourceStartSeconds>cue.endSeconds+12||d.sourceEndSeconds<cue.startSeconds-12||d.sourceEndSeconds<=d.sourceStartSeconds||
   !progress.allDecisions.some(p=>overlap(d,p)))throw Error('Literal source reuse is not independently verified');
  if(typeof d.museRequestId!=='string'||d.museRequestId.trim().length<6)throw Error('Original Muse request reference required');
  seen.add(index);
  return {segmentIndex:index,rejectedDecision:structuredClone(d),failureKind:'accepted_source_overlap'};
 });
}
// Shared write authorization for both first dispatch and retry. Diagnostics
// may show a candidate with unknown future segments; writes may not.
export function requireCarFullInventory(audit,targetIds){
 const unknown=audit?.inventory?.unknownSegmentIds;
 if(audit?.evidenceStatus!=='verified'||!Array.isArray(unknown)||
    !Array.isArray(targetIds)||targetIds.length<1||targetIds.length>3||
    new Set(targetIds).size!==targetIds.length)
  throw Error('CAR full bilingual inventory is incomplete or unverified');
 const proven=new Set([...(audit.verifiedSegmentIds||[]),...targetIds]);
 if(unknown.length===0||unknown.length>3||proven.size>3||
    unknown.some(id=>!proven.has(id))||targetIds.some(id=>!unknown.includes(id)))
  throw Error('CAR full bilingual inventory is incomplete or exceeds the three-target recovery limit');
 return true;
}
export function validateCarRecoveryBatch({record,language,cues,sourceSrt,accepted,otherAccepted,payload}){
 const targets=JSON.parse(record.targets_json),indices=new Set(targets.map(t=>t.segmentIndex));
 if(payload?.carRecovery!==true)throw Error('Explicit carRecovery:true required');
 const verified=validateProductionDeepBatch(language,cues,sourceSrt,accepted,payload);
 const source=loadProductionCues(sourceSrt),allPrior=[...accepted,...otherAccepted].flatMap(b=>b.decisions);
 for(const d of verified.decisions){
  if(!indices.has(d.segmentIndex)){
   if(d.anchorMethod==='context')throw Error('Undeclared context recovery target');
   continue;
  }
  const declaration=targets.find(t=>t.segmentIndex===d.segmentIndex),old=declaration.rejectedDecision.sourceCueIds[0];
  const id=d.sourceCueIds[0],cue=source[id-1];
  if(d.anchorMethod!=='context'||d.sourceCueIds.length!==1||Math.abs(id-old)>5||id===old||
   norm(d.evidenceQuote)!==norm(cue?.text)||d.sourceStartSeconds<cue.startSeconds||d.sourceEndSeconds>cue.endSeconds||
   allPrior.some(p=>p.sourceCueIds.includes(id)||overlap(d,p))||
   verified.decisions.some(p=>p!==d&&(p.sourceCueIds.includes(id)||overlap(d,p))))
    throw Error('Context target requires an unused exact source cue within five cues of the rejected literal anchor');
 }
 return {...verified,carRecovery:{version:CAR_LIVE_BUILD,targets:[...indices],failedJobId:record.failed_job_id}};
}
export async function ensureCarLiveTable(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS car_live_batches (
 job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, worker_id TEXT NOT NULL,
 failed_job_id TEXT NOT NULL UNIQUE, step_id TEXT NOT NULL, targets_json TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, source_hash TEXT NOT NULL, next_job_id TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL, CHECK(json_array_length(targets_json) BETWEEN 1 AND 3))`).run();
}
export async function carLiveRecord(env,jobId){
 await ensureCarLiveTable(env);
 return env.DB.prepare('SELECT * FROM car_live_batches WHERE job_id=?').bind(jobId).first();
}
export async function completedCarSnapshot(env,projectId){
 const rows=await env.DB.prepare("SELECT id,step_id,output FROM jobs WHERE project_id=? AND status='done' ORDER BY id").bind(projectId).all();
 return JSON.stringify(rows.results||[]);
}
// These predicates are evaluated inside the write transaction, not merely in
// the preceding HTTP read. Snapshot binds exact completed outputs in both languages.
const snapshotGuard=`(SELECT count(*) FROM jobs WHERE project_id=r.project_id AND status='done')=json_array_length(r.snapshot_json)
 AND NOT EXISTS(SELECT 1 FROM json_each(r.snapshot_json) s WHERE NOT EXISTS(
 SELECT 1 FROM jobs j WHERE j.id=json_extract(s.value,'$.id') AND j.project_id=r.project_id
 AND j.status='done' AND j.step_id=json_extract(s.value,'$.step_id') AND j.output IS json_extract(s.value,'$.output')))`;
const controlGuard=`EXISTS(SELECT 1 FROM projects p JOIN workers w ON w.id=p.worker_id
 LEFT JOIN cinepulse_movie_controls c ON c.project_id=p.id
 WHERE p.id=r.project_id AND p.worker_id=r.worker_id AND w.enabled=1 AND w.paused=0
 AND p.status IN ('needs_review','processing') AND COALESCE(c.paused,0)=0 AND COALESCE(c.stopped,0)=0)`;
// A retry or acceptance must not trust a staged reservation if the original
// failed Muse job's durable decision evidence was subsequently changed.
const failedEvidenceGuard=`EXISTS(SELECT 1 FROM jobs f
 WHERE f.id=r.failed_job_id AND f.project_id=r.project_id
 AND f.worker_id=r.worker_id AND f.step_id=r.step_id
 AND f.status='error' AND length(trim(COALESCE(f.error,'')))>0
 AND json_valid(f.output)=1
 AND json_extract(f.output,'$.carFailureEvidence.failedJobId')=r.failed_job_id
 AND json_extract(f.output,'$.carFailureEvidence.stepId')=r.step_id
 AND json_type(f.output,'$.carFailureEvidence.rejectedDecisions')='array'
 AND json_array_length(json_extract(f.output,'$.carFailureEvidence.rejectedDecisions'))=json_array_length(r.targets_json)
 AND NOT EXISTS(SELECT 1 FROM json_each(r.targets_json) target
 WHERE NOT EXISTS(SELECT 1 FROM json_each(f.output,'$.carFailureEvidence.rejectedDecisions') proof
 WHERE json_extract(target.value,'$.segmentIndex')=json_extract(proof.value,'$.segmentIndex')
 AND json_extract(target.value,'$.rejectedDecision')=proof.value)))`;
export async function dispatchCarLiveBatch(env,{projectId,workerId,failed,targets,snapshot,sourceSrt,jobId,nextJobId,now}){
 if(!carLiveEnabled(env,projectId))throw Error('Controlled CAR rollout is not enabled for this movie');
 await ensureCarLiveTable(env);
 const prior=await env.DB.prepare('SELECT r.*,j.status FROM car_live_batches r JOIN jobs j ON j.id=r.job_id WHERE r.failed_job_id=? AND r.project_id=?').bind(failed.id,projectId).first();
 if(prior)return {jobId:prior.job_id,status:prior.status,alreadyDispatched:true};
 const record={job_id:jobId,project_id:projectId,worker_id:workerId,failed_job_id:failed.id,step_id:failed.step_id,
 targets_json:JSON.stringify(targets),snapshot_json:snapshot,source_hash:await sha256(sourceSrt),next_job_id:nextJobId,created_at:now};
 const values=Object.values(record);
 const result=await env.DB.batch([
 env.DB.prepare(`INSERT INTO car_live_batches SELECT r.* FROM (SELECT ? job_id,? project_id,? worker_id,? failed_job_id,? step_id,? targets_json,? snapshot_json,? source_hash,? next_job_id,? created_at) r
 WHERE ${controlGuard} AND ${snapshotGuard}
 AND EXISTS(SELECT 1 FROM jobs f WHERE f.id=r.failed_job_id AND f.project_id=r.project_id AND f.worker_id=r.worker_id AND f.step_id=r.step_id AND f.status='error' AND f.error=? AND f.output=?
 AND f.rowid=(SELECT max(latest.rowid) FROM jobs latest WHERE latest.project_id=r.project_id AND latest.step_id=r.step_id))
 AND NOT EXISTS(SELECT 1 FROM jobs a WHERE a.project_id=r.project_id AND a.status IN ('queued','working'))
 AND COALESCE((SELECT sum(json_array_length(targets_json)) FROM car_live_batches WHERE project_id=r.project_id),0)+json_array_length(r.targets_json)<=3
 AND NOT EXISTS(SELECT 1 FROM car_live_batches b,json_each(b.targets_json) old,json_each(r.targets_json) fresh
 WHERE b.project_id=r.project_id AND b.step_id=r.step_id AND json_extract(old.value,'$.segmentIndex')=json_extract(fresh.value,'$.segmentIndex'))`).bind(...values,failed.error,failed.output),
 env.DB.prepare(`INSERT INTO jobs(id,project_id,worker_id,step_id,status,prompt,created_at)
 SELECT job_id,project_id,worker_id,step_id,'queued',?,created_at FROM car_live_batches WHERE job_id=?`).bind(CAR_LIVE_MARKER,jobId),
 env.DB.prepare("UPDATE projects SET status='processing',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=?)").bind(now,projectId,jobId)
 ]);
 if(result[0].meta?.changes!==1)throw Error('Dispatch rejected: stale state, active task, controls, or lifetime recovery cap');
 return {jobId,status:'queued',alreadyDispatched:false};
}
export async function acceptCarLiveBatch(env,{record,job,verified,nextStep,sourceSrt,now}){
 if(!carLiveEnabled(env,job.project_id)||record.project_id!==job.project_id||record.worker_id!==job.worker_id||record.step_id!==job.step_id||record.source_hash!==await sha256(sourceSrt))throw Error('Recovery identity, flag or original source changed');
 const output=JSON.stringify({...verified,carAcceptanceId:crypto.randomUUID()});
 const result=await env.DB.batch([
 env.DB.prepare(`UPDATE jobs SET output=?,status='done',finished_at=?,lease=NULL,lease_until=NULL
 WHERE id=? AND status='working' AND lease=? AND lease_until>?
 AND EXISTS(SELECT 1 FROM car_live_batches r WHERE r.job_id=jobs.id AND ${controlGuard} AND ${snapshotGuard} AND ${failedEvidenceGuard})`).bind(output,now,job.id,job.lease,now),
 env.DB.prepare(`INSERT INTO jobs(id,project_id,worker_id,step_id,status,prompt,created_at)
 SELECT r.next_job_id,r.project_id,r.worker_id,?,'queued','[PERMANENT-DEEP-MUSE] Continue after accepted CAR batch',?
 FROM car_live_batches r JOIN jobs j ON j.id=r.job_id WHERE r.job_id=? AND j.status='done' AND j.output=?
 AND NOT EXISTS(SELECT 1 FROM jobs n WHERE n.id=r.next_job_id)`).bind(nextStep,now,job.id,output),
 env.DB.prepare("UPDATE projects SET status='processing',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=?)").bind(now,job.project_id,record.next_job_id)
 ]);
 if(result[0].meta?.changes!==1)throw Error('Recovery result rejected: stale snapshot, expired lease or movie controls');
 return {id:job.id,status:'done',nextJobId:record.next_job_id,nextStep,recoveredTargets:JSON.parse(record.targets_json).map(t=>t.segmentIndex),acceptedJobsUnchanged:true};
}

export async function readCarLiveAudit(env,projectId){
 const exists=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='car_live_batches'").first();
 if(!exists)return {reservedCount:0,recoveredCount:0,pendingTargets:[],jobs:[]};
 const rows=await env.DB.prepare('SELECT r.job_id,r.step_id,r.targets_json,j.status FROM car_live_batches r JOIN jobs j ON j.id=r.job_id WHERE r.project_id=? ORDER BY r.created_at').bind(projectId).all();
 const result={reservedCount:0,recoveredCount:0,pendingTargets:[],jobs:[]};
 for(const row of rows.results||[]){
  const ids=JSON.parse(row.targets_json).map(t=>deepLanguage(row.step_id)+':'+t.segmentIndex);
  result.reservedCount+=ids.length;
  if(row.status==='done')result.recoveredCount+=ids.length;else result.pendingTargets.push(...ids);
  result.jobs.push({jobId:row.job_id,status:row.status,targets:ids});
 }
 return result;
}

export async function retryCarLiveBatch(env,{record,sourceSrt,now}){
 if(!carLiveEnabled(env,record.project_id)||record.source_hash!==await sha256(sourceSrt))throw Error('Recovery flag or source changed');
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE jobs SET status='queued',prompt=?,error=NULL,lease=NULL,lease_until=NULL,finished_at=NULL
   WHERE id=? AND status='error' AND EXISTS(SELECT 1 FROM car_live_batches r WHERE r.job_id=jobs.id
    AND ${controlGuard} AND ${snapshotGuard} AND ${failedEvidenceGuard}
    AND NOT EXISTS(SELECT 1 FROM jobs a WHERE a.project_id=r.project_id AND a.status IN ('queued','working')))`)
    .bind(CAR_LIVE_MARKER,record.job_id),
  env.DB.prepare("UPDATE projects SET status='processing',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND status='queued')").bind(now,record.project_id,record.job_id)
 ]);
 if(result[0].meta?.changes!==1)throw Error('Recovery retry denied: stale state, controls or active task');
 return {jobId:record.job_id,status:'queued',sameReservation:true};
}
