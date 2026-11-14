/**
 * Explicit administrator-triggered retry of the single failed, incomplete
 * sequential movie stage. Works when projects.status='needs_review'; normal
 * pause/resume routes intentionally cannot perform this transition.
 *
 * This is NOT CAR, scene-matching partial repair or automatic regeneration.
 * Preserve accepted outputs and failed job history; append only one new job.
 */
export const REVIEW_STAGE_RETRY_BUILD='review-stage-retry-v1-20261114';
export const REVIEW_STAGE_RETRY_MARKER='[REVIEW-STAGE-RETRY-V1:';
export const REVIEW_STAGE_RETRY_MAX=3;
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
export const REVIEW_STAGE_ADVANCED=new Set([
 'deep_match_english','deep_match_urdu','deep_cut_plan','windows_project',
 'scene_matching','cut_plan','deep_prepare','deep_match','deep_export',
 'scene_intelligence','targeted_urdu_rematch'
]);
export const REVIEW_STAGE_MEDIA=new Set(['mp3_english','srt_english','mp3_urdu','srt_urdu']);

export function inspectReviewStageRetry({project,worker,policy,jobs,now}){
 const reasons=[];
 const require=(ok,reason)=>{if(!ok)reasons.push(reason)};
 if(!project)return {eligible:false,reasons:['project_missing'],readOnly:true};
 const all=Array.isArray(jobs)?jobs:[];
 const stages=Array.isArray(policy?.stages)?policy.stages:[];
 const latest=all.at(-1);
 const failed=latest?.status==='error'?latest:null;
 require(project.status==='needs_review','not_needs_review');
 require(!project.control_stopped&&!project.control_paused,'movie_paused_or_stopped');
 require(!project.expires_at||project.expires_at>now,'project_expired');
 require(!!worker&&Number(worker.enabled)===1&&!Number(worker.paused),'worker_disabled_or_paused');
 require(!!failed,'latest_job_not_failed');
 require(!!failed&&stages.includes(failed.step_id),'failed_step_outside_pipeline');
 require(!failed||!REVIEW_STAGE_ADVANCED.has(failed.step_id),'stage_requires_specialized_recovery');
 require(!policy?.experiment,'experimental_pipeline_requires_specialized_recovery');
 require(!all.some(j=>j.status==='queued'||j.status==='working'),'existing_queued_or_working_task');
 if(failed&&stages.includes(failed.step_id)){
  const position=stages.indexOf(failed.step_id);
  for(const prerequisite of stages.slice(0,position))
   require(all.some(j=>j.step_id===prerequisite&&j.status==='done'),
    'missing_accepted_prerequisite:'+prerequisite);
  for(const later of stages.slice(position))
   require(!all.some(j=>j.step_id===later&&j.status==='done'),
    'accepted_output_would_be_overwritten:'+later);
 }
 const retryCount=failed?all.filter(j=>j.step_id===failed.step_id&&
  String(j.prompt||'').includes(REVIEW_STAGE_RETRY_MARKER)).length:0;
 require(retryCount<REVIEW_STAGE_RETRY_MAX,'retry_limit_reached');
 return {eligible:reasons.length===0,reasons,readOnly:true,
  projectId:project.id,workerId:project.worker_id,failedJobId:failed?.id||null,
  step:failed?.step_id||null,attempts:retryCount,maxAttempts:REVIEW_STAGE_RETRY_MAX,
  acceptedJobsPreserved:true};
}
/* Avoid LIKE/GLOB entirely. An atomic INSERT + conditional project update
 * prevents queue duplication across racing admin calls and worker polls. */
export const REVIEW_STAGE_INSERT_SQL=`INSERT INTO jobs
 (id,project_id,worker_id,step_id,status,prompt,created_at)
 SELECT ?,p.id,p.worker_id,f.step_id,'queued',?,?
 FROM projects p JOIN workers w ON w.id=p.worker_id
 LEFT JOIN cinepulse_movie_controls c ON c.project_id=p.id
 JOIN jobs f ON f.id=? AND f.project_id=p.id AND f.worker_id=p.worker_id
 WHERE p.id=? AND p.worker_id=? AND p.status='needs_review'
 AND (p.expires_at IS NULL OR p.expires_at>?)
 AND w.enabled=1 AND COALESCE(w.paused,0)=0
 AND COALESCE(c.paused,0)=0 AND COALESCE(c.stopped,0)=0
 AND f.status='error' AND f.step_id=?
 AND f.id=(SELECT j.id FROM jobs j WHERE j.project_id=p.id
    ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1)
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
    AND j.status IN ('queued','working'))
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
    AND j.step_id=f.step_id AND j.status='done')
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
    AND instr(COALESCE(j.prompt,''),?)>0)
 AND (SELECT COUNT(*) FROM jobs j WHERE j.project_id=p.id
    AND j.step_id=f.step_id AND
    instr(COALESCE(j.prompt,''),'[REVIEW-STAGE-RETRY-V1:')>0) < 3`;
export const REVIEW_STAGE_PROJECT_SQL=`UPDATE projects SET status='processing',updated_at=?
 WHERE id=? AND worker_id=? AND status='needs_review'
 AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=? AND j.project_id=projects.id
    AND j.status='queued' AND instr(COALESCE(j.prompt,''),?)>0)`;

export async function enqueueReviewStageRetry(env,{projectId,workerId,failedJobId,
 stage,newJobId,prompt,now}){
 if(![projectId,workerId,failedJobId,newJobId].every(uuid)||!stage||
  !Number.isInteger(now)||now<=0||typeof prompt!=='string'||
  !prompt.includes(REVIEW_STAGE_RETRY_MARKER+failedJobId+']'))
  return {enqueued:false,reason:'invalid_retry_request'};
 const marker=REVIEW_STAGE_RETRY_MARKER+failedJobId+']';
 const find=()=>env.DB.prepare(
  "SELECT id,status FROM jobs WHERE project_id=? AND step_id=? "+
  "AND instr(COALESCE(prompt,''),?)>0 ORDER BY created_at DESC LIMIT 1"
 ).bind(projectId,stage,marker).first();
 const existing=await find();
 if(existing)return {enqueued:false,idempotent:true,jobId:existing.id,status:existing.status,
  reason:'retry_already_issued'};
 const result=await env.DB.batch([
  env.DB.prepare(REVIEW_STAGE_INSERT_SQL).bind(
    newJobId,prompt,now,failedJobId,projectId,workerId,now,stage,marker),
  env.DB.prepare(REVIEW_STAGE_PROJECT_SQL).bind(
    now,projectId,workerId,newJobId,marker)
 ]);
 const created=Number(result?.[0]?.meta?.changes||0);
 const resumed=Number(result?.[1]?.meta?.changes||0);
 if(created===1&&resumed===1)
  return {enqueued:true,jobId:newJobId,step:stage,status:'queued',
   projectId,workerId,acceptedJobsPreserved:true};
 if(created!==0||resumed!==0)throw Error('review retry atomic state invariant violated');
 const raced=await find();
 if(raced)return {enqueued:false,idempotent:true,jobId:raced.id,status:raced.status,
  reason:'retry_already_issued'};
 return {enqueued:false,reason:'concurrent_change_or_guard_rejected'};
}
