/**
 * Production-grade opt-in V5-G checkpoint validation.
 * All functions pure: no queue, D1, R2, existing project, or CAR mutation.
 * Source SRT is the sole movie input; downstream assets are worker-generated.
 */
import {inspectBeforeVoice} from './bfg-v5-grounded-restart.mjs';
import {parseMeasuredCues} from './scene-lab-package.mjs';
export const V5G_MARKER='[CINEPULSE-V5G-GROUNDED-SRT-ONLY]';
export const V5G_EVIDENCE='grounded_evidence';
export const V5G_PREFLIGHT='grounded_preflight';
export const V5G_MATCH_PLAN='grounded_match_plan';
export const V5G_STEPS=[
 'digest',V5G_EVIDENCE,'narration_english','narration_urdu',
 V5G_PREFLIGHT,'publishing_metadata',
 'mp3_english','srt_english','mp3_urdu','srt_urdu',
 V5G_MATCH_PLAN,'deep_match_english','deep_match_urdu',
 'deep_cut_plan','windows_project'
];
const fail=reason=>{throw Error('V5-G: '+reason)};
const plain=s=>String(s||'').normalize('NFKC').replace(/\r\n?/g,'\n')
 .replace(/\s+/g,' ').trim();
const noMarkers=s=>plain(s).replace(/\s*\[B\d{2,4}\]\s*/gi,' ').replace(/\s+/g,' ').trim();
const isObj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const getPayload=payload=>{
 if(typeof payload==='string'){try{return JSON.parse(payload)}catch{fail('JSON output required')}}
 return payload;
};
export function validateV5gEvidence(sourceSrt,input){
 const result=getPayload(input);
 if(!isObj(result)||!Array.isArray(result.beats)||!Array.isArray(result.blueprint))
  fail('grounded_evidence requires JSON {beats,blueprint}');
 if(result.beats.length<1||result.beats.length>400||
    result.blueprint.length!==result.beats.length)
  fail('grounded_evidence beats/blueprint count is invalid');
 const test=inspectBeforeVoice({sourceSrt,beats:result.beats,
  blueprint:result.blueprint,narrationUnits:[]});
 if(!test.ready)fail('source and blueprint citations invalid: '+test.errors.slice(0,6).join('; '));
 return {beats:result.beats,blueprint:result.blueprint,
  validation:{sourceCueCount:test.sourceCueCount,digestBeats:test.digestBeats,
   sourceAnchorPlanCount:test.sourceAnchorPlanCount,videoRequired:false,
   stage:'grounded_evidence',checked:true}};
}
export function validateV5gPreTts({sourceSrt,evidence,englishScript,urduScript,input}){
 const result=getPayload(input);
 if(!isObj(result)||!Array.isArray(result.narrationUnits))
  fail('grounded_preflight requires JSON {narrationUnits}');
 if(!isObj(evidence)||!Array.isArray(evidence.beats)||
    !Array.isArray(evidence.blueprint))fail('Accepted source evidence checkpoint missing');
 const units=result.narrationUnits;
 if(units.length<2||units.length>1500)fail('Invalid bilingual narration unit count');
 const test=inspectBeforeVoice({sourceSrt,beats:evidence.beats,
  blueprint:evidence.blueprint,narrationUnits:units});
 if(!test.ready)fail('Source/beat/narration chain invalid: '+test.errors.slice(0,8).join('; '));
 const byLang={english:[],urdu:[]};
 for(const u of units){
  if(!Array.isArray(byLang[u.language]))fail('Unsupported narration language');
  byLang[u.language].push(u);
 }
 for(const [lang,script] of [['english',englishScript],['urdu',urduScript]]){
  const a=byLang[lang];
  if(!a.length||!String(script||'').trim())fail('Approved '+lang+' narration or units missing');
  const parts=a.map(u=>u.text);
  if(parts.some(p=>typeof p!=='string'||!p.trim()))fail('Empty '+lang+' narration unit');
  if(noMarkers(parts.join(' '))!==noMarkers(script))
   fail(lang+' narration text does not exactly correspond to source-linked units');
  // Every beat must be connected to at least one unit in each approved language.
  const ids=new Set(a.flatMap(u=>u.beatIds||[]));
  for(const beat of evidence.beats)
   if(!ids.has(beat.id))fail(lang+' narration misses story beat '+beat.id);
 }
 return {narrationUnits:units,validation:{
  stage:'grounded_preflight',ready:true,
  digestBeats:evidence.beats.length,
  englishUnits:byLang.english.length,urduUnits:byLang.urdu.length,
  sourceChecked:true,scriptTextChecked:true,visualVerified:false
 }};
}
/** Measured cue proof does not trust invented timing or silently normalized subtitles. */
export function validateV5gMeasuredCues(measuredSrt,cues,language){
 if(!Array.isArray(cues)||!cues.length)fail('Measured cue lineage required');
 const actual=parseMeasuredCues(measuredSrt);
 if(cues.length!==actual.length)fail('Measured cue count mismatch');
 const claimed=new Set();
 for(let i=0;i<cues.length;i++){
  const c=cues[i],a=actual[i];
  if(c.language!==language||c.index!==i+1)fail('Measured cue index or language mismatch');
  if(Math.abs(c.startSeconds-a.startSeconds)>.003||
     Math.abs(c.endSeconds-a.endSeconds)>.003)
   fail('Measured cue timestamps differ from accepted SRT at '+language+':'+(i+1));
  if(plain(c.text)!==plain(a.text))
   fail('Measured cue text differs from accepted SRT at '+language+':'+(i+1));
  if(!Array.isArray(c.unitIds)||!c.unitIds.length||
     c.unitIds.some(id=>typeof id!=='string'||!id))fail('Measured cue lineage missing');
  for(const id of c.unitIds)claimed.add(id);
 }
 return {count:actual.length,unitIds:[...claimed]};
}

/** Only the server-stored worker label controls NEW movie routing.
 * A label not demonstrably Worker 1 or INT is rejected at intake, never
 * silently mapped to old V5. Durable digest markers preserve old projects.
 */
export function classifyV5gWorker(workerLabel,{disabled=false}={}){
 const label=String(workerLabel??'').normalize('NFKC').toLowerCase()
  .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 const hasInt=/(?:^| )int(?: |$)/.test(label);
 // Two established labels refer to the same Worker 1 role:
 // "Worker 1" and the original Android Muse connection label,
 // "CinePulse Android Muse 1" (sometimes displayed/transcribed as
 // "CinePulse Android Views 1"). This is a server-stored label, NOT
 // user-supplied pipeline selection. Only explicit role-1 labels match.
 const workerOne=/(?:^| )worker ?(?:0*1|one)(?: |$)/.test(label) ||
   /^cinepulse android (?:muse|views|news) (?:0*1|one)$/.test(label);
 // Never silently classify a combined INT + Worker 1 label as either mode.
 if(hasInt&&workerOne)return {kind:'unrecognized',productionMode:'unavailable',recognized:false};
 if(hasInt)return {kind:'legacy_int',productionMode:'stable',recognized:true};
 if(workerOne&&disabled)return {kind:'v5g_disabled',productionMode:'unavailable',recognized:true};
 if(workerOne)return {kind:'grounded_worker1',productionMode:'v5_grounded_srt_only',recognized:true};
 return {kind:'unrecognized',productionMode:'unavailable',recognized:false};
}
export function selectV5gWorkflow(workerLabel,options={}){
 return classifyV5gWorker(workerLabel,options).kind==='grounded_worker1';
}
