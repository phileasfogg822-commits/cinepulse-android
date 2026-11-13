/**
 * Whole-movie Gate B SRT-semantic allocation, before any live deep matching.
 * All measured cues get distinct source windows; narration remains grouped by
 * semantic unit. No movie footage/vision inference, no D1/R2 mutation.
 */
import {parseMeasuredCues} from './scene-lab-package.mjs';
import {validateProductionDeepBatch,loadProductionCues} from './permanent-deep-muse.mjs';
import {inspectAfterVoice} from './bfg-v5-grounded-restart.mjs';
import {validateV5gMeasuredCues} from './v5g-production-gate.mjs';
const fail=msg=>{throw Error('V5-G global match plan: '+msg)};
export function validateV5gGlobalPlan({sourceSrt,englishSrt,urduSrt,preflight,evidence,input}){
 if(!preflight||!Array.isArray(preflight.narrationUnits))fail('Accepted bilingual pre-TTS checkpoint missing');
 if(!evidence||!Array.isArray(evidence.beats)||!Array.isArray(evidence.blueprint))
  fail('Accepted source-beat blueprint checkpoint missing');
 const sourceCues=parseMeasuredCues(sourceSrt);
 const allBeats=new Map(evidence.beats.map(b=>[b.id,b]));
 const anchors=new Map(evidence.blueprint.map(b=>[b.beatId,b]));
 const allUnits=new Map(preflight.narrationUnits.map(u=>[u.language+':'+u.id,u]));
 if(typeof input==='string'){try{input=JSON.parse(input)}catch{fail('Invalid JSON payload')}}
 if(!input||!Array.isArray(input.measuredCues)||!input.decisions||
   !Array.isArray(input.decisions.english)||!Array.isArray(input.decisions.urdu))
  fail('Expected JSON {measuredCues,decisions:{english,urdu}}');
 const english=input.measuredCues.filter(c=>c.language==='english');
 const urdu=input.measuredCues.filter(c=>c.language==='urdu');
 const both=[english,urdu];
 if(english.length+urdu.length!==input.measuredCues.length)
  fail('Unsupported language in measured cue mapping');
 for(const [language,cues,srt] of [['english',english,englishSrt],['urdu',urdu,urduSrt]]){
  validateV5gMeasuredCues(srt,cues,language);
  // Every measured cue must map to exactly one semantic unit, unless a newly
  // checked audio boundary is supplied. Do not silently split a merged STT cue.
  for(const c of cues){
   if(c.unitIds.length>1)fail('Measured cue '+language+':'+c.index+
     ' merges distinct narration units; perform targeted audio alignment before matching');
  }
 }
 const grouping=inspectAfterVoice({units:preflight.narrationUnits,measuredCues:input.measuredCues});
 if(!grouping.ready)fail('Measured SRT semantic lineage invalid: '+grouping.errors.slice(0,6).join('; '));
 const review={};
 for(const [lang,srt,cues] of [['english',englishSrt,english],['urdu',urduSrt,urdu]]){
  const decisions=input.decisions[lang],accepted=[];
  if(decisions.length!==cues.length)fail(lang+' planned decision count does not match measured SRT');
  for(let i=0;i<decisions.length;i++){
   const d=decisions[i],c=cues[i];
   if(d?.segmentIndex!==i+1||d.unitId!==c.unitIds[0])
    fail(lang+' source decision does not match semantic unit at cue '+(i+1));
   const unit=allUnits.get(lang+':'+d.unitId);
   if(!unit||!Array.isArray(unit.beatIds)||!unit.beatIds.length)
    fail(lang+' decision has no source-backed narration unit');
   const relevant=unit.beatIds.some(id=>{
    const anchor=anchors.get(id),beat=allBeats.get(id);
    if(!anchor||!beat)return false;
    const sourceTouch=Array.isArray(d.sourceCueIds)&&d.sourceCueIds.some(n=>{
     const cue=Number.isInteger(n)?sourceCues[n-1]:null;
     return cue&&cue.startSeconds<=anchor.endSeconds+1&&
       cue.endSeconds>=anchor.startSeconds-1;
    });
    return sourceTouch&&d.sourceStartSeconds<=anchor.endSeconds+12&&
      d.sourceEndSeconds>=anchor.startSeconds-12;
   });
   if(!relevant)fail(lang+' source decision is outside its narration beat blueprint at cue '+(i+1));
   if(d.qualityScore<.9||!Number.isFinite(d.qualityScore)||
      d.independentSubtitleReview!==true||
      typeof d.reviewerRef!=='string'||d.reviewerRef.trim().length<4)
    fail(lang+' source decision requires independent SRT-semantic >=9/10 review at cue '+(i+1));
  }
  // Reuse the exact live production semantic-batch and non-overlap validator,
  // rehearsing all batches BEFORE any job writes can occur.
  const source=loadProductionCues(sourceSrt),measured=loadProductionCues(srt);
  for(let i=0;i<decisions.length;i+=5){
   const batch={decisions:decisions.slice(i,i+5)};
   const checked=validateProductionDeepBatch(lang,measured,sourceSrt,accepted,batch);
   accepted.push(checked);
  }
  const maxWindow=lang==='english'?12:25;
  review[lang]={cues:measured.length,units:grouping.groups.filter(x=>x.language===lang).length,
   batches:accepted.length,decisionCount:decisions.length,qualityFloor:.9,
   maxSourceEvidenceCorridorSeconds:maxWindow,
   sourceCues:source.length};
 }
 return {measuredCues:input.measuredCues,decisions:input.decisions,
  validation:{stage:'grounded_match_plan',status:'reviewed_all_units',globalCoverage:true,
   english:review.english,urdu:review.urdu,verifiedVisualQuality:false,
   plannedBeforeCheckpointSubmission:true}};
}
