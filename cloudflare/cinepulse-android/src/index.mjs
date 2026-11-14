import {inspectCarMovieDispatchControls} from './car-atomic-reservations.mjs';
import {URDU_DEVANAGARI_POLICY_MARKER,URDU_DEVANAGARI_RESCUE_MARKER,URDU_DEVANAGARI_BUILD,URDU_DEVANAGARI_METHOD,validateDevanagariUrduVoiceReceipt,urduDevanagariInstructions,urduDevanagariSrtInstructions} from './urdu-devanagari-voice.mjs';
import { AUDIO_QA_MARKER,AUDIO_QA_BUILD,validateNarrationContent,validateMeasuredSubtitleQuality,validateUrduVoiceReceipt } from './audio-urdu-quality.mjs';
import { URDU_REPAIR_STAGE,URDU_REPAIR_MARKER,URDU_REPAIR_BUILD,URDU_REPAIR_BATCH_MAX,LOST_WORLD_URDU_REPAIR_INDICES,parseUrduRepairPrompt,makeUrduRepairPrompt,applyAcceptedUrduRepairs,UrduRepairTaskEvidence,validateTargetedUrduRematch } from './permanent-deep-rematch.mjs';
import { STRICT_DURATION_MARKER,validateNarrationScriptCap,validateMeasuredDurationCap } from './narration-duration-policy.mjs';
import { V5G_MARKER,V5G_STEPS,V5G_EVIDENCE,V5G_PREFLIGHT,V5G_MATCH_PLAN,validateV5gEvidence,validateV5gPreTts,extractV5gNarrationText,selectV5gWorkflow,classifyV5gWorker } from './v5g-production-gate.mjs';
import {V5G_PREFLIGHT_REQUEUE_BUILD,V5G_PREFLIGHT_REQUEUE_MARKER,BFG_PREFLIGHT_PROJECT_ID,BFG_PREFLIGHT_FAILED_JOB_ID,BFG_PREFLIGHT_WORKER_ID,requeueFailedV5gPreflight,inspectV5gPreflightRecoveryGuards} from './v5g-preflight-requeue.mjs';
import {REVIEW_STAGE_RETRY_BUILD,REVIEW_STAGE_RETRY_MARKER,REVIEW_STAGE_MEDIA,inspectReviewStageRetry,enqueueReviewStageRetry} from './review-stage-retry.mjs';
import {validateV5gGlobalPlan} from './v5g-match-plan.mjs';
import { PERMANENT_DEEP_MARKER,PERMANENT_DEEP_BUILD,PERMANENT_DEEP_STEPS,PERMANENT_DEEP_MATCH_STEPS,PERMANENT_DEEP_MATCH_EN,PERMANENT_DEEP_MATCH_UR,PERMANENT_DEEP_CUTS,deepLanguage,isProductionDeepStage,loadProductionCues,deepProductionProgress,productionDeepPrompt,validateProductionDeepBatch,combineProductionDeepCuts,summariseProductionDeepMatches } from './permanent-deep-muse.mjs';
import { rankDeepMuseCandidates } from './scene-lab-deep-candidates.mjs';
import { carEligibility } from './context-anchor-recovery.mjs';
import { verifyCarLiveInventory } from './car-live-inventory.mjs';
import { collectCarD1Inventory,auditCarD1Evidence,inspectCarRecoveryCandidate } from './car-d1-inventory.mjs';
import { ensureCarRecoveryLedger,insertScopedCarRecoveryCheckpoint,loadScopedCarRecoveryCheckpoints,inspectScopedCarRecoveryReadiness,buildScopedCarRecoveryHandoff,verifyFreshCarD1Snapshot } from './car-recovery-ledger.mjs';
import {fingerprintCarD1State} from './car-d1-preflight.mjs';
import { DEEP_BUILD,DEEP_PREPARE,DEEP_MATCH,DEEP_EXPORT,DEEP_STAGES,ensureDeepTables,deepRow,deepBatch,deepOutputs,normalizeDeepCreate,segmentBatch,preparePrompt,matchPrompt,exportPrompt,validateDeepBatch,validateDeepFinalCuts,publicDeepStatus } from './scene-lab-deep.mjs';
import { ensureSceneLab,sceneLabRow,normalizeSceneLabCreate,sceneLabInstructions,sceneLabTaskMetadata,SCENE_LAB_STAGE,SCENE_LAB_BUILD } from './scene-lab-runtime.mjs';
import { buildSceneLabV4Package,unwrapMeasuredSrt } from './scene-lab-package.mjs';
import { API_BUILD, HttpError, json, nowSeconds, dayUTC, newId, isUuid, sha256, hashWorkerToken, requireString, normalizeSrt, validateManifest, randomToken, secureEqual, signDownload, verifyDownload, fileNames, isProbablyMp3 } from './helpers.mjs';
import { LONGFORM_MODE, LONGFORM_MARKER, isLongFormCreateRequest, normalizePublishingMetadata, validateFinalCutPlan } from './longform-policy.mjs';
import { allocateFinalLongFormCuts } from './server-cut-planner.mjs';
import { buildWindowsProject, WINDOWS_FILE_KINDS, WINDOWS_FILE_NAMES } from './windows-export.mjs';
import { MUSE_V4_MARKER, MUSE_V4_STAGES, museStageInstructions, verifyMuseWindowsProject, canonicalMuseAnalysis } from './muse-production-contract.mjs';
import { assetRow,registerAsset,assetTableFor,allAssetKeys,allAssetMetadata,storageTotals,ensureWindowsAssets } from './asset-registry.mjs';
import { EXPERIMENT_JOB_MARKER,EXPERIMENT_JOB_STAGES,experimentalQueuePrompt } from './experimental-muse-instructions.mjs';
import { createExperimentIndex,experimentalSourceInfo,validateSceneIntelligenceOutput,storeExperimentAsset,experimentalAssetRow,isExperimentAssetKind,EXPERIMENT_ASSET_NAMES,ensureExperimentTables,experimentR2Key } from './experimental-bridge-runtime.mjs';
import { ensureMovieControls, MOVIE_CONTROL_JOIN, MOVIE_CONTROL_FIELDS, ELIGIBLE_MOVIE_CONTROL, publicMovieState, controlIsStopped, controlIsPaused } from './movie-controls.mjs';

// Legacy projects continue through their original stages. New projects use metadata only.
const STAGES = ['digest','narration_english','narration_urdu','viral_metadata','mp3_english','srt_english','mp3_urdu','srt_urdu','scene_matching','cut_plan'];
const LONGFORM_STAGES = ['digest','narration_english','narration_urdu','publishing_metadata','mp3_english','srt_english','mp3_urdu','srt_urdu','scene_matching','cut_plan'];
const LONGFORM_STAGES_V3 = LONGFORM_STAGES.filter(step=>step!=='cut_plan');
const LONGFORM_MARKER_V3='[CINEPULSE-LONGFORM-V3-SERVER-CUTS]';
const LONGFORM_BUILD = 'android-cloud-backend-0.4.3-v3828-cutplan-srt-diagnostics';
async function projectPolicy(env,projectId){
  // No D1 migration: distinguish new and legacy projects by the durable digest job prompt.
  const row=await env.DB.prepare("SELECT prompt FROM jobs WHERE project_id=? AND step_id='digest' ORDER BY created_at ASC LIMIT 1").bind(projectId).first();
  const prompt=String(row?.prompt||'');
  const experiment=prompt.startsWith(EXPERIMENT_JOB_MARKER);
  const permanentDeep=prompt.startsWith(PERMANENT_DEEP_MARKER);
  const grounded=permanentDeep&&prompt.includes(V5G_MARKER);
  const strictNarrationDuration=permanentDeep&&prompt.includes(STRICT_DURATION_MARKER);
  const audioLanguageQa=permanentDeep&&prompt.includes(AUDIO_QA_MARKER);
  const urduDevanagariVoice=permanentDeep&&prompt.includes(URDU_DEVANAGARI_POLICY_MARKER);
  const museOwnsCuts=permanentDeep||experiment||prompt.startsWith(MUSE_V4_MARKER);
  const serverCuts=prompt.startsWith(LONGFORM_MARKER_V3);
  const longForm=museOwnsCuts||serverCuts||prompt.startsWith(LONGFORM_MARKER);
  const targetMinutes=longForm ? Number(/targetMinutes=(\d+)/.exec(prompt)?.[1]||10) : null;
  return {longForm,serverCuts,museOwnsCuts,permanentDeep,grounded,strictNarrationDuration,audioLanguageQa,urduDevanagariVoice,experiment,targetMinutes,
    stages:grounded?V5G_STEPS:permanentDeep?PERMANENT_DEEP_STEPS:experiment?EXPERIMENT_JOB_STAGES:museOwnsCuts?MUSE_V4_STAGES:serverCuts?LONGFORM_STAGES_V3:longForm?LONGFORM_STAGES:STAGES};
}

const ASSET_TYPES = {
  source_srt:'application/x-subrip',english_mp3:'audio/mpeg',urdu_mp3:'audio/mpeg',
  scene_index_sqlite:'application/vnd.sqlite3',english_final_cuts:'application/json',urdu_final_cuts:'application/json',
  export_json:'application/json',windows_project_json:'application/json',
  english_srt:'application/x-subrip',urdu_srt:'application/x-subrip',
  english_narration:'text/plain; charset=utf-8',urdu_narration:'text/plain; charset=utf-8'
};
const MAX_JSON = 2_500_000;
const MAX_MUSE_WINDOWS_RESULT = 10_000_000; // Only for the authenticated final Muse Windows ProjectState.
const LEASE_SECONDS = 15 * 60;
const DOWNLOAD_LINK_SECONDS = 15 * 60;
const MAX_INACTIVE_DAYS = 7;

const fail = (status,message) => { throw new HttpError(status,message); };
const requireEnv = env => { if(!env.DB || !env.FILES || !env.ADMIN_TOKEN || !env.DOWNLOAD_SIGNING_KEY || env.ADMIN_TOKEN.length<32 || !/^[0-9a-f]{64,}$/i.test(env.DOWNLOAD_SIGNING_KEY) || env.DOWNLOAD_SIGNING_KEY.length%2)fail(503,'CinePulse backend is not securely configured'); };
const getBearer = request => /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization')||'')?.[1]?.trim()||null;
async function administrator(request,env) { const supplied=getBearer(request); if(!supplied || !secureEqual(supplied,env.ADMIN_TOKEN))fail(401,'Administrator token required'); }
async function authWorker(request,env,id) {
  if(!isUuid(id))fail(404,'Worker not found');
  const worker=await env.DB.prepare('SELECT * FROM workers WHERE id = ?').bind(id).first();
  if(!worker || !worker.enabled)fail(403,'Worker unavailable');
  const token=getBearer(request);
  if(!token || !secureEqual(await hashWorkerToken(token),worker.token_hash))fail(401,'Invalid worker token');
  return worker;
}
const getJson = async (request,limit=MAX_JSON) => {
  const size=Number(request.headers.get('content-length')||0);
  if(size>limit)fail(413,'JSON body too large');
  const body=await request.text();
  if(body.length>limit)fail(413,'JSON body too large');
  try {return JSON.parse(body||'{}');} catch {fail(400,'Invalid JSON body');}
};
const requireUUID = v=>{if(!isUuid(v))fail(400,'Invalid identifier');return v;};
async function getProject(env,id) {const project=await env.DB.prepare('SELECT p.*, '+MOVIE_CONTROL_FIELDS+' FROM projects p '+MOVIE_CONTROL_JOIN+' WHERE p.id=?').bind(requireUUID(id)).first();if(!project)fail(404,'Project not found');return project;}
async function getJob(env,id) {const job=await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(requireUUID(id)).first();if(!job)fail(404,'Task not found');return job;}
const publicWorker=w=>({id:w.id,label:w.label,movieTitle:w.movie_title,enabled:!!w.enabled,paused:!!w.paused,createdAt:w.created_at,lastSeen:w.last_seen});
const publicProject=p=>({id:p.id,workerId:p.worker_id,title:p.title,...publicMovieState(p),retentionHours:p.retention_hours,createdAt:p.created_at,readyAt:p.ready_at,firstDownloadedAt:p.first_downloaded_at,expiresAt:p.expires_at});
const publicJob=j=>({id:j.id,workerId:j.worker_id,projectId:j.project_id,stepId:j.step_id,status:j.status,createdAt:j.created_at,finishedAt:j.finished_at,leaseUntil:j.lease_until,error:j.error||null});
const objectKey=(projectId,kind)=>`projects/${projectId}/${kind}`;
async function assetByKind(env,projectId,kind){return isExperimentAssetKind(kind)?experimentalAssetRow(env,projectId,kind):assetRow(env,projectId,kind);}
async function logDaily(env,delta) {
  // Writes ONLY for mutation/download events; no D1 writes for empty Muse polls.
  const names=['projects_created','jobs_created','jobs_completed','uploaded_bytes','downloads','deleted_projects'];
  const values=names.map(n=>Math.max(0,Number(delta[n]||0)));
  const setters=names.map(n=>`${n}=${n}+excluded.${n}`).join(',');
  await env.DB.prepare(`INSERT INTO usage_daily(day,${names.join(',')}) VALUES (?,?,?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET ${setters}`).bind(dayUTC(),...values).run();
}
function promptFor(step) {
  switch(step){
    case 'digest':return 'Read the original SRT from inputAsset. Create a detailed, chronological movie digest grounded in the subtitles. Return the digest as plain text. Do not invent scenes unsupported by the SRT.';
    case V5G_EVIDENCE:return 'V5-G SOURCE EVIDENCE STAGE. Use ONLY the original source SRT, priorOutputs.digest and surrounding dialogue plus literal bracket captions for important uncaptioned intervals. Return JSON {"beats":[{"id":"B01","summary":"...", "evidence":[{"kind":"subtitle","cueId":1,"exactQuote":"exact quote present inside original cue"}]}],"blueprint":[{"beatId":"B01","startSeconds":1,"endSeconds":2}]}. For silent contextual beats, use evidence kind srt_context with precedingCueId,followingCueId (adjacent), precedingExactQuote,followingExactQuote,role temporal_transition or caption_supported_context, reason >=18 chars, and if caption-supported captionCueId + exactCaption. Never invent visual content from SRT gaps. Every beat needs a distinct ID, source evidence and a matching window. Read the WHOLE SRT and preserve chronology. This checkpoint must pass server validation before narration.';
    case V5G_PREFLIGHT:return 'V5-G PRE-TTS HARD GATE. Using previousOutputs.grounded_evidence, previousOutputs.narration_english and previousOutputs.narration_urdu, return JSON {"narrationUnits":[{"language":"english","id":"en1","text":"exact passage copied from the approved English narration","beatIds":["B01"]},{"language":"urdu","id":"ur1","text":"exact passage copied from approved Urdu narration","beatIds":["B01"]}]}. Complete texts concatenated in unit order must equal each saved approved narration script (no missing text, no duplicated text); both languages must reference every approved story beat; preserve short sentences as one unit, do not split the Morning, Sophie greeting. No MP3 may start until this checkpoint is accepted.';
    case V5G_MATCH_PLAN:return 'V5-G GLOBAL SRT-SEMANTIC MATCHING GATE, BEFORE DEEP MUSE FIVE-CUE BATCHES. Read both actual measured SRTs, the approved narration units and source SRT. Return JSON {"measuredCues":[{"language":"english","index":1,"startSeconds":0,"endSeconds":4,"text":"EXACT MEASURED SRT CUE TEXT","unitIds":["en1"]}],"decisions":{"english":[{"segmentIndex":1,"unitId":"en1","sourceStartSeconds":100,"sourceEndSeconds":104,"sourceCueIds":[1],"evidenceQuote":"exact copied source quote","reason":"why this source supports the narration >=24 chars","alternatives":[{"cueId":2,"reason":"why another cue is wrong"}],"confidence":0.97,"qualityScore":0.95,"independentSubtitleReview":true,"reviewerRef":"real independent review ref","museRequestId":"actual Muse call reference"}],"urdu":[...]}}. Provide measuredCues for ALL real English and Urdu SRT cues, and exactly one source decision per measured cue. Do NOT invent timestamps, reuse source intervals in the SAME language, pass weak/precision candidates as verified, or assert visual verification. A cue spanning two different narration semantic units must receive targeted real audio boundary repair before this submission. Quality >=0.90 applies to SRT-semantic relevance only; a numeric claim alone cannot prove correctness. Return unresolved stage error if any part is unsupported.';
    case 'narration_english':return 'Using the completed digest and source SRT available for this project, write a compelling English narration script appropriate to the movie tone and desired length. Return only the complete English narration text.';
    case 'narration_urdu':return 'Using the completed digest and source SRT, write the complete Urdu narration in Urdu script. Return only the Urdu narration text; do not mix English paragraphs.';
    case 'viral_metadata':return 'LEGACY COMPATIBILITY: return JSON with {"viralScenes":[],"metadata":{"description":"At least 20 characters of movie description","keywords":["movie recap"],"hashtags":["#movie"]}}. Do not generate viral scenes or Shorts.';
    case 'publishing_metadata':return 'Generate ONLY English long-form publishing metadata, in JSON {"metadata":{"description":"At least 20 characters about this movie","keywords":["cinema"],"hashtags":["#movie"]}}. Do NOT create viralScenes, Shorts or short video jobs.';
    case 'mp3_english':return 'Generate the full English narration MP3 using an authorized ONLINE text-to-speech tool. Upload the actual MP3 to the worker task asset endpoint /tasks/{task_id}/asset/english_mp3 (Bearer worker token and X-CinePulse-Lease header). Do NOT mark task complete until the actual MP3 upload succeeds; never claim an imagined audio file.';
    case 'srt_english':return 'Use the ACTUAL generated English MP3 available at this task\'s inputAsset path. Use remote STT or measured alignment with online tools (e.g. Whisper/Hugging Face when authorized). Return a complete timecoded English SRT as plain text. Do not use approximate script fallback.';
    case 'mp3_urdu':return 'Generate the full Urdu narration MP3 using an authorized ONLINE text-to-speech tool. Upload the actual MP3 to /tasks/{task_id}/asset/urdu_mp3 using worker credential and task lease. Do not mark task complete before successful MP3 upload.';
    case 'srt_urdu':return 'Use the ACTUAL generated Urdu MP3 at inputAsset. Produce genuinely timed, full Urdu narration SRT using an authorized remote STT/alignment tool. Do not substitute invented timestamps.';
    case 'scene_matching':return 'Muse: analyze ONLY the two full long-form explanatory videos, not Shorts or viral clips. Use original movie SRT plus ENGLISH and URDU genuinely measured narration SRTs. Return JSON {"matches":[{"language":"english"|"urdu","sourceStartSeconds":number,"sourceEndSeconds":number,"narrationStartSeconds":number,"narrationEndSeconds":number,"confidence":0.0-1.0}]}. Include chronological source-to-narration scene evidence for BOTH languages. These are broad SEARCH REFERENCES, not final video cuts. Do not reuse unrelated movie scenes or fabricate subtitle evidence. Cloudflare will allocate every 3–6-second final cut, resolve collisions, validate duration and store the Windows project. Do not output Shorts or virals.';
    case 'cut_plan':return 'FINAL LONG-FORM CUTS ONLY, for exactly ONE English and ONE Urdu explanatory video. Use the original source SRT, the scene_matching output and both already MEASURED narration SRTs in previousOutputs. Return JSON array with {"sourceStartSeconds":number,"sourceEndSeconds":number,"narrationStartSeconds":number,"narrationEndSeconds":number,"language":"english"|"urdu"}. EACH source and narration clip MUST be >=3 and <=6 seconds, be the SAME length, source clips MUST NOT overlap or reuse footage WITHIN each language, narration cuts must begin at zero, cover the COMPLETE language SRT timeline WITHOUT GAPS or overlaps, and every source interval must end within movie source-SRT duration. This may require ~100 short edit decisions for a 9-minute narration, but these are cuts of ONE long movie per language, NOT Shorts/viral videos. No frame decoding is needed for numeric timing checks. If there is insufficient source subtitle evidence, return a task error, not invented timestamps.';
    default: return '';
  }
}
async function queueTask(env,project,step,requestedPrompt){
  if(controlIsStopped(await getProject(env,project.id)))fail(410,'Stopped movie cannot queue another Muse task');
  const timestamp=nowSeconds();const id=newId();
  let prompt=requestedPrompt||promptFor(step);
  if(!requestedPrompt && (step==='narration_english'||step==='narration_urdu')){
    const policy=await projectPolicy(env,project.id);
    if(policy.longForm)prompt+=` IMPORTANT: Full explanatory narration for approximately ${policy.targetMinutes} minutes. This language will later be timed with the actual uploaded MP3, not estimated.`;
  }
  await env.DB.prepare("INSERT INTO jobs(id,project_id,worker_id,step_id,status,prompt,created_at) VALUES(?,?,?,?,'queued',?,?)").bind(id,project.id,project.worker_id,step,prompt,timestamp).run();
  await logDaily(env,{jobs_created:1});
  await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(nowSeconds(),project.id).run();
  return id;
}
async function acceptedUrduRepairOutputs(env,projectId){
 const result=await env.DB.prepare("SELECT output FROM jobs WHERE project_id=? AND step_id=? AND status='done' ORDER BY created_at ASC,rowid ASC")
   .bind(projectId,URDU_REPAIR_STAGE).all();
 return (result.results||[]).map(j=>JSON.parse(j.output||'null'));
}
async function acceptedPermanentDeepBatches(env,projectId,stage){
 const result=await env.DB.prepare("SELECT output FROM jobs WHERE project_id=? AND step_id=? AND status='done' ORDER BY created_at ASC,rowid ASC")
  .bind(projectId,stage).all();
 const original=(result.results||[]).map(j=>{
  const parsed=JSON.parse(j.output||'null');
  if(!parsed||!Array.isArray(parsed.decisions))throw Error('Deep Muse checkpoint output is corrupt');
  return parsed;
 });
 return stage===PERMANENT_DEEP_MATCH_UR?
   applyAcceptedUrduRepairs(original,await acceptedUrduRepairOutputs(env,projectId)):original;
}
// Read all relevant job states, not just completed batches: accepted outputs
// and late status changes must invalidate an older CAR audit handoff.
async function readCarD1Fingerprint(env,projectId,audit,checkpoints,sourceSrt,outputs){
 const rows=await env.DB.prepare(
  "SELECT id,step_id,status,output,created_at,finished_at FROM jobs WHERE project_id=? AND step_id IN (?,?) ORDER BY created_at ASC,rowid ASC"
 ).bind(projectId,PERMANENT_DEEP_MATCH_EN,PERMANENT_DEEP_MATCH_UR).all();
 return fingerprintCarD1State({projectId,audit,checkpoints,sourceSrt,
  englishSrt:outputs.srt_english,urduSrt:outputs.srt_urdu,
  jobRows:rows.results||[]});
}
async function priorOutputs(env,projectId) {
 const result=await env.DB.prepare("SELECT step_id,output FROM jobs WHERE project_id=? AND status='done' ORDER BY created_at ASC,rowid ASC").bind(projectId).all();
 const outputs=Object.fromEntries((result.results||[]).map(v=>[v.step_id,v.output]));
 // Muse V4 finalization contract remains the byte-preserving format for
 // permanent V5 movies. Derive read-only aliases from validated Deep cut output.
 if(outputs[PERMANENT_DEEP_CUTS]){
  const result=JSON.parse(outputs[PERMANENT_DEEP_CUTS]);
  if(!Array.isArray(result.cuts)||!result.provenance)
   throw Error('Permanent Muse cut checkpoint has invalid output');
  outputs.cut_plan=JSON.stringify(result.cuts);
  const [english,urdu]=await Promise.all([
   acceptedPermanentDeepBatches(env,projectId,PERMANENT_DEEP_MATCH_EN),
   acceptedPermanentDeepBatches(env,projectId,PERMANENT_DEEP_MATCH_UR)
  ]);
  outputs.scene_matching=JSON.stringify({matches:summariseProductionDeepMatches(english,urdu)});
 }
 return outputs;
}
async function taskDetail(env,job) {
  if(job.step_id===URDU_REPAIR_STAGE){
    const policy=await projectPolicy(env,job.project_id);
    if(!policy.permanentDeep)fail(403,'Targeted repair not authorized for older movie');
    const project=await getProject(env,job.project_id);
    const plan=parseUrduRepairPrompt(job.prompt);
    const outputs=await priorOutputs(env,job.project_id);
    const original=await env.FILES.get(project.source_srt_key);
    if(!original)fail(409,'Original movie SRT unavailable');
    const cues=loadProductionCues(outputs.srt_urdu);
    const effective=await acceptedPermanentDeepBatches(env,job.project_id,PERMANENT_DEEP_MATCH_UR);
    const task=UrduRepairTaskEvidence({
      sourceSrt:await original.text(),urduCues:cues,acceptedBatches:effective,prompt:job.prompt
    });
    return {...publicJob(job),lease:job.lease,productionMode:'stable',
      sceneMatchingMode:URDU_REPAIR_BUILD,
      movie:{id:project.id,title:project.title,workerId:project.worker_id},
      sourceSrtAsset:{path:'/tasks/'+job.id+'/asset/source_srt',mime:'application/x-subrip',name:'CinePulse_Source.srt'},
      inputAsset:{path:'/tasks/'+job.id+'/asset/source_srt',mime:'application/x-subrip',name:'CinePulse_Source.srt'},
      prompt:task.instructions,
      deepMuse:{mode:'targeted_urdu_rematch',originalAcceptedSegments:cues.length,
        repairIndices:plan.indices,repairBatchIndices:task.taskSegments.map(x=>x.segmentIndex),
        repairOffset:plan.offset,originalCutPlanJobId:plan.sourceCutJobId,
        segments:task.taskSegments,visualVerified:false,
        candidateEvidenceBudget:4000,requiredSourceEvidence:true},
      notice:'Re-match only the listed Urdu segments with REAL Muse decisions; preserve all original jobs, English cuts, narrations, MP3s, SRTs and source movie.'};
  }
  if(DEEP_STAGES.includes(job.step_id)){
    const run=await deepRow(env,job.project_id);
    if(!run)fail(409,'Deep Muse job not registered');
    const batch=job.step_id===DEEP_MATCH?await deepBatch(env,job.id):null;
    if(job.step_id===DEEP_MATCH&&!batch)fail(409,'Deep Muse batch checkpoint missing');
    const accepted=job.step_id===DEEP_PREPARE?[]:await deepOutputs(env,job.project_id);
    let ranked=null;
    if(batch){
      const parent=await getProject(env,job.project_id);
      const file=await env.FILES.get(parent.source_srt_key);
      if(!file)fail(409,'Whole movie source SRT unavailable to rank Muse batch');
      const all=Array.from({length:run.batch_count},(_,i)=>segmentBatch(run,i)).flat();
      ranked=rankDeepMuseCandidates(await file.text(),segmentBatch(run,batch.batch_index),
        all,accepted.flatMap(x=>x.decisions));
    }
    const sourcePath='/tasks/'+job.id+'/asset/source_srt';
    const instructions=job.step_id===DEEP_PREPARE?preparePrompt(run):
      job.step_id===DEEP_MATCH?matchPrompt(run,batch.batch_index):exportPrompt(run);
    const manifest=JSON.parse(run.manifest_json);
    const deep={mode:'muse_deep_batch_v1',stage:job.step_id,backendBuild:DEEP_BUILD,
      originalProjectId:run.parent_project_id,experimentProjectId:run.project_id,
      strategy:run.strategy,manifest,segmentCount:run.segment_count,
      batchCount:run.batch_count,currentBatch:run.current_batch,
      visualVerified:false,
      sourceSrtAsset:{path:sourcePath,name:'CinePulse_Source.srt',mime:'application/x-subrip'},
      acceptedDecisions:accepted,
      ...(ranked?{rankedSourceCandidates:ranked.candidates,candidateRetrieval:{budget:ranked.budget,candidateCount:ranked.candidateCount,sourceCueCount:ranked.sourceCueCount}}:{}),
      ...(batch?{batchIndex:batch.batch_index,segments:segmentBatch(run,batch.batch_index)}:{}),
      ...(job.step_id===DEEP_PREPARE?{expectedMp3s:JSON.parse(run.expected_mp3s_json),
         uploadMp3Endpoints:{english:'/tasks/'+job.id+'/asset/english_mp3',
           urdu:'/tasks/'+job.id+'/asset/urdu_mp3'}}:{})};
    return {...publicJob(job),lease:job.lease,productionMode:'scene_lab_deep_muse',
      prompt:instructions+(ranked?'\nWHOLE MOVIE RANKED CANDIDATE EVIDENCE (advisory, Muse must decide):\n'+ranked.candidateEvidenceText:'')+
        (job.prompt?.startsWith('RETRY REQUIRED:')?'\n'+job.prompt:''),
      sceneLabDeep:deep,movie:{id:job.project_id,title:'Muse Deep Scene Lab — '+run.strategy,
        workerId:job.worker_id},sourceSrtAsset:deep.sourceSrtAsset,
      inputAsset:deep.sourceSrtAsset,previousOutputs:{},
      notice:'Deep Muse decisions are accepted in independent checkpointed batches; do not submit fast-scoring cut plans.'};
  }
  if(job.step_id===SCENE_LAB_STAGE){
    const row=await sceneLabRow(env,job.project_id);
    if(!row||row.job_id!==job.id)fail(409,'Scene Lab task registration missing');
    const lab=sceneLabTaskMetadata(row,job);
    return {...publicJob(job),lease:job.lease,prompt:sceneLabInstructions(row),
      productionMode:'scene_matching_lab',sceneLab:lab,
      movie:{id:job.project_id,workerId:job.worker_id,title:'Scene Lab — '+row.strategy},
      sourceSrtAsset:lab.sourceSrtAsset,inputAsset:lab.sourceSrtAsset,
      notice:'Isolated Scene Lab: upload two extracted real MP3s, then submit V4 package fields. Original movie unchanged.'};
  }
  const policyForDeep=await projectPolicy(env,job.project_id);
  if(policyForDeep.permanentDeep && isProductionDeepStage(job.step_id)){
    const movie=await getProject(env,job.project_id);
    const outputs=await priorOutputs(env,job.project_id);
    const readOnlyAsset={path:'/tasks/'+job.id+'/asset/source_srt',name:'CinePulse_Source.srt',
      mime:'application/x-subrip'};
    if(PERMANENT_DEEP_MATCH_STEPS.includes(job.step_id)){
      const language=deepLanguage(job.step_id);
      const measured=outputs[language==='english'?'srt_english':'srt_urdu'];
      const cues=loadProductionCues(measured);
      const accepted=await acceptedPermanentDeepBatches(env,movie.id,job.step_id);
      const file=await env.FILES.get(movie.source_srt_key);
      if(!file)fail(409,'Original source SRT unavailable for full-movie Muse matching');
      const evidence=productionDeepPrompt(language,null,cues,await file.text(),accepted);
      const groundedPlan=policyForDeep.grounded?JSON.parse(outputs[V5G_MATCH_PLAN]||'null'):null;
      if(policyForDeep.grounded&&(!groundedPlan?.validation?.globalCoverage||
         !Array.isArray(groundedPlan?.decisions?.[language])))
        fail(409,'V5-G global matching plan not accepted');
      const globalDecisions=groundedPlan?.decisions?.[language]?.slice(
        evidence.progress.reviewedSegments,evidence.progress.reviewedSegments+evidence.segments.length)||null;
      return {...publicJob(job),lease:job.lease,prompt:evidence.prompt+
        (globalDecisions?'\nV5-G ACCEPTED WHOLE-MOVIE SOURCE PLAN FOR THIS FIVE-CUE BATCH. Recheck and submit these independently reviewed decisions preserving source intervals/quotes; do not blindly reallocate earlier scene anchors. '+JSON.stringify(globalDecisions):'')+
        (job.prompt?.startsWith('RETRY REQUIRED:')?'\n'+job.prompt:''),
       movie:{id:movie.id,title:movie.title,workerId:movie.worker_id},
       productionMode:'stable',sceneMatchingMode:PERMANENT_DEEP_BUILD,
       sourceSrtAsset:readOnlyAsset,inputAsset:readOnlyAsset,
       deepMuse:{language,batchIndex:evidence.progress.batchIndex,
        batchCount:evidence.progress.batchCount,reviewedSegments:evidence.progress.reviewedSegments,
        totalSegments:cues.length,segments:evidence.segments,rankedSourceCandidates:evidence.ranked.candidates,
        maxSourceEvidenceCharacters:evidence.ranked.budget,priorAcceptedDecisions:accepted.flatMap(x=>x.decisions),
        visualVerified:false,groundedGlobalPlanDecisions:globalDecisions||undefined},
       notice:'This is live FULL-MOVIE Muse matching, not fast scoring. Each measured narration cue requires a separate Muse semantic decision.'};
    }
    const [english,urdu]=await Promise.all([
      acceptedPermanentDeepBatches(env,movie.id,PERMANENT_DEEP_MATCH_EN),
      acceptedPermanentDeepBatches(env,movie.id,PERMANENT_DEEP_MATCH_UR)
    ]);
    const acceptedRematches=await acceptedUrduRepairOutputs(env,movie.id);
    const revisedUrduIndices=acceptedRematches.flatMap(b=>b.decisions.map(d=>d.segmentIndex));
    const enCues=loadProductionCues(outputs.srt_english),urCues=loadProductionCues(outputs.srt_urdu);
    if(!deepProductionProgress(enCues,english).complete||!deepProductionProgress(urCues,urdu).complete)
      fail(409,'All original full-movie narration segments must be Muse-reviewed before cut generation');
    return {...publicJob(job),lease:job.lease,productionMode:'stable',
      sceneMatchingMode:PERMANENT_DEEP_BUILD,
      movie:{id:movie.id,title:movie.title,workerId:movie.worker_id},
      sourceSrtAsset:readOnlyAsset,inputAsset:readOnlyAsset,
      deepMuse:{englishCues:enCues,urduCues:urCues,acceptedDecisions:{
       english:english.flatMap(x=>x.decisions),urdu:urdu.flatMap(x=>x.decisions)},
       targetedUrduRepair:{repairedIndices:revisedUrduIndices,acceptedReplacementCount:revisedUrduIndices.length,
         useOriginalCompletedCandidateCutsWhereStillValid:true},visualVerified:false},
      prompt:'CINEPULSE PERMANENT DEEP MUSE: FINAL FULL-MOVIE CUT PLAN. '+
       (revisedUrduIndices.length?'V5.2 TARGETED URDU REPAIRS HAVE BEEN ACCEPTED for segment indices '+revisedUrduIndices.join(',')+
        '. Muse must reuse its existing verified Candidate 5 cut plan wherever it remains valid, then modify ONLY the affected Urdu windows/links to the NEW accepted source anchors. Do not regenerate original audio/SRT, do not alter any of the 209 accepted English cuts; exactly 369/369 original Urdu narration segments must be represented. ':'')+
       'All English '+enCues.length+' and Urdu '+urCues.length+' cues have individually accepted Muse source decisions. '+
       'Generate a SEPARATE complete 3–6 second cut plan for each language using ONLY those accepted source anchors. '+
       'Each clip must contain matchSegmentIndices linking to accepted Muse decisions in THAT language. '+
       'Respect 100% measured narration coverage, source duration equal to narration duration, nonoverlap of movie footage WITHIN EACH LANGUAGE, and original movie SRT time bounds. '+
       'ENGLISH anchors must remain within 12 seconds of accepted Muse evidence; URDU is allowed up to 25 seconds for long narration under strict source relevance, 3–6 second individual clips, and no reused source footage. '+
       'If unsupported, report an unresolved stage error rather than inserting arbitrary footage. '+
       'Return JSON {"englishCuts":[{"narrationStartSeconds":0,"narrationEndSeconds":5,"sourceStartSeconds":100,"sourceEndSeconds":105,"matchSegmentIndices":[1]}],'+
       '"urduCuts":[...]} with full continuous lists. NO Shorts or virals. NO visual-verification claims.'+
       (job.prompt?.startsWith('RETRY REQUIRED:')?'\n'+job.prompt:''),
      notice:'Muse is responsible for final cut decisions; Cloudflare only validates and stores.'};
  }
  const outputs=await priorOutputs(env,job.project_id);
  // Context only for the current project and its own worker. Never mixes movies.
  const policy=await projectPolicy(env,job.project_id);
  const stages=policy.stages;
  const context=Object.fromEntries(Object.entries(outputs).filter(([key])=>stages.indexOf(key)>=0&&stages.indexOf(key)<stages.indexOf(job.step_id)));
  if(policy.permanentDeep&&job.step_id==='windows_project'){
    context.cut_plan=outputs.cut_plan;
    context.scene_matching=outputs.scene_matching;
  }
  const movie=await getProject(env,job.project_id);
  const audioRows=policy.museOwnsCuts?await Promise.all(['english_mp3','urdu_mp3'].map(k=>assetByKind(env,job.project_id,k))):[];
  const audioManifest=policy.museOwnsCuts?Object.fromEntries(['english','urdu'].map((lang,i)=>[lang,audioRows[i]?{bytes:audioRows[i].bytes,sha256:audioRows[i].sha256,filename:lang==='english'?'CinePulse_English.mp3':'CinePulse_Urdu.mp3'}:null])):null;
  // V4 Windows projects must reuse Muse's previously ACCEPTED outputs without
  // paraphrasing. Expose the exact canonical field names/values to Muse on its
  // already-authenticated task claim (including currently working jobs).
  const analysisReference=policy.museOwnsCuts&&job.step_id==='windows_project'?
    canonicalMuseAnalysis({narrations:{
      english:outputs.narration_english,urdu:outputs.narration_urdu
    },digest:outputs.digest}):undefined;
  const kind=job.step_id==='srt_english'?'english_mp3':job.step_id==='srt_urdu'?'urdu_mp3':'source_srt';
  const assetPath=`/tasks/${job.id}/asset`;
  const experimentSource=policy.experiment?await experimentalSourceInfo(env,job.project_id):null;
  const experimentPrompt=policy.experiment?experimentalQueuePrompt(job.step_id,{projectId:job.project_id,sourceSrtSha256:experimentSource.sourceSrtSha256}):'';
  const urduAudioIsDev=(()=>{
    try{return JSON.parse(outputs.mp3_urdu||'null')?.method===URDU_DEVANAGARI_METHOD;}
    catch{return false;}
  })();
  const controlledUrduTask=policy.urduDevanagariVoice||
    (job.step_id==='mp3_urdu'&&String(job.prompt||'').includes(URDU_DEVANAGARI_RESCUE_MARKER))||
    (job.step_id==='srt_urdu'&&urduAudioIsDev);
  const originalUrduDigest=controlledUrduTask&&job.step_id==='mp3_urdu'&&outputs.narration_urdu?
    await sha256(new TextEncoder().encode(outputs.narration_urdu)):undefined;

  return {...publicJob(job),lease:job.lease,
    prompt:policy.museOwnsCuts?((policy.grounded&&[V5G_EVIDENCE,V5G_PREFLIGHT,V5G_MATCH_PLAN].includes(job.step_id)?(job.prompt?.startsWith('RETRY REQUIRED:')?promptFor(job.step_id)+'\n'+job.prompt:job.prompt):museStageInstructions(job.step_id,{movieTitle:movie.title,projectId:movie.id,targetMinutes:policy.targetMinutes}))+(policy.grounded&&['digest','narration_english','narration_urdu'].includes(job.step_id)?'\nV5-G GROUNDED POLICY: Use original SRT and previously accepted source-backed evidence; avoid unsupported story detail, preserve distinct source cue/beat context and full scripts. There is a mandatory pre-TTS checkpoint before audio.':'')+(controlledUrduTask&&job.step_id==='mp3_urdu'?'\n'+urduDevanagariInstructions({rescue:String(job.prompt||'').includes(URDU_DEVANAGARI_RESCUE_MARKER)}):'')+(controlledUrduTask&&job.step_id==='srt_urdu'?'\n'+urduDevanagariSrtInstructions:'')+(controlledUrduTask&&job.step_id==='narration_urdu'?'\nAPPROVED CANONICAL NARRATION IS PAKISTANI URDU SCRIPT. The later Devanagari TTS transport MUST NOT alter this text.':'')+(policy.audioLanguageQa&&!((controlledUrduTask)&&['narration_urdu','mp3_urdu','srt_urdu'].includes(job.step_id))&&['narration_english','narration_urdu','mp3_english','mp3_urdu','srt_english','srt_urdu'].includes(job.step_id)?
      '\nCINEPULSE V5.4 AUDIO QA (NEW MOVIES ONLY): Reject filler or repeated 5- to 8-word phrases and repeated TTS chunks. Before MP3, compare the exact script against all previous chunks and check chunk joins with overlap-free sample playback. Never restart, duplicate or loop a previously synthesized chunk. After MP3, use speech-to-text aligned to REAL audio and compare each transcript region with the approved script; never hallucinate transcription or fake cues. For URDU ONLY: write natural idiomatic Pakistani Urdu (Nastaliq/Arabic-derived script) with Pakistani vocabulary, not Hindi or awkward literal translation; read Urdu text aloud in a genuine ur-PK-capable voice and do not transliterate to Devanagari or use a hi-IN Hindi voice. If ur-PK TTS unavailable, return a clear unresolved stage error; never silently substitute Hindi. The mp3_urdu result output MUST be JSON {"provider":"actual provider","voiceName":"actual voice id","voiceLocale":"ur-PK","inputScript":"Urdu","transliterated":false,"hindiFallback":false} after uploading the real MP3. The SRT must be plain timed Urdu (or a JSON envelope with format=srt, text=timed Urdu), without Cyrillic, Chinese, Korean, Devanagari or repeated hallucinated segments. QA failures mean repair THIS stage; never advance to Deep matching with bad audio.': '')+(policy.strictNarrationDuration&&['narration_english','narration_urdu','mp3_english','mp3_urdu','srt_english','srt_urdu'].includes(job.step_id)?'\nHARD CAP FOR THIS NEW MOVIE: '+policy.targetMinutes+' minutes per language. Narration must stay under the word cap and measured MP3-aligned SRT MUST end no later than '+(policy.targetMinutes*60)+'s. Shorten script before TTS to prevent overlong audio. Do not slow down or stretch narration.':'')+(policy.permanentDeep&&job.step_id==='windows_project'?'\nPERMANENT DEEP MUSE V5: use priorOutputs.cut_plan derived from the validated 5-cue semantic batches for BOTH languages; preserve all cut values and sourceEvidence; do not repeat matching or alter narration/audio. Include method/provenance in cloudImport if supported.':'')+(experimentPrompt?'\nEXPERIMENTAL ADDENDUM:\n'+experimentPrompt:'')+(job.prompt?.includes('RETRY REQUIRED:')?'\n'+job.prompt:'')):
      policy.longForm&&job.step_id==='cut_plan'?promptFor('cut_plan'):job.prompt,
    movie:policy.museOwnsCuts?{id:movie.id,title:movie.title,targetMinutes:policy.targetMinutes,workerId:movie.worker_id}:undefined,
    sourceSrtAsset:policy.museOwnsCuts?{path:assetPath+'/source_srt',mime:ASSET_TYPES.source_srt,name:'CinePulse_Source.srt'}:undefined,
    sceneIndexAsset:policy.experiment?{path:assetPath+'/scene_index_json',mime:'application/json',name:'Scene_Evidence.json',sourceSrtSha256:experimentSource.sourceSrtSha256,uploadSqlitePath:assetPath+'/scene_index_sqlite'}:undefined,
    productionMode:policy.experiment?'scene_intelligence_experiment':undefined,
    audioManifest:audioManifest||undefined,
    urduPronunciation:controlledUrduTask&&job.step_id==='mp3_urdu'?{
      method:URDU_DEVANAGARI_METHOD,sourceUrduSha256:originalUrduDigest,
      approvedUrduPreserved:true,pronunciationInputScript:'Devanagari',
      readerLocale:'hi-IN',finalSrtScript:'Urdu',voiceAccentVerified:false
    }:undefined,
    analysisReference,
    analysisFieldPaths:analysisReference?{
      'analysis.narrations.english':'analysisReference.narrations.english',
      'analysis.narrations.hindiUrdu':'analysisReference.narrations.hindiUrdu',
      'analysis.research.verifiedSynopsis':'analysisReference.research.verifiedSynopsis'
    }:undefined,
    productionContract:policy.museOwnsCuts?{owner:'Muse',clipMinSeconds:3,clipMaxSeconds:6,noOverlap:true,shorts:false,virals:false,
      finalRenderVideos:['english','urdu'],taskOutputOwnedBy:'Muse',cloudflareRole:'validate/store/deliver',androidRole:'download only'}:undefined,
    outputMode:policy.longForm?LONGFORM_MODE:'legacy',
    previousOutputs:context,inputAsset:{path:assetPath,name:kind==='source_srt'?'movie.srt':`${kind}.mp3`,mime:ASSET_TYPES[kind]},
    notice:policy.museOwnsCuts?(job.step_id==='windows_project'?
      'Muse Windows JSON uses exact text copies from task.analysisReference. Keep all previously completed cuts/MP3s/SRTs unchanged. On 422, read the exact failing JSON field path and correct only that field, then resubmit the same leased task.':
      'All reasoning, edit math, fallback source decisions and Windows ProjectState authoring belong to Muse. Cloudflare only checks, stores and delivers Muse outputs. Correct rejected work and resubmit during your active lease.'):policy.serverCuts?'Legacy v3: Cloudflare allocates cuts for this older project. New movies use Muse V4.':'An authorized Muse worker must remain active and return valid task results.'};
}
async function putR2(env,projectId,kind,bytes) {
  const key=objectKey(projectId,kind);const digest=await sha256(bytes);const time=nowSeconds();
  // Only the five new Windows kinds need the supplemental schema.
  // Legacy four-kind writes never depend on D1 migration availability.
  if(assetTableFor(kind)==='windows_assets')await ensureWindowsAssets(env);
  await env.FILES.put(key,bytes,{httpMetadata:{contentType:ASSET_TYPES[kind]},customMetadata:{projectId,kind,sha256:digest}});
  await registerAsset(env,{projectId,kind,key,bytes:bytes.byteLength,hash:digest,time});
  await logDaily(env,{uploaded_bytes:bytes.byteLength});
  await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(nowSeconds(),projectId).run();
  return {kind,bytes:bytes.byteLength,sha256:digest};
}
async function uploadAudio(request,env,projectId,kind) {
  const max=Math.min(40*1024*1024, Number(env.MAX_MP3_BYTES)||40*1024*1024);
  const size=Number(request.headers.get('content-length'));
  if(!Number.isSafeInteger(size)||size<=0)fail(411,'Content-Length required for MP3 streaming upload');
  if(size<2048||size>max)fail(413,'MP3 must be at least 2 KiB and at most 40 MiB');
  const claimedHash=(request.headers.get('X-CinePulse-SHA256')||'').toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(claimedHash))fail(422,'X-CinePulse-SHA256 (64 hex chars) required');
  const key=objectKey(projectId,kind);
  if(!request.body)fail(400,'Audio body missing');
  // Production Cloudflare runtime: stream to R2; avoid buffering large MP3 and exceeding CPU/RAM.
  // Verify MP3 magic from first received bytes via FixedLengthStream, preserving known length.
  if(typeof FixedLengthStream !== 'undefined'){
    const reader=request.body.getReader();
    const first=await reader.read();
    if(first.done||!first.value||!isProbablyMp3(first.value)){await reader.cancel();fail(422,'Audio does not have a valid MP3 header');}
    const stream=new FixedLengthStream(size),writer=stream.writable.getWriter();
    const pump=(async()=>{
      try{
        await writer.write(first.value);
        for(;;){const part=await reader.read();if(part.done)break;await writer.write(part.value);}
        await writer.close();
      }catch(err){try{await writer.abort(err);}catch{}throw err;}
    })();
    await Promise.all([env.FILES.put(key,stream.readable,{httpMetadata:{contentType:'audio/mpeg'}}),pump]);
  }else{
    // Only for Node in-memory tests (Cloudflare Workers has FixedLengthStream).
    const bytes=new Uint8Array(await request.arrayBuffer());
    if(bytes.length!==size||!isProbablyMp3(bytes))fail(422,'Invalid MP3 content');
    await env.FILES.put(key,bytes,{httpMetadata:{contentType:'audio/mpeg'}});
  }
  const time=nowSeconds();
  // Uploader computes content digest, and Windows checks the actual downloaded bytes.
  await env.DB.prepare('INSERT INTO assets(project_id,kind,r2_key,bytes,sha256,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,kind) DO UPDATE SET r2_key=excluded.r2_key,bytes=excluded.bytes,sha256=excluded.sha256,created_at=excluded.created_at').bind(projectId,kind,key,size,claimedHash,time).run();
  await logDaily(env,{uploaded_bytes:size});
  await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(time,projectId).run();
  return {kind,bytes:size,sha256:claimedHash};
}

async function finalizeProject(env,project,manifest,{generatedByCloudflare=false,verifiedMuseJob=false}={}) {
  if(controlIsStopped(await getProject(env,project.id)))fail(410,'Stopped movie cannot finalize');
  const policy=await projectPolicy(env,project.id);
  if(policy.serverCuts&&!generatedByCloudflare)
    fail(409,'Legacy V3 server-generated cut plan requires its normal task pipeline.');
  if(policy.museOwnsCuts&&!verifiedMuseJob)
    fail(409,'Muse V4 edit decisions and Windows project must come from the verified Muse task pipeline; manual overrides are prohibited.');
  if(policy.longForm){
    // Never allow a manual finalize request to reactivate viral output for new movies.
    let metadata;try{metadata=normalizePublishingMetadata({metadata:manifest.metadata});}
    catch(error){fail(422,error.message);}
    manifest={...manifest,viralScenes:[],metadata};
  }
  validateManifest(manifest);
  const en=await assetByKind(env,project.id,'english_mp3');
  const ur=await assetByKind(env,project.id,'urdu_mp3');
  if(!en || !ur)fail(409,'Both physical English and Urdu MP3 assets are required before export');
  const srt=await env.FILES.get(project.source_srt_key);
  if(!srt)fail(409,'Original SRT missing');
  const sourceSrt=await srt.text();
  let cutMetrics=null;
  if(policy.longForm){try{cutMetrics=validateFinalCutPlan(manifest.cutPlan,{
    sourceSrt,englishSrt:manifest.narrationSrts.english,urduSrt:manifest.narrationSrts.urdu,
    experimentalReview:policy.experiment
  });}catch(error){fail(422,'Final cuts cannot be exported: '+error.message);}}
  const document={
    schema:'cinepulse.render-project.v1',generatedAt:new Date().toISOString(),
    project:{id:project.id,title:project.title,workerId:project.worker_id},
    sourceSrt,
    digest:manifest.digest,
    narrations:manifest.narrations,
    narrationSrts:manifest.narrationSrts,
    sceneMatches:manifest.sceneMatches,
    cutPlan:manifest.cutPlan,
    viralScenes:policy.longForm?[]:manifest.viralScenes,
    outputMode:policy.longForm?LONGFORM_MODE:'legacy',
    finalCutMetrics:cutMetrics,
    sourceVideoFrameInspectionRequired:false,
    metadata:manifest.metadata,
    renderingSettings:manifest.renderingSettings||{},
    audio:{english:{filename:fileNames.english_mp3,sha256:en.sha256,bytes:en.bytes},urdu:{filename:fileNames.urdu_mp3,sha256:ur.sha256,bytes:ur.bytes}},
    notes:policy.longForm?
      'English and Urdu final cut TIMESTAMPS passed 3–6-second bounds, no overlapping intervals and measured narration-SRT coverage. No movie-frame inspection is needed for these numeric checks. Windows must attach the matching original movie and MP3s for rendering.':
      'Legacy project retained its original export format and processing state.'
  };
  const encoded=new TextEncoder().encode(JSON.stringify(document));
  if(encoded.byteLength>10*1024*1024)fail(413,'Export JSON exceeds 10 MiB');
  await putR2(env,project.id,'export_json',encoded);
  if(policy.serverCuts||policy.museOwnsCuts){
    // V4 stores the FULL Muse-authored Windows project without modifying any
    // scene, source position or media reference. V3 remains backwards compatible.
    const projectJson=policy.museOwnsCuts?verifyMuseWindowsProject(manifest.windowsProject,{
      projectId:project.id,title:project.title,sourceSrt,
      narrations:manifest.narrations,narrationSrts:manifest.narrationSrts,
      digest:manifest.digest,cutPlan:manifest.cutPlan,metadata:manifest.metadata,
      mp3Manifest:document.audio,experimentalReview:policy.experiment
    }):buildWindowsProject({
      project,sourceSrt,digest:manifest.digest,narrations:manifest.narrations,
      narrationSrts:manifest.narrationSrts,cuts:manifest.cutPlan,
      metadata:manifest.metadata,mp3s:document.audio,metrics:cutMetrics
    });
    if(policy.experiment){
      if(!(await assetByKind(env,project.id,'scene_index_sqlite')))fail(409,'Experimental scene SQLite must be present');
      const englishCuts=manifest.cutPlan.filter(c=>c.language==='english');
      const urduCuts=manifest.cutPlan.filter(c=>c.language==='urdu');
      if(!englishCuts.length||!urduCuts.length)fail(422,'Both language cut plans must be finalized');
      await storeExperimentAsset(env,{projectId:project.id,kind:'english_final_cuts',bytes:new TextEncoder().encode(JSON.stringify(englishCuts))});
      await storeExperimentAsset(env,{projectId:project.id,kind:'urdu_final_cuts',bytes:new TextEncoder().encode(JSON.stringify(urduCuts))});
    }
    const serverFiles={
      windows_project_json:JSON.stringify(projectJson),
      // Physically published .srt files MUST contain SRT timecodes, not the
      // worker's JSON envelope. The verified native Windows project is unchanged.
      english_srt:unwrapMeasuredSrt(manifest.narrationSrts.english),
      urdu_srt:unwrapMeasuredSrt(manifest.narrationSrts.urdu),
      english_narration:manifest.narrations.english,urdu_narration:manifest.narrations.urdu
    };
    for(const [kind,content] of Object.entries(serverFiles)){
      const bytes=new TextEncoder().encode(content);
      if(!bytes.byteLength||bytes.byteLength>10*1024*1024)fail(413,'Invalid generated '+kind+' size');
      await putR2(env,project.id,kind,bytes);
    }
    // Readiness means all EIGHT requested files exist physically in R2 and
    // each D1 registry points to a file of the advertised byte count.
    // Do not mark a movie ready on metadata alone.
    for(const kind of (policy.experiment?[...WINDOWS_FILE_KINDS,...Object.keys(EXPERIMENT_ASSET_NAMES)]:WINDOWS_FILE_KINDS)){
      const row=await assetByKind(env,project.id,kind);
      if(!row||!row.r2_key||!Number.isSafeInteger(Number(row.bytes))||Number(row.bytes)<1)
        fail(500,'Missing generated Windows asset: '+kind);
      const object=await env.FILES.head(row.r2_key);
      if(!object||object.size!==Number(row.bytes))
        fail(500,'Windows asset was not stored completely in R2: '+kind);
    }
  }
  await env.DB.prepare("UPDATE projects SET status='ready',ready_at=COALESCE(ready_at,?),export_key=?,updated_at=? WHERE id=?").bind(nowSeconds(),objectKey(project.id,'export_json'),nowSeconds(),project.id).run();
  // A successful idempotent replay clears stale finalization errors without
  // modifying the Muse-produced result or reopening the completed task.
  await env.DB.prepare("UPDATE jobs SET error=NULL WHERE project_id=? AND status='done' AND step_id=?")
    .bind(project.id,policy.stages[policy.stages.length-1]).run();
  return {status:'ready',files:[fileNames.export_json,fileNames.english_mp3,fileNames.urdu_mp3]};
}
async function autoFinalize(env,project){
  const outputs=await priorOutputs(env,project.id);
  try {
    const parse=(key)=>JSON.parse(outputs[key]);
    const policy=await projectPolicy(env,project.id);
    const meta=policy.longForm?normalizePublishingMetadata(parse('publishing_metadata')):parse('viral_metadata');
    const matches=parse('scene_matching');
    let cuts;
    if(policy.serverCuts){
      // Only projects explicitly created under the old V3 policy use the
      // legacy Cloudflare allocator. ALL new V4 projects use Muse's own cuts.
      const source=await env.FILES.get(project.source_srt_key);
      if(!source)fail(409,'Original source subtitles unavailable');
      const cutResult=allocateFinalLongFormCuts({
        sourceSrt:await source.text(),
        englishSrt:outputs.srt_english,urduSrt:outputs.srt_urdu,
        sceneMatches:Array.isArray(matches)?matches:matches.matches||[]
      });
      cuts=cutResult.cuts;
    }else{
      cuts=parse('cut_plan');
    }
    const m={digest:outputs.digest,narrations:{english:outputs.narration_english,urdu:outputs.narration_urdu},
      narrationSrts:{english:outputs.srt_english,urdu:outputs.srt_urdu},
      viralScenes:policy.longForm?[]:meta.viralScenes,metadata:policy.longForm?meta:meta.metadata,
      sceneMatches:Array.isArray(matches)?matches:matches.matches||[],cutPlan:cuts,
      ...(policy.museOwnsCuts?{windowsProject:parse('windows_project')}:{})};
    const finished=await finalizeProject(env,project,m,{
      generatedByCloudflare:policy.serverCuts,verifiedMuseJob:policy.museOwnsCuts
    });
    if(policy.serverCuts&&finished.status==='ready'){
      // Audit record, not a Muse task: an already-finished server cut_plan job.
      const exists=await env.DB.prepare("SELECT id FROM jobs WHERE project_id=? AND step_id='cut_plan' LIMIT 1").bind(project.id).first();
      if(!exists){
        const stamp=nowSeconds();
        await env.DB.prepare("INSERT INTO jobs(id,project_id,worker_id,step_id,status,prompt,output,created_at,finished_at) VALUES(?,?,?,'cut_plan','done',?,?,?,?)")
          .bind(newId(),project.id,project.worker_id,'Generated deterministically by Cloudflare after Muse scene matching',JSON.stringify(cuts),stamp,stamp).run();
      }
    }
    return finished;
  }catch(error){
    // Automatically request better scene references from Muse when the
    // timestamp allocator runs out of supported source footage. Never ask
    // Android to patch missing scene decisions.
    const policy=await projectPolicy(env,project.id);
    if(policy.serverCuts){
      const attempts=await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE project_id=? AND step_id='scene_matching'").bind(project.id).first();
      if(Number(attempts?.n||0)<3){
        const prompt=promptFor('scene_matching')+
          '\nRETRY REQUIRED: Cloudflare rejected your previous matches: '+
          String(error.message).slice(0,650)+
          '\nProvide better non-overlapping movie source time windows for BOTH languages; do not repeat the same 13 narrow intervals. Do not generate a cut plan, Shorts or virals.';
        await queueTask(env,project,'scene_matching',prompt);
        return {status:'processing',nextStep:'scene_matching',retry:true,
          message:'Cloudflare requested corrected Muse scene matching automatically: '+error.message};
      }
    }
    // Preserve full Muse outputs for retry; the accepted job stays DONE.
    // Store a concise diagnostic, throttling repeated retries on app polls.
    await env.DB.batch([
      env.DB.prepare("UPDATE projects SET status='needs_review',updated_at=? WHERE id=?").bind(nowSeconds(),project.id),
      env.DB.prepare("UPDATE jobs SET error=? WHERE project_id=? AND status='done' AND step_id=?")
        .bind(String(error?.message||'Finalization failed').slice(0,850),project.id,policy.stages[policy.stages.length-1])
    ]);
    return {status:'needs_review',message:error.message};
  }
}
/**
 * Recovery operates ONLY on previously accepted Muse work:
 * - project must be needs_review
 * - its final windows_project job must already be DONE
 * - no queued/working/error tasks remain
 * - no new Muse tasks, audio generation or cut calculation is requested.
 * Caller is an authenticated administrator; retry is idempotent.
 */
/**
 * Validates unchanged accepted V5-G checkpoints before allowing a one-shot
 * recovery of an actual failed pre-TTS job. Neither this function nor the
 * guarded SQL modifies accepted stage outputs.
 */
/**
 * Review is an explicit failed state, not a processing pause. Inspect the
 * last failed job and preserve all previously accepted stage outputs.
 */
async function reviewRetryState(env,project){
 const [policy,worker,rows]=await Promise.all([
  projectPolicy(env,project.id),
  env.DB.prepare('SELECT id,enabled,paused FROM workers WHERE id=?').bind(project.worker_id).first(),
  env.DB.prepare('SELECT id,step_id,status,prompt,created_at FROM jobs WHERE project_id=? ORDER BY created_at ASC,rowid ASC')
    .bind(project.id).all()
 ]);
 return inspectReviewStageRetry({project,worker,policy,jobs:rows.results||[],now:nowSeconds()});
}
async function retryReviewedStage(env,project,requestBody){
 const state=await reviewRetryState(env,project);
 if(!state.eligible)return {...state,enqueued:false,reason:'review_retry_not_eligible'};
 const failedJobId=requireUUID(requestBody?.failedJobId);
 if(requestBody?.stepId!==state.step||failedJobId!==state.failedJobId)
  return {...state,enqueued:false,reason:'failed_step_or_job_changed'};
 if(REVIEW_STAGE_MEDIA.has(state.step)){
  const assetKind={mp3_english:'english_mp3',mp3_urdu:'urdu_mp3',
   srt_english:'english_srt',srt_urdu:'urdu_srt'}[state.step];
  if(await assetByKind(env,project.id,assetKind))
   return {...state,enqueued:false,reason:'stage_media_asset_requires_manual_reconciliation'};
 }
 if(!await env.FILES.get(project.source_srt_key))
  return {...state,enqueued:false,reason:'source_srt_not_available'};
 const marker=REVIEW_STAGE_RETRY_MARKER+failedJobId+']';
 const policy=await projectPolicy(env,project.id);
 const latest=await env.DB.prepare('SELECT prompt FROM jobs WHERE id=? AND project_id=?').bind(failedJobId,project.id).first();
 const base=state.step==='digest'?String(latest?.prompt||''):promptFor(state.step);
 if(!base.trim())return {...state,enqueued:false,reason:'retry_prompt_unavailable'};
 const prompt=base+'\\n'+marker+
  ' Retry only the previously failed stage with the same approved previousOutputs.'+
  ' Preserve accepted narrations, source evidence, voice assets and scene checkpoints.'+
  ' Return a real, validated stage output; never fabricate missing media.';
 const result=await enqueueReviewStageRetry(env,{
  projectId:project.id,workerId:project.worker_id,failedJobId,
  stage:state.step,newJobId:newId(),prompt,now:nowSeconds()
 });
 return {...result,previousFailedJobId:failedJobId,retryStage:state.step,
  acceptedJobsUnchanged:true};
}
async function resumeFailedGroundedPreflight(env,project,failedJobId){
 const policy=await projectPolicy(env,project.id);
 if(!policy.grounded)return {enqueued:false,reason:'not_grounded_v5g'};
 if(project.status!=='needs_review')return {enqueued:false,reason:'not_needs_review'};
 if(controlIsStopped(project)||controlIsPaused(project))
  return {enqueued:false,reason:'movie_paused_or_stopped'};
 const worker=await env.DB.prepare('SELECT id,enabled,paused FROM workers WHERE id=?').bind(project.worker_id).first();
 if(!worker||!worker.enabled||worker.paused)return {enqueued:false,reason:'worker_disabled_or_paused'};
 const outputs=await priorOutputs(env,project.id);
 if(!outputs.digest||!outputs.grounded_evidence||!outputs.narration_english||!outputs.narration_urdu)
  return {enqueued:false,reason:'accepted_checkpoints_missing'};
 // The script envelope bug is fixed; now verify the saved reference data
 // remains readable before any project/job mutation.
 extractV5gNarrationText(outputs.narration_english,'english');
 extractV5gNarrationText(outputs.narration_urdu,'urdu');
 const original=await env.FILES.get(project.source_srt_key);
 if(!original)return {enqueued:false,reason:'original_source_srt_missing'};
 let evidence;
 try{evidence=JSON.parse(outputs.grounded_evidence)}catch{return {enqueued:false,reason:'corrupt_grounded_evidence'};}
 validateV5gEvidence(await original.text(),evidence);
 const prompt=promptFor(V5G_PREFLIGHT)+'\n'+V5G_PREFLIGHT_REQUEUE_MARKER+
  ' Recovery of the failed pre-TTS validation ONLY. Re-use both approved scripts, '+
  'existing 46-beat evidence and preserved bilingual units verbatim; do not '+
  'rewrite the story, regenerate audio, skip a beat, or change accepted checkpoints.';
 return requeueFailedV5gPreflight(env,{projectId:project.id,
  workerId:project.worker_id,failedJobId,newJobId:newId(),prompt,now:nowSeconds()});
}
async function recoverAcceptedFinalization(env,project){
  if(controlIsStopped(await getProject(env,project.id)))return {attempted:false,reason:'movie_stopped'};
  if(project.status!=='needs_review')return {attempted:false,reason:'not_needs_review'};
  if(project.expires_at&&project.expires_at<=nowSeconds())
    return {attempted:false,reason:'expired'};
  const policy=await projectPolicy(env,project.id);
  if(!policy.museOwnsCuts&&!policy.serverCuts)
    return {attempted:false,reason:'not_server_windows_package'};
  const finalStep=policy.stages[policy.stages.length-1];
  const [finalJob,incomplete]=await Promise.all([
    env.DB.prepare("SELECT id FROM jobs WHERE project_id=? AND step_id=? AND status='done' LIMIT 1")
      .bind(project.id,finalStep).first(),
    env.DB.prepare("SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','working','error') LIMIT 1")
      .bind(project.id).first()
  ]);
  if(!finalJob||incomplete)
    return {attempted:false,reason:'Muse_final_task_not_fully_accepted'};
  const result=await autoFinalize(env,project);
  return {attempted:true,status:result.status,message:result.message||null};
}
async function recoverOneCompletedProject(env,workerId=null){
  // Bounded: never regenerate unrelated movies or scan task payloads.
  const rows=workerId?
    await env.DB.prepare("SELECT * FROM projects WHERE worker_id=? AND status='needs_review' AND updated_at<? ORDER BY updated_at ASC LIMIT 3")
      .bind(workerId,nowSeconds()-30).all():
    await env.DB.prepare("SELECT * FROM projects WHERE status='needs_review' AND updated_at<? ORDER BY updated_at ASC LIMIT 3")
      .bind(nowSeconds()-30).all();
  for(const candidate of rows.results||[]){
    try{
      const recovered=await recoverAcceptedFinalization(env,candidate);
      if(recovered.attempted)return {projectId:candidate.id,...recovered};
    }catch(e){
      console.error('CinePulse accepted-output recovery failed',candidate.id,String(e?.message||e));
    }
  }
  return {attempted:false};
}
async function advancePipeline(env,job){
  if(controlIsStopped(await getProject(env,job.project_id)))return {status:'stopped',autoAdvanced:false};
  if(controlIsPaused(await getProject(env,job.project_id)))return {status:'paused',autoAdvanced:false};
  const policy=await projectPolicy(env,job.project_id);
  const stages=policy.stages;
  const current=stages.indexOf(job.step_id);
  if(current<0)return {status:'done',autoAdvanced:false};
  if(current===stages.length-1){const project=await getProject(env,job.project_id);return autoFinalize(env,project);}
  const project=await getProject(env,job.project_id);
  const next=stages[current+1];
  const already=await env.DB.prepare('SELECT id FROM jobs WHERE project_id=? AND step_id=? LIMIT 1').bind(job.project_id,next).first();
  if(!already)await queueTask(env,project,next);
  return {status:'processing',nextStep:next};
}
async function signedLinks(env,request,project){
  if(project.status!=='ready')fail(409,'Project is not ready for download');
  if(project.expires_at && project.expires_at<=nowSeconds())fail(410,'Project files expired');
  const base=new URL(request.url).origin;
  const now=nowSeconds();
  const expiry=Math.min(now+DOWNLOAD_LINK_SECONDS,project.expires_at||now+DOWNLOAD_LINK_SECONDS);
  const files={};
  const requestedFormat=new URL(request.url).searchParams.get('format');
  // Scene Lab is a native server-authored 8-file V4 project; the legacy APK
  // requests /downloads without ?format. Do not claim export_json exists.
  const format=requestedFormat||((await sceneLabRow(env,project.id))?'windows':null);
  const policy=await projectPolicy(env,project.id);
  if(format && format!=='windows' && format!=='windows_experiment')fail(400,'Unknown download format');
  if(format==='windows_experiment'&&!policy.experiment)fail(409,'Experimental package is only available for experimental projects');
  const kinds=format==='windows_experiment'?[...WINDOWS_FILE_KINDS,...Object.keys(EXPERIMENT_ASSET_NAMES)]:format==='windows'?WINDOWS_FILE_KINDS:['export_json','english_mp3','urdu_mp3'];
  for(const kind of kinds){
    const asset=await assetByKind(env,project.id,kind);
    if(!asset)fail(409,`Server-owned Windows export missing ${kind}. This old project must use legacy download mode; no APK-side cut correction is allowed.`);
    const sig=await signDownload(env.DOWNLOAD_SIGNING_KEY,project.id,kind,expiry);
    files[kind]={filename:EXPERIMENT_ASSET_NAMES[kind]||WINDOWS_FILE_NAMES[kind]||fileNames[kind],bytes:asset.bytes,sha256:asset.sha256,
      url:`${base}/dl/${project.id}/${kind}?exp=${expiry}&sig=${sig}`,linkExpiresAt:expiry};
  }
  return {project:publicProject(project),files,format:format==='windows_experiment'?'windows_eleven_verified':format==='windows'?'windows_eight_verified':'legacy_three',
    retentionHours:project.retention_hours,info:'Cloudflare prepared all Windows files; Android only verifies SHA-256 and downloads them. Signed links expire after 15 minutes.'};
}
async function download(req,env,parts,url){
  const [, ,pid,kind]=parts;
  if(!isUuid(pid)||!['export_json',...WINDOWS_FILE_KINDS,...Object.keys(EXPERIMENT_ASSET_NAMES)].includes(kind))fail(404,'File not found');
  const exp=url.searchParams.get('exp'),sig=url.searchParams.get('sig');
  if(!await verifyDownload(env.DOWNLOAD_SIGNING_KEY,pid,kind,exp,sig||''))fail(403,'Download link expired or invalid');
  const project=await getProject(env,pid);
  if(project.status!=='ready'||(project.expires_at&&project.expires_at<=nowSeconds()))fail(410,'Project no longer available');
  if(isExperimentAssetKind(kind)&&!(await projectPolicy(env,pid)).experiment)fail(404,'Not an experimental asset');
  const asset=await assetByKind(env,pid,kind);
  if(!asset)fail(404,'Download file missing');
  const obj=await env.FILES.get(asset.r2_key);if(!obj)fail(404,'Stored file missing');
  const time=nowSeconds();
  // First *successful* download starts the post-download 24/48-hour retention clock.
  await env.DB.prepare('UPDATE projects SET first_downloaded_at=COALESCE(first_downloaded_at,?),expires_at=COALESCE(expires_at,?) WHERE id=?').bind(time,time+project.retention_hours*3600,pid).run();
  await logDaily(env,{downloads:1});
  return new Response(obj.body,{status:200,headers:{'Content-Type':ASSET_TYPES[kind],'Content-Disposition':`attachment; filename="${EXPERIMENT_ASSET_NAMES[kind]||WINDOWS_FILE_NAMES[kind]||fileNames[kind]}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Length':String(asset.bytes)}});
}
async function removeProject(env,pid){
  const project=await getProject(env,pid);
  const busy=await env.DB.prepare("SELECT id FROM jobs WHERE project_id=? AND status='working' LIMIT 1").bind(pid).first();
  if(busy)fail(409,'Project has an active Muse lease; wait until it completes or expires');
  const rows=await allAssetKeys(env,pid);
  const experimental=(await projectPolicy(env,pid)).experiment;
  if(experimental){
    await ensureExperimentTables(env);
    const stored=await env.DB.prepare('SELECT r2_key FROM experimental_package_assets WHERE project_id=?').bind(pid).all();
    for(const row of stored.results||[])rows.push(row);
    rows.push({r2_key:experimentR2Key(pid,'scene-evidence-v1.json')});
  }
  // Deletes are idempotent. If R2 fails, D1 remains intact for safe retry.
  for(const a of rows)await env.FILES.delete(a.r2_key);
  if(experimental)await env.DB.batch([
    env.DB.prepare('DELETE FROM experimental_package_assets WHERE project_id=?').bind(pid),
    env.DB.prepare('DELETE FROM experimental_scene_windows WHERE project_id=?').bind(pid),
    env.DB.prepare('DELETE FROM experimental_scene_indexes WHERE project_id=?').bind(pid)
  ]);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM cinepulse_movie_controls WHERE project_id=?').bind(pid),
    env.DB.prepare('DELETE FROM windows_assets WHERE project_id=?').bind(pid),
    env.DB.prepare('DELETE FROM assets WHERE project_id=?').bind(pid),
    env.DB.prepare('DELETE FROM jobs WHERE project_id=?').bind(pid),
    env.DB.prepare('DELETE FROM projects WHERE id=?').bind(pid)
  ]);
  await logDaily(env,{deleted_projects:1});
  return project;
}
async function scheduledCleanup(env){
  const now=nowSeconds(),stale=now-MAX_INACTIVE_DAYS*86400;
  const rows=await env.DB.prepare('SELECT id FROM projects WHERE (expires_at IS NOT NULL AND expires_at<=?) OR (first_downloaded_at IS NULL AND updated_at<?) LIMIT 50').bind(now,stale).all();
  let count=0;
  for(const p of rows.results||[]){try{await removeProject(env,p.id);count++;}catch(error){console.error('cleanup skipped',p.id,error.message);}}
  return count;
}
/** Atomic-on-success Scene Lab finalization with independent V4 package assets. */
async function acceptSceneLabResult(env,job,output){
 const lab=await sceneLabRow(env,job.project_id);
 if(!lab||lab.job_id!==job.id)fail(409,'Scene Lab registration missing');
 if(typeof output==='string'){try{output=JSON.parse(output)}catch{fail(422,'Scene Lab result output must be valid JSON');}}
 if(!output||typeof output!=='object')fail(422,'Scene Lab output must be an object');
 const [english,urdu,src]=await Promise.all([
   assetByKind(env,job.project_id,'english_mp3'),
   assetByKind(env,job.project_id,'urdu_mp3'),
   env.FILES.get((await getProject(env,job.project_id)).source_srt_key)
 ]);
 if(!english||!urdu||!src)fail(409,'Both uploaded physical MP3s and original source SRT required');
 const mp3s={
  english:{bytes:english.bytes,sha256:english.sha256,filename:'CinePulse_English.mp3'},
  urdu:{bytes:urdu.bytes,sha256:urdu.sha256,filename:'CinePulse_Urdu.mp3'}
 };
 let result;
 try{
   result=buildSceneLabV4Package({...output,manifest:JSON.parse(lab.manifest_json),
    sourceSrt:await src.text(),mp3s,projectId:job.project_id,workerId:job.worker_id});
 }catch(error){fail(422,'Scene Lab V4 package rejected: '+error.message);}
 const assetData=[
  ['windows_project_json','CinePulse_Project.json'],
  ['english_srt','CinePulse_English.srt'],
  ['urdu_srt','CinePulse_Urdu.srt'],
  ['english_narration','CinePulse_English_Narration.txt'],
  ['urdu_narration','CinePulse_Urdu_Narration.txt']
 ];
 // Staging keys are stable and isolated per experiment; failed attempts may be repaired in-place.
 for(const [kind,name] of assetData){
  const payload=new TextEncoder().encode(result.files[name]);
  const key=objectKey(job.project_id,kind);
  await env.FILES.put(key,payload,{httpMetadata:{contentType:ASSET_TYPES[kind]}});
  await registerAsset(env,{projectId:job.project_id,kind,key,bytes:payload.byteLength,hash:await sha256(payload),time:nowSeconds()});
 }
 const time=nowSeconds();
 const update=await env.DB.prepare("UPDATE jobs SET output=?,status='done',finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='working' RETURNING id")
   .bind(JSON.stringify({strategy:lab.strategy,experimentId:result.experimentId,files:assetData.map(x=>x[1]),englishSeconds:output.englishAudio?.durationSeconds,urduSeconds:output.urduAudio?.durationSeconds}),time,job.id,job.lease).first();
 if(!update)fail(409,'Scene Lab task lease changed while exporting');
 await env.DB.batch([
  env.DB.prepare("UPDATE projects SET status='ready',updated_at=? WHERE id=?").bind(time,job.project_id),
  env.DB.prepare("UPDATE cinepulse_scene_lab SET status='ready',updated_at=? WHERE project_id=?").bind(time,job.project_id)
 ]);
 await logDaily(env,{jobs_completed:1});
 return {id:job.id,status:'done',projectId:job.project_id,strategy:lab.strategy,sceneLab:'ready',downloadEndpoint:'/v1/scene-lab/'+job.project_id+'/downloads',nextEndpoint:'/agent/next'};
}

async function queueDeepMuseBatch(env,run,index){
 const p=await getProject(env,run.project_id);
 const segments=segmentBatch(run,index);
 const id=await queueTask(env,p,DEEP_MATCH,'[DEEP-MUSE-BATCH-'+String(index+1)+']');
 await env.DB.prepare("INSERT INTO cinepulse_scene_lab_deep_batches(project_id,batch_index,job_id,first_segment,last_segment,status) VALUES(?,?,?,?,?,'queued') ON CONFLICT(project_id,batch_index) DO UPDATE SET job_id=excluded.job_id,first_segment=excluded.first_segment,last_segment=excluded.last_segment,status='queued',output_json=NULL,finished_at=NULL")
   .bind(run.project_id,index,id,segments[0].segmentIndex,segments.at(-1).segmentIndex).run();
 return id;
}
async function queueDeepMuseExport(env,run){
 const p=await getProject(env,run.project_id);
 const id=await queueTask(env,p,DEEP_EXPORT,'[DEEP-MUSE-EXPORT]');
 await env.DB.prepare("UPDATE cinepulse_scene_lab SET job_id=?,status='matching',updated_at=? WHERE project_id=?")
   .bind(id,nowSeconds(),run.project_id).run();
 return id;
}
async function deepProgressSnapshot(env,row){
 const result=await env.DB.prepare("SELECT batch_index,first_segment,last_segment,status,finished_at FROM cinepulse_scene_lab_deep_batches WHERE project_id=? ORDER BY batch_index")
  .bind(row.project_id).all();
 return {...publicDeepStatus(row,result.results||[]),batches:result.results||[]};
}
async function acceptDeepMuseResult(env,job,output){
 const run=await deepRow(env,job.project_id);
 if(!run||run.worker_id!==job.worker_id)fail(409,'Deep Muse project or worker identity mismatch');
 if(!output||typeof output!=='object'||Array.isArray(output))throw Error('Muse must submit an output JSON object');
 if(job.step_id===DEEP_PREPARE){
  if(output.verified!==true)throw Error('Both physical MP3 upload receipts must be verified');
  const expected=JSON.parse(run.expected_mp3s_json);
  for(const lang of ['english','urdu']){
   const kind=lang+'_mp3',row=await assetByKind(env,job.project_id,kind),e=expected[lang];
   if(!row||row.bytes!==e.bytes||row.sha256?.toLowerCase()!==e.sha256.toLowerCase())
    throw Error('Deep Muse '+kind+' asset missing or SHA/byte manifest mismatch');
  }
  const now=nowSeconds();
  const ended=await env.DB.prepare("UPDATE jobs SET output=?,status='done',finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND status='working' AND lease=? RETURNING id")
    .bind(JSON.stringify({verified:true,englishSha256:expected.english.sha256,urduSha256:expected.urdu.sha256}),now,job.id,job.lease).first();
  if(!ended)fail(409,'Deep Muse preparation lease changed');
  await env.DB.prepare("UPDATE cinepulse_scene_lab_deep SET status='matching',updated_at=? WHERE project_id=?")
    .bind(now,job.project_id).run();
  const next=await queueDeepMuseBatch(env,run,0);
  return {id:job.id,status:'done',nextStep:DEEP_MATCH,nextJobId:next,progress:'0/'+run.segment_count};
 }
 if(job.step_id===DEEP_MATCH){
  const batch=await deepBatch(env,job.id);
  if(!batch||batch.project_id!==run.project_id||batch.status!=='queued')
    fail(409,'Unrecognized or already completed Deep Muse checkpoint');
  const src=await env.FILES.get((await getProject(env,run.project_id)).source_srt_key);
  if(!src)fail(409,'Original SRT missing');
  const completed=await deepOutputs(env,run.project_id);
  const result=validateDeepBatch(run,batch.batch_index,output,await src.text(),completed);
  const now=nowSeconds();
  const ended=await env.DB.prepare("UPDATE jobs SET output=?,status='done',finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND status='working' AND lease=? RETURNING id")
    .bind(JSON.stringify(result),now,job.id,job.lease).first();
  if(!ended)fail(409,'Deep Muse matching lease changed');
  await env.DB.batch([
    env.DB.prepare("UPDATE cinepulse_scene_lab_deep_batches SET status='done',output_json=?,finished_at=? WHERE project_id=? AND batch_index=? AND job_id=?")
      .bind(JSON.stringify(result),now,run.project_id,batch.batch_index,job.id),
    env.DB.prepare("UPDATE cinepulse_scene_lab_deep SET current_batch=?,status='matching',updated_at=? WHERE project_id=?")
      .bind(batch.batch_index+1,now,run.project_id)
  ]);
  const nextBatch=batch.batch_index+1;
  const nextId=nextBatch<run.batch_count?
    await queueDeepMuseBatch(env,run,nextBatch):await queueDeepMuseExport(env,run);
  const finished=Math.min(run.segment_count,nextBatch*5);
  return {id:job.id,status:'done',acceptedSegments:result.decisions.length,
    reviewedSegments:finished,totalSegments:run.segment_count,
    completedBatches:nextBatch,batchCount:run.batch_count,
    nextStep:nextBatch<run.batch_count?DEEP_MATCH:DEEP_EXPORT,nextJobId:nextId};
 }
 if(job.step_id===DEEP_EXPORT){
  const completed=await deepOutputs(env,run.project_id);
  if(completed.length!==run.batch_count)throw Error('All Muse matching batches must pass before export');
  const checked=validateDeepFinalCuts(run,output.englishCuts,completed);
  const expected=JSON.parse(run.expected_mp3s_json);
  const manifest=JSON.parse(run.manifest_json);
  const provenance={mode:'muse_deep_batch_v1',completedBatches:checked.completedBatches,
   reviewedSegments:checked.reviewedSegments,matchedDecisions:completed.flatMap(b=>b.decisions),
   museRequestIds:checked.museRequests,visualVerified:false,
   sourceEvidencePolicy:'exact source SRT cue quotation, alternative, and cut-to-segment anchor'};
  const validated={
   baselineProject:JSON.parse(run.baseline_project_json),
   manifest,englishCues:JSON.parse(run.english_cues_json),
   urduSrt:run.urdu_srt,narrations:JSON.parse(run.narrations_json),
   englishAudio:{bytes:expected.english.bytes,durationSeconds:expected.english.durationSeconds},
   urduAudio:{bytes:expected.urdu.bytes,durationSeconds:expected.urdu.durationSeconds},
   urduCuts:JSON.parse(run.urdu_cuts_json),englishCuts:checked.cuts,
   deepMatching:provenance
  };
  // The established V4 export stores all eight files, validates coverage,
  // verifies receipt manifests, and finishes the existing experiment project.
  const accepted=await acceptSceneLabResult(env,job,validated);
  await env.DB.prepare("UPDATE cinepulse_scene_lab_deep SET status='ready',current_batch=?,updated_at=? WHERE project_id=?")
   .bind(run.batch_count,nowSeconds(),run.project_id).run();
  return {...accepted,deepMuse:DEEP_BUILD,reviewedSegments:run.segment_count,
   completedBatches:run.batch_count,visualVerified:false};
 }
 fail(400,'Invalid Deep Muse stage');
}

async function acceptPermanentDeepStage(env,job,output){
 if(!output||typeof output!=='object'||Array.isArray(output))
   throw Error('A JSON object with Muse source evidence is required');
 const outputs=await priorOutputs(env,job.project_id),movie=await getProject(env,job.project_id);
 if(PERMANENT_DEEP_MATCH_STEPS.includes(job.step_id)){
   const language=deepLanguage(job.step_id);
   const cues=loadProductionCues(outputs[language==='english'?'srt_english':'srt_urdu']);
   const accepted=await acceptedPermanentDeepBatches(env,job.project_id,job.step_id);
   const source=await env.FILES.get(movie.source_srt_key);
   if(!source)throw Error('Original movie subtitles missing');
   // CAR v1.1 integration guard: normal Muse submissions are unchanged.
   // Recovery is never inferred from a 422 or a partial five-segment batch.
   // A future recovery submission must provide a complete independently verified
   // movie-wide unresolved inventory, and must not replace accepted decisions.
   if(output?.carRecovery){
     // Client-supplied inventories are not trusted. Reconcile both languages
     // against this project's live D1 checkpoints before any CAR decision.
     const d1Inventory=await collectCarD1Inventory(env,job.project_id,outputs,acceptedPermanentDeepBatches);
     if(!d1Inventory.eligibility.verified)
       throw Error('CAR live D1 inventory denied: '+d1Inventory.eligibility.reason);
     const verifiedInventory=verifyCarLiveInventory(d1Inventory);
     const check=carEligibility({
       enabled:env.CAR_V1_1_ENABLED==='true',
       unresolvedSegmentIds:verifiedInventory.unresolvedSegmentIds,
       acceptedSegmentIds:[
         ...accepted.flatMap(batch=>batch.decisions||[]).map(d=>language+':'+d.segmentIndex)
       ]
     });
     if(!check.eligible)throw Error('CAR recovery denied: '+check.reason);
     throw Error('CAR recovery persistence not yet authorized: atomic checkpoint integration required');
   }
   const policy=await projectPolicy(env,job.project_id);
   if(policy.grounded){
     const plan=JSON.parse(outputs[V5G_MATCH_PLAN]||'null');
     if(!plan?.validation?.globalCoverage||!Array.isArray(plan?.decisions?.[language]))
       throw Error('V5-G global plan checkpoint not accepted');
     const start=deepProductionProgress(cues,accepted).reviewedSegments;
     const expected=plan.decisions[language].slice(start,start+output.decisions.length);
     if(expected.length!==output.decisions.length)throw Error('V5-G planned decision count differs');
     for(let i=0;i<expected.length;i++){
       const a=expected[i],b=output.decisions[i];
       if(!b||b.segmentIndex!==a.segmentIndex||
          b.sourceStartSeconds!==a.sourceStartSeconds||
          b.sourceEndSeconds!==a.sourceEndSeconds||
          JSON.stringify(b.sourceCueIds)!==JSON.stringify(a.sourceCueIds)||
          String(b.evidenceQuote).trim()!==String(a.evidenceQuote).trim()||
          a.qualityScore<.9||a.independentSubtitleReview!==true)
         throw Error('V5-G decision differs from accepted reviewed global plan at cue '+(start+i+1));
     }
   }
   const verified=validateProductionDeepBatch(language,cues,await source.text(),accepted,output);
   const now=nowSeconds();
   const updated=await env.DB.prepare("UPDATE jobs SET output=?,status='done',finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='working' RETURNING id")
     .bind(JSON.stringify(verified),now,job.id,job.lease).first();
   if(!updated)fail(409,'Muse checkpoint was already accepted or re-leased');
   await logDaily(env,{jobs_completed:1});
   const progress=deepProductionProgress(cues,[...accepted,verified]);
   const next=progress.complete?(language==='english'?PERMANENT_DEEP_MATCH_UR:PERMANENT_DEEP_CUTS):job.step_id;
   const nextId=await queueTask(env,movie,next,'[PERMANENT-DEEP-MUSE] '+language+' accepted '+progress.reviewedSegments+'/'+progress.totalSegments);
   return {id:job.id,status:'done',language,acceptedSegments:verified.decisions.length,
     reviewedSegments:progress.reviewedSegments,totalSegments:progress.totalSegments,
     completedBatches:progress.batchIndex,batchCount:progress.batchCount,
     nextStep:next,nextJobId:nextId,visualVerified:false,
     pipeline:{status:'processing',nextStep:next},nextEndpoint:'/agent/next'};
 }
 if(job.step_id!==PERMANENT_DEEP_CUTS)throw Error('Unrecognized permanent Muse stage');
 const [en,ur]=await Promise.all([
  acceptedPermanentDeepBatches(env,job.project_id,PERMANENT_DEEP_MATCH_EN),
  acceptedPermanentDeepBatches(env,job.project_id,PERMANENT_DEEP_MATCH_UR)
 ]);
 const enCues=loadProductionCues(outputs.srt_english),urCues=loadProductionCues(outputs.srt_urdu);
 const checked=combineProductionDeepCuts(output.englishCuts,output.urduCuts,enCues,urCues,en,ur);
 const src=await env.FILES.get(movie.source_srt_key);
 if(!src)throw Error('Original movie subtitle asset missing');
 validateFinalCutPlan(checked.cuts,{
  sourceSrt:await src.text(),englishSrt:outputs.srt_english,
  urduSrt:outputs.srt_urdu,experimentalReview:false
 });
 const now=nowSeconds();
 const updated=await env.DB.prepare("UPDATE jobs SET output=?,status='done',finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='working' RETURNING id")
   .bind(JSON.stringify(checked),now,job.id,job.lease).first();
 if(!updated)fail(409,'Muse final cuts already accepted or re-leased');
 await logDaily(env,{jobs_completed:1});
 const nextId=await queueTask(env,movie,'windows_project','[PERMANENT-DEEP-MUSE] Accepted bilingual verified cut plan; preserve values in CinePulse V4 JSON');
 return {id:job.id,status:'done',nextStep:'windows_project',nextJobId:nextId,
  englishCuts:checked.cuts.filter(c=>c.language==='english').length,
  urduCuts:checked.cuts.filter(c=>c.language==='urdu').length,
  evidenceProvenance:checked.provenance,visualVerified:false,
  pipeline:{status:'processing',nextStep:'windows_project'},nextEndpoint:'/agent/next'};
}

async function beginTargetedUrduRematch(env,job,indices,lease){
  if(job.step_id!==PERMANENT_DEEP_CUTS||job.status!=='working')fail(409,'An active unaccepted deep_cut_plan task is required');
  if(job.lease_until<=nowSeconds()||!secureEqual(lease||'',job.lease||''))fail(409,'The current cut-plan task lease must be valid');
  const movie=await getProject(env,job.project_id),policy=await projectPolicy(env,movie.id);
  if(!policy.permanentDeep||controlIsStopped(movie)||movie.status==='ready')
    fail(409,'Only an active permanent Deep Muse movie can request a repair');
  if(!Array.isArray(indices)||indices.length<1||indices.length>16||
     !indices.every((n,i)=>Number.isInteger(n)&&n>0&&(i===0||indices[i-1]<n)))
    fail(422,'Repair indices must be 1–16 unique ascending Urdu narration segments');
  const [existing,busy,outputs]=await Promise.all([
    env.DB.prepare("SELECT id FROM jobs WHERE project_id=? AND step_id=? LIMIT 1").bind(movie.id,URDU_REPAIR_STAGE).first(),
    env.DB.prepare("SELECT id FROM jobs WHERE project_id=? AND id<>? AND status IN ('working','queued') LIMIT 1").bind(movie.id,job.id).first(),
    priorOutputs(env,movie.id)
  ]);
  if(existing||busy)fail(409,'A repair already exists, or another movie task is active');
  if(!outputs.srt_urdu||!outputs.srt_english)fail(409,'Original bilingual measured SRTs are missing');
  const cues=loadProductionCues(outputs.srt_urdu);
  if(indices.at(-1)>cues.length)fail(422,'Repair segment index beyond actual Urdu SRT');
  const accepted=await acceptedPermanentDeepBatches(env,movie.id,PERMANENT_DEEP_MATCH_UR);
  if(!deepProductionProgress(cues,accepted).complete)
    fail(409,'All original Urdu Muse decisions must be complete before targeted repair');
  const prompt=makeUrduRepairPrompt({indices,offset:0,sourceCutJobId:job.id});
  const updated=await env.DB.prepare("UPDATE jobs SET status='cancelled',error=?,finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND step_id=? AND status='working' AND lease=? RETURNING id")
    .bind('Superseded by targeted Urdu re-matching; saved outputs remain untouched',nowSeconds(),
       job.id,PERMANENT_DEEP_CUTS,lease).first();
  if(!updated)fail(409,'The original cut-plan lease was claimed or changed during repair setup');
  let nextId;
  try{nextId=await queueTask(env,movie,URDU_REPAIR_STAGE,prompt);}
  catch(err){
    await env.DB.prepare("UPDATE projects SET status='needs_review',updated_at=? WHERE id=?")
      .bind(nowSeconds(),movie.id).run();
    throw err;
  }
  return {projectId:movie.id,workerId:movie.worker_id,previousCutTaskId:job.id,
    nextJobId:nextId,nextStep:URDU_REPAIR_STAGE,indices,
    batches:Math.ceil(indices.length/URDU_REPAIR_BATCH_MAX),
    preserved:{englishCuts:true,englishSrt:true,urduSrt:true,englishMp3:true,urduMp3:true,
      originalMuseDecisions:true},visualVerified:false};
}
async function acceptTargetedUrduRepair(env,job,output){
  const plan=parseUrduRepairPrompt(job.prompt),movie=await getProject(env,job.project_id);
  if(!output||typeof output!=='object'||Array.isArray(output))throw Error('Muse targeted repair must return decisions JSON');
  const source=await env.FILES.get(movie.source_srt_key);
  if(!source)throw Error('Original movie source SRT missing');
  const outputs=await priorOutputs(env,movie.id);
  const cues=loadProductionCues(outputs.srt_urdu);
  const [accepted,done]=await Promise.all([
    acceptedPermanentDeepBatches(env,movie.id,PERMANENT_DEEP_MATCH_UR),
    acceptedUrduRepairOutputs(env,movie.id)
  ]);
  const validated=validateTargetedUrduRematch({
    sourceSrt:await source.text(),urduCues:cues,
    acceptedBatches:accepted,completedRepairs:done,plan,payload:output
  });
  const now=nowSeconds();
  const saved=await env.DB.prepare("UPDATE jobs SET status='done',output=?,finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='working' RETURNING id")
    .bind(JSON.stringify(validated),now,job.id,job.lease).first();
  if(!saved)fail(409,'Muse repair lease changed; no duplicate accepted');
  await logDaily(env,{jobs_completed:1});
  const nextOffset=plan.offset+validated.decisions.length;
  const nextStage=nextOffset<plan.indices.length?URDU_REPAIR_STAGE:PERMANENT_DEEP_CUTS;
  const prompt=nextStage===URDU_REPAIR_STAGE?
    makeUrduRepairPrompt({...plan,offset:nextOffset}):
    '[PERMANENT-DEEP-MUSE] Targeted Urdu repairs accepted; rebuild final cuts from ALL effective Muse anchors, preserve English 209 cuts and original audio, 3–6s, Urdu 25s, original cue evidence';
  const nextId=await queueTask(env,movie,nextStage,prompt);
  return {id:job.id,status:'done',repairedIndices:validated.decisions.map(d=>d.segmentIndex),
    repairedCount:nextOffset,totalRepairs:plan.indices.length,
    nextStep:nextStage,nextJobId:nextId,originalSourceCutTaskId:plan.sourceCutJobId,
    allOriginalCheckpointsPreserved:true,visualVerified:false};
}

/** Recover only an error-parked Urdu MP3 task, with no previous output rewrites. */
async function resumeControlledUrduPronunciation(env,projectId,authorizedWorkerId=null){
 const project=await getProject(env,projectId);
 if(authorizedWorkerId&&project.worker_id!==authorizedWorkerId)
   fail(403,'Cannot recover another worker\'s movie');
 if(controlIsStopped(project))fail(410,'Stopped movie cannot be requeued');
 if(project.status==='ready')fail(409,'Completed movie already has verified Windows outputs');
 const policy=await projectPolicy(env,project.id);
 if(!policy.permanentDeep||!policy.audioLanguageQa)
   fail(403,'Controlled Urdu pronunciation recovery is available only to permanent V5.4+ movies');
 const active=await env.DB.prepare("SELECT id,step_id,status FROM jobs WHERE project_id=? AND status IN ('queued','working') LIMIT 1")
   .bind(project.id).first();
 if(active)return {projectId:project.id,workerId:project.worker_id,status:'processing',
   existingJobId:active.id,existingStep:active.step_id,notice:'Existing task preserved; no duplicate or reset'};
 if(project.status!=='needs_review')fail(409,'Recovery requires needs_review; existing movie not failed at the Urdu MP3 stage');
 const latest=await env.DB.prepare("SELECT id,status,error FROM jobs WHERE project_id=? AND step_id='mp3_urdu' ORDER BY created_at DESC,rowid DESC LIMIT 1")
   .bind(project.id).first();
 if(!latest||latest.status!=='error')
   fail(409,'Only an actual failed Urdu MP3 task can be safely recovered');
 const output=await priorOutputs(env,project.id);
 if(!output.digest||!output.narration_english||!output.narration_urdu||
    !output.publishing_metadata||!output.mp3_english||!output.srt_english)
   fail(409,'Approved English, Urdu narration, and publishing checkpoints must be complete before resuming');
 if(output.mp3_urdu||output.srt_urdu)
   fail(409,'An Urdu voice or SRT was already accepted; avoid duplicate replacement');
 const [mp3,english]=await Promise.all([
  assetByKind(env,project.id,'urdu_mp3'),
  assetByKind(env,project.id,'english_mp3')
 ]);
 if(mp3)fail(409,'An Urdu MP3 asset exists: inspect and reconcile it first, never overwrite accepted/partial audio silently');
 if(!english)fail(409,'Original English MP3 physical asset is missing');
 const id=newId(),ts=nowSeconds(),prompt=URDU_DEVANAGARI_RESCUE_MARKER+
   ' Controlled Urdu TTS ONLY. Resume after failed native Urdu voice attempts; canonical Urdu narration and English accepted results unchanged.';
 // One conditional insert prevents parallel admin/worker requests from creating duplicates.
 const inserted=await env.DB.prepare("INSERT INTO jobs(id,project_id,worker_id,step_id,status,prompt,created_at) SELECT ?,?,?,?,'queued',?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND status='needs_review') AND NOT EXISTS (SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','working')) RETURNING id")
   .bind(id,project.id,project.worker_id,'mp3_urdu',prompt,ts,project.id,project.id).first();
 if(!inserted)fail(409,'Concurrent recovery already queued or changed this project: retry queue status, not task creation');
 await logDaily(env,{jobs_created:1});
 await env.DB.prepare("UPDATE projects SET status='processing',updated_at=? WHERE id=? AND status='needs_review'")
   .bind(nowSeconds(),project.id).run();
 return {projectId:project.id,workerId:project.worker_id,previousFailedTaskId:latest.id,
   nextJobId:id,nextStep:'mp3_urdu',status:'processing',voiceMethod:URDU_DEVANAGARI_METHOD,
   preserved:{digest:true,englishNarration:true,urduNarration:true,publishingMetadata:true,
      englishMp3:true,englishSrt:true,originalSourceSrt:true},
   notice:'Same project resumed at Urdu TTS only. Claim queued Urdu MP3, synthesize genuine Urdu words through Devanagari Hindi reader, then timed Urdu-script SRT. No audio was fabricated.'};
}

async function route(request,env){
  requireEnv(env);
  const url=new URL(request.url),parts=url.pathname.split('/'),method=request.method;
  if(method==='GET'&&url.pathname==='/health')return json({service:'cinepulse-android-cloud-bridge',build:LONGFORM_BUILD,status:'online',cloudOrigin:true,
    policy:{newMovies:'long_form_only',perMoviePauseStopDelete:true,experimentalSceneIntelligenceOptIn:true,experimentalWindowsAssets:11,sceneLabBuild:SCENE_LAB_BUILD,sceneLabIsolatedQueue:true,sceneLabMuseV4Export:true,productionDeepMuseBuild:PERMANENT_DEEP_BUILD,permanentDeepMuseDefault:true,v5gWorker1Only:true,v5gLegacyIntPreserved:true,v5gAcceptingNewProjects:env.CINEPULSE_V5G_DISABLED!=='true',v5gLiveStageCount:V5G_STEPS.length,v5gPreflightRequeueBuild:V5G_PREFLIGHT_REQUEUE_BUILD,reviewStageRetryBuild:REVIEW_STAGE_RETRY_BUILD,productionDeepMuseBatchSize:5,urduTargetedRematchBuild:URDU_REPAIR_BUILD,urduTargetedRematchEnabled:true,audioLanguageQualityBuild:AUDIO_QA_BUILD,audioLanguageQualityForNewProjects:true,urduTtsControlledDevanagari:true,urduPronunciationBuild:URDU_DEVANAGARI_BUILD,urduTtsLocaleRequired:'hi-IN',urduCanonicalScript:'Urdu',narrationDurationPolicy:'v5.1-strict-for-new-projects',urduAnchorWindowSeconds:25,englishAnchorWindowSeconds:12,legacySceneLabCreationRetired:true,deepMuseBuild:DEEP_BUILD,deepMuseBatches:true,deepMuseSourceEvidence:true,deepMuseCheckpoints:true,deepMuseWindowCandidateBudget:22000,shorts:false,virals:false,metadata:true,cutMinSeconds:3,cutMaxSeconds:6,serverCutAllocator:false,museOwnsCuts:true,museAuthorsWindowsProject:true,windowsAssetCount:8,
      analysisReferenceOnWindowsTask:true,museFailureDiagnostics:'exact_field_and_first_difference',
      d1WindowsAssetTable:'windows_assets',legacyAssetSchemaPreserved:true,completedJobRepair:true,validation:'narration SRT and source SRT numeric timecodes; no video frame analysis',legacyJobsPreserved:true}});
  await ensureMovieControls(env);
  if(method==='GET'&&parts[1]==='dl'&&parts.length===4)return download(request,env,parts,url);
  if(parts[1]==='w'&&parts.length>=4){
    const wid=parts[2],worker=await authWorker(request,env,wid);
    const tail='/'+parts.slice(3).join('/');
    let bfgRecovery=null;
    // CAR worker audit: existing worker token, own movie only, D1/R2 through
    // backend bindings. No Cloudflare D1 REST token or mutation authorization.
    const carWorkerParts=tail.split('/');
    const carWorkerAudit=carWorkerParts.length===5 && carWorkerParts[1]==='projects' && carWorkerParts[3]==='car' && carWorkerParts[4]==='audit' ? [tail,carWorkerParts[2]] : null;
    if(method==='GET'&&carWorkerAudit){
      const pid=requireUUID(carWorkerAudit[1]);
      const movie=await getProject(env,pid);
      if(movie.worker_id!==wid)fail(403,'This movie belongs to a different worker');
      if(!(await projectPolicy(env,pid)).permanentDeep)
        fail(403,'CAR evidence audit requires a permanent V5 Muse movie');
      const original=await env.FILES.get(movie.source_srt_key||objectKey(pid,'source_srt'));
      if(!original)fail(409,'Original movie SRT missing for CAR audit');
      const outputs=await priorOutputs(env,pid);
      const audit=await auditCarD1Evidence(env,pid,outputs,acceptedPermanentDeepBatches,await original.text());
      const unknown=audit.inventory?.unknownSegmentIds||[];
      const verified=audit.verifiedSegmentIds||[];
      const exact=verified.length>0&&verified.length<=3&&
        unknown.length===verified.length&&unknown.every(id=>verified.includes(id));
      const eligible=exact&&audit.evidenceStatus==='verified'&&
        !Number(movie.control_paused)&&!Number(movie.control_stopped);
      return json({projectId:pid,workerId:wid,projectStatus:movie.status,
        moviePaused:!!Number(movie.control_paused),movieStopped:!!Number(movie.control_stopped),
        snapshotVersion:audit.inventory?.snapshotVersion,
        sourceSrtAvailable:true,englishSegments:audit.inventory?.english?.total||0,
        urduSegments:audit.inventory?.urdu?.total||0,
        acceptedCount:audit.inventory?.acceptedSegmentIds?.length||0,
        unknownCount:unknown.length,verifiedCount:verified.length,
        verifiedTargets:verified.slice(0,3),
        evidenceStatus:audit.evidenceStatus,
        evidenceReason:audit.reason||null,candidateReady:eligible,
        reason:eligible?'verified_bounded_candidates_only':
          audit.evidenceStatus!=='verified'?'unverified_source_provenance':
          !exact?'unresolved_inventory_incomplete_or_over_limit':
          'movie_paused_or_stopped',
        readOnly:true,recoveryDispatchEnabled:false,
        recoveryResultAcceptanceEnabled:false,
        acceptedJobsUnchanged:true,resumeTriggered:false});
    }
    const urduVoiceRescue=/^\/projects\/([a-f0-9-]{36})\/audio\/urdu-devanagari\/resume$/.exec(tail);
    if(method==='POST'&&urduVoiceRescue)
      return json(await resumeControlledUrduPronunciation(env,requireUUID(urduVoiceRescue[1]),wid),201);
    if(method==='GET'&&tail==='/projects/'+BFG_PREFLIGHT_PROJECT_ID+'/grounded-preflight/recovery-diagnostic'&&wid===BFG_PREFLIGHT_WORKER_ID){
      return json(await inspectV5gPreflightRecoveryGuards(env,{
        projectId:BFG_PREFLIGHT_PROJECT_ID,workerId:wid,failedJobId:BFG_PREFLIGHT_FAILED_JOB_ID,now:nowSeconds()}));
    }
    if(method==='GET'&&['/agent/queue','/agent/next'].includes(tail)&&wid===BFG_PREFLIGHT_WORKER_ID){
      // One-shot, exactly identified BFG recovery. Do not conceal a failed
      // or skipped requeue: return safe reason codes to this worker only.
      const bfg=await env.DB.prepare("SELECT id FROM projects WHERE id=? AND worker_id=? AND status='needs_review'")
        .bind(BFG_PREFLIGHT_PROJECT_ID,wid).first();
      if(bfg){
        try{
          bfgRecovery=await resumeFailedGroundedPreflight(env,await getProject(env,BFG_PREFLIGHT_PROJECT_ID),BFG_PREFLIGHT_FAILED_JOB_ID);
        }catch(error){
          const diagnosticCode=String(error?.message||error).slice(0,280);
          console.error('BFG scoped preflight recovery failed',diagnosticCode);
          bfgRecovery={enqueued:false,reason:'recovery_exception',detail:diagnosticCode};
        }
        if(!bfgRecovery?.enqueued){
          try{
            bfgRecovery={...bfgRecovery,diagnostic:await inspectV5gPreflightRecoveryGuards(env,{
              projectId:BFG_PREFLIGHT_PROJECT_ID,workerId:wid,failedJobId:BFG_PREFLIGHT_FAILED_JOB_ID,now:nowSeconds()})};
          }catch(error){bfgRecovery={...bfgRecovery,diagnosticUnavailable:true};}
        }
      }else bfgRecovery={enqueued:false,reason:'project_not_eligible_or_worker_mismatch'};
    }
    if(method==='GET'&&['/agent/queue','/agent/next','/agent/current'].includes(tail)){
      // Requeue only expired leases; a crash cannot permanently strand this task.
      const expired=await env.DB.prepare("SELECT id FROM jobs WHERE worker_id=? AND status='working' AND lease_until<=? LIMIT 1").bind(wid,nowSeconds()).first();
      if(expired)await env.DB.prepare("UPDATE jobs SET status='queued',lease=NULL,lease_until=NULL WHERE worker_id=? AND status='working' AND lease_until<=?").bind(wid,nowSeconds()).run();
    }
    if(method==='GET'&&tail==='/agent/queue'){
      const [waiting,active]=await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS n FROM jobs j LEFT JOIN cinepulse_movie_controls c ON c.project_id=j.project_id WHERE j.worker_id=? AND j.status='queued' AND "+ELIGIBLE_MOVIE_CONTROL).bind(wid).first(),
        env.DB.prepare("SELECT * FROM jobs WHERE worker_id=? AND status='working' ORDER BY created_at LIMIT 1").bind(wid).first()
      ]);
      return json({queuedCount:waiting?.n||0,paused:!!worker.paused,activeTask:active?publicJob(active):null,notice:(waiting?.n||0)>0?'Waiting tasks available':'No waiting tasks.',nextEndpoint:'/agent/next',...(bfgRecovery?{bfgRecovery}:{})});
    }
    if(method==='GET'&&['/agent/next','/agent/current'].includes(tail)){
      let job=await env.DB.prepare("SELECT * FROM jobs WHERE worker_id=? AND status='working' AND lease_until>? ORDER BY created_at LIMIT 1").bind(wid,nowSeconds()).first();
      if(job)return json({task:await taskDetail(env,job),paused:!!worker.paused,nextEndpoint:'/agent/next',...(bfgRecovery?{bfgRecovery}:{})});
      if(worker.paused||tail==='/agent/current')return json({task:null,paused:!!worker.paused,...(bfgRecovery?{bfgRecovery}:{})});
      const time=nowSeconds(),id=newId(),expire=time+LEASE_SECONDS;
      // Atomic conditional claim; prevents two parallel Muse polls from taking the same job.
      job=await env.DB.prepare("UPDATE jobs SET status='working',lease=?,lease_until=? WHERE id=(SELECT j.id FROM jobs j LEFT JOIN cinepulse_movie_controls c ON c.project_id=j.project_id WHERE j.worker_id=? AND j.status='queued' AND "+ELIGIBLE_MOVIE_CONTROL+" ORDER BY j.created_at LIMIT 1) AND NOT EXISTS (SELECT 1 FROM jobs WHERE worker_id=? AND status='working' AND lease_until>?) RETURNING *").bind(id,expire,wid,wid,time).first();
      if(!job)return json({task:null,paused:false,notice:'No waiting tasks.',...(bfgRecovery?{bfgRecovery}:{})});
      return json({task:await taskDetail(env,job),paused:false,nextEndpoint:'/agent/next',...(bfgRecovery?{bfgRecovery}:{})});
    }
    const taskMatch=/^\/tasks\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(tail);
    if(taskMatch){
      const jid=requireUUID(taskMatch[1]),action=taskMatch[2]||'',job=await getJob(env,jid);
      if(job.worker_id!==wid)fail(403,'Cross-worker task access forbidden');
      if(controlIsStopped(await getProject(env,job.project_id)))fail(410,'Stopped movie; task lease revoked, results/uploads rejected');
      const validLease=request.headers.get('X-CinePulse-Lease')===job.lease && job.status==='working'&&job.lease_until>nowSeconds();
      if(method==='GET'&&action===''){return json({...publicJob(job),...(job.status==='done'?{output:job.output}:{}),lease:job.lease});}
      if(method==='GET'&&(action==='asset'||action.startsWith('asset/'))){
        const kind=action==='asset'?(job.step_id==='srt_english'?'english_mp3':job.step_id==='srt_urdu'?'urdu_mp3':'source_srt'):action.slice('asset/'.length);
        if(kind==='scene_index_json'){
          if(!(await projectPolicy(env,job.project_id)).experiment)fail(404,'Experimental source index unavailable');
          const file=await env.FILES.get(experimentR2Key(job.project_id,'scene-evidence-v1.json'));
          if(!file)fail(404,'Experimental source index missing');
          return new Response(file.body,{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
        }
        if(!['source_srt','english_mp3','urdu_mp3'].includes(kind))fail(404,'Asset not found');
        const row=await assetByKind(env,job.project_id,kind);if(!row)fail(404,'Asset not uploaded yet');
        const file=await env.FILES.get(row.r2_key);if(!file)fail(404,'Asset missing');
        return new Response(file.body,{headers:{'Content-Type':ASSET_TYPES[kind],'Cache-Control':'private, no-store'}});
      }
      if(method==='POST'&&action.startsWith('asset/')){
        if(!validLease)fail(409,'Valid active lease required for upload');
        const kind=action.slice('asset/'.length);
        if(kind==='scene_index_sqlite'){
          const policy=await projectPolicy(env,job.project_id);
          if(!policy.experiment||job.step_id!=='scene_intelligence')fail(403,'Only experimental scene intelligence may upload SQLite');
          if(Number(request.headers.get('content-length')||0)>12*1024*1024)fail(413,'Scene SQLite exceeds 12 MiB');
          const binary=await request.arrayBuffer();
          try{return json(await storeExperimentAsset(env,{projectId:job.project_id,kind,bytes:binary}),201);}catch(error){fail(422,String(error.message));}
        }
        if(!['english_mp3','urdu_mp3'].includes(kind))fail(400,'Only MP3 and authorized scene SQLite uploads supported');
        if((job.step_id==='mp3_english'&&kind!=='english_mp3')||(job.step_id==='mp3_urdu'&&kind!=='urdu_mp3'))fail(403,'Audio asset does not match this stage');
        if(!['mp3_english','mp3_urdu',SCENE_LAB_STAGE,DEEP_PREPARE].includes(job.step_id))fail(403,'Only authorized audio-preparation stages may upload MP3');
        return json(await uploadAudio(request,env,job.project_id,kind),201);
      }
      if(method==='POST'&&action==='heartbeat'){
        const body=await getJson(request);
        if(job.status!=='working'||!secureEqual(body.lease||'',job.lease||''))fail(409,'Lease does not match');
        await env.DB.prepare("UPDATE jobs SET lease_until=? WHERE id=? AND lease=? AND status='working'").bind(nowSeconds()+LEASE_SECONDS,jid,job.lease).run();
        return json({ok:true,leaseUntil:nowSeconds()+LEASE_SECONDS});
      }
      if(method==='POST'&&action==='request-urdu-rematch'){
        const body=await getJson(request);
        if(job.step_id!==PERMANENT_DEEP_CUTS||job.worker_id!==wid)
          fail(403,'Only current assigned Muse cut-plan task may request targeted Urdu re-matching');
        return json(await beginTargetedUrduRematch(env,job,body.indices,body.lease),201);
      }
      if(method==='POST'&&action==='result'){
        if(job.step_id===URDU_REPAIR_STAGE){
          if(job.status!=='working'||job.lease_until<=nowSeconds())
            fail(409,'Targeted Muse lease expired or not active');
          const body=await getJson(request,MAX_JSON);
          if(!secureEqual(body.lease||'',job.lease||''))
            fail(409,'Targeted Urdu Muse lease mismatch');
          if(body.error){
            const reason=requireString(String(body.error),'Unresolved targeted Urdu source scene',1100);
            const ended=await env.DB.prepare("UPDATE jobs SET status='error',error=?,finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND status='working' AND lease=? RETURNING id")
              .bind(reason,nowSeconds(),job.id,job.lease).first();
            if(!ended)fail(409,'Targeted Muse task changed during failure report');
            await env.DB.prepare("UPDATE projects SET status='needs_review',updated_at=? WHERE id=?")
              .bind(nowSeconds(),job.project_id).run();
            return json({id:job.id,status:'needs_review',reason,recoveryRoute:'/v1/projects/'+job.project_id+'/deep-muse/rematch-urdu/resume',
              originalAcceptedResultsPreserved:true});
          }
          let output=body.output;
          if(typeof output==='string'){try{output=JSON.parse(output);}catch{fail(422,'Targeted Muse output must be JSON');}}
          try{return json(await acceptTargetedUrduRepair(env,job,output),201);}
          catch(error){
            if(error instanceof HttpError)throw error;
            fail(422,'Targeted Urdu source decision rejected; repair same task: '+String(error.message||error).slice(0,1000));
          }
        }
        if(isProductionDeepStage(job.step_id)){
          const policy=await projectPolicy(env,job.project_id);
          if(!policy.permanentDeep)fail(403,'Not a permanent Muse Deep movie');
          const body=await getJson(request,MAX_JSON);
          if(job.status!=='working'||job.lease_until<=nowSeconds()||!secureEqual(body.lease||'',job.lease||''))fail(409,'Muse lease changed');
          if(body.error){
            const reason=requireString(String(body.error),'Muse unresolved scene',1200);
            const ended=await env.DB.prepare("UPDATE jobs SET status='error',error=?,finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='working' RETURNING id")
              .bind(reason,nowSeconds(),jid,job.lease).first();
            if(!ended)fail(409,'Muse task already completed');
            await env.DB.prepare("UPDATE projects SET status='needs_review',updated_at=? WHERE id=?").bind(nowSeconds(),job.project_id).run();
            return json({id:jid,status:'needs_review',reason,preservedCheckpoints:true});
          }
          let output=body.output;
          if(typeof output==='string'){try{output=JSON.parse(output);}catch{fail(422,'Muse deep JSON required');}}
          try{return json(await acceptPermanentDeepStage(env,job,output),201);}
          catch(error){
            if(error instanceof HttpError)throw error;
            const reason=String(error.message||error).slice(0,1100);
            await env.DB.prepare("UPDATE jobs SET prompt=? WHERE id=? AND lease=? AND status='working'")
              .bind('RETRY REQUIRED: '+reason,job.id,job.lease).run();
            fail(422,'Muse Deep production stage rejected; retry same lease: '+reason);
          }
        }
        if(DEEP_STAGES.includes(job.step_id)){
          const body=await getJson(request,MAX_MUSE_WINDOWS_RESULT);
          if(job.status!=='working'||job.lease_until<=nowSeconds()||!secureEqual(body.lease||'',job.lease||''))fail(409,'Deep Muse lease expired or changed');
          if(body.error){
            const reason=requireString(String(body.error),'Deep Muse task error',1200);
            const ended=await env.DB.prepare("UPDATE jobs SET status='error',error=?,finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='working' RETURNING id")
              .bind(reason,nowSeconds(),jid,job.lease).first();
            if(!ended)fail(409,'Deep Muse task was re-claimed');
            await env.DB.batch([
              env.DB.prepare("UPDATE cinepulse_scene_lab_deep SET status='needs_review',updated_at=? WHERE project_id=?").bind(nowSeconds(),job.project_id),
              env.DB.prepare("UPDATE projects SET status='needs_review',updated_at=? WHERE id=?").bind(nowSeconds(),job.project_id)
            ]);
            return json({id:jid,status:'needs_review',reason,notice:'Accepted checkpoints preserved; administrator can resume this experiment.'});
          }
          let output=body.output;
          if(typeof output==='string'){try{output=JSON.parse(output);}catch{fail(422,'Deep Muse result must contain a JSON object');}}
          try{return json(await acceptDeepMuseResult(env,job,output),201);}
          catch(error){
            if(error instanceof HttpError)throw error;
            const detail=String(error.message||error).slice(0,1100);
            await env.DB.prepare("UPDATE jobs SET prompt=? WHERE id=? AND lease=? AND status='working'")
              .bind('RETRY REQUIRED: '+detail,job.id,job.lease).run();
            fail(422,'Deep Muse checkpoint rejected; repair and resubmit: '+detail);
          }
        }
        if(job.step_id===SCENE_LAB_STAGE){
          const body=await getJson(request,MAX_MUSE_WINDOWS_RESULT);
          if(job.status!=='working'||job.lease_until<=nowSeconds()||!secureEqual(body.lease||'',job.lease||''))fail(409,'Scene Lab lease expired or changed');
          if(body.error){
            const why=requireString(String(body.error),'Scene Lab error',1200);
            await env.DB.prepare("UPDATE jobs SET status='error',error=?,finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='working'").bind(why,nowSeconds(),jid,job.lease).run();
            await env.DB.prepare("UPDATE cinepulse_scene_lab SET status='needs_review',updated_at=? WHERE project_id=?").bind(nowSeconds(),job.project_id).run();
            await env.DB.prepare("UPDATE projects SET status='needs_review',updated_at=? WHERE id=?").bind(nowSeconds(),job.project_id).run();
            return json({id:jid,status:'error',reason:why});
          }
          return json(await acceptSceneLabResult(env,job,body.output),201);
        }
        const policy=await projectPolicy(env,job.project_id);
        const limit=policy.museOwnsCuts&&job.step_id==='windows_project'?MAX_MUSE_WINDOWS_RESULT:MAX_JSON;
        const body=await getJson(request,limit);
        if(job.status!=='working'||job.lease_until<=nowSeconds()||!secureEqual(body.lease||'',job.lease||''))fail(409,'Task lease expired or changed');
        if(body.error){
          const reason=requireString(String(body.error),'Muse failure reason',1200);
          const completed=await env.DB.prepare("UPDATE jobs SET status='error',error=?,finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='working' RETURNING id").bind(reason,nowSeconds(),jid,job.lease).first();
          if(!completed)fail(409,'Lease changed before error report');
          await env.DB.prepare("UPDATE projects SET status='needs_review',updated_at=? WHERE id=?").bind(nowSeconds(),job.project_id).run();
          return json({id:jid,status:'error',pipeline:{status:'needs_review'},reason,notice:'Task reported failure and processing stopped safely. No fake MP3/SRT generated.'});
        }
        let output=typeof body.output==='string'?body.output:JSON.stringify(body.output??'');
        if(!output.trim()||output.length>limit)fail(422,'Nonempty task output required within stage size limit');
        if([V5G_EVIDENCE,V5G_PREFLIGHT,V5G_MATCH_PLAN].includes(job.step_id)){
          const policy=await projectPolicy(env,job.project_id);
          if(!policy.grounded)fail(403,'V5-G checkpoint is not part of this movie workflow');
          const parent=await getProject(env,job.project_id);
          const original=await env.FILES.get(parent.source_srt_key);
          if(!original)fail(409,'Original source SRT required for V5-G validation');
          const sourceSrt=await original.text();
          const outputs=await priorOutputs(env,job.project_id);
          try{
            let checked;
            if(job.step_id===V5G_EVIDENCE)
              checked=validateV5gEvidence(sourceSrt,output);
            else if(job.step_id===V5G_PREFLIGHT){
              if(!outputs[V5G_EVIDENCE])fail(409,'Accepted V5-G evidence stage missing');
              checked=validateV5gPreTts({
                sourceSrt,evidence:JSON.parse(outputs[V5G_EVIDENCE]),
                englishScript:extractV5gNarrationText(outputs.narration_english,'english'),
                urduScript:extractV5gNarrationText(outputs.narration_urdu,'urdu'),input:output
              });
            }else{
              if(!outputs[V5G_PREFLIGHT]||!outputs.srt_english||!outputs.srt_urdu)
                fail(409,'Accepted V5-G pre-TTS checkpoint and both real measured SRTs required');
              checked=validateV5gGlobalPlan({
                sourceSrt,englishSrt:outputs.srt_english,urduSrt:outputs.srt_urdu,
                preflight:JSON.parse(outputs[V5G_PREFLIGHT]),evidence:JSON.parse(outputs[V5G_EVIDENCE]||'null'),input:output
              });
            }
            output=JSON.stringify(checked);
            if(output.length>limit)fail(413,'V5-G reviewed evidence checkpoint exceeds stage size limit');
          }catch(error){
            if(error instanceof HttpError)throw error;
            fail(422,'V5-G checkpoint rejected before durable acceptance: '+String(error.message||error).slice(0,900));
          }
        }
        if(job.step_id==='mp3_english'&&!await assetByKind(env,job.project_id,'english_mp3'))fail(409,'Real English MP3 upload required');
        if(job.step_id==='mp3_urdu'&&!await assetByKind(env,job.project_id,'urdu_mp3'))fail(409,'Real Urdu MP3 upload required');
        if(['narration_english','narration_urdu'].includes(job.step_id)){
          const pp=await projectPolicy(env,job.project_id);
          const language=job.step_id==='narration_english'?'english':'urdu';
          if(pp.strictNarrationDuration){
            try{validateNarrationScriptCap(output,language,pp.targetMinutes);}
            catch(error){fail(422,'Strict new-movie narration duration: '+error.message);}
          }
          if(pp.audioLanguageQa){
            try{validateNarrationContent(output,language);}
            catch(error){fail(422,'New-movie narration anti-repeat / Urdu QA: '+error.message);}
          }
        }
        if(job.step_id==='mp3_urdu'){
          const pp=await projectPolicy(env,job.project_id);
          if(pp.audioLanguageQa){
            const controlled=pp.urduDevanagariVoice||String(job.prompt||'').includes(URDU_DEVANAGARI_RESCUE_MARKER);
            if(controlled){
              const source=(await priorOutputs(env,job.project_id)).narration_urdu;
              if(!source)fail(409,'Approved original Urdu narration is missing');
              try{
                const digest=await sha256(new TextEncoder().encode(source));
                validateDevanagariUrduVoiceReceipt(output,source,digest);
              }catch(error){fail(422,'Controlled Urdu-in-Devanagari TTS input rejected: '+error.message);}
            }else{
              try{validateUrduVoiceReceipt(output);}
              catch(error){fail(422,'Original native Pakistani Urdu TTS provenance: '+error.message);}
            }
          }
        }
        if(['srt_english','srt_urdu'].includes(job.step_id)){
          normalizeSrt(output);
          const pp=await projectPolicy(env,job.project_id);
          const language=job.step_id==='srt_english'?'english':'urdu';
          if(pp.strictNarrationDuration){
            try{validateMeasuredDurationCap(output,language,pp.targetMinutes);}
            catch(error){fail(422,'Strict new-movie measured audio duration: '+error.message);}
          }
          if(pp.audioLanguageQa){
            const approved=(await priorOutputs(env,job.project_id))['narration_'+language];
            try{validateMeasuredSubtitleQuality(output,language,approved);}
            catch(error){fail(422,'New-movie measured transcription quality: '+error.message);}
          }
        }
        if(job.step_id==='scene_intelligence'){
          const policy=await projectPolicy(env,job.project_id);
          if(!policy.experiment)fail(403,'Scene intelligence is experimental only');
          if(!(await assetByKind(env,job.project_id,'scene_index_sqlite')))fail(409,'Upload a real Scene_Intelligence.sqlite before completion');
          try{validateSceneIntelligenceOutput(output);}catch(error){fail(422,'Scene intelligence rejected: '+String(error.message));}
        }
        // Keep Muse's lease and previous work intact when Muse submits an
        // incorrect calculation. Feed exact validation errors back into its
        // next task poll, so only Muse repairs the proposed edit decisions.
        try {
        // Stage-specific structural checks BEFORE accepting the job result.
        if(job.step_id==='viral_metadata'){
          let m;try{m=JSON.parse(output);}catch{fail(422,'Legacy metadata must be valid JSON');}
          if(!Array.isArray(m.viralScenes)||!m.metadata)fail(422,'Legacy stage requires viralScenes array and metadata');
        }
        if(job.step_id==='publishing_metadata'){
          let m;try{m=JSON.parse(output);}catch{fail(422,'Publishing metadata must be valid JSON');}
          try{normalizePublishingMetadata(m);}catch(error){fail(422,error.message);}
        }
        if(job.step_id==='scene_matching'){
          const policy=await projectPolicy(env,job.project_id);
          if(policy.serverCuts||policy.museOwnsCuts){
            let scene;try{scene=JSON.parse(output);}catch{fail(422,'Muse scene matching must return valid JSON');}
            const matches=Array.isArray(scene)?scene:scene?.matches;
            if(!Array.isArray(matches)||matches.length===0||matches.length>2000)
              fail(422,'Muse must provide a nonempty array of movie scene references');
            // Stronger quality gate: both languages need at least one source/narration
            // reference. Cloudflare may expand beyond these hints without overlaps.
            for(const language of ['english','urdu']){
              const found=matches.some(c=>c?.language===language &&
                Number.isFinite(c.sourceStartSeconds)&&Number.isFinite(c.sourceEndSeconds)&&
                c.sourceStartSeconds>=0&&c.sourceEndSeconds>c.sourceStartSeconds &&
                Number.isFinite(c.narrationStartSeconds)&&Number.isFinite(c.narrationEndSeconds)&&
                c.narrationStartSeconds>=0&&c.narrationEndSeconds>c.narrationStartSeconds);
              if(!found)fail(422,'Muse must submit timed source/narration scene references for '+language+' before Cloudflare can finalize cuts');
            }
          }
        }
        if(job.step_id==='cut_plan'){
          let cuts;try{cuts=JSON.parse(output);}catch{fail(422,'Cut plan must be valid JSON');}
          const policy=await projectPolicy(env,job.project_id);
          if(policy.longForm){
            const outputs=await priorOutputs(env,job.project_id);
            const original=await env.FILES.get((await getProject(env,job.project_id)).source_srt_key);
            if(!original)fail(409,'Movie source SRT missing');
            try{validateFinalCutPlan(cuts,{
              sourceSrt:await original.text(),englishSrt:outputs.srt_english,urduSrt:outputs.srt_urdu,
              experimentalReview:policy.experiment
            });}catch(error){fail(422,'Final timestamp checks failed: '+error.message);}
          }else if(!Array.isArray(cuts)||!cuts.length||cuts.some(c=>!Number.isFinite(c.sourceStartSeconds)||!Number.isFinite(c.sourceEndSeconds)||c.sourceEndSeconds<=c.sourceStartSeconds))
            fail(422,'Legacy cut plan source timestamps invalid');
        }
        if(job.step_id==='windows_project'){
          const policy=await projectPolicy(env,job.project_id);
          if(policy.museOwnsCuts){
            let produced;
            try{produced=JSON.parse(output);}catch{fail(422,'Muse Windows project must be valid JSON');}
            const old=await priorOutputs(env,job.project_id);
            const movie=await getProject(env,job.project_id);
            const source=await env.FILES.get(movie.source_srt_key);
            const [en,ur]=await Promise.all(['english_mp3','urdu_mp3'].map(k=>assetByKind(env,job.project_id,k)));
            if(!source||!en||!ur)fail(409,'Source SRT or verified English/Urdu MP3 unavailable');
            try{
              const metadata=normalizePublishingMetadata(JSON.parse(old.publishing_metadata));
              verifyMuseWindowsProject(produced,{
                projectId:movie.id,title:movie.title,sourceSrt:await source.text(),
                narrations:{english:old.narration_english,urdu:old.narration_urdu},
                narrationSrts:{english:old.srt_english,urdu:old.srt_urdu},
                digest:old.digest,cutPlan:JSON.parse(old.cut_plan),metadata,
                experimentalReview:policy.experiment,
                mp3Manifest:{
                  english:{filename:fileNames.english_mp3,bytes:en.bytes,sha256:en.sha256},
                  urdu:{filename:fileNames.urdu_mp3,bytes:ur.bytes,sha256:ur.sha256}
                }
              });
            }catch(error){fail(422,'Muse Windows project rejected; correct and resubmit within task lease: '+error.message);}
          }
        }
        }catch(error){
          const policy=await projectPolicy(env,job.project_id);
          if(policy.museOwnsCuts && [422].includes(error?.status) &&
             ['scene_intelligence','scene_matching','cut_plan','windows_project',V5G_EVIDENCE,V5G_PREFLIGHT,V5G_MATCH_PLAN].includes(job.step_id)){
            const feedback='RETRY REQUIRED: '+String(error.message||'Invalid Muse output').slice(0,1200)+
              '\nRecalculate and resubmit the full corrected result. Do not ask Cloudflare or Android to invent edits.';
            await env.DB.prepare("UPDATE jobs SET prompt=? WHERE id=? AND lease=? AND status='working'")
              .bind(feedback,jid,job.lease).run();
          }
          throw error;
        }
        const time=nowSeconds();
        const updated=await env.DB.prepare("UPDATE jobs SET output=?,status='done',finished_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='working' RETURNING id").bind(output,time,jid,job.lease).first();
        if(!updated)fail(409,'Task was already completed or re-claimed');
        await logDaily(env,{jobs_completed:1});
        await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(nowSeconds(),job.project_id).run();
        const next=await advancePipeline(env,job);
        return json({id:jid,status:'done',pipeline:next,nextEndpoint:'/agent/next'});
      }
    }
    fail(404,'Unknown worker route');
  }
  if(!url.pathname.startsWith('/v1/'))fail(404,'Route not found');
  await administrator(request,env);

  // CAR v1.1 administrator-only dispatch readiness inspection.
  // Explicitly read-only: no claim, outbox, production job or movie mutation.
  const carDispatchReadinessRoute=url.pathname.split('/').length===6 && url.pathname.split('/')[1]==='v1' && url.pathname.split('/')[2]==='projects' && url.pathname.split('/')[4]==='car' && url.pathname.split('/')[5]==='dispatch-readiness' ? [url.pathname,url.pathname.split('/')[3]] : null;
  if(method==='GET'&&carDispatchReadinessRoute&&url.pathname===carDispatchReadinessRoute[0]){
    const projectId=requireUUID(carDispatchReadinessRoute[1]);
    if(env.CAR_V1_1_ENABLED!=='true')fail(403,'CAR recovery is disabled');
    const project=await getProject(env,projectId);
    const policy=await projectPolicy(env,projectId);
    if(!policy.permanentDeep)fail(403,'CAR dispatch requires a V5 permanent Muse project');
    const controls=await inspectCarMovieDispatchControls(env,{projectId});
    return json({...controls,projectStatus:project.status,readOnly:true,
      enqueueAllowed:false,resumeTriggered:false});
  }

  // Read-only, administrator-authenticated CAR coverage diagnostic.
  // No stage is resumed and no D1/R2 record is modified by this endpoint.
  const carInventoryRoute=/^\/v1\/projects\/([a-f0-9-]{36})\/car\/inventory$/.exec(url.pathname);
  if(method==='GET'&&carInventoryRoute){
    const projectId=requireUUID(carInventoryRoute[1]);
    await getProject(env,projectId);
    const policy=await projectPolicy(env,projectId);
    if(!policy.permanentDeep)fail(403,'CAR D1 inventory requires a V5 permanent Muse project');
    const outputs=await priorOutputs(env,projectId);
    return json({projectId,...await collectCarD1Inventory(env,projectId,outputs,acceptedPermanentDeepBatches)});
  }

  // Administrator-only, read-only operational CAR audit. This route does not
  // advance, lease, pause or alter any normal movie job.
  const carAuditRoute=/^\/v1\/projects\/([a-f0-9-]{36})\/car\/audit$/.exec(url.pathname);
  if(method==='GET'&&carAuditRoute){
    const projectId=requireUUID(carAuditRoute[1]);
    const project=await getProject(env,projectId);
    const policy=await projectPolicy(env,projectId);
    if(!policy.permanentDeep)fail(403,'CAR audit requires a V5 permanent Muse project');
    const original=await env.FILES.get(project.source_srt_key||objectKey(projectId,'source_srt'));
    if(!original)fail(409,'Original movie source SRT unavailable for CAR audit');
    const sourceSrt=await original.text();
    const outputs=await priorOutputs(env,projectId);
    const audit=await auditCarD1Evidence(env,projectId,outputs,acceptedPermanentDeepBatches,sourceSrt);
    const target=url.searchParams.get('target');
    // Read the isolated checkpoint ledger only after the live evidence audit.
    // Existing accepted V5 decisions remain authoritative; no auto-resume.
    const checkpoints=env.CAR_V1_1_ENABLED==='true'
      ?await (async()=>{await ensureCarRecoveryLedger(env);return loadScopedCarRecoveryCheckpoints(env,projectId)})()
      :[];
    const readiness=inspectScopedCarRecoveryReadiness({audit,checkpoints,sourceSrt});
    const plan=buildScopedCarRecoveryHandoff({projectId,readiness,checkpoints});
    const handoff=plan.authorized?{...plan,stateFingerprint:await readCarD1Fingerprint(
      env,projectId,audit,checkpoints,sourceSrt,outputs)}:plan;
    return json({...audit,checkpoints,readiness,handoff,
      candidate:target?inspectCarRecoveryCandidate(audit,target):null,
      resumeTriggered:false,acceptedCheckpointsUnchanged:true});
  }

  // Read-only live D1 preflight. An administrator submits the previously
  // audited handoff; the server re-queries source evidence and all deep-match
  // job states before comparing its accepted-state SHA-256 fingerprint.
  // This is NOT atomic with a future enqueue and never resumes a movie.
  const carPreflightRoute=/^\/v1\/projects\/([a-f0-9-]{36})\/car\/preflight$/.exec(url.pathname);
  if(method==='POST'&&carPreflightRoute){
    if(env.CAR_V1_1_ENABLED!=='true')fail(403,'CAR recovery is disabled');
    const projectId=requireUUID(carPreflightRoute[1]);
    const body=await getJson(request);
    const handoff=body?.handoff;
    if(handoff?.projectId!==projectId||handoff?.authorized!==true)
      fail(422,'A project-matched audited CAR handoff is required');
    const project=await getProject(env,projectId);
    const policy=await projectPolicy(env,projectId);
    if(!policy.permanentDeep)fail(403,'CAR preflight requires a V5 permanent Muse project');
    const original=await env.FILES.get(project.source_srt_key||objectKey(projectId,'source_srt'));
    if(!original)fail(409,'Original movie source SRT unavailable');
    const sourceSrt=await original.text();
    const outputs=await priorOutputs(env,projectId);
    const audit=await auditCarD1Evidence(env,projectId,outputs,acceptedPermanentDeepBatches,sourceSrt);
    // No CREATE TABLE here: an absent ledger is a failure, not permission
    // to mutate D1 as part of a read-only preflight.
    const checkpoints=await loadScopedCarRecoveryCheckpoints(env,projectId);
    const freshFingerprint=await readCarD1Fingerprint(env,projectId,audit,checkpoints,sourceSrt,outputs);
    const proof=verifyFreshCarD1Snapshot({
      projectId,handoff,audit,checkpoints,sourceSrt,freshFingerprint
    });
    return json({...proof,readOnly:true,productionValidated:false,
      enqueueAllowed:false,resumeTriggered:false});
  }

  // CAR-only, administrator-authenticated checkpoint submission. Never mutates
  // accepted V5 batches, jobs, project state or the normal movie queue.
  const carCheckpointRoute=/^\/v1\/projects\/([a-f0-9-]{36})\/car\/checkpoint/.exec(url.pathname);
  if(method==='POST'&&carCheckpointRoute&&url.pathname===carCheckpointRoute[0]){
    if(env.CAR_V1_1_ENABLED!=='true')fail(403,'CAR recovery is disabled');
    const projectId=requireUUID(carCheckpointRoute[1]);
    const project=await getProject(env,projectId);
    const policy=await projectPolicy(env,projectId);
    if(!policy.permanentDeep)fail(403,'CAR requires a V5 permanent Muse project');
    const body=await getJson(request);
    const targetId=body?.targetId,decision=body?.decision;
    if(typeof targetId!=='string'||! /^(english|urdu):[1-9][0-9]*$/.test(targetId))
      fail(422,'CAR targetId must be an English or Urdu segment');
    const original=await env.FILES.get(project.source_srt_key||objectKey(projectId,'source_srt'));
    if(!original)fail(409,'Original movie source SRT unavailable');
    const sourceSrt=await original.text();
    const outputs=await priorOutputs(env,projectId);
    const audit=await auditCarD1Evidence(env,projectId,outputs,acceptedPermanentDeepBatches,sourceSrt);
    const candidate=inspectCarRecoveryCandidate(audit,targetId);
    if(!candidate.eligible)fail(409,'CAR target denied: '+candidate.reason);
    await ensureCarRecoveryLedger(env);
    const result=await insertScopedCarRecoveryCheckpoint(env,{
      projectId,targetId,audit,decision,sourceSrt,enabled:true
    });
    if(!result.saved)fail(409,'CAR checkpoint denied: '+result.reason);
    return json({projectId,targetId,status:'checkpoint_saved',resumeTriggered:false,
      normalPipelineUnchanged:true,mutationScope:result.mutationScope},201);
  }

  if(method==='GET'&&url.pathname==='/v1/scene-lab/deep'){
    await ensureDeepTables(env);
    const rows=await env.DB.prepare("SELECT project_id,parent_project_id,worker_id,strategy,status,segment_count,batch_count,current_batch,created_at FROM cinepulse_scene_lab_deep ORDER BY created_at DESC LIMIT 100").all();
    return json({deepMuseBuild:DEEP_BUILD,projects:rows.results||[]});
  }
  if(method==='POST'&&url.pathname==='/v1/scene-lab/deep'){
    fail(410,'Deep Scene Lab pilot creation retired: new films now use the permanent bilingual Muse V5 pipeline. Existing pilot remains downloadable.');
    const body=await getJson(request,MAX_MUSE_WINDOWS_RESULT);
    let parsed;try{parsed=normalizeDeepCreate(body);}catch(error){fail(422,'Deep Muse creation refused: '+error.message);}
    const worker=await env.DB.prepare('SELECT id,label,enabled,paused FROM workers WHERE id=? AND enabled=1').bind(parsed.workerId).first();
    if(!worker||String(worker.label||'').toLowerCase()!=='int')fail(403,'Deep Muse mode is restricted to the existing enabled INT worker');
    await ensureDeepTables(env);
    const previous=await env.DB.prepare('SELECT project_id,status FROM cinepulse_scene_lab_deep WHERE request_id=?').bind(parsed.requestId).first();
    if(previous)return json({deepMuseBuild:DEEP_BUILD,projectId:previous.project_id,status:previous.status,
      alreadyExists:true,notice:'Idempotent request: original experiment preserved; no duplicate queued.'});
    const src=new TextEncoder().encode(parsed.sourceSrt),hash=await sha256(src);
    if(hash.toLowerCase()!==String(body.sourceSrtSha256).toLowerCase())fail(422,'Original movie source SRT SHA256 mismatch');
    const id=newId(),jid=newId(),time=nowSeconds(),key=objectKey(id,'source_srt');
    const title='Scene Lab Deep Muse — '+parsed.manifest.strategy+' — '+parsed.parentProjectId.slice(0,8);
    await ensureSceneLab(env);
    await env.FILES.put(key,src,{httpMetadata:{contentType:'application/x-subrip'}});
    try{
      await env.DB.batch([
        env.DB.prepare("INSERT INTO projects(id,worker_id,title,status,created_at,updated_at,retention_hours,source_srt_key) VALUES(?,?,?,'processing',?,?,?,?)")
          .bind(id,parsed.workerId,title,time,time,48,key),
        env.DB.prepare("INSERT INTO assets(project_id,kind,r2_key,bytes,sha256,created_at) VALUES(?,'source_srt',?,?,?,?)")
          .bind(id,key,src.byteLength,hash,time),
        env.DB.prepare("INSERT INTO jobs(id,project_id,worker_id,step_id,status,prompt,created_at) VALUES(?,?,?,?,'queued',?,?)")
          .bind(jid,id,parsed.workerId,DEEP_PREPARE,'[DEEP-MUSE-ASSET-PREPARE]',time),
        env.DB.prepare("INSERT INTO cinepulse_scene_lab(project_id,parent_project_id,worker_id,strategy,manifest_json,job_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'queued',?,?)")
          .bind(id,parsed.parentProjectId,parsed.workerId,parsed.manifest.strategy,JSON.stringify(parsed.manifest),jid,time,time),
        env.DB.prepare("INSERT INTO cinepulse_scene_lab_deep(project_id,request_id,parent_project_id,worker_id,strategy,manifest_json,english_cues_json,urdu_srt,urdu_cuts_json,narrations_json,baseline_project_json,expected_mp3s_json,segment_count,batch_count,current_batch,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'preparing',?,?)")
          .bind(id,parsed.requestId,parsed.parentProjectId,parsed.workerId,parsed.manifest.strategy,
             JSON.stringify(parsed.manifest),JSON.stringify(parsed.englishCues),
             parsed.urduSrt,JSON.stringify(parsed.urduCuts),JSON.stringify(parsed.narrations),
             JSON.stringify(parsed.baselineProject),JSON.stringify(parsed.expectedMp3s),
             parsed.segmentCount,parsed.batchCount,time,time)
      ]);
    }catch(error){await env.FILES.delete(key);throw error;}
    await logDaily(env,{projects_created:1,jobs_created:1,uploaded_bytes:src.byteLength});
    return json({deepMuseBuild:DEEP_BUILD,projectId:id,prepareJobId:jid,workerId:parsed.workerId,
     parentProjectId:parsed.parentProjectId,segmentCount:parsed.segmentCount,
     batchCount:parsed.batchCount,status:'preparing',queued:true,visualVerified:false,
     notice:'Muse will first verify reused MP3s, then execute independent five-segment semantic batches.'},201);
  }
  const deepMatch=/^\/v1\/scene-lab\/deep\/([a-f0-9-]{36})(?:\/(resume))?$/.exec(url.pathname);
  if(deepMatch){
    const pid=requireUUID(deepMatch[1]),run=await deepRow(env,pid);
    if(!run)fail(404,'Deep Muse experiment not found');
    if(method==='GET'&&!deepMatch[2])return json(await deepProgressSnapshot(env,run));
    if(method==='POST'&&deepMatch[2]==='resume'){
      if(run.status==='ready')return json({projectId:pid,status:'ready',message:'Already completed; no retry necessary'});
      if(controlIsStopped(await getProject(env,pid)))fail(410,'Stopped Deep Muse project cannot resume');
      // Expired active leases are the existing worker protocol's responsibility.
      const busy=await env.DB.prepare("SELECT id,step_id,status,lease_until FROM jobs WHERE project_id=? AND step_id IN (?,?,?) AND status IN ('queued','working') ORDER BY created_at DESC LIMIT 1")
        .bind(pid,DEEP_PREPARE,DEEP_MATCH,DEEP_EXPORT).first();
      if(busy)return json({projectId:pid,status:'processing',jobId:busy.id,
        notice:'Existing queued or leased Muse job preserved; no duplicate submitted'});
      const prep=await env.DB.prepare("SELECT id FROM jobs WHERE project_id=? AND step_id=? AND status='done' LIMIT 1")
        .bind(pid,DEEP_PREPARE).first();
      await env.DB.prepare("UPDATE projects SET status='processing',updated_at=? WHERE id=?")
        .bind(nowSeconds(),pid).run();
      let nextId,nextStep;
      if(!prep){
        nextStep=DEEP_PREPARE;
        nextId=await queueTask(env,await getProject(env,pid),DEEP_PREPARE,'[DEEP-MUSE-RETRY-PREPARE]');
      }else{
        const accepted=await deepOutputs(env,pid);
        const index=accepted.length;
        if(index<run.batch_count){nextStep=DEEP_MATCH;nextId=await queueDeepMuseBatch(env,run,index);}
        else{nextStep=DEEP_EXPORT;nextId=await queueDeepMuseExport(env,run);}
      }
      await env.DB.prepare("UPDATE cinepulse_scene_lab_deep SET status=?,updated_at=? WHERE project_id=?")
        .bind(nextStep===DEEP_PREPARE?'preparing':'matching',nowSeconds(),pid).run();
      return json({projectId:pid,status:'processing',nextStep,nextJobId:nextId,
        recoveredCheckpoints:true,notice:'Resume queued only the missing or failed stage.'},201);
    }
  }
  if(method==='GET'&&url.pathname==='/v1/scene-lab'){
    await ensureSceneLab(env);
    const result=await env.DB.prepare('SELECT project_id,parent_project_id,worker_id,strategy,status,created_at,updated_at FROM cinepulse_scene_lab ORDER BY created_at DESC LIMIT 100').all();
    return json({sceneLabBuild:SCENE_LAB_BUILD,experiments:result.results||[]});
  }
  if(method==='POST'&&url.pathname==='/v1/scene-lab'){
    fail(410,'Fast Scene Lab experiments retired for new submissions. Use the permanent Muse V5 movie pipeline. Existing experiments remain downloadable.');
    const raw=await getJson(request);
    let lab;try{lab=normalizeSceneLabCreate(raw);}catch(error){fail(422,error.message);}
    const worker=await env.DB.prepare('SELECT id FROM workers WHERE id=? AND enabled=1').bind(raw.workerId).first();
    if(!worker)fail(404,'INT worker not found or disabled');
    const id=newId(),jid=newId(),time=nowSeconds();
    const key=objectKey(id,'source_srt'),bytes=new TextEncoder().encode(lab.sourceSrt),hash=await sha256(bytes);
    const title='Scene Lab — '+lab.manifest.strategy+' — '+raw.parentProjectId.slice(0,8);
    await ensureSceneLab(env);
    await env.FILES.put(key,bytes,{httpMetadata:{contentType:'application/x-subrip'}});
    try{
      await env.DB.batch([
        env.DB.prepare("INSERT INTO projects(id,worker_id,title,status,created_at,updated_at,retention_hours,source_srt_key) VALUES(?,?,?,'processing',?,?,?,?)").bind(id,raw.workerId,title,time,time,48,key),
        env.DB.prepare("INSERT INTO assets(project_id,kind,r2_key,bytes,sha256,created_at) VALUES(?,'source_srt',?,?,?,?)").bind(id,key,bytes.byteLength,hash,time),
        env.DB.prepare("INSERT INTO jobs(id,project_id,worker_id,step_id,status,prompt,created_at) VALUES(?,?,?,?,'queued',?,?)").bind(jid,id,raw.workerId,SCENE_LAB_STAGE,'[SCENE-LAB-ISOLATED-V1] '+JSON.stringify(lab.manifest),time),
        env.DB.prepare("INSERT INTO cinepulse_scene_lab(project_id,parent_project_id,worker_id,strategy,manifest_json,job_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'queued',?,?)").bind(id,raw.parentProjectId,raw.workerId,raw.strategy,JSON.stringify(lab.manifest),jid,time,time)
      ]);
    }catch(error){await env.FILES.delete(key);throw error;}
    await logDaily(env,{projects_created:1,jobs_created:1,uploaded_bytes:bytes.byteLength});
    return json({sceneLabBuild:SCENE_LAB_BUILD,projectId:id,jobId:jid,workerId:raw.workerId,parentProjectId:raw.parentProjectId,strategy:raw.strategy,status:'queued',notice:'Isolated Scene Lab task queued; original project has not been changed.'},201);
  }
  let labMatch=/^\/v1\/scene-lab\/([a-f0-9-]{36})(?:\/(downloads))?$/.exec(url.pathname);
  if(labMatch&&method==='GET'){
    const row=await sceneLabRow(env,requireUUID(labMatch[1]));
    if(!row)fail(404,'Scene Lab experiment not found');
    const project=await getProject(env,row.project_id);
    if(labMatch[2]==='downloads'){
      const downloadUrl=new URL(request.url);
      downloadUrl.searchParams.set('format','windows');
      return json(await signedLinks(env,{url:downloadUrl.toString()},project));
    }
    return json({sceneLabBuild:SCENE_LAB_BUILD,projectId:row.project_id,parentProjectId:row.parent_project_id,strategy:row.strategy,status:row.status,manifest:JSON.parse(row.manifest_json)});
  }
  if(method==='GET'&&url.pathname==='/v1/workers'){
    const rows=await env.DB.prepare('SELECT * FROM workers ORDER BY created_at DESC LIMIT 250').all();
    return json({workers:(rows.results||[]).map(worker=>{
      const route=classifyV5gWorker(worker.label,{disabled:env.CINEPULSE_V5G_DISABLED==='true'});
      return {...publicWorker(worker),newMovieProductionMode:route.productionMode,
        newMovieRoutingStatus:route.kind};
    })});
  }
  if(method==='POST'&&url.pathname==='/v1/workers'){
    const body=await getJson(request),id=newId(),secret=randomToken(),label=requireString(body.label||body.movieTitle||'Movie worker','label');
    const time=nowSeconds();
    await env.DB.prepare('INSERT INTO workers(id,label,token_hash,movie_title,created_at) VALUES(?,?,?,?,?)').bind(id,label,await hashWorkerToken(secret),label,time).run();
    return json({worker:{id,label},token:secret,endpoint:`/w/${id}`,note:'Token shown only once. Do not include worker or administrator tokens in project exports.'},201);
  }
  let match=/^\/v1\/workers\/([a-f0-9-]{36})\/(pause|resume)$/.exec(url.pathname);
  if(match&&method==='POST'){
    const id=requireUUID(match[1]),value=match[2]==='pause'?1:0;
    const found=await env.DB.prepare('UPDATE workers SET paused=? WHERE id=? RETURNING id').bind(value,id).first();
    if(!found)fail(404,'Worker not found');return json({id,paused:!!value});
  }
  match=/^\/v1\/workers\/([a-f0-9-]{36})$/.exec(url.pathname);
  if(match&&method==='DELETE'){
    const id=requireUUID(match[1]);const attached=await env.DB.prepare('SELECT id FROM projects WHERE worker_id=? LIMIT 1').bind(id).first();
    if(attached)fail(409,'Delete or transfer all worker projects before deleting this worker');
    await env.DB.prepare('DELETE FROM workers WHERE id=?').bind(id).run();return json({deleted:true,id});
  }
  if(method==='GET'&&url.pathname==='/v1/jobs'){
    const wid=url.searchParams.get('workerId');
    const query=wid ? env.DB.prepare('SELECT * FROM jobs WHERE worker_id=? ORDER BY created_at DESC LIMIT 500').bind(requireUUID(wid)) : env.DB.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 500');
    const rows=await query.all();return json({jobs:(rows.results||[]).map(publicJob),note:'Paginated history is limited to the latest 500 jobs.'});
  }
  const jobRoute=/^\/v1\/jobs\/([a-f0-9-]{36})(?:\/(cancel))?$/.exec(url.pathname);
  if(jobRoute){
    const jid=requireUUID(jobRoute[1]),action=jobRoute[2]||'',job=await getJob(env,jid);
    if(method==='POST'&&action==='cancel'){
      if(job.status!=='queued')fail(409,'Only unclaimed queued tasks can be cancelled');
      const changed=await env.DB.prepare("UPDATE jobs SET status='cancelled',finished_at=?,error='Cancelled by administrator' WHERE id=? AND status='queued' RETURNING id").bind(nowSeconds(),jid).first();
      if(!changed)fail(409,'Task was claimed while cancellation was requested');
      await env.DB.prepare("UPDATE projects SET status='needs_review' WHERE id=? AND status='processing'").bind(job.project_id).run();
      return json({cancelled:true,id:jid});
    }
    if(method==='DELETE'&&!action){
      if(!['done','cancelled','error'].includes(job.status))fail(409,'Only completed, cancelled or failed jobs may be deleted');
      // A historical stage result might be referenced by export or other jobs.
      const project=await getProject(env,job.project_id);
      if(project.status==='processing')fail(409,'Do not delete historical stage outputs while production is active');
      await env.DB.prepare('DELETE FROM jobs WHERE id=?').bind(jid).run();return json({deleted:true,id:jid});
    }
  }
  if(method==='POST'&&url.pathname==='/v1/projects'){
    const body=await getJson(request);
    const experiment=body.productionMode==='scene_intelligence_experiment';
    // Worker 1 alone uses the new V5-G queue; INT is always on its existing V5 path.
    // Operator/Android cannot force another worker into V5-G with a request flag.
    // Resolve routing from the authenticated DB worker row below.
    let grounded=false;
    if(experiment)fail(410,'Experimental scene intelligence is retired for NEW movies; permanent Muse Deep V5 is now the standard. Existing projects remain downloadable.');
    if(body.productionMode && body.productionMode!=='stable' && !experiment)fail(422,'Unknown CinePulse production mode');
    let requested;try{requested=isLongFormCreateRequest(body);}catch(error){fail(422,error.message);}
    const title=requireString(body.title,'movie title'),workerId=requireUUID(body.workerId),worker=await env.DB.prepare('SELECT * FROM workers WHERE id=? AND enabled=1').bind(workerId).first();
    if(!worker)fail(404,'Select an active Muse worker');
    const routing=classifyV5gWorker(worker.label,{disabled:env.CINEPULSE_V5G_DISABLED==='true'});
    if(routing.kind==='unrecognized')
      fail(422,'Worker label not mapped to a production pipeline. Choose the configured Worker 1 or INT in the refreshed worker list. No new movie was created.');
    if(routing.kind==='v5g_disabled')
      fail(503,'Worker 1 V5-G new-movie intake is disabled. No old-pipeline fallback and no new movie created.');
    grounded=selectV5gWorkflow(worker.label,{disabled:env.CINEPULSE_V5G_DISABLED==='true'});
    if(body.v5Grounded!==undefined && body.v5Grounded!==grounded)
      fail(422,'V5-G processing is assigned to Worker 1 only; INT retains the legacy workflow. Select the correct worker.');
    const srt=normalizeSrt(body.sourceSrt);
    const hours=body.retentionHours===24?24:body.retentionHours===48||body.retentionHours===undefined?48:null;
    if(!hours)fail(422,'retentionHours must be 24 or 48');
    const pid=newId(),time=nowSeconds(),key=objectKey(pid,'source_srt');
    const bytes=new TextEncoder().encode(srt);
    if(bytes.byteLength>Number(env.MAX_SRT_BYTES||2*1024*1024))fail(413,'Original SRT exceeds 2 MiB');
    // Store first, then create D1 records. Clean up R2 if any database operation fails.
    await env.FILES.put(key,bytes,{httpMetadata:{contentType:'application/x-subrip'}});
    try{
      await env.DB.batch([
        env.DB.prepare("INSERT INTO projects(id,worker_id,title,status,created_at,updated_at,retention_hours,source_srt_key) VALUES(?,?,?,'processing',?,?,?,?)").bind(pid,workerId,title,time,time,hours,key),
        env.DB.prepare("INSERT INTO assets(project_id,kind,r2_key,bytes,sha256,created_at) VALUES(?,'source_srt',?,?,?,?)").bind(pid,key,bytes.byteLength,await sha256(bytes),time)
      ]);
    }catch(error){await env.FILES.delete(key);throw error;}
    if(experiment){
      try{await createExperimentIndex(env,{projectId:pid,title,sourceSrt:srt});}
      catch(error){await removeProject(env,pid);fail(422,'Experimental subtitle evidence creation failed: '+String(error.message));}
    }
    await logDaily(env,{projects_created:1,uploaded_bytes:bytes.byteLength});
    // Durable project-level policy stored in the first digest job prompt: no schema migration.
    const policyPrompt=`${experiment?EXPERIMENT_JOB_MARKER:PERMANENT_DEEP_MARKER} ${grounded?' '+V5G_MARKER:''} ${STRICT_DURATION_MARKER} ${AUDIO_QA_MARKER} ${URDU_DEVANAGARI_POLICY_MARKER} targetMinutes=${requested.targetMinutes} outputMode=${LONGFORM_MODE} shorts=false virals=false museOwnsCuts=true windowsFiles=${experiment?11:8}\n${promptFor('digest')}`;
    const taskId=await queueTask(env,{id:pid,worker_id:workerId},'digest',policyPrompt);
    return json({projectId:pid,workerId,title,firstTaskId:taskId,stage:'digest',status:'processing',retentionHours:hours,
      productionMode:experiment?'scene_intelligence_experiment':grounded?'v5_grounded_srt_only':'stable',
      pipelineStages:grounded?V5G_STEPS:PERMANENT_DEEP_STEPS,routeConfirmed:true,workerRoute:routing.kind,
      targetMinutes:requested.targetMinutes,outputMode:requested.outputMode,
      modules:{digest:true,sourceGrounded:grounded,groundedEvidence:grounded,groundedPreTts:grounded,globalMatchPlan:grounded,englishNarration:true,urduNarration:true,metadata:true,englishMp3:true,urduMp3:true,
        englishMeasuredSrt:true,urduMeasuredSrt:true,sceneMatching:true,finalCuts:true,sceneMatchingMethod:'muse_semantic_batches',batchSize:5,eachLanguageIndependent:true,
        finalCutOwner:'muse',windowsProjectOwner:'muse',windowsAssets:experiment?11:8,shorts:false,virals:false}},201);
  }
  if(method==='GET'&&url.pathname==='/v1/projects'){
    // Admin authenticated listing is also the safe self-heal opportunity for
    // accepted final jobs stuck at storage registration. At most one per poll.
    const recovery=await recoverOneCompletedProject(env);
    const rows=await env.DB.prepare("SELECT p.*, "+MOVIE_CONTROL_FIELDS+", "+
      "(SELECT prompt FROM jobs j WHERE j.project_id=p.id AND j.step_id='digest' ORDER BY j.created_at ASC LIMIT 1) AS first_digest_prompt, "+
      "(SELECT step_id FROM jobs j WHERE j.project_id=p.id ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1) AS latest_step_id, "+
      "(SELECT status FROM jobs j WHERE j.project_id=p.id ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1) AS latest_step_status "+
      "FROM projects p "+MOVIE_CONTROL_JOIN+" ORDER BY p.created_at DESC LIMIT 200").all();
    return json({projects:(rows.results||[]).map(row=>{
      const prompt=String(row.first_digest_prompt||'');
      return {...publicProject(row),productionMode:prompt.includes(V5G_MARKER)?'v5_grounded_srt_only':
        prompt.startsWith(PERMANENT_DEEP_MARKER)?'stable':'legacy',
        currentStep:row.latest_step_id||null,currentStepStatus:row.latest_step_status||null};
    }),
      ...(recovery.attempted?{finalizationRecovery:recovery}:{})});
  }
  match=/^\/v1\/projects\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(url.pathname);
  if(match){
    const pid=requireUUID(match[1]),action=match[2]||'',project=await getProject(env,pid);
    if(action==='recovery'&&method==='GET'){
      const state=await reviewRetryState(env,project);
      const supported=!!state.eligible;
      return json({projectId:pid,status:project.status,
        canRetry:supported,failedStage:state.step,failedJobId:state.failedJobId,
        workerPaused:state.reasons?.includes('worker_disabled_or_paused')||false,
        options:supported?[{stepId:state.step,
          label:'Retry only failed '+state.step.replace(/_/g,' ')+' stage',
          recommended:true,
          warning:'Preserves prior accepted checkpoints. Media stages are checked for existing assets before retry.'}]:[],
        notice:supported?'Only the latest failed stage may be retried. Previous completed work remains accepted.':
          state.reasons?.join('; ')||'No safe failed-stage retry is available.',
        readOnly:true});
     }
     if(action==='recovery'&&method==='POST'){
      const body=await getJson(request);
      if(body.confirm!==true)fail(422,'Explicit confirmation required to retry a failed stage');
      const state=await reviewRetryState(env,project);
      const result=await retryReviewedStage(env,project,{stepId:body.stepId,failedJobId:state.failedJobId});
      return json({projectId:pid,...result,message:result.enqueued?
        'Failed stage queued for the original Muse worker; existing accepted work preserved.':
        result.reason||'Retry refused by live project state'},
        result.enqueued?201:result.idempotent?200:409);
     }
     if(action==='review/retry'&&method==='GET'){
      const state=await reviewRetryState(env,project);
      return json({projectId:pid,workerId:project.worker_id,...state,
        mutatesAcceptedJobs:false,specializedStagesRequireSeparateRecovery:true});
     }
     if(action==='review/retry'&&method==='POST'){
      const body=await getJson(request);
      const result=await retryReviewedStage(env,project,body);
      return json({projectId:pid,workerId:project.worker_id,...result},
        result.enqueued?201:result.idempotent?200:409);
     }
     if(action==='grounded-preflight/requeue'&&method==='POST'){
       const body=await getJson(request),failedJobId=requireUUID(body.failedJobId);
       const result=await resumeFailedGroundedPreflight(env,project,failedJobId);
       return json({projectId:pid,workerId:project.worker_id,...result,
         acceptedJobsUnchanged:true,sourceSrtUnchanged:true,
         notice:'Only the previously failed V5-G preflight can be queued; no accepted scenes, narration or media are replaced.'},
         result.enqueued?201:result.idempotent?200:409);
     }
     if(action==='audio/urdu-devanagari/resume'&&method==='POST')
      return json(await resumeControlledUrduPronunciation(env,pid),201);
    if(action==='deep-muse/rematch-urdu'&&method==='POST'){
      const body=await getJson(request);
      const cutJobId=requireUUID(body.cutPlanJobId);
      const task=await getJob(env,cutJobId);
      if(task.project_id!==pid)fail(403,'The requested cut-plan job belongs to another movie');
      return json(await beginTargetedUrduRematch(env,task,body.indices,task.lease),201);
    }
    if(action==='deep-muse/rematch-urdu/resume'&&method==='POST'){
      const policy=await projectPolicy(env,pid);
      if(!policy.permanentDeep||controlIsStopped(project)||project.status==='ready')
        fail(409,'Only an active permanent Deep Muse project can resume a targeted repair');
      const active=await env.DB.prepare("SELECT id,step_id FROM jobs WHERE project_id=? AND status IN ('queued','working') LIMIT 1")
        .bind(pid).first();
      if(active)return json({projectId:pid,status:'processing',activeJobId:active.id,
        notice:'Existing Muse job preserved; no duplicate'});
      const last=await env.DB.prepare("SELECT id,prompt,status FROM jobs WHERE project_id=? AND step_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1")
        .bind(pid,URDU_REPAIR_STAGE).first();
      if(!last)fail(404,'No targeted repair exists to resume');
      const manifest=parseUrduRepairPrompt(last.prompt);
      const completed=await acceptedUrduRepairOutputs(env,pid);
      const repaired=completed.flatMap(b=>b.decisions.map(d=>d.segmentIndex));
      const expected=manifest.indices.slice(0,repaired.length);
      if(repaired.length!==expected.length||repaired.some((n,i)=>n!==expected[i]))
        fail(409,'Targeted correction checkpoints are inconsistent; review before resuming');
      const next=expected.length<manifest.indices.length?URDU_REPAIR_STAGE:PERMANENT_DEEP_CUTS;
      const prompt=next===URDU_REPAIR_STAGE?
        makeUrduRepairPrompt({indices:manifest.indices,offset:expected.length,sourceCutJobId:manifest.sourceCutJobId}):
        '[PERMANENT-DEEP-MUSE] All targeted Urdu Muse repairs accepted. Rebuild final cut plan from patched source evidence, preserve original English and media.';
      await env.DB.prepare("UPDATE projects SET status='processing',updated_at=? WHERE id=?")
        .bind(nowSeconds(),pid).run();
      const nextId=await queueTask(env,project,next,prompt);
      return json({projectId:pid,nextJobId:nextId,nextStep:next,repairedCount:repaired.length,
        targetCount:manifest.indices.length,originalCheckpointsPreserved:true},201);
    }
    if(action==='deep-muse'&&method==='GET'){
      const policy=await projectPolicy(env,pid);
      if(!policy.permanentDeep)fail(404,'This movie predates permanent Muse Deep V5');
      const outputs=await priorOutputs(env,pid);
      const state={projectId:pid,mode:PERMANENT_DEEP_BUILD,status:project.status,
       lastProjectUpdateAt:project.updated_at,visualVerified:false,langs:{}};
      for(const [lang,stage] of [['english',PERMANENT_DEEP_MATCH_EN],['urdu',PERMANENT_DEEP_MATCH_UR]]){
        const raw=outputs[lang==='english'?'srt_english':'srt_urdu'];
        if(raw){
          const cues=loadProductionCues(raw),done=await acceptedPermanentDeepBatches(env,pid,stage);
          const progress=deepProductionProgress(cues,done);
          state.langs[lang]={reviewedSegments:progress.reviewedSegments,totalSegments:progress.totalSegments,
            acceptedBatches:progress.batchIndex,batchCount:progress.batchCount,complete:progress.complete};
        }else state.langs[lang]={status:'waiting_for_measured_mp3_srt'};
      }
      const repairs=await acceptedUrduRepairOutputs(env,pid);
      state.urduTargetedRepairs={acceptedBatches:repairs.length,
        repairedSegmentIndices:repairs.flatMap(b=>b.decisions.map(d=>d.segmentIndex))};
      state.cutPlanValidated=!!outputs[PERMANENT_DEEP_CUTS];
      state.windowsExportValidated=!!outputs.windows_project;
      return json(state);
    }
    if(action==='deep-muse/resume'&&method==='POST'){
      const existingRepair=await env.DB.prepare("SELECT id FROM jobs WHERE project_id=? AND step_id=? LIMIT 1")
        .bind(pid,URDU_REPAIR_STAGE).first();
      if(existingRepair)fail(409,'Targeted Urdu correction is in progress; use /deep-muse/rematch-urdu/resume to preserve patches');
      const policy=await projectPolicy(env,pid);
      if(!policy.permanentDeep)fail(404,'Only permanent V5 movies can resume Deep Muse');
      if(controlIsStopped(project))fail(410,'Stopped movie cannot resume');
      if(project.status==='ready')return json({projectId:pid,status:'ready',notice:'The complete Windows project is already ready'});
      const active=await env.DB.prepare("SELECT id,step_id,status,lease_until FROM jobs WHERE project_id=? AND status IN ('queued','working') ORDER BY created_at DESC LIMIT 1")
        .bind(pid).first();
      if(active)return json({projectId:pid,jobId:active.id,step:active.step_id,
        status:'processing',notice:'Existing Muse task retained, no duplicate queued'});
      const outputs=await priorOutputs(env,pid);
      if(!outputs.srt_english||!outputs.srt_urdu)
       fail(409,'Measured English and Urdu SRTs are required before resuming Deep Muse');
      let step=PERMANENT_DEEP_CUTS;
      for(const [lang,name] of [['english',PERMANENT_DEEP_MATCH_EN],['urdu',PERMANENT_DEEP_MATCH_UR]]){
       const cues=loadProductionCues(outputs[lang==='english'?'srt_english':'srt_urdu']);
       const accepted=await acceptedPermanentDeepBatches(env,pid,name);
       if(!deepProductionProgress(cues,accepted).complete){step=name;break;}
      }
      if(outputs[PERMANENT_DEEP_CUTS])step='windows_project';
      if(outputs.windows_project)
       fail(409,'Muse Windows project is accepted; use the existing finalization recovery endpoint');
      await env.DB.prepare("UPDATE projects SET status='processing',updated_at=? WHERE id=?")
       .bind(nowSeconds(),pid).run();
      const nextId=await queueTask(env,project,step,'[PERMANENT-DEEP-MUSE] Resume only unfinished stage; preserve prior 5-cue checkpoints');
      return json({projectId:pid,nextStep:step,nextJobId:nextId,status:'processing',
        checkpointed:true,notice:'Only the pending Muse stage has been requeued'},201);
    }
    if(method==='GET'&&!action){
      const recovery=!controlIsStopped(project)&&project.status==='needs_review'&&project.updated_at<nowSeconds()-30?
        await recoverAcceptedFinalization(env,project):{attempted:false};
      const updated=recovery.attempted?await getProject(env,pid):project;
      const rows=await env.DB.prepare('SELECT * FROM jobs WHERE project_id=? ORDER BY created_at').bind(pid).all();
      const assetRows=await allAssetMetadata(env,pid);
      const policy=await projectPolicy(env,pid);
      return json({project:{...publicProject(updated),productionMode:(await sceneLabRow(env,pid))?'scene_matching_lab':policy.experiment?'scene_intelligence_experiment':policy.grounded?'v5_grounded_srt_only':policy.permanentDeep?'stable':'legacy'},
        pipelineStages:policy.stages,stageCount:policy.stages.length,routeConfirmed:true,
        jobs:(rows.results||[]).map(publicJob),
        assets:assetRows,...(recovery.attempted?{finalizationRecovery:recovery}:{})});
    }
    if(method==='POST'&&['pause','resume','stop'].includes(action)){
      if(project.status==='ready'&&!controlIsStopped(project))fail(409,'Ready movies can be deleted after downloading');
      const time=nowSeconds();
      if(action==='stop'){
        // Transactionally revoke active task lease and cancel queued stages
        // for this PROJECT ID only. Other movies on this worker continue.
        await env.DB.batch([
          env.DB.prepare("INSERT INTO cinepulse_movie_controls(project_id,paused,stopped,updated_at) VALUES(?,0,1,?) ON CONFLICT(project_id) DO UPDATE SET paused=0,stopped=1,updated_at=excluded.updated_at").bind(pid,time),
          env.DB.prepare("UPDATE jobs SET status='cancelled',lease=NULL,lease_until=NULL,finished_at=?,error='Stopped by movie administrator' WHERE project_id=? AND status IN ('queued','working')").bind(time,pid),
          env.DB.prepare("UPDATE projects SET status='needs_review',updated_at=? WHERE id=? AND status='processing'").bind(time,pid)
        ]);
        return json({projectId:pid,status:'stopped',paused:false,stopped:true,revoked:true,
          message:'Movie stopped: active server lease revoked, queued tasks cancelled. An already-running external Muse request cannot be forcibly killed, but its uploads and results are rejected. Other movies keep processing.'});
      }
      if(controlIsStopped(project))fail(409,'Stopped movies cannot resume; submit again explicitly if needed');
      if(project.status!=='processing')fail(409,'Only processing movies can be paused or resumed');
      if(action==='pause'){
        // Per-movie immediate pause: atomically invalidate its current Muse
        // lease and requeue that *unfinished* task. The currently executing
        // external worker cannot be interrupted, but all further writes made
        // with the revoked lease are rejected. No other worker/movie touched.
        await env.DB.batch([
          env.DB.prepare("INSERT INTO cinepulse_movie_controls(project_id,paused,stopped,updated_at) VALUES(?,1,0,?) ON CONFLICT(project_id) DO UPDATE SET paused=1,updated_at=excluded.updated_at WHERE stopped=0").bind(pid,time),
          env.DB.prepare("UPDATE jobs SET status='queued',lease=NULL,lease_until=NULL WHERE project_id=? AND status='working'").bind(pid)
        ]);
        return json({projectId:pid,status:'processing',paused:true,stopped:false,leaseRevoked:true,
          message:'This movie is paused. Current Muse lease revoked; unfinished task saved as queued and will be available after resume. Other movies unaffected.'});
      }
      await env.DB.prepare("INSERT INTO cinepulse_movie_controls(project_id,paused,stopped,updated_at) VALUES(?,0,0,?) ON CONFLICT(project_id) DO UPDATE SET paused=0,updated_at=excluded.updated_at WHERE stopped=0").bind(pid,time).run();
      return json({projectId:pid,status:'processing',paused:false,stopped:false,
        message:'This movie is resumed. Preserved queued stage can be claimed by its original worker.'});
    }
    if(method==='POST'&&action==='repair-finalization'){
      const result=await recoverAcceptedFinalization(env,project);
      return json({project:publicProject(await getProject(env,pid)),recovery:result});
    }
    if(method==='DELETE'&&!action){
      if(project.status==='processing'&&!controlIsStopped(project))fail(409,'Stop this movie before deleting an active project');
      await removeProject(env,pid);return json({deleted:true,id:pid,notice:'This movie and its Muse queue tasks, scene evidence and R2 assets were deleted. Other movies and worker credentials are unchanged.'});
    }
    if(method==='POST'&&action==='finalize'){
      const m=await getJson(request);const result=await finalizeProject(env,project,m);
      return json(result);
    }
    if(method==='POST'&&(action==='audio/english_mp3'||action==='audio/urdu_mp3')){
      if(project.status==='ready')fail(409,'Project already finalized');
      const kind=action.split('/')[1];return json(await uploadAudio(request,env,pid,kind),201);
    }
    if(method==='GET'&&action==='downloads')return json(await signedLinks(env,request,project));
  }
  if(method==='GET'&&url.pathname==='/v1/usage/cloudflare'){
    if(!env.CF_ACCOUNT_ID||!env.CF_ANALYTICS_TOKEN)fail(503,'Cloudflare analytics access not configured. Set CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN separately.');
    const date=url.searchParams.get('date')||dayUTC();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail(400,'date must be YYYY-MM-DD');
    const start=date+'T00:00:00.000Z';
    const end=new Date(Date.parse(start)+86400000-1).toISOString();
    const queries={
      workers:{query:`query($accountTag: string!, $start: string!, $end: string!){viewer{accounts(filter:{accountTag:$accountTag}){workersInvocationsAdaptive(limit:1000,filter:{scriptName:"cinepulse-android-bridge",datetime_geq:$start,datetime_leq:$end}){sum{requests errors subrequests}}}}}` ,variables:{accountTag:env.CF_ACCOUNT_ID,start,end}},
      d1:{query:`query($accountTag: string!, $date: Date!){viewer{accounts(filter:{accountTag:$accountTag}){d1AnalyticsAdaptiveGroups(limit:1000,filter:{date_geq:$date,date_leq:$date}){dimensions{databaseId}sum{rowsRead rowsWritten}}}}}`,variables:{accountTag:env.CF_ACCOUNT_ID,date}},
      r2Operations:{query:`query($accountTag: string!, $start: Time, $end: Time){viewer{accounts(filter:{accountTag:$accountTag}){r2OperationsAdaptiveGroups(limit:1000,filter:{datetime_geq:$start,datetime_leq:$end,bucketName:"cinepulse-android-assets"}){dimensions{actionType}sum{requests}}}}}`,variables:{accountTag:env.CF_ACCOUNT_ID,start,end}},
      r2Storage:{query:`query($accountTag: string!, $start: Time, $end: Time){viewer{accounts(filter:{accountTag:$accountTag}){r2StorageAdaptiveGroups(limit:1000,filter:{datetime_geq:$start,datetime_leq:$end,bucketName:"cinepulse-android-assets"},orderBy:[datetime_DESC]){max{objectCount payloadSize metadataSize}dimensions{datetime}}}}}`,variables:{accountTag:env.CF_ACCOUNT_ID,start,end}},
      r2Bandwidth:{query:`query($accountTag: string!, $start: Time!, $end: Time!){viewer{accounts(filter:{accountTag:$accountTag}){r2BandwidthUsageAdaptiveGroups(limit:1000,filter:{datetime_geq:$start,datetime_lt:$end,bucketName:"cinepulse-android-assets"}){sum{bytesDownload bytesUpload}dimensions{datetimeHour}}}}}`,variables:{accountTag:env.CF_ACCOUNT_ID,start,end}}
    };
    const results={};
    for(const [name,payload] of Object.entries(queries)){
      try{
        const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+env.CF_ANALYTICS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const data=await response.json();
        if(!response.ok||data.errors?.length)results[name]={available:false,error:data.errors?.[0]?.message||`Cloudflare analytics HTTP ${response.status}`};
        else results[name]={available:true,records:data.data?.viewer?.accounts?.[0]?.[{workers:'workersInvocationsAdaptive',d1:'d1AnalyticsAdaptiveGroups',r2Operations:'r2OperationsAdaptiveGroups',r2Storage:'r2StorageAdaptiveGroups',r2Bandwidth:'r2BandwidthUsageAdaptiveGroups'}[name]]||[]};
      }catch(error){results[name]={available:false,error:String(error?.message||error)};}
    }
    return json({day:date,cloudflareAnalytics:results,info:'Workers usage is script-specific. D1/R2 datasets cover the account; filter records by the CinePulse database and bucket. R2 storage GB-month and true billing totals must be confirmed in the Cloudflare dashboard.'});
  }
  if(method==='GET'&&url.pathname==='/v1/usage'){
    const date=url.searchParams.get('date')||dayUTC();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail(400,'date must be YYYY-MM-DD');
    const [daily,storage,projectStats]=await Promise.all([
      env.DB.prepare('SELECT * FROM usage_daily WHERE day=?').bind(date).first(),
      storageTotals(env),
      env.DB.prepare('SELECT COUNT(*) AS projects FROM projects').first()
    ]);
    return json({day:date,appEvents:daily||{day:date,projects_created:0,jobs_created:0,jobs_completed:0,uploaded_bytes:0,downloads:0,deleted_projects:0},
      storageEstimate:{objects:storage?.objects||0,bytes:storage?.total_bytes||0,projects:projectStats?.projects||0},
      freeTierReferences:{workersRequestsPerDay:100000,d1RowsReadPerDay:5000000,d1RowsWrittenPerDay:100000,r2StandardStorageGBMonths:10},
      authoritative:false,warning:'Counts reflect CinePulse database events and current CinePulse asset sizes, not Cloudflare billing usage. Use Workers, D1, and R2 Cloudflare Dashboard analytics to verify true free-tier consumption. Muse/TTS/STT provider costs are separate.'});
  }
  fail(404,'Unknown administrator endpoint');
}
function withCors(response,request,env){
  const origin=request.headers.get('Origin');
  const allowlist=String(env.ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean);
  if(origin&&allowlist.includes(origin)){
    response.headers.set('Access-Control-Allow-Origin',origin);
    response.headers.set('Vary','Origin');
    response.headers.set('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers','Authorization, Content-Type, X-CinePulse-Lease, X-CinePulse-SHA256');
    response.headers.set('Access-Control-Max-Age','600');
  }
  return response;
}
export default {
  async fetch(request,env,ctx){
    const origin=request.headers.get('Origin');
    const allowed=String(env.ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean);
    if(request.method==='OPTIONS')return withCors(new Response(null,{status:204}),request,env);
    if(origin&&!allowed.includes(origin))return json({error:'Origin not permitted'},403);
    try{
      const result=await route(request,env);
      result.headers.set('X-CinePulse-Bridge',API_BUILD);
      return withCors(result,request,env);
    }catch(e){
      if(e instanceof HttpError)return withCors(json({error:e.message},e.status),request,env);
      console.error('Unhandled CinePulse request error',e?.stack||e);
      return withCors(json({error:'Unexpected backend failure; check Worker logs'},500),request,env);
    }
  },
  async scheduled(_event,env,_ctx){
    try{const n=await scheduledCleanup(env);console.log('CinePulse expired projects removed',n);}catch(e){console.error('CinePulse scheduled cleanup failed',e?.stack||e);}
  }
};
