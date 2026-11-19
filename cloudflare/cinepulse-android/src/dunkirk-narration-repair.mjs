/**
 * One-project surgical repair for Dunkirk (2017): the accepted V5-G scripts
 * omit actual story beats. Do NOT weaken or bypass grounded_preflight.
 *
 * Exactly one English then one Urdu revision may be queued for the pre-audio
 * project. Previous done records remain durable; priorOutputs deliberately
 * uses the latest accepted result by rowid. Preflight is explicitly authorized
 * only after both revisions are accepted. No audio, source, beat or other
 * project record is changed by this module.
 */
import {countNarrationWords} from './narration-duration-policy.mjs';
export const DUNKIRK_REPAIR_BUILD='dunkirk-pretts-two-language-repair-v1-20261119';
export const DUNKIRK_REPAIR_PROJECT='2500c3d9-09e3-446e-b98d-ab1f485a2242';
export const DUNKIRK_REPAIR_WORKER='e36f4e31-83a7-42cc-b13c-2525b863f5ab';
export const DUNKIRK_REPAIR_FAILED='6cde7c34-ac7d-4798-ba76-024c613f43a1';
export const DUNKIRK_REPAIR_SOURCE_SHA='eba9a08e94f40df34da8578a0bb16d80dbeb2fd58722e98c32d40efe9e2f0180';
export const DUNKIRK_REPAIR_MARKER='[DUNKIRK-48-BEAT-NARRATION-REPAIR-V1]';
export const DUNKIRK_ENGLISH='narration_english';
export const DUNKIRK_URDU='narration_urdu';
export const DUNKIRK_PREFLIGHT='grounded_preflight';
export const DUNKIRK_LATER_STAGES=[
 'publishing_metadata','mp3_english','srt_english','mp3_urdu','srt_urdu',
 'grounded_match_plan','deep_match_english','deep_match_urdu',
 'deep_cut_plan','windows_project'
];
const tagged=j=>String(j?.prompt||'').includes(DUNKIRK_REPAIR_MARKER);
const ordered=jobs=>(Array.isArray(jobs)?jobs:[]).slice().sort((a,b)=>
 Number(a.created_at||0)-Number(b.created_at||0)||
 Number(a.rowid||0)-Number(b.rowid||0));
export const isDunkirkNarrationRepairJob=j=>j?.project_id===DUNKIRK_REPAIR_PROJECT&&
 [DUNKIRK_ENGLISH,DUNKIRK_URDU].includes(j.step_id)&&tagged(j);
export const DUNKIRK_REPAIR_BEATS=Object.freeze({
 english:['B22'],urdu:['B07','B22','B32','B45']
});
export const DUNKIRK_REPAIR_PROMPTS=Object.freeze({
 narration_english:`REPAIR REQUIRED: DUNKIRK (2017), project ${DUNKIRK_REPAIR_PROJECT}.
${DUNKIRK_REPAIR_MARKER}
This is a revision of the SAME previously accepted English narration, not a new movie or a restarted digest.
Use the task's repairOriginalNarration plus the original SRT and accepted grounded_evidence (48 beats).
REQUIRED MISSING BEAT B22 (movie cues 329-341): Spitfires pass directly over the Moonstone; Dawson calls a Spitfire the "greatest plane ever built"; below deck the shell-shocked soldier is locked in and begs to be let out.
Include those facts explicitly and accurately; cover ALL OTHER 47 beats B01-B48 as before.
English MAXIMUM 1,500 backend-counted words (600s requested audio cap). The old 1,499-word script cannot simply be appended to. Condense lower-priority phrasing, never remove another grounded beat.
Preserve chronological Mole / Sea / Air transitions and accurate source-grounding. Never fabricate scene detail.
Return the FULL rewritten English narration, and independently audit coverage of all 48 beats before submitting.
No MP3, subtitle, source evidence, digest, or preflight output may be generated here.`,
 narration_urdu:`REPAIR REQUIRED: DUNKIRK (2017), project ${DUNKIRK_REPAIR_PROJECT}.
${DUNKIRK_REPAIR_MARKER}
Revise the previously accepted URDU narration using task.repairOriginalNarration, the 48 accepted grounded beats, the approved updated English narration and the original movie SRT.
Four mandatory formerly missing beats:
B07 (cues 77-80): Collins asks why they cannot load at Calais (کالے); Fortis Leader warns German fighters will come out of the sun (سورج).
B22 (cues 329-341): Spitfires cross over Moonstone; Dawson calls the Spitfire the greatest plane ever built; the shell-shocked soldier locked below deck begs to be released.
B32 (cues 541-552): the Dutch (ڈچ) seaman returns to rescue the grounded boat's soldiers; the tide still needs hours before the vessel floats.
B45 (cues 821-827): the train is approaching Woking (ووکنگ); a soldier is afraid to read the newspaper, fearing public scorn and being spat at.
Keep ALL OTHER 44 beats B01-B48 supported, with accurate chronology, no fabricated details, no omissions.
Output NATURAL PAKISTANI URDU SCRIPT ONLY; no Devanagari, no Hindi translation of the final narration.
Urdu MAXIMUM 1,320 whitespace-separated words AND the backend strict Urdu script budget; trim nonessential descriptive repetitions, never an entire grounded beat. The old 1,221-word version dropped real beats and must not be reused unchanged.
Return the FULL revised Urdu narration after checking each of 48 grounded beats. No TTS, scene cuts or SRT yet.`
});
export const DUNKIRK_PREFLIGHT_PROMPT=`V5-G PRE-TTS HARD GATE: the two Dunkirk narrations were revised for truthful coverage of all 48 source-grounded beats.
${DUNKIRK_REPAIR_MARKER}
Use ONLY the latest accepted narration_english and narration_urdu, not old job outputs. Construct verbatim, ordered narrationUnits for both languages.
English must honestly cover B22; Urdu must honestly cover B07,B22,B32,B45; every other beat must also appear in both languages. Do not attach unsupported beat tags.
No paraphrasing/omissions in narrationUnits. Strictly run the original validateV5gPreTts against accepted digest/evidence and exact saved scripts.
Do not start any MP3 until this preflight result is accepted.`;

/** Check accepted text alone for the missing distinct events, in addition to
 * the original word/Urdu QA validators. Canonical proper nouns are intentionally
 * required on this narrowly scoped project to prevent a false beat-tag pass. */
export function validateDunkirkRepairNarrationText(text,language,originalText){
 if(!['english','urdu'].includes(language)||typeof text!=='string'||
    !text.trim()||typeof originalText!=='string'||!originalText.trim())
  throw Error('Missing revision or approved narration');
 if(text===originalText)throw Error('Revision cannot repeat the omitted-beat narration unchanged');
 const words=countNarrationWords(text);
 if(language==='english'&&words>1500)throw Error('Dunkirk English revision exceeds 1500 backend-counted words');
 if(language==='urdu'){
  const whitespace=text.trim().split(/\s+/u).length;
  if(whitespace>1320)throw Error('Dunkirk Urdu revision exceeds 1320 whitespace words');
  if(/[A-Za-z]/u.test(text)||!/[\u0600-\u06FF]/u.test(text))
   throw Error('Dunkirk final Urdu narration must remain Urdu script only');
 }
 const requirements=language==='english'?[
   ['Spitfires over Moonstone',/spitfire/i,/moonstone/i],
   ['Dawson greatest plane',/dawson/i,/greatest|finest|best/i],
   ['locked soldier below deck',/lock|shut|confine/i,/below.deck|down.below|belowdecks/i]
 ]:[
   ['B07 Calais and sun',/کالے|کیلے|کالائس|کالیس|کیلیس/u,/سورج|دھوپ/u],
   ['B22 Moonstone Spitfire',/مون.?اسٹون|مون.?سٹون/u,/اسپٹ.?فائر|سپٹ.?فائر/u],
   ['B32 Dutch and returns',/ڈچ|ہالینڈی|نیدرلینڈ/u,/واپس|لوٹ/u],
   ['B45 Woking and newspaper',/ووکنگ|ووکِنگ/u,/اخبار/u]
 ];
 for(const [topic,...parts] of requirements)
  if(!parts.every(re=>re.test(text)))throw Error('Dunkirk revised '+language+
   ' narration still lacks required grounded detail: '+topic);
 return {language,words,checkedMissingBeats:DUNKIRK_REPAIR_BEATS[language].slice(),
  semanticReviewStillRequired:true};
}
/** Pure precheck. D1 atomic INSERTs repeat all critical state predicates. */
export function inspectDunkirkNarrationRepair({project,worker,policy,jobs,
 groundedBeats,sourceSha,hasAudio=false,now}){
 const reasons=[],all=ordered(jobs);
 const add=(ok,msg)=>{if(!ok)reasons.push(msg)};
 add(project?.id===DUNKIRK_REPAIR_PROJECT,'wrong_project');
 add(project?.worker_id===DUNKIRK_REPAIR_WORKER,'wrong_worker');
 add(policy?.grounded===true,'not_grounded_pipeline');
 add(!policy?.experiment,'experiment_not_supported');
 add(project?.status==='needs_review'||project?.status==='processing','wrong_project_status');
 add(!Number(project?.control_paused)&&!Number(project?.control_stopped),'movie_paused_or_stopped');
 add(!project?.expires_at||project.expires_at>now,'project_expired');
 add(!!worker&&Number(worker.enabled)===1&&!Number(worker.paused),'worker_unavailable');
 add(sourceSha===DUNKIRK_REPAIR_SOURCE_SHA,'source_srt_hash_mismatch');
 add(!hasAudio,'media_already_exists');
 add(Array.isArray(groundedBeats)&&groundedBeats.length===48&&
  groundedBeats.every((b,i)=>b?.id==='B'+String(i+1).padStart(2,'0')),
  'grounded_evidence_not_48_unchanged_beats');
 for(const stage of ['digest','grounded_evidence',DUNKIRK_ENGLISH,DUNKIRK_URDU])
  add(all.some(j=>j.step_id===stage&&j.status==='done'),'missing_accepted_'+stage);
 for(const stage of DUNKIRK_LATER_STAGES)
  add(!all.some(j=>j.step_id===stage&&j.status==='done'),'accepted_downstream_'+stage);
 const failed=all.find(j=>j.id===DUNKIRK_REPAIR_FAILED);
 add(!!failed&&failed.step_id===DUNKIRK_PREFLIGHT&&failed.status==='error',
  'original_preflight_failure_not_present');
 const en=all.filter(j=>j.step_id===DUNKIRK_ENGLISH&&tagged(j));
 const ur=all.filter(j=>j.step_id===DUNKIRK_URDU&&tagged(j));
 const retry=all.filter(j=>j.step_id===DUNKIRK_PREFLIGHT&&tagged(j));
 add(en.length<=1&&ur.length<=1&&retry.length<=1,'duplicate_repair_jobs');
 const active=all.filter(j=>j.status==='queued'||j.status==='working');
 add(active.length<=1,'unrelated_active_tasks');
 if(active.length===1)add(isDunkirkNarrationRepairJob(active[0])||
  (active[0].step_id===DUNKIRK_PREFLIGHT&&tagged(active[0])),
  'unrelated_active_task');
 let phase='not_started';
 if(en.length)phase=en[0].status==='done'?'english_done':'english_'+en[0].status;
 if(ur.length)phase=ur[0].status==='done'?'urdu_done':'urdu_'+ur[0].status;
 if(retry.length)phase='preflight_'+retry[0].status;
 const latest=all.at(-1);
 const start=phase==='not_started'&&project?.status==='needs_review'&&
   latest?.id===DUNKIRK_REPAIR_FAILED&&!active.length;
 const needsUr=en.length===1&&en[0].status==='done'&&!ur.length&&
  project?.status==='processing'&&!active.length;
 const needsPreflight=en.length===1&&en[0].status==='done'&&
  ur.length===1&&ur[0].status==='done'&&!retry.length&&
  project?.status==='needs_review'&&!active.length;
 if(start||needsUr||needsPreflight) add(reasons.length===0,'blocked_by_repair_guard');
 return {eligible:reasons.length===0,projectId:DUNKIRK_REPAIR_PROJECT,
  failedJobId:DUNKIRK_REPAIR_FAILED,phase,canStart:reasons.length===0&&start,
  canQueueUrdu:reasons.length===0&&needsUr,
  canRetryPreflight:reasons.length===0&&needsPreflight,
  acceptedJobsPreserved:true,mediaChanged:false,originalFailedJobPreserved:true,
  readOnly:true,reasons};
}

const CONTROL_JOIN='LEFT JOIN cinepulse_movie_controls c ON c.project_id=p.id';
const BASE_GUARD=`FROM projects p JOIN workers w ON w.id=p.worker_id
 ${CONTROL_JOIN}
 JOIN jobs f ON f.id=? AND f.project_id=p.id AND f.worker_id=p.worker_id
 WHERE p.id=? AND p.worker_id=? AND
 (p.expires_at IS NULL OR p.expires_at>?) AND
 w.enabled=1 AND COALESCE(w.paused,0)=0 AND
 COALESCE(c.paused,0)=0 AND COALESCE(c.stopped,0)=0 AND
 f.status='error' AND f.step_id='grounded_preflight' AND
 EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.step_id='digest' AND j.status='done') AND
 EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.step_id='grounded_evidence' AND j.status='done') AND
 NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.status IN ('queued','working')) AND
 NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.step_id IN ('publishing_metadata','mp3_english','srt_english',
 'mp3_urdu','srt_urdu','grounded_match_plan','deep_match_english',
 'deep_match_urdu','deep_cut_plan','windows_project') AND j.status='done')`;
export const DUNKIRK_START_SQL=`INSERT INTO jobs(id,project_id,worker_id,step_id,status,prompt,created_at)
 SELECT ?,p.id,p.worker_id,'narration_english','queued',?,?
 ${BASE_GUARD} AND p.status='needs_review' AND
 f.id=(SELECT j.id FROM jobs j WHERE j.project_id=p.id
 ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1) AND
 EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.step_id='narration_english' AND j.status='done') AND
 EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.step_id='narration_urdu' AND j.status='done') AND
 NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 instr(COALESCE(j.prompt,''),?)>0)`;
export const DUNKIRK_URDU_SQL=`INSERT INTO jobs(id,project_id,worker_id,step_id,status,prompt,created_at)
 SELECT ?,p.id,p.worker_id,'narration_urdu','queued',?,?
 ${BASE_GUARD} AND p.status='processing' AND
 EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.step_id='narration_english' AND j.status='done' AND
 instr(COALESCE(j.prompt,''),?)>0) AND
 NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.step_id='narration_urdu' AND
 instr(COALESCE(j.prompt,''),?)>0)`;
export const DUNKIRK_PREFLIGHT_SQL=`INSERT INTO jobs(id,project_id,worker_id,step_id,status,prompt,created_at)
 SELECT ?,p.id,p.worker_id,'grounded_preflight','queued',?,?
 ${BASE_GUARD} AND p.status='needs_review' AND
 EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.step_id='narration_english' AND j.status='done' AND
 instr(COALESCE(j.prompt,''),?)>0) AND
 EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.step_id='narration_urdu' AND j.status='done' AND
 instr(COALESCE(j.prompt,''),?)>0) AND
 NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND
 j.step_id='grounded_preflight' AND
 instr(COALESCE(j.prompt,''),?)>0)`;
export const DUNKIRK_PROCESSING_SQL=`UPDATE projects SET status='processing',updated_at=?
 WHERE id=? AND worker_id=? AND status='needs_review'
 AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND project_id=projects.id
 AND step_id=? AND status='queued' AND instr(COALESCE(prompt,''),?)>0)`;
export const DUNKIRK_REVIEW_SQL=`UPDATE projects SET status='needs_review',updated_at=?
 WHERE id=? AND worker_id=? AND status='processing'
 AND EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=projects.id AND
 j.step_id='narration_english' AND j.status='done' AND
 instr(COALESCE(j.prompt,''),?)>0)
 AND EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=projects.id AND
 j.step_id='narration_urdu' AND j.status='done' AND
 instr(COALESCE(j.prompt,''),?)>0)
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=projects.id AND
 j.status IN ('queued','working'))`;
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
const findTagged=async(env,stage)=>env.DB.prepare(
 "SELECT id,status FROM jobs WHERE project_id=? AND step_id=? AND instr(COALESCE(prompt,''),?)>0 ORDER BY created_at DESC,rowid DESC LIMIT 1"
).bind(DUNKIRK_REPAIR_PROJECT,stage,DUNKIRK_REPAIR_MARKER).first();
export async function queueDunkirkRepairStage(env,{stage,newJobId,now}){
 if(!uuid(newJobId)||!Number.isInteger(now)||now<=0||
  ![DUNKIRK_ENGLISH,DUNKIRK_URDU,DUNKIRK_PREFLIGHT].includes(stage))
  return {enqueued:false,reason:'invalid_repair_request'};
 const existing=await findTagged(env,stage);
 if(existing)return {enqueued:false,idempotent:true,jobId:existing.id,status:existing.status,
   reason:'stage_already_queued'};
 const prompt=stage===DUNKIRK_ENGLISH?DUNKIRK_REPAIR_PROMPTS.narration_english:
  stage===DUNKIRK_URDU?DUNKIRK_REPAIR_PROMPTS.narration_urdu:DUNKIRK_PREFLIGHT_PROMPT;
 const sql=stage===DUNKIRK_ENGLISH?DUNKIRK_START_SQL:
  stage===DUNKIRK_URDU?DUNKIRK_URDU_SQL:DUNKIRK_PREFLIGHT_SQL;
 const binds=[newJobId,prompt,now,DUNKIRK_REPAIR_FAILED,DUNKIRK_REPAIR_PROJECT,
   DUNKIRK_REPAIR_WORKER,now];
 if(stage===DUNKIRK_ENGLISH)binds.push(DUNKIRK_REPAIR_MARKER);
 else if(stage===DUNKIRK_URDU)binds.push(DUNKIRK_REPAIR_MARKER,DUNKIRK_REPAIR_MARKER);
 else binds.push(DUNKIRK_REPAIR_MARKER,DUNKIRK_REPAIR_MARKER,DUNKIRK_REPAIR_MARKER);
 let result;
 if(stage===DUNKIRK_URDU)result=await env.DB.prepare(sql).bind(...binds).run();
 else{
  const statements=[
   env.DB.prepare(sql).bind(...binds),
   env.DB.prepare(DUNKIRK_PROCESSING_SQL).bind(now,DUNKIRK_REPAIR_PROJECT,
      DUNKIRK_REPAIR_WORKER,newJobId,stage,DUNKIRK_REPAIR_MARKER)
  ];
  result=await env.DB.batch(statements);
 }
 const inserted=Number((Array.isArray(result)?result[0]:result)?.meta?.changes||0);
 const updated=Array.isArray(result)?Number(result[1]?.meta?.changes||0):undefined;
 if(inserted===1&&(updated===undefined||updated===1))
  return {enqueued:true,jobId:newJobId,step:stage,status:'queued',
    projectId:DUNKIRK_REPAIR_PROJECT,workerId:DUNKIRK_REPAIR_WORKER,
    acceptedJobsPreserved:true,sourceEvidenceUnchanged:true};
 if(inserted||updated)throw Error('Dunkirk repair transaction invariant violated');
 const raced=await findTagged(env,stage);
 if(raced)return {enqueued:false,idempotent:true,jobId:raced.id,status:raced.status};
 return {enqueued:false,reason:'state_changed_or_guard_rejected'};
}
export async function markDunkirkNarrationsReady(env,now){
 const result=await env.DB.prepare(DUNKIRK_REVIEW_SQL).bind(
  now,DUNKIRK_REPAIR_PROJECT,DUNKIRK_REPAIR_WORKER,
  DUNKIRK_REPAIR_MARKER,DUNKIRK_REPAIR_MARKER).run();
 return {ready:Number(result?.meta?.changes||0)===1,status:'needs_review'};
}
