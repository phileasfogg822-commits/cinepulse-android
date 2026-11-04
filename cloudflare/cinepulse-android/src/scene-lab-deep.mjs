/**
 * CinePulse Scene Lab Deep V1 — explicit Muse decisions for EACH measured
 * English narration segment, in resumable, ordered batches of at most five.
 * This module owns only experimental validation/state. No existing movie job
 * stage, legacy editor, or Scene Lab fast-scoring experiment is changed.
 */
import {validateExperimentManifest,rebaseCues,validateCompleteCutPlan} from './scene-lab.mjs';
import {parseMeasuredCues} from './scene-lab-package.mjs';
export const DEEP_BUILD='cinepulse-scene-lab-deep-muse-v1';
export const DEEP_PREPARE='scene_lab_deep_prepare';
export const DEEP_MATCH='scene_lab_deep_match';
export const DEEP_EXPORT='scene_lab_deep_export';
export const DEEP_BATCH_SIZE=5;
export const DEEP_STAGES=Object.freeze([DEEP_PREPARE,DEEP_MATCH,DEEP_EXPORT]);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/i;
const TOLERANCE=.26;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const cleaned=x=>String(x??'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');

export const DEEP_RUNS_SCHEMA="CREATE TABLE IF NOT EXISTS cinepulse_scene_lab_deep ("+
 "project_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, parent_project_id TEXT NOT NULL,"+
 "worker_id TEXT NOT NULL, strategy TEXT NOT NULL, manifest_json TEXT NOT NULL,"+
 "english_cues_json TEXT NOT NULL, urdu_srt TEXT NOT NULL, urdu_cuts_json TEXT NOT NULL,"+
 "narrations_json TEXT NOT NULL, baseline_project_json TEXT NOT NULL, expected_mp3s_json TEXT NOT NULL,"+
 "segment_count INTEGER NOT NULL, batch_count INTEGER NOT NULL, current_batch INTEGER NOT NULL DEFAULT 0,"+
 "status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)";
export const DEEP_BATCHES_SCHEMA="CREATE TABLE IF NOT EXISTS cinepulse_scene_lab_deep_batches ("+
 "project_id TEXT NOT NULL, batch_index INTEGER NOT NULL, job_id TEXT NOT NULL UNIQUE,"+
 "first_segment INTEGER NOT NULL, last_segment INTEGER NOT NULL, status TEXT NOT NULL,"+
 "output_json TEXT, finished_at INTEGER, PRIMARY KEY(project_id,batch_index))";
export async function ensureDeepTables(env){
 await env.DB.prepare(DEEP_RUNS_SCHEMA).run();
 await env.DB.prepare(DEEP_BATCHES_SCHEMA).run();
}
export async function deepRow(env,projectId){
 await ensureDeepTables(env);
 return env.DB.prepare('SELECT * FROM cinepulse_scene_lab_deep WHERE project_id=?').bind(projectId).first();
}
export async function deepBatch(env,jobId){
 await ensureDeepTables(env);
 return env.DB.prepare('SELECT * FROM cinepulse_scene_lab_deep_batches WHERE job_id=?').bind(jobId).first();
}
export async function deepOutputs(env,projectId){
 await ensureDeepTables(env);
 const r=await env.DB.prepare("SELECT batch_index,output_json FROM cinepulse_scene_lab_deep_batches WHERE project_id=? AND status='done' ORDER BY batch_index").bind(projectId).all();
 return (r.results||[]).map(x=>({batchIndex:x.batch_index,decisions:JSON.parse(x.output_json).decisions}));
}
export function normalizeDeepCreate(body){
 if(!body||!UUID.test(body.workerId||'')||!UUID.test(body.parentProjectId||''))throw Error('INT worker and parent movie UUIDs required');
 if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{10,128}$/.test(body.requestId))throw Error('Stable requestId (10-128 characters) required to prevent duplicates');
 const manifest={mode:'scene_matching_lab',language:'english',parentProjectId:body.parentProjectId,strategy:body.strategy,excerpts:body.excerpts};
 const checked=validateExperimentManifest(manifest);
 if(typeof body.sourceSrt!=='string'||body.sourceSrt.length<100||body.sourceSrt.length>2000000)throw Error('Full original source movie SRT required');
 if(!HASH.test(body.sourceSrtSha256||''))throw Error('Exact original source SRT SHA256 required');
 const sourceCues=parseMeasuredCues(body.sourceSrt);
 if(sourceCues.length<100)throw Error('Original source movie SRT must include the whole movie');
 const baseline=body.baselineProject;
 if(!baseline||baseline.cloudImport?.schema!=='cinepulse.windows-muse.v4'||baseline.cloudImport?.cloudProjectId!==body.parentProjectId||
    baseline.sourceFiles?.[0]?.text!==body.sourceSrt)throw Error('Exact original Muse V4 project and source SRT required');
 if(!Array.isArray(body.englishCues)||!body.englishCues.length)throw Error('Original measured English cue array required');
 const rebased=rebaseCues(body.englishCues,body.excerpts);
 if(rebased.length<1||rebased.length>200||Math.abs(rebased.at(-1).endSeconds-checked.totalSeconds)>TOLERANCE)
   throw Error('English cues do not fully cover chosen four excerpts');
 if(!rebased.every(c=>finite(c.startSeconds)&&finite(c.endSeconds)&&c.endSeconds>c.startSeconds&&String(c.text||'').trim()))throw Error('Invalid measured English cue');
 const urduCues=parseMeasuredCues(body.urduSrt);
 const urduDuration=urduCues.at(-1).endSeconds;
 if(urduDuration<29.5||urduDuration>30.5)throw Error('Shared Urdu control must end at approximately 30 seconds');
 validateCompleteCutPlan(body.urduCuts,urduDuration);
 if(!body.narrations||!String(body.narrations.english||'').trim()||!String(body.narrations.urdu||'').trim())throw Error('Both fixed excerpt narrations required');
 const expected=body.mp3Manifest;
 for(const [lang,duration] of [['english',checked.totalSeconds],['urdu',urduDuration]]){
  const m=expected?.[lang];
  if(!m||!Number.isInteger(m.bytes)||m.bytes<2048||!HASH.test(m.sha256||'')||
    !finite(m.durationSeconds)||Math.abs(m.durationSeconds-duration)>.25)throw Error('Exact '+lang+' MP3 SHA256, bytes and measured duration required');
 }
 return {
  manifest,sourceSrt:body.sourceSrt,baselineProject:baseline,
  englishCues:body.englishCues,rebasedCues:rebased,urduSrt:body.urduSrt,
  urduCuts:body.urduCuts,narrations:body.narrations,expectedMp3s:expected,
  segmentCount:rebased.length,batchCount:Math.ceil(rebased.length/DEEP_BATCH_SIZE),
  parentProjectId:body.parentProjectId,workerId:body.workerId,requestId:body.requestId
 };
}
export function segmentBatch(row,batchIndex){
 const original=JSON.parse(row.english_cues_json),manifest=JSON.parse(row.manifest_json);
 const cues=rebaseCues(original,manifest.excerpts);
 const first=batchIndex*DEEP_BATCH_SIZE;
 if(!Number.isInteger(batchIndex)||first<0||first>=cues.length)throw Error('Unknown deep matching batch');
 return cues.slice(first,first+DEEP_BATCH_SIZE).map((c,i)=>({
  segmentIndex:first+i+1,narrationStartSeconds:c.startSeconds,
  narrationEndSeconds:c.endSeconds,text:c.text
 }));
}
export function preparePrompt(row){
 return 'CINEPULSE DEEP MUSE MATCHING: ASSET PREPARATION ONLY. Original Peter Rabbit movie is IMMUTABLE. '+
  'Experiment '+row.project_id+'. Do not regenerate English or Urdu narration, TTS or STT. '+
  'Upload the exact SAME existing extracted 5-minute English MP3 and 30-second Urdu MP3 '+
  'using the two authenticated task asset paths and X-CinePulse-SHA256 plus X-CinePulse-Lease. '+
  'Their exact hashes and byte sizes are in sceneLabDeep.expectedMp3s. '+
  'Only submit {"verified":true} after BOTH receipts and their hashes match. '+
  'No scene cut decisions are authorized in this stage.';
}
export function matchPrompt(row,batchIndex){
 const segments=segmentBatch(row,batchIndex);
 return 'CINEPULSE DEEP MUSE SCENE MATCH — BATCH '+(batchIndex+1)+'/'+row.batch_count+'. '+
  'YOU MUST CALL MUSE FOR SEMANTIC REASONING OF EACH OF THESE '+segments.length+' MEASURED ENGLISH NARRATION SEGMENTS; '+ 
  'a local lexical score or reused precomputed 60-cut plan is NOT a substitute. '+
  'Retrieve candidates from the ENTIRE original movie SRT available at sourceSrtAsset. '+
  'Inspect characters, spoken dialogue, physical actions, event chronology and surrounding subtitle context. '+
  'For EACH segment independently select one defensible source time anchor and source cue IDs; '+
  'quote an EXACT contiguous portion of text from one cited ORIGINAL source cue. '+
  'Report a real alternative source cue with a reason for rejection. Preserve prior accepted anchors, avoid overlap '+
  'and do not use unrelated footage to make a coverage metric pass. '+
  'If unsolved, return an explicit task error with reason; do not invent an answer. '+
  'The batch is checkpointed only after every citation and timestamp validates. '+
  'Return JSON {"decisions":[{"segmentIndex":1,"sourceStartSeconds":0,"sourceEndSeconds":5,'+
  '"sourceCueIds":[1],"evidenceQuote":"exact quote from original subtitle","reason":"explicit semantic explanation",'+
  '"alternatives":[{"cueId":2,"reason":"why rejected"}],"confidence":0.8,"museRequestId":"MUSE-CALL-ID"}]}. '+
  'The segmentIndex must match the supplied 1-based segmentIndex exactly. '+
  'Never claim visual verification; audio and SRT only. '+
  'MEASURED NARRATION SEGMENTS: '+JSON.stringify(segments);
}
export function exportPrompt(row){
 return 'CINEPULSE DEEP MUSE FINAL CUT PLAN. All '+row.segment_count+' English narration segments '+
  'must have their OWN accepted Muse semantic decisions in sceneLabDeep.acceptedDecisions. '+
  'Use those decisions as anchors to author a final source-grounded 3-6 second cut plan with 100% narration coverage. '+
  'Do not copy any earlier fast-scoring Scene Lab cut plan. Every cut must contain '+
  'matchSegmentIndices: an array of indices of the accepted decisions that support this exact source window. '+
  'The final cut narration time must overlap the cited narration segment. The source cut must be within 12s '+
  'of that accepted source anchor. Footage must be non-overlapping globally, and source duration must equal narration duration. '+
  'Submit {"englishCuts":[{"narrationStartSeconds":0,"narrationEndSeconds":5,'+
  '"sourceStartSeconds":100,"sourceEndSeconds":105,"matchSegmentIndices":[1],"confidence":0.8}]}. '+
  'The Urdu 30-second control is fixed and is NOT to be rematched. '+
  'Do not claim visual confirmation. If evidence cannot cover the complete narration, report an unresolved task error.';
}
export function validateDeepBatch(row,batchIndex,payload,sourceSrt,completed){
 const expected=segmentBatch(row,batchIndex);
 if(!payload||!Array.isArray(payload.decisions)||payload.decisions.length!==expected.length)
  throw Error('Muse must decide each narration segment in batch '+(batchIndex+1)+' exactly once');
 const sourceCues=parseMeasuredCues(sourceSrt);
 const sourceEnd=sourceCues.at(-1).endSeconds;
 const used=(completed||[]).flatMap(x=>x.decisions).map(d=>[d.sourceStartSeconds,d.sourceEndSeconds]);
 const decisions=[];
 for(let i=0;i<expected.length;i++){
  const d=payload.decisions[i],s=expected[i];
  if(d?.segmentIndex!==s.segmentIndex)throw Error('Wrong or missing Muse decision for segment '+s.segmentIndex);
  if(!finite(d.sourceStartSeconds)||!finite(d.sourceEndSeconds)||d.sourceStartSeconds<0||
      d.sourceEndSeconds<=d.sourceStartSeconds||d.sourceEndSeconds>sourceEnd+0.01||
      d.sourceEndSeconds-d.sourceStartSeconds>30)throw Error('Invalid source anchor for segment '+s.segmentIndex);
  if(!Array.isArray(d.sourceCueIds)||d.sourceCueIds.length<1||d.sourceCueIds.length>8||
      !d.sourceCueIds.every(n=>Number.isInteger(n)&&n>0&&n<=sourceCues.length))
      throw Error('Missing/incorrect original source cue IDs for segment '+s.segmentIndex);
  const quoted=cleaned(d.evidenceQuote);
  if(quoted.length<6 || !d.sourceCueIds.some(n=>cleaned(sourceCues[n-1].text).includes(quoted)))
    throw Error('Source cue does not contain cited exact evidence for segment '+s.segmentIndex);
  if(!d.sourceCueIds.some(n=>{
   const cue=sourceCues[n-1];
   return d.sourceStartSeconds<=cue.endSeconds+12&&d.sourceEndSeconds>=cue.startSeconds-12;
  }))throw Error('Selected source time contradicts cited source cue for segment '+s.segmentIndex);
  if(typeof d.reason!=='string'||d.reason.trim().length<24)throw Error('Muse semantic reason missing for segment '+s.segmentIndex);
  if(!Array.isArray(d.alternatives)||d.alternatives.length<1||
   !d.alternatives.some(a=>Number.isInteger(a?.cueId)&&a.cueId>=1&&a.cueId<=sourceCues.length&&
     !d.sourceCueIds.includes(a.cueId)&&typeof a.reason==='string'&&a.reason.trim().length>=8))
    throw Error('Alternative candidate and rejection reason required for segment '+s.segmentIndex);
  if(!finite(d.confidence)||d.confidence<0||d.confidence>1)throw Error('Invalid confidence for segment '+s.segmentIndex);
  if(typeof d.museRequestId!=='string'||d.museRequestId.trim().length<6)throw Error('Muse request trace missing for segment '+s.segmentIndex);
  if(used.some(([a,b])=>d.sourceStartSeconds<b-.001&&d.sourceEndSeconds>a+.001))
    throw Error('Previously accepted source footage reused for segment '+s.segmentIndex);
  used.push([d.sourceStartSeconds,d.sourceEndSeconds]);
  decisions.push({...d,narrationStartSeconds:s.narrationStartSeconds,narrationEndSeconds:s.narrationEndSeconds,
    narrationText:s.text,visualVerified:false});
 }
 return {decisions};
}
export function validateDeepFinalCuts(row,cuts,completed){
 const manifest=JSON.parse(row.manifest_json),checked=validateExperimentManifest(manifest);
 validateCompleteCutPlan(cuts,checked.totalSeconds);
 const all=(completed||[]).flatMap(b=>b.decisions);
 if(all.length!==row.segment_count)throw Error('Cannot export: all measured segments must have accepted Muse decisions');
 const sorted=[...all].sort((a,b)=>a.segmentIndex-b.segmentIndex);
 if(sorted.some((d,i)=>d.segmentIndex!==i+1))throw Error('Deep Muse decisions missing/duplicated');
 const used=new Set();
 const verified=[];
 for(let i=0;i<cuts.length;i++){
  const cut=cuts[i];
  const matchIds=cut.matchSegmentIndices;
  if(!Array.isArray(matchIds)||matchIds.length<1||matchIds.length>5)throw Error('Cut '+(i+1)+' lacks Muse decision link');
  const eligible=matchIds.map(n=>sorted[n-1]).filter(d=>d&&
    cut.narrationStartSeconds<d.narrationEndSeconds+3&&cut.narrationEndSeconds>d.narrationStartSeconds-3&&
    cut.sourceStartSeconds>=d.sourceStartSeconds-12&&cut.sourceEndSeconds<=d.sourceEndSeconds+12);
  if(!eligible.length)throw Error('Cut '+(i+1)+' lacks source-grounded Muse anchor nearby');
  for(const d of eligible)used.add(d.segmentIndex);
  verified.push({...cut,sourceEvidence:eligible.map(d=>'cue '+d.sourceCueIds.join(',')+' '+d.evidenceQuote).join(' | '),
    confidence:Math.min(...eligible.map(d=>d.confidence))});
 }
 if(used.size!==sorted.length)throw Error('Not every Muse-reviewed narration segment is represented in final cuts');
 return {cuts:verified,reviewedSegments:sorted.length,completedBatches:(completed||[]).length,
  museRequests:[...new Set(sorted.map(d=>d.museRequestId))],visualVerified:false};
}
export function publicDeepStatus(row,batches){
 return {projectId:row.project_id,parentProjectId:row.parent_project_id,workerId:row.worker_id,
  strategy:row.strategy,status:row.status,segmentCount:row.segment_count,batchCount:row.batch_count,
  currentBatch:row.current_batch,acceptedBatches:(batches||[]).filter(x=>x.status==='done').length,
  completedSegments:(batches||[]).filter(x=>x.status==='done').reduce((n,b)=>n+b.last_segment-b.first_segment+1,0),
  backendBuild:DEEP_BUILD,visualVerified:false};
}
