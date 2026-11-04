/**
 * CinePulse V5.2 targeted Urdu rematch, an append-only correction lane.
 * Accepted Muse batches are NEVER rewritten. Existing MP3/SRT, English cuts,
 * source movie and completed jobs are immutable.
 */
import {loadProductionCues,validateProductionDeepBatch,deepProductionProgress} from './permanent-deep-muse.mjs';
import {rankDeepMuseCandidates} from './scene-lab-deep-candidates.mjs';
export const URDU_REPAIR_STAGE='deep_rematch_urdu';
export const URDU_REPAIR_MARKER='[CINEPULSE-V52-URDU-TARGETED-REPAIR] ';
export const URDU_REPAIR_BATCH_MAX=5;
export const URDU_REPAIR_MAX_SEGMENTS=16;
export const URDU_REPAIR_BUILD='cinepulse-urdu-targeted-rematch-v5.2';
export const LOST_WORLD_URDU_REPAIR_INDICES=Object.freeze([41,50,127,130,141,146,186,233]);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const near=(a,b)=>a[0]<b[1]-.001&&a[1]>b[0]+.001;

export function parseUrduRepairPrompt(prompt){
 const text=String(prompt||'');
 if(!text.startsWith(URDU_REPAIR_MARKER))throw Error('Not an authorized Urdu rematch task');
 const value=JSON.parse(text.slice(URDU_REPAIR_MARKER.length));
 if(!Array.isArray(value.indices)||value.indices.length<1||value.indices.length>URDU_REPAIR_MAX_SEGMENTS||
   !value.indices.every((n,i)=>Number.isInteger(n)&&n>0&&(i===0||value.indices[i-1]<n))||
   !Number.isInteger(value.offset)||value.offset<0||value.offset>=value.indices.length||
   value.offset%URDU_REPAIR_BATCH_MAX!==0||
   typeof value.sourceCutJobId!=='string'||value.sourceCutJobId.length<30)
  throw Error('Invalid or unordered targeted Muse repair manifest');
 return value;
}
export function makeUrduRepairPrompt({indices,offset,sourceCutJobId}){
 const data={indices:[...indices],offset,sourceCutJobId};
 const text=URDU_REPAIR_MARKER+JSON.stringify(data);
 parseUrduRepairPrompt(text);
 return text;
}
export function applyAcceptedUrduRepairs(acceptedBatches,completedRepairOutputs){
 if(!Array.isArray(acceptedBatches)||!Array.isArray(completedRepairOutputs))throw Error('Invalid stored checkpoints');
 const patches=new Map();
 for(const batch of completedRepairOutputs){
  if(!Array.isArray(batch?.decisions))throw Error('Stored targeted Muse correction malformed');
  for(const d of batch.decisions){
   if(!Number.isInteger(d.segmentIndex)||d.segmentIndex<1||patches.has(d.segmentIndex))
    throw Error('Duplicate or invalid targeted Muse correction '+d.segmentIndex);
   patches.set(d.segmentIndex,d);
  }
 }
 const replaced=new Set();
 const output=acceptedBatches.map(b=>({...b,decisions:b.decisions.map(d=>{
  const patch=patches.get(d.segmentIndex);
  if(patch)replaced.add(d.segmentIndex);
  return patch||d;
 })}));
 if(replaced.size!==patches.size)throw Error('Targeted repair refers to an unknown original narration segment');
 return output;
}
export function UrduRepairTaskEvidence({sourceSrt,urduCues,acceptedBatches,prompt}){
 const plan=parseUrduRepairPrompt(prompt);
 const progress=deepProductionProgress(urduCues,acceptedBatches);
 if(!progress.complete)throw Error('Urdu original Muse matching incomplete');
 const selected=plan.indices.slice(plan.offset,plan.offset+URDU_REPAIR_BATCH_MAX);
 const taskSegments=selected.map(i=>{
  const c=urduCues[i-1];
  if(!c)throw Error('Original Urdu cue '+i+' does not exist');
  return {segmentIndex:i,narrationStartSeconds:c.startSeconds,narrationEndSeconds:c.endSeconds,text:c.text,
    previousAcceptedDecision:progress.allDecisions[i-1]};
 });
 // Rank each distant narration fragment independently, with a total 20K cap.
 const evidence=taskSegments.map(s=>({
  segmentIndex:s.segmentIndex,
  ...rankDeepMuseCandidates(sourceSrt,[s],urduCues.map((c,i)=>({
    segmentIndex:i+1,narrationStartSeconds:c.startSeconds,narrationEndSeconds:c.endSeconds,text:c.text
  })),progress.allDecisions.filter(d=>!plan.indices.includes(d.segmentIndex)),4000)
 }));
 return {plan,taskSegments,evidence,
  instructions:'CINEPULSE TARGETED URDU RE-MATCH V5.2. This is a NEW Muse semantic decision task, not a cut-plan resubmission. '+
  'Analyze each of these '+taskSegments.length+' specified Urdu narration segments against the WHOLE original movie SRT. '+
  'Choose a genuinely different scene anchor with exact original source cue quotation, source cue IDs, a genuine rejected alternative, confidence, a real Muse call reference, and a character/event/story reasoning explanation. '+
  'The original 369 Urdu accepted decisions remain immutable. Other accepted Urdu source intervals are RESERVED. '+
  'Preserve all accepted English results, both original TTS MP3s and SRTs. Never change them. '+
  'A 25-second proximity rule still applies to Urdu cuts; each clip remains 3–6 seconds. '+
  'The goal is to find new non-overlapping scene evidence that permits the eight short narration segments to be represented by a valid final cut. '+
  'Return only JSON {"decisions":[{"segmentIndex":41,"sourceStartSeconds":100,"sourceEndSeconds":104,'+
  '"sourceCueIds":[5],"evidenceQuote":"exact original SRT text","reason":"why this source scene fits",' +
  '"alternatives":[{"cueId":6,"reason":"why rejected"}],"confidence":0.7,"museRequestId":"actual-ID"}]}. '+
  'If any genuine source scene is unavailable, return a real unresolved-task error rather than fabricating evidence. '+
  'TARGETS:'+JSON.stringify(taskSegments)+'\nWHOLE-MOVIE RANKED CANDIDATES (advisory; Muse must reason and search original SRT):\n'+
  evidence.map(e=>'SEGMENT '+e.segmentIndex+'\n'+e.candidateEvidenceText).join('\n')
 };
}
export function validateTargetedUrduRematch({sourceSrt,urduCues,acceptedBatches,completedRepairs,plan,payload}){
 if(!payload||!Array.isArray(payload.decisions))throw Error('Muse corrections object requires decisions');
 const indices=plan.indices.slice(plan.offset,plan.offset+URDU_REPAIR_BATCH_MAX);
 if(payload.decisions.length!==indices.length)throw Error('Only the exact '+indices.length+' specified Urdu narration segments may be repaired in this batch');
 const progress=deepProductionProgress(urduCues,acceptedBatches);
 if(!progress.complete)throw Error('Urdu accepted decisions incomplete');
 const already=new Set((completedRepairs||[]).flatMap(b=>b.decisions.map(d=>d.segmentIndex)));
 const selected=new Set(plan.indices);
 const reserved=progress.allDecisions.filter(d=>!selected.has(d.segmentIndex)||already.has(d.segmentIndex))
  .map(d=>[d.sourceStartSeconds,d.sourceEndSeconds]);
 const checked=[];
 for(let i=0;i<indices.length;i++){
  const d=payload.decisions[i],index=indices[i],old=progress.allDecisions[index-1];
  if(d?.segmentIndex!==index||!old)throw Error('Muse must repair exact requested original Urdu segment '+index);
  if(already.has(index))throw Error('Urdu segment '+index+' was already re-matched');
  // Reuse the battle-tested source quotation, alternate-cue, chronology
  // and provenance validator on this SINGLE measured narration cue.
  const one=validateProductionDeepBatch('urdu',[urduCues[index-1]],sourceSrt,[],
    {decisions:[{...d,segmentIndex:1}]}).decisions[0];
  const verified={...one,segmentIndex:index};
  if(Math.abs(verified.sourceStartSeconds-old.sourceStartSeconds)<.5 &&
     Math.abs(verified.sourceEndSeconds-old.sourceEndSeconds)<.5)
   throw Error('Urdu segment '+index+' submitted its old source anchor unchanged');
  const interval=[verified.sourceStartSeconds,verified.sourceEndSeconds];
  if(!finite(interval[0])||!finite(interval[1])||reserved.some(x=>near(interval,x)))
   throw Error('Replacement source anchor overlaps existing preserved Urdu decision at segment '+index);
  reserved.push(interval);
  checked.push(verified);
 }
 return {language:'urdu',targetedRepair:true,decisions:checked,
  sourceCutJobId:plan.sourceCutJobId,visualVerified:false};
}
