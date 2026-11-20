/**
 * Whole-movie Gate B SRT-semantic allocation, before any live deep matching.
 * All measured cues get distinct source windows; narration remains grouped by
 * semantic unit. No movie footage/vision inference, no D1/R2 mutation.
 */
import {parseMeasuredCues} from './scene-lab-package.mjs';
import {validateProductionDeepBatch,loadProductionCues} from './permanent-deep-muse.mjs';
import {inspectAfterVoice} from './bfg-v5-grounded-restart.mjs';
import {validateV5gMeasuredCues} from './v5g-production-gate.mjs';
export const V5G_MATCH_PLAN_BUILD='v5g-match-plan-merged-cue-relevance-20261120';
const fail=msg=>{throw Error('V5-G global match plan: '+msg)};
export function validateV5gGlobalPlan({sourceSrt,englishSrt,urduSrt,preflight,evidence,input}){
 if(!preflight||!Array.isArray(preflight.narrationUnits))fail('Accepted bilingual pre-TTS checkpoint missing');
 if(!evidence||!Array.isArray(evidence.beats)||!Array.isArray(evidence.blueprint))
  fail('Accepted source-beat blueprint checkpoint missing');
 const sourceCues=parseMeasuredCues(sourceSrt);
 const allBeats=new Map(evidence.beats.map(b=>[b.id,b]));
 const anchors=new Map(evidence.blueprint.map(b=>[b.beatId,b]));
 const allUnits=new Map(preflight.narrationUnits.map(u=>[u.language+':'+u.id,u]));
 const orderedUnits={english:new Map(),urdu:new Map()};
 for(const language of ['english','urdu']){
  preflight.narrationUnits.filter(u=>u.language===language)
   .forEach((u,index)=>orderedUnits[language].set(u.id,index));
 }
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
  // Real STT pauses need not coincide with sentence boundaries. Retain the
  // exact measured SRT cue count, timestamps and text, but permit a cue to
  // cover multiple distinct *consecutive* approved narration units. Never
  // silently split a cue or accept unknown, repeated or reordered unit IDs.
  for(const c of cues){
   const positions=c.unitIds.map(id=>orderedUnits[language].get(id));
   if(positions.some(p=>p===undefined)||
      positions.some((p,i)=>i>0&&p!==positions[i-1]+1))
    fail('Measured cue '+language+':'+c.index+
     ' merges non-consecutive or unknown narration units');
  }
 }
 const grouping=inspectAfterVoice({units:preflight.narrationUnits,measuredCues:input.measuredCues});
 if(!grouping.ready)fail('Measured SRT semantic lineage invalid: '+grouping.errors.slice(0,6).join('; '));
 const touchesBeat=(decision,unit)=>{
  if(!unit||!Array.isArray(unit.beatIds)||!unit.beatIds.length)return false;
  return unit.beatIds.some(id=>{
   const anchor=anchors.get(id),beat=allBeats.get(id);
   if(!anchor||!beat)return false;
   const sourceTouch=Array.isArray(decision.sourceCueIds)&&decision.sourceCueIds.some(n=>{
    const cue=Number.isInteger(n)?sourceCues[n-1]:null;
    return cue&&cue.startSeconds<=anchor.endSeconds+1&&
      cue.endSeconds>=anchor.startSeconds-1;
   });
   return sourceTouch&&decision.sourceStartSeconds<=anchor.endSeconds+12&&
     decision.sourceEndSeconds>=anchor.startSeconds-12;
  });
 };
 const review={};
 for(const [lang,srt,cues] of [['english',englishSrt,english],['urdu',urduSrt,urdu]]){
  const decisions=input.decisions[lang],accepted=[],relevantUnits=new Set(),mergedAudioUnits=new Set();
  if(decisions.length!==cues.length)fail(lang+' planned decision count does not match measured SRT');
  const supportsCue=decisions.map((d,i)=>{
   const c=cues[i];
   if(d?.segmentIndex!==i+1||!c.unitIds.includes(d.unitId))
    fail(lang+' source decision does not match semantic unit at cue '+(i+1));
   const unit=allUnits.get(lang+':'+d.unitId);
   if(!unit||!Array.isArray(unit.beatIds)||!unit.beatIds.length)
    fail(lang+' decision has no source-backed narration unit');
   const relevant=touchesBeat(d,unit);
   // An STT cue can contain two or more consecutive preflight-approved
   // narration units while the movie decision can select only ONE scene.
   // The decision's scene must be grounded in a unit the cue really speaks.
   // For a single-unit voice passage spanning many cues, retain the prior
   // "one reviewed in-window source decision per unit" allowance.
   const cueGrounded=relevant||c.unitIds.some(id=>
    touchesBeat(d,allUnits.get(lang+':'+id)));
   if(relevant)relevantUnits.add(d.unitId);
   if(d.qualityScore<.9||!Number.isFinite(d.qualityScore)||
      d.independentSubtitleReview!==true||
      typeof d.reviewerRef!=='string'||d.reviewerRef.trim().length<4)
    fail(lang+' source decision requires independent SRT-semantic >=9/10 review at cue '+(i+1));
   return cueGrounded;
  });
  // Separate *audible unit* coverage (measured SRT lineage + approved
  // preflight) from one selected visual scene per actual STT cue.
  // A unit occurring ONLY inside multi-unit cues cannot have a distinct
  // scene decision without fabricating additional subtitle boundaries.
  // Such units may be carried by the existing independently-reviewed
  // source decision if it touches another real beat in that same cue.
  // Units with any standalone measured cue must still have their OWN
  // in-blueprint source decision, just as before.
  for(const group of grouping.groups.filter(g=>g.language===lang)){
   if(relevantUnits.has(group.unitId))continue;
   const positions=group.cueIndices.map(idx=>idx-1);
   const onlyMerged=positions.length>0&&positions.every(i=>
    cues[i]?.unitIds.length>1);
   const anchoredMerged=positions.some(i=>supportsCue[i]===true);
   if(onlyMerged&&anchoredMerged){
    mergedAudioUnits.add(group.unitId);
    continue;
   }
   fail(lang+' source decision is outside its narration beat blueprint for unit '+group.unitId);
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
   sourceCues:source.length,
   mergedAudioOnlyUnits:[...mergedAudioUnits],
   mergedAudioOnlyNotIndependentlyVisualVerified:true};
 }
 return {measuredCues:input.measuredCues,decisions:input.decisions,
  validation:{stage:'grounded_match_plan',status:'reviewed_all_units',globalCoverage:true,
   english:review.english,urdu:review.urdu,verifiedVisualQuality:false,
   plannedBeforeCheckpointSubmission:true}};
}
