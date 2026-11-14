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
 AND instr(COALESCE(f.error,''),'narration text does not exactly correspond to source-linked units')>0
 AND f.id=(SELECT j.id FROM jobs j WHERE j.project_id=p.id
   AND j.step_id='grounded_preflight' ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1)
 AND EXISTS(SELECT 1 FROM jobs digest WHERE digest.project_id=p.id
   AND digest.step_id='digest' AND digest.status='done'
   AND instr(COALESCE(digest.prompt,''),'[CINEPULSE-V5G-GROUNDED-SRT-ONLY]')>0)
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
   AND instr(COALESCE(j.prompt,''),'[V5G-PREFLIGHT-RECOVERY-V1]')>0)`;
export const V5G_PREFLIGHT_RECOVERY_PROJECT_SQL=`UPDATE projects
 SET status='processing',updated_at=?
 WHERE id=? AND worker_id=? AND status='needs_review'
 AND EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=projects.id AND j.id=?
   AND j.step_id='grounded_preflight' AND j.status IN ('queued','working')
   AND instr(COALESCE(j.prompt,''),'[V5G-PREFLIGHT-RECOVERY-V1]')>0)`;

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
  "AND instr(COALESCE(prompt,''),'[V5G-PREFLIGHT-RECOVERY-V1]')>0 ORDER BY created_at DESC LIMIT 1"
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
  "AND instr(COALESCE(prompt,''),'[V5G-PREFLIGHT-RECOVERY-V1]')>0 ORDER BY created_at DESC LIMIT 1"
 ).bind(projectId).first();
 if(after)return {enqueued:false,idempotent:true,jobId:after.id,status:after.status,
  reason:'recovery_already_issued'};
 return {enqueued:false,reason:'state_or_evidence_guard_rejected'};
}

/**
 * Read-only reason codes for a failed V5-G preflight that did not requeue.
 * Returns booleans/counts, never narration, SRT content, auth or worker tokens.
 * Use only behind an authenticated, matching Worker 1 or administrator route.
 */
export async function inspectV5gPreflightRecoveryGuards(env,{projectId,workerId,failedJobId,now}={}){
 if(![projectId,workerId,failedJobId].every(uuid)||!Number.isInteger(now))
  return {eligible:false,blockingReasons:['invalid_identifiers']};
 const [project,failed,rows]=await Promise.all([
  env.DB.prepare(`SELECT p.id,p.status,p.worker_id,p.expires_at,
      COALESCE(c.paused,0) AS movie_paused,COALESCE(c.stopped,0) AS movie_stopped,
      w.enabled AS worker_enabled,w.paused AS worker_paused
    FROM projects p LEFT JOIN workers w ON w.id=p.worker_id
    LEFT JOIN cinepulse_movie_controls c ON c.project_id=p.id
    WHERE p.id=?`).bind(projectId).first(),
  env.DB.prepare(`SELECT id,status,step_id,error FROM jobs WHERE id=? AND project_id=?`)
    .bind(failedJobId,projectId).first(),
  env.DB.prepare(`SELECT id,step_id,status,prompt FROM jobs WHERE project_id=?
    ORDER BY created_at ASC,rowid ASC`).bind(projectId).all()
 ]);
 const jobs=rows?.results||[];
 const latestPreflight=jobs.filter(j=>j.step_id==='grounded_preflight').at(-1);
 const prerequisites=['digest','grounded_evidence','narration_english','narration_urdu'];
 const prereqCounts=Object.fromEntries(prerequisites.map(step=>[
  step,jobs.filter(j=>j.step_id===step&&j.status==='done').length
 ]));
 const downstream=new Set(['grounded_preflight','publishing_metadata','mp3_english',
  'srt_english','mp3_urdu','srt_urdu','grounded_match_plan','deep_match_english',
  'deep_match_urdu','deep_cut_plan','windows_project']);
 const blockingReasons=[];
 const check=(ok,code)=>{if(!ok)blockingReasons.push(code);};
 check(!!project,'project_missing');
 if(project){
  check(project.worker_id===workerId,'worker_mismatch');
  check(project.status==='needs_review','project_not_needs_review');
  check(project.expires_at===null||project.expires_at>now,'project_expired');
  check(Number(project.worker_enabled)===1,'worker_disabled');
  check(Number(project.worker_paused||0)===0,'worker_paused');
  check(Number(project.movie_paused||0)===0,'movie_paused');
  check(Number(project.movie_stopped||0)===0,'movie_stopped');
 }
 check(!!failed,'failed_job_missing');
 if(failed){
  check(failed.step_id==='grounded_preflight','wrong_failed_step');
  check(failed.status==='error','failed_job_not_error');
  check(String(failed.error||'').includes('narration text does not exactly correspond to source-linked units'),
   'failed_error_not_envelope_mismatch');
 }
 check(latestPreflight?.id===failedJobId,'different_latest_preflight');
 const digest=jobs.find(j=>j.step_id==='digest'&&j.status==='done');
 check(!!digest&&String(digest.prompt||'').includes('[CINEPULSE-V5G-GROUNDED-SRT-ONLY]'),
  'not_v5g_digest_checkpoint');
 check(Object.values(prereqCounts).every(n=>n===1),'accepted_prerequisites_not_exactly_once');
 check(!jobs.some(j=>j.status==='done'&&downstream.has(j.step_id)),
  'later_stage_already_accepted');
 check(!jobs.some(j=>['queued','working'].includes(j.status)),'active_or_queued_task_exists');
 check(!jobs.some(j=>j.step_id==='grounded_preflight'&&
  String(j.prompt||'').includes(V5G_PREFLIGHT_REQUEUE_MARKER)),
  'recovery_already_issued');
 return {projectId,workerId,failedJobId,eligible:blockingReasons.length===0,
  blockingReasons,acceptedPrerequisiteCounts:prereqCounts,
  failedJobStatus:failed?.status||null,latestPreflightJobId:latestPreflight?.id||null,
  projectStatus:project?.status||null,readOnly:true};
}
