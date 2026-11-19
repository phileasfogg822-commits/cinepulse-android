/**
 * Blade Runner 2049: one-job English MP3 audio repair for a proven TTS loop.
 * Keeps every accepted text/preflight checkpoint and the original R2 MP3.
 * No general-purpose asset replacement or validator bypass is introduced.
 */
export const BR_AUDIO_REPAIR_BUILD='blade-runner-v5g-english-audio-repair-v1-20261120';
export const BR_PROJECT='2f037c09-81af-4c8c-a909-9f54900cb402';
export const BR_WORKER='e36f4e31-83a7-42cc-b13c-2525b863f5ab';
export const BR_FAILED_SRT='962a739f-8195-489b-8ed3-95d763e08b11';
export const BR_ORIGINAL_SHA='7c0269b66b03ee725ca0ac303c377e186d283095763aaab3436483eff2a58218';
export const BR_ORIGINAL_BYTES=4725925;
export const BR_REPAIR_MARKER='[BR2049-V5G-MP3-REGION-REPAIR-V1]';
export const BR_RETRY_SRT_MARKER='[BR2049-AFTER-AUDIO-REPAIR-V1]';
export const BR_REPAIR_STAGE='mp3_english';
export const BR_FOLLOWUP_STAGE='srt_english';
export const BR_FORBIDDEN='it was about driving and building his own plan';
export const BR_MISSING='sometimes to love someone you gotta be a stranger';
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/i.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
export const isBladeRunnerAudioRepairJob=job=>job?.project_id===BR_PROJECT&&
 job.step_id===BR_REPAIR_STAGE&&String(job.prompt||'').includes(BR_REPAIR_MARKER);
export const stagedBladeRunnerAudioKey=jobId=>{
 if(!uuid(jobId))throw Error('Invalid MP3 repair job ID');
 return `projects/${BR_PROJECT}/repairs/english_mp3/${jobId}.mp3`;
};
export const BR_REPAIR_PROMPT=`BLADERUNNER 2049 V5-G ENGLISH AUDIO REPAIR; project ${BR_PROJECT}.
${BR_REPAIR_MARKER}
Rebuild ONLY the broken portion of the already approved English narration MP3:
original SHA-256 ${BR_ORIGINAL_SHA}, 4,725,925 bytes, duration 590.736 seconds;
defect 00:05:56–00:07:15 (356–435s). The first 24s are unintelligible; the next ~55s loop an unrelated phrase about driving and treasure.
The missing approved sentence is "Sometimes, to love someone, you gotta be a stranger."
Use the EXACT accepted 1,453-word narration, preserve all content, and generate fresh TTS with DIFFERENT and SMALLER chunks than the original Las Vegas / Deckard region. Repeating the original TTS call/chunking is prohibited.
Find real spoken boundaries around approximately 356–435s, retain a clean margin on either side, and splice at natural phrase/PCM boundaries. Preserve decoded audio outside the repair interval; verify clean start/end joins with actual listening and waveform checks. The repaired MP3's duration may change: do not force 590.736s or invent timestamps. MP3 frame-level copy may not be PCM/sample-identical at splice boundaries: measure the result rather than claiming impossible byte identity after re-encoding.
Use TWO independent real STT model passes on the repaired region (Whisper tiny.en and base), and full-file script/audio QA to confirm all narration words exist, the missing line is restored, the alien loop is absent, no unintelligible regions, duplicate phrases, clipped joins or missing speech.
Upload a NEW full, real MP3 to this repair task's /asset/english_mp3 endpoint. It is staged separately, NOT an overwrite of the original accepted recording.
After genuine verification, result.output must be JSON: {"kind":"english_audio_region_repair","originalSha256":"...","repairedSha256":"...","repairedBytes":integer,"approvedTextSha256":"...","region":{"startSeconds":number,"endSeconds":number},"qa":{"changedTtsChunking":true,"fullFileScriptAligned":true,"joinsAudiblyClean":true,"outsideSpeechPreserved":true,"missingLineRestored":true,"alienLoopAbsent":true,"independentStt":[{"model":"tiny.en","transcript":"actual full repaired-region transcript","requestId":"real STT reference"},{"model":"base","transcript":"actual full repaired-region transcript","requestId":"different real STT reference"}]}}.
Do not invent the STT outputs or proof fields. If reconstruction cannot be verified, return a task error and leave the original MP3 unchanged.
No narration, digest, source SRT, Urdu work, preflight, metadata, deep matching, or cuts may be modified.`;
export const BR_NEW_SRT_PROMPT=`Re-run the original srt_english stage against the freshly repaired real MP3, not the previous defective recording.
${BR_RETRY_SRT_MARKER}
Use remote STT / independently measured alignment to the ACTUAL MP3. Confirm the previously missing approved narration line exists and the unrelated repeated loop is gone. Preserve the original approved English narration and all grounded beats. No approximate timestamps, no fake SRT, and do not bypass the existing V5.4 script-to-audio QA. Return a complete properly synchronized English SRT. Continue the normal pipeline only if accepted.`;
const ordered=jobs=>[...(jobs||[])].sort((a,b)=>
 Number(a.created_at||0)-Number(b.created_at||0)||Number(a.rowid||0)-Number(b.rowid||0));
export function inspectBladeRunnerAudioRepair({project,worker,policy,jobs,audio,now}){
 const reasons=[],all=ordered(jobs);
 const chk=(yes,reason)=>{if(!yes)reasons.push(reason);};
 chk(project?.id===BR_PROJECT,'wrong_project');
 chk(project?.worker_id===BR_WORKER,'wrong_worker');
 chk(project?.status==='needs_review','wrong_project_status');
 chk(!Number(project?.control_stopped)&&!Number(project?.control_paused),'movie_paused_or_stopped');
 chk(!project?.expires_at||project.expires_at>now,'project_expired');
 chk(!!worker&&Number(worker.enabled)===1&&!Number(worker.paused),'worker_unavailable');
 chk(policy?.grounded===true&&!policy?.experiment,'not_grounded_pipeline');
 chk(audio?.sha256===BR_ORIGINAL_SHA&&Number(audio?.bytes)===BR_ORIGINAL_BYTES,
  'original_mp3_asset_not_verified');
 chk(!audio||audio.r2_key===`projects/${BR_PROJECT}/english_mp3`,
  'mp3_already_replaced');
 for(const stage of ['digest','grounded_evidence','narration_english','narration_urdu',
  'grounded_preflight','publishing_metadata','mp3_english'])
  chk(all.some(j=>j.step_id===stage&&j.status==='done'),'missing_checkpoint_'+stage);
 const failed=all.find(j=>j.id===BR_FAILED_SRT);
 chk(!!failed&&failed.step_id==='srt_english'&&failed.status==='error',
  'failed_srt_not_preserved');
 chk(all.at(-1)?.id===BR_FAILED_SRT,'latest_job_not_failed_srt');
 chk(!all.some(j=>j.status==='working'||j.status==='queued'),
  'task_already_active');
 chk(!all.some(j=>['srt_english','mp3_urdu','srt_urdu','grounded_match_plan',
  'deep_match_english','deep_match_urdu','deep_cut_plan','windows_project']
  .includes(j.step_id)&&j.status==='done'),'downstream_checkpoint_already_done');
 chk(!all.some(j=>String(j.prompt||'').includes(BR_REPAIR_MARKER)),
  'repair_already_attempted');
 return {eligible:reasons.length===0,canStart:reasons.length===0,
  projectId:BR_PROJECT,failedJobId:BR_FAILED_SRT,
  sourceAssetUnchanged:true,originalMp3Preserved:true,
  readOnly:true,reasons};
}
export const BR_ENQUEUE_SQL=`INSERT INTO jobs
 (id,project_id,worker_id,step_id,status,prompt,created_at)
 SELECT ?,p.id,p.worker_id,'mp3_english','queued',?,?
 FROM projects p JOIN workers w ON w.id=p.worker_id
 LEFT JOIN cinepulse_movie_controls c ON c.project_id=p.id
 JOIN jobs failed ON failed.id=? AND failed.project_id=p.id
 WHERE p.id=? AND p.worker_id=? AND p.status='needs_review'
 AND (p.expires_at IS NULL OR p.expires_at>?)
 AND w.enabled=1 AND COALESCE(w.paused,0)=0
 AND COALESCE(c.paused,0)=0 AND COALESCE(c.stopped,0)=0
 AND failed.step_id='srt_english' AND failed.status='error'
 AND failed.id=(SELECT j.id FROM jobs j WHERE j.project_id=p.id
    ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1)
 AND EXISTS(SELECT 1 FROM assets a WHERE a.project_id=p.id AND
   a.kind='english_mp3' AND a.sha256=? AND a.bytes=? AND a.r2_key=?)
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
   AND j.status IN ('queued','working'))
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
   AND j.status='done' AND j.step_id IN
   ('srt_english','mp3_urdu','srt_urdu','grounded_match_plan',
    'deep_match_english','deep_match_urdu','deep_cut_plan','windows_project'))
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
   AND instr(COALESCE(j.prompt,''),?)>0)`;
export const BR_PROJECT_RESUME_SQL=`UPDATE projects SET status='processing',updated_at=?
 WHERE id=? AND worker_id=? AND status='needs_review'
 AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND project_id=projects.id
   AND step_id='mp3_english' AND status='queued' AND
   instr(COALESCE(prompt,''),?)>0)`;
const findRepair=async env=>env.DB.prepare(
 "SELECT id,status FROM jobs WHERE project_id=? AND step_id='mp3_english' "+
 "AND instr(COALESCE(prompt,''),?)>0 ORDER BY created_at DESC,rowid DESC LIMIT 1"
).bind(BR_PROJECT,BR_REPAIR_MARKER).first();
export async function queueBladeRunnerAudioRepair(env,{jobId,now}){
 if(!uuid(jobId)||!Number.isInteger(now)||now<=0)
  return {enqueued:false,reason:'invalid_request'};
 const existing=await findRepair(env);
 if(existing)return {enqueued:false,idempotent:true,jobId:existing.id,status:existing.status};
 const statements=[
  env.DB.prepare(BR_ENQUEUE_SQL).bind(jobId,BR_REPAIR_PROMPT,now,BR_FAILED_SRT,BR_PROJECT,
    BR_WORKER,now,BR_ORIGINAL_SHA,BR_ORIGINAL_BYTES,
    `projects/${BR_PROJECT}/english_mp3`,BR_REPAIR_MARKER),
  env.DB.prepare(BR_PROJECT_RESUME_SQL).bind(now,BR_PROJECT,BR_WORKER,jobId,BR_REPAIR_MARKER)
 ];
 const changes=(await env.DB.batch(statements)).map(r=>Number(r?.meta?.changes||0));
 if(changes[0]===1&&changes[1]===1)
  return {enqueued:true,jobId,step:'mp3_english',status:'queued',
   projectId:BR_PROJECT,originalMp3Preserved:true,acceptedCheckpointsPreserved:true};
 if(changes.some(Boolean))throw Error('Audio repair atomic enqueue invariant failed');
 const raced=await findRepair(env);
 if(raced)return {enqueued:false,idempotent:true,jobId:raced.id,status:raced.status};
 return {enqueued:false,reason:'state_changed_or_guard_rejected'};
}
const normalize=x=>String(x||'').toLowerCase().replace(/[‘’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function validateBladeRunnerAudioReceipt(payload,{stagedHash,stagedBytes,approvedTextHash}){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    payload.kind!=='english_audio_region_repair')
  throw Error('Audio repair receipt kind missing');
 if(payload.originalSha256!==BR_ORIGINAL_SHA||
    payload.repairedSha256!==stagedHash||
    !sha(stagedHash)||stagedHash===BR_ORIGINAL_SHA||
    payload.repairedBytes!==stagedBytes||!Number.isSafeInteger(stagedBytes)||stagedBytes<2048||
    payload.approvedTextSha256!==approvedTextHash)
  throw Error('Repair MP3, original, or approved script hash/bytes mismatch');
 const r=payload.region,q=payload.qa;
 if(!r||!Number.isFinite(r.startSeconds)||!Number.isFinite(r.endSeconds)||
   r.startSeconds<340||r.startSeconds>380||r.endSeconds<425||r.endSeconds>455||
   r.endSeconds-r.startSeconds<55)
  throw Error('Repair region does not encompass the verified 356–435s defect');
 if(!q||q.changedTtsChunking!==true||q.fullFileScriptAligned!==true||
   q.joinsAudiblyClean!==true||q.outsideSpeechPreserved!==true||
   q.missingLineRestored!==true||q.alienLoopAbsent!==true)
  throw Error('Required independent audio quality confirmations missing');
 const runs=q.independentStt;
 if(!Array.isArray(runs)||runs.length!==2||
    runs[0]?.model!=='tiny.en'||runs[1]?.model!=='base'||
    typeof runs[0]?.requestId!=='string'||runs[0].requestId.length<8||
    typeof runs[1]?.requestId!=='string'||runs[1].requestId.length<8||
    runs[0].requestId===runs[1].requestId)
  throw Error('Two distinct real Whisper tiny.en and base verification references required');
 for(const run of runs){
  if(typeof run.transcript!=='string'||run.transcript.length<90||run.transcript.length>30_000)
   throw Error('Real region transcript missing or unreasonably short');
  const v=normalize(run.transcript);
  if(!v.includes(normalize(BR_MISSING)))
   throw Error('Repaired audio transcript missing approved Deckard sentence: '+run.model);
  if(v.includes(normalize(BR_FORBIDDEN))||v.includes('treasure doesnt matter'))
   throw Error('Repaired audio still contains foreign TTS loop: '+run.model);
 }
 return {verified:true,independentModels:['tiny.en','base'],acceptedFullFileQa:true,
   approvedTextHash,stagedHash,stagedBytes};
}
export const BR_PROMOTE_ASSET_SQL=`UPDATE assets
 SET r2_key=?,bytes=?,sha256=?,created_at=?
 WHERE project_id=? AND kind='english_mp3' AND
 sha256=? AND bytes=? AND r2_key=?
 AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=? AND
   j.project_id=assets.project_id AND j.step_id='mp3_english'
   AND j.status='working' AND j.lease=? AND j.lease_until>?)`;
export const BR_ACCEPT_JOB_SQL=`UPDATE jobs SET output=?,status='done',finished_at=?,
 lease=NULL,lease_until=NULL
 WHERE id=? AND project_id=? AND worker_id=? AND
 step_id='mp3_english' AND status='working' AND lease=? AND lease_until>?
 AND instr(COALESCE(prompt,''),?)>0
 AND EXISTS(SELECT 1 FROM assets a WHERE a.project_id=jobs.project_id
 AND a.kind='english_mp3' AND a.sha256=? AND a.r2_key=?)`;
export const BR_ENQUEUE_SRT_SQL=`INSERT INTO jobs
 (id,project_id,worker_id,step_id,status,prompt,created_at)
 SELECT ?,p.id,p.worker_id,'srt_english','queued',?,?
 FROM projects p JOIN jobs repaired ON repaired.id=?
 WHERE p.id=? AND p.worker_id=? AND p.status='processing'
 AND repaired.project_id=p.id AND repaired.step_id='mp3_english'
 AND repaired.status='done' AND instr(COALESCE(repaired.prompt,''),?)>0
 AND EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
   AND j.id=? AND j.step_id='srt_english' AND j.status='error')
 AND EXISTS(SELECT 1 FROM assets a WHERE a.project_id=p.id
   AND a.kind='english_mp3' AND a.sha256=?)
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
   AND j.status IN ('queued','working'))
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id
   AND j.step_id='srt_english' AND instr(COALESCE(j.prompt,''),?)>0)`;
/** Called only after staging bytes are independently hashed and the real
 * audio evidence receipt passes. Batch transaction prevents incomplete
 * promotion from starting SRT. R2 old key remains untouched/archived.
 */
export async function promoteBladeRunnerAudioRepair(env,{job,lease,output,
 stagedHash,stagedBytes,approvedTextHash,originalNarration,now,newSrtJobId}){
 validateBladeRunnerAudioReceipt(output,{stagedHash,stagedBytes,approvedTextHash});
 if(!isBladeRunnerAudioRepairJob(job)||job.status!=='working'||
    lease!==job.lease||job.lease_until<=now||!uuid(newSrtJobId))
  throw Error('Invalid active Blade Runner repair lease or followup task');
 const key=stagedBladeRunnerAudioKey(job.id);
 const result=await env.DB.batch([
  env.DB.prepare(BR_PROMOTE_ASSET_SQL).bind(key,stagedBytes,stagedHash,now,
    BR_PROJECT,BR_ORIGINAL_SHA,BR_ORIGINAL_BYTES,
    `projects/${BR_PROJECT}/english_mp3`,job.id,lease,now),
  env.DB.prepare(BR_ACCEPT_JOB_SQL).bind(JSON.stringify({
    text:originalNarration,method:'repaired-region-audio',repairedSha256:stagedHash,
    originalSha256:BR_ORIGINAL_SHA,qa:output.qa,region:output.region
  }),now,job.id,BR_PROJECT,BR_WORKER,lease,now,BR_REPAIR_MARKER,stagedHash,key),
  env.DB.prepare(BR_ENQUEUE_SRT_SQL).bind(newSrtJobId,BR_NEW_SRT_PROMPT,now,
    job.id,BR_PROJECT,BR_WORKER,BR_REPAIR_MARKER,BR_FAILED_SRT,
    stagedHash,BR_RETRY_SRT_MARKER)
 ]);
 const changes=result.map(r=>Number(r?.meta?.changes||0));
 if(changes.join(',')!=='1,1,1')
  throw Error('Blade Runner audio promotion/lease integrity invariant: '+changes.join(','));
 return {id:job.id,status:'done',projectId:BR_PROJECT,repairedEnglishMp3Sha256:stagedHash,
  originalEnglishMp3Sha256:BR_ORIGINAL_SHA,originalMp3StillInR2:true,
  followupJobId:newSrtJobId,nextStep:'srt_english',nextStatus:'queued',
  previousAcceptedCheckpointsPreserved:true};
}
