/**
 * V5-G pre-TTS narrowly-scoped recovery. Never changes accepted jobs, SRT,
 * narration, source anchors, CAR records, or assets.
 *
 * BFG authorized self-heal is triggered ONLY from the authenticated Worker 1
 * queue poll, and only for the exact known failed preflight job. Other movies
 * require an explicit authenticated administrator request.
 */
export const V5G_PREFLIGHT_REQUEUE_BUILD='v5g-preflight-requeue-v1-20261114';
export const V5G_PREFLIGHT_REQUEUE_MARKER='[V5G-PREFLIGHT-RECOVERY-V1]';
export const BFG_PREFLIGHT_PROJECT_ID='822bd90b-ad93-40be-bf0e-eae0fb4ca52c';
export const BFG_PREFLIGHT_FAILED_JOB_ID='e543691a-f5f1-44ac-a752-88b351c7d72a';
export const BFG_PREFLIGHT_WORKER_ID='e36f4e31-83a7-42cc-b13c-2525b863f5ab';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);

/**
 * D1 batch is one SQLite transaction. The first INSERT guards all mutable
 * state against the latest failed checkpoint, already accepted stages,
 * queued/working tasks and per-movie/worker controls. The second statement
 * updates project state only when that newly inserted task exists.
 */
export const V5G_PREFLIGHT_RECOVERY_INSERT_SQL=`INSERT INTO jobs
 (id,project_id,worker_id,step_id,status,prompt,created_at)
 SELECT ?,p.id,p.worker_id,'grounded_preflight','queued',?,?
 FROM projects p JOIN workers w ON w.id=p.worker_id
 LEFT JOIN cinepulse_movie_controls c ON c.project_id=p.id
 JOIN jobs f ON f.id=? AND f.project_id=p.id AND f.worker_id=p.worker_id
 WHERE p.id=? AND p.worker_id=? AND p.status='needs_review'
 AND (p.expires_at IS NULL OR p.expires_at>?)
 AND w.enabled=1 AND COALESCE(w.paused,0)=0
 AND COALESCE(c.paused,0)=0 AND COALESCE(c.stopped,0)=0
 AND f.step_id='grounded_preflight' AND f.status='error'
 AND f.error LIKE '%narration text does not exactly correspond to source-linked units%'
 AND f.id=(SELECT j.id FROM jobs j WHERE j.project_id=p.id
   AND j.step_id='grounded_preflight' ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1)
 AND EXISTS(SELECT 1 FROM jobs digest WHERE digest.project_id=p.id
   AND digest.step_id='digest' AND digest.status='done'
   AND digest.prompt LIKE '%[CINEPULSE-V5G-GROUNDED-SRT-ONLY]%')
 AND (SELECT COUNT(DISTINCT j.step_id) FROM jobs j WHERE j.project_id=p.id
   AND j.status='done' AND j.step_id IN
    ('digest','grounded_evidence','narration_english','narration_urdu'))=4
 AND (SELECT COUNT(*) FROM jobs j WHERE j.project_id=p.id
   AND j.status='done' AND j.step_id IN
    ('digest','grounded_evidence','narration_english','narration_urdu'))=4
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
   AND j.status='done' AND j.step_id IN
    ('grounded_preflight','publishing_metadata','mp3_english','srt_english',
     'mp3_urdu','srt_urdu','grounded_match_plan','deep_match_english',
     'deep_match_urdu','deep_cut_plan','windows_project'))
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
   AND j.status IN ('queued','working'))
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
   AND j.step_id='grounded_preflight'
   AND j.prompt LIKE '%[V5G-PREFLIGHT-RECOVERY-V1]%')`;
export const V5G_PREFLIGHT_RECOVERY_PROJECT_SQL=`UPDATE projects
 SET status='processing',updated_at=?
 WHERE id=? AND worker_id=? AND status='needs_review'
 AND EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=projects.id AND j.id=?
   AND j.step_id='grounded_preflight' AND j.status IN ('queued','working')
   AND j.prompt LIKE '%[V5G-PREFLIGHT-RECOVERY-V1]%')`;

export async function requeueFailedV5gPreflight(env,{
 projectId,workerId,failedJobId,newJobId,prompt,now
}={}){
 if(![projectId,workerId,failedJobId,newJobId].every(uuid)||
   !Number.isInteger(now)||now<=0||
   typeof prompt!=='string'||!prompt.startsWith('V5-G PRE-TTS HARD GATE.')||
   !prompt.includes(V5G_PREFLIGHT_REQUEUE_MARKER))
  return {enqueued:false,reason:'invalid_recovery_request'};
 const existing=await env.DB.prepare(
  "SELECT id,status FROM jobs WHERE project_id=? AND step_id='grounded_preflight' "+
  "AND prompt LIKE '%[V5G-PREFLIGHT-RECOVERY-V1]%' ORDER BY created_at DESC LIMIT 1"
 ).bind(projectId).first();
 if(existing)return {enqueued:false,idempotent:true,jobId:existing.id,status:existing.status,
  reason:'recovery_already_issued'};
 const results=await env.DB.batch([
  env.DB.prepare(V5G_PREFLIGHT_RECOVERY_INSERT_SQL).bind(
    newJobId,prompt,now,failedJobId,projectId,workerId,now),
  env.DB.prepare(V5G_PREFLIGHT_RECOVERY_PROJECT_SQL).bind(
    now,projectId,workerId,newJobId)
 ]);
 const inserted=Number(results?.[0]?.meta?.changes||0);
 const activated=Number(results?.[1]?.meta?.changes||0);
 if(inserted===1&&activated===1)
  return {enqueued:true,jobId:newJobId,projectId,workerId,
    step:'grounded_preflight',status:'queued',priorAcceptedUnchanged:true};
 if(inserted!==0||activated!==0)throw Error('V5-G recovery transaction invariant violated');
 const after=await env.DB.prepare(
  "SELECT id,status FROM jobs WHERE project_id=? AND step_id='grounded_preflight' "+
  "AND prompt LIKE '%[V5G-PREFLIGHT-RECOVERY-V1]%' ORDER BY created_at DESC LIMIT 1"
 ).bind(projectId).first();
 if(after)return {enqueued:false,idempotent:true,jobId:after.id,status:after.status,
  reason:'recovery_already_issued'};
 return {enqueued:false,reason:'state_or_evidence_guard_rejected'};
}
