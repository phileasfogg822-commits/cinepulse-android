import { API_BUILD, HttpError, json, nowSeconds, dayUTC, newId, isUuid, sha256, hashWorkerToken, requireString, normalizeSrt, validateManifest, randomToken, secureEqual, signDownload, verifyDownload, fileNames, isProbablyMp3 } from './helpers.mjs';
import { LONGFORM_MODE, LONGFORM_MARKER, isLongFormCreateRequest, normalizePublishingMetadata, validateFinalCutPlan } from './longform-policy.mjs';
import { allocateFinalLongFormCuts } from './server-cut-planner.mjs';
import { buildWindowsProject, WINDOWS_FILE_KINDS, WINDOWS_FILE_NAMES } from './windows-export.mjs';
import { MUSE_V4_MARKER, MUSE_V4_STAGES, museStageInstructions, verifyMuseWindowsProject, canonicalMuseAnalysis } from './muse-production-contract.mjs';
import { assetRow,registerAsset,assetTableFor,allAssetKeys,allAssetMetadata,storageTotals,ensureWindowsAssets } from './asset-registry.mjs';
import { EXPERIMENT_JOB_MARKER,EXPERIMENT_JOB_STAGES,experimentalQueuePrompt } from './experimental-muse-instructions.mjs';
import { createExperimentIndex,experimentalSourceInfo,validateSceneIntelligenceOutput,storeExperimentAsset,experimentalAssetRow,isExperimentAssetKind,EXPERIMENT_ASSET_NAMES,ensureExperimentTables,experimentR2Key } from './experimental-bridge-runtime.mjs';

// Legacy projects continue through their original stages. New projects use metadata only.
const STAGES = ['digest','narration_english','narration_urdu','viral_metadata','mp3_english','srt_english','mp3_urdu','srt_urdu','scene_matching','cut_plan'];
const LONGFORM_STAGES = ['digest','narration_english','narration_urdu','publishing_metadata','mp3_english','srt_english','mp3_urdu','srt_urdu','scene_matching','cut_plan'];
const LONGFORM_STAGES_V3 = LONGFORM_STAGES.filter(step=>step!=='cut_plan');
const LONGFORM_MARKER_V3='[CINEPULSE-LONGFORM-V3-SERVER-CUTS]';
const LONGFORM_BUILD = 'android-cloud-backend-0.4.2-d1-windows-assets-recovery';
async function projectPolicy(env,projectId){
  // No D1 migration: distinguish new and legacy projects by the durable digest job prompt.
  const row=await env.DB.prepare("SELECT prompt FROM jobs WHERE project_id=? AND step_id='digest' ORDER BY created_at ASC LIMIT 1").bind(projectId).first();
  const prompt=String(row?.prompt||'');
  const experiment=prompt.startsWith(EXPERIMENT_JOB_MARKER);
  const museOwnsCuts=experiment||prompt.startsWith(MUSE_V4_MARKER);
  const serverCuts=prompt.startsWith(LONGFORM_MARKER_V3);
  const longForm=museOwnsCuts||serverCuts||prompt.startsWith(LONGFORM_MARKER);
  const targetMinutes=longForm ? Number(/targetMinutes=(\d+)/.exec(prompt)?.[1]||10) : null;
  return {longForm,serverCuts,museOwnsCuts,experiment,targetMinutes,
    stages:experiment?EXPERIMENT_JOB_STAGES:museOwnsCuts?MUSE_V4_STAGES:serverCuts?LONGFORM_STAGES_V3:longForm?LONGFORM_STAGES:STAGES};
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
async function getProject(env,id) {const project=await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(requireUUID(id)).first();if(!project)fail(404,'Project not found');return project;}
async function getJob(env,id) {const job=await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(requireUUID(id)).first();if(!job)fail(404,'Task not found');return job;}
const publicWorker=w=>({id:w.id,label:w.label,movieTitle:w.movie_title,enabled:!!w.enabled,paused:!!w.paused,createdAt:w.created_at,lastSeen:w.last_seen});
const publicProject=p=>({id:p.id,workerId:p.worker_id,title:p.title,status:p.status,retentionHours:p.retention_hours,createdAt:p.created_at,readyAt:p.ready_at,firstDownloadedAt:p.first_downloaded_at,expiresAt:p.expires_at});
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
async function priorOutputs(env,projectId) {
  const result=await env.DB.prepare("SELECT step_id,output FROM jobs WHERE project_id=? AND status='done' ORDER BY created_at ASC").bind(projectId).all();
  return Object.fromEntries((result.results||[]).map(v=>[v.step_id,v.output]));
}
async function taskDetail(env,job) {
  const outputs=await priorOutputs(env,job.project_id);
  // Context only for the current project and its own worker. Never mixes movies.
  const policy=await projectPolicy(env,job.project_id);
  const stages=policy.stages;
  const context=Object.fromEntries(Object.entries(outputs).filter(([key])=>stages.indexOf(key)>=0&&stages.indexOf(key)<stages.indexOf(job.step_id)));
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
  return {...publicJob(job),lease:job.lease,
    prompt:policy.museOwnsCuts?((experimentPrompt||museStageInstructions(job.step_id,{movieTitle:movie.title,projectId:movie.id,targetMinutes:policy.targetMinutes}))+(job.prompt?.includes('RETRY REQUIRED:')?'\n'+job.prompt:'')):
      policy.longForm&&job.step_id==='cut_plan'?promptFor('cut_plan'):job.prompt,
    movie:policy.museOwnsCuts?{id:movie.id,title:movie.title,targetMinutes:policy.targetMinutes,workerId:movie.worker_id}:undefined,
    sourceSrtAsset:policy.museOwnsCuts?{path:assetPath+'/source_srt',mime:ASSET_TYPES.source_srt,name:'CinePulse_Source.srt'}:undefined,
    sceneIndexAsset:policy.experiment?{path:assetPath+'/scene_index_json',mime:'application/json',name:'Scene_Evidence.json',sourceSrtSha256:experimentSource.sourceSrtSha256,uploadSqlitePath:assetPath+'/scene_index_sqlite'}:undefined,
    productionMode:policy.experiment?'scene_intelligence_experiment':undefined,
    audioManifest:audioManifest||undefined,
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
    sourceSrt,englishSrt:manifest.narrationSrts.english,urduSrt:manifest.narrationSrts.urdu
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
      mp3Manifest:document.audio
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
      english_srt:manifest.narrationSrts.english,urdu_srt:manifest.narrationSrts.urdu,
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
async function recoverAcceptedFinalization(env,project){
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
  const format=new URL(request.url).searchParams.get('format');
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
async function route(request,env){
  requireEnv(env);
  const url=new URL(request.url),parts=url.pathname.split('/'),method=request.method;
  if(method==='GET'&&url.pathname==='/health')return json({service:'cinepulse-android-cloud-bridge',build:LONGFORM_BUILD,status:'online',cloudOrigin:true,
    policy:{newMovies:'long_form_only',shorts:false,virals:false,metadata:true,cutMinSeconds:3,cutMaxSeconds:6,serverCutAllocator:false,museOwnsCuts:true,museAuthorsWindowsProject:true,windowsAssetCount:8,
      analysisReferenceOnWindowsTask:true,museFailureDiagnostics:'exact_field_and_first_difference',
      d1WindowsAssetTable:'windows_assets',legacyAssetSchemaPreserved:true,completedJobRepair:true,validation:'narration SRT and source SRT numeric timecodes; no video frame analysis',legacyJobsPreserved:true}});
  if(method==='GET'&&parts[1]==='dl'&&parts.length===4)return download(request,env,parts,url);
  if(parts[1]==='w'&&parts.length>=4){
    const wid=parts[2],worker=await authWorker(request,env,wid);
    const tail='/'+parts.slice(3).join('/');
    if(method==='GET'&&['/agent/queue','/agent/next','/agent/current'].includes(tail)){
      // Requeue only expired leases; a crash cannot permanently strand this task.
      const expired=await env.DB.prepare("SELECT id FROM jobs WHERE worker_id=? AND status='working' AND lease_until<=? LIMIT 1").bind(wid,nowSeconds()).first();
      if(expired)await env.DB.prepare("UPDATE jobs SET status='queued',lease=NULL,lease_until=NULL WHERE worker_id=? AND status='working' AND lease_until<=?").bind(wid,nowSeconds()).run();
    }
    if(method==='GET'&&tail==='/agent/queue'){
      const [waiting,active]=await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE worker_id=? AND status='queued'").bind(wid).first(),
        env.DB.prepare("SELECT * FROM jobs WHERE worker_id=? AND status='working' ORDER BY created_at LIMIT 1").bind(wid).first()
      ]);
      return json({queuedCount:waiting?.n||0,paused:!!worker.paused,activeTask:active?publicJob(active):null,notice:(waiting?.n||0)>0?'Waiting tasks available':'No waiting tasks.',nextEndpoint:'/agent/next'});
    }
    if(method==='GET'&&['/agent/next','/agent/current'].includes(tail)){
      let job=await env.DB.prepare("SELECT * FROM jobs WHERE worker_id=? AND status='working' AND lease_until>? ORDER BY created_at LIMIT 1").bind(wid,nowSeconds()).first();
      if(job)return json({task:await taskDetail(env,job),paused:!!worker.paused,nextEndpoint:'/agent/next'});
      if(worker.paused||tail==='/agent/current')return json({task:null,paused:!!worker.paused});
      const time=nowSeconds(),id=newId(),expire=time+LEASE_SECONDS;
      // Atomic conditional claim; prevents two parallel Muse polls from taking the same job.
      job=await env.DB.prepare("UPDATE jobs SET status='working',lease=?,lease_until=? WHERE id=(SELECT id FROM jobs WHERE worker_id=? AND status='queued' ORDER BY created_at LIMIT 1) AND NOT EXISTS (SELECT 1 FROM jobs WHERE worker_id=? AND status='working' AND lease_until>?) RETURNING *").bind(id,expire,wid,wid,time).first();
      if(!job)return json({task:null,paused:false,notice:'No waiting tasks.'});
      return json({task:await taskDetail(env,job),paused:false,nextEndpoint:'/agent/next'});
    }
    const taskMatch=/^\/tasks\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(tail);
    if(taskMatch){
      const jid=requireUUID(taskMatch[1]),action=taskMatch[2]||'',job=await getJob(env,jid);
      if(job.worker_id!==wid)fail(403,'Cross-worker task access forbidden');
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
        if(!['mp3_english','mp3_urdu'].includes(job.step_id))fail(403,'Only MP3 stage may upload audio');
        return json(await uploadAudio(request,env,job.project_id,kind),201);
      }
      if(method==='POST'&&action==='heartbeat'){
        const body=await getJson(request);
        if(job.status!=='working'||!secureEqual(body.lease||'',job.lease||''))fail(409,'Lease does not match');
        await env.DB.prepare("UPDATE jobs SET lease_until=? WHERE id=? AND lease=? AND status='working'").bind(nowSeconds()+LEASE_SECONDS,jid,job.lease).run();
        return json({ok:true,leaseUntil:nowSeconds()+LEASE_SECONDS});
      }
      if(method==='POST'&&action==='result'){
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
        const output=typeof body.output==='string'?body.output:JSON.stringify(body.output??'');
        if(!output.trim()||output.length>limit)fail(422,'Nonempty task output required within stage size limit');
        if(job.step_id==='mp3_english'&&!await assetByKind(env,job.project_id,'english_mp3'))fail(409,'Real English MP3 upload required');
        if(job.step_id==='mp3_urdu'&&!await assetByKind(env,job.project_id,'urdu_mp3'))fail(409,'Real Urdu MP3 upload required');
        if(['srt_english','srt_urdu'].includes(job.step_id))normalizeSrt(output);
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
              sourceSrt:await original.text(),englishSrt:outputs.srt_english,urduSrt:outputs.srt_urdu
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
             ['scene_matching','cut_plan','windows_project'].includes(job.step_id)){
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
  if(method==='GET'&&url.pathname==='/v1/workers'){
    const rows=await env.DB.prepare('SELECT * FROM workers ORDER BY created_at DESC LIMIT 250').all();
    return json({workers:(rows.results||[]).map(publicWorker)});
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
    if(body.productionMode && body.productionMode!=='stable' && !experiment)fail(422,'Unknown CinePulse production mode');
    let requested;try{requested=isLongFormCreateRequest(body);}catch(error){fail(422,error.message);}
    const title=requireString(body.title,'movie title'),workerId=requireUUID(body.workerId),worker=await env.DB.prepare('SELECT * FROM workers WHERE id=? AND enabled=1').bind(workerId).first();
    if(!worker)fail(404,'Select an active Muse worker');
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
    const policyPrompt=`${experiment?EXPERIMENT_JOB_MARKER:MUSE_V4_MARKER} targetMinutes=${requested.targetMinutes} outputMode=${LONGFORM_MODE} shorts=false virals=false museOwnsCuts=true windowsFiles=${experiment?11:8}\n${promptFor('digest')}`;
    const taskId=await queueTask(env,{id:pid,worker_id:workerId},'digest',policyPrompt);
    return json({projectId:pid,workerId,title,firstTaskId:taskId,stage:'digest',status:'processing',retentionHours:hours,
      productionMode:experiment?'scene_intelligence_experiment':'stable',
      targetMinutes:requested.targetMinutes,outputMode:requested.outputMode,
      modules:{digest:true,englishNarration:true,urduNarration:true,metadata:true,englishMp3:true,urduMp3:true,
        englishMeasuredSrt:true,urduMeasuredSrt:true,sceneMatching:true,finalCuts:true,
        finalCutOwner:'muse',windowsProjectOwner:'muse',windowsAssets:experiment?11:8,shorts:false,virals:false}},201);
  }
  if(method==='GET'&&url.pathname==='/v1/projects'){
    // Admin authenticated listing is also the safe self-heal opportunity for
    // accepted final jobs stuck at storage registration. At most one per poll.
    const recovery=await recoverOneCompletedProject(env);
    const rows=await env.DB.prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT 200').all();
    return json({projects:(rows.results||[]).map(publicProject),
      ...(recovery.attempted?{finalizationRecovery:recovery}:{})});
  }
  match=/^\/v1\/projects\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(url.pathname);
  if(match){
    const pid=requireUUID(match[1]),action=match[2]||'',project=await getProject(env,pid);
    if(method==='GET'&&!action){
      const recovery=project.status==='needs_review'&&project.updated_at<nowSeconds()-30?
        await recoverAcceptedFinalization(env,project):{attempted:false};
      const updated=recovery.attempted?await getProject(env,pid):project;
      const rows=await env.DB.prepare('SELECT * FROM jobs WHERE project_id=? ORDER BY created_at').bind(pid).all();
      const assetRows=await allAssetMetadata(env,pid);
      return json({project:publicProject(updated),jobs:(rows.results||[]).map(publicJob),
        assets:assetRows,...(recovery.attempted?{finalizationRecovery:recovery}:{})});
    }
    if(method==='POST'&&action==='repair-finalization'){
      const result=await recoverAcceptedFinalization(env,project);
      return json({project:publicProject(await getProject(env,pid)),recovery:result});
    }
    if(method==='DELETE'&&!action){await removeProject(env,pid);return json({deleted:true,id:pid,notice:'All project files and tasks removed; this cannot be undone'});}
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