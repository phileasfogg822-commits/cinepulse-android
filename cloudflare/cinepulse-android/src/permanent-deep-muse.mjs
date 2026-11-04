/**
 * CinePulse V5 — permanent Muse-owned, segment-by-segment, full-movie matching.
 * Only NEW stable projects use these stages. Previous V4 and Scene Lab jobs
 * retain their own recorded pipelines for historical recovery and downloads.
 */
import {parseMeasuredCues} from './scene-lab-package.mjs';
import {rankDeepMuseCandidates,DEEP_CANDIDATE_BUDGET} from './scene-lab-deep-candidates.mjs';
import {validateCompleteCutPlan} from './scene-lab.mjs';
export const PERMANENT_DEEP_MARKER='[CINEPULSE-V5-PERMANENT-DEEP-MUSE]';
export const PERMANENT_DEEP_BUILD='cinepulse-production-muse-deep-v5.0';
export const PERMANENT_DEEP_MATCH_EN='deep_match_english';
export const PERMANENT_DEEP_MATCH_UR='deep_match_urdu';
export const PERMANENT_DEEP_CUTS='deep_cut_plan';
export const PERMANENT_DEEP_BATCH_SIZE=5;
export const PERMANENT_DEEP_MATCH_STEPS=[PERMANENT_DEEP_MATCH_EN,PERMANENT_DEEP_MATCH_UR];
export const PERMANENT_DEEP_STEPS=[
 'digest','narration_english','narration_urdu','publishing_metadata',
 'mp3_english','srt_english','mp3_urdu','srt_urdu',
 PERMANENT_DEEP_MATCH_EN,PERMANENT_DEEP_MATCH_UR,PERMANENT_DEEP_CUTS,'windows_project'
];
const n=v=>typeof v==='number'&&Number.isFinite(v);
const stop=new Set('the and that this with from have has had were was are for but not you your his her their they them then than into onto out about after before when where what who why how can could would should will just like also only over under again still more most some any all one two three very now him she he it its we our of'.split(' '));
const clean=x=>String(x??'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
export const isProductionDeepStage=step=>PERMANENT_DEEP_MATCH_STEPS.includes(step)||step===PERMANENT_DEEP_CUTS;
export const deepLanguage=step=>step===PERMANENT_DEEP_MATCH_EN?'english':step===PERMANENT_DEEP_MATCH_UR?'urdu':null;

export function loadProductionCues(srt){
 const cues=parseMeasuredCues(srt);
 if(cues.length>10000)throw Error('More than 10000 narration cues not allowed');
 if(!cues.every((c,i)=>c.startSeconds>=0&&c.endSeconds>c.startSeconds&&
    (i===0||c.startSeconds>=cues[i-1].startSeconds-.003)))
   throw Error('Measured narration SRT has invalid or reversed cues');
 return cues;
}
export function deepProductionProgress(cues,accepted){
 if(!Array.isArray(cues)||!cues.length)throw Error('Measured narration cues required');
 const total=Math.ceil(cues.length/PERMANENT_DEEP_BATCH_SIZE);
 const prior=accepted.flatMap(b=>b.decisions||[]);
 if(prior.length>cues.length||prior.some((d,i)=>d.segmentIndex!==i+1))
   throw Error('Corrupt or out-of-order Deep Muse checkpoints');
 if(accepted.length>total||accepted.some((b,i)=>b.decisions?.length!==Math.min(5,cues.length-i*5)))
   throw Error('Incomplete Deep Muse batch in durable record');
 return {batchIndex:accepted.length,batchCount:total,reviewedSegments:prior.length,
  totalSegments:cues.length,allDecisions:prior,complete:prior.length===cues.length};
}
export function productionDeepPrompt(lang,batch,cues,sourceSrt,accepted){
 const progress=deepProductionProgress(cues,accepted);
 const start=progress.reviewedSegments;
 if(progress.complete)throw Error('All segments already matched');
 const segments=cues.slice(start,start+5).map((c,i)=>({
  segmentIndex:start+i+1,narrationStartSeconds:c.startSeconds,
  narrationEndSeconds:c.endSeconds,text:c.text
 }));
 const ranked=rankDeepMuseCandidates(sourceSrt,segments,
  cues.map((c,i)=>({...c,segmentIndex:i+1,narrationStartSeconds:c.startSeconds,narrationEndSeconds:c.endSeconds})),
  progress.allDecisions);
 const prompt='CINEPULSE V5 PERMANENT DEEP MUSE MATCHING. Language '+lang.toUpperCase()+
  '. Batch '+(progress.batchIndex+1)+'/'+progress.batchCount+'; narration segments '+(start+1)+'–'+(start+segments.length)+
  ' of '+cues.length+'. Use MUSE SEMANTIC REASONING for EACH narration segment independently.'+
  ' Rank candidates from ENTIRE movie source SRT. The 22K-ranked cues are ADVISORY, not a substitute for your own source search.'+
  ' Confirm who/what/when, quoted source dialogue, alternative scene and rejection reason.'+
  ' Do not insist that the movie source timestamps always increase; prefer literal relevance over chronological echo.'+
  ' Do not reuse accepted source anchors WITHIN THIS LANGUAGE. Other language matches are independent.'+
  ' On uncertain alignment report an unresolved issue instead of inventing a match or claiming visual verification.'+
  ' Return JSON {"decisions":[{"segmentIndex":1,"sourceStartSeconds":100,"sourceEndSeconds":103,'+
  '"sourceCueIds":[1],"evidenceQuote":"exact passage copied from source cue",' +
  '"reason":"specific character/event/story rationale and limitations",' +
  '"alternatives":[{"cueId":2,"reason":"why rejected"}],"confidence":0.80,'+
  '"museRequestId":"actual-Muse-call-reference"}]}. Submit a decision for EVERY supplied segment.'+
  ' NEVER submit a precomputed fast-scoring cut plan.';
 return {segments,ranked,progress,prompt:prompt+'\nNARRATION:\n'+JSON.stringify(segments)+
  '\nORIGINAL MOVIE EVIDENCE (advisory candidates, within 22K character budget):\n'+ranked.candidateEvidenceText};
}
export function validateProductionDeepBatch(lang,cues,sourceSrt,accepted,payload){
 const progress=deepProductionProgress(cues,accepted);
 if(progress.complete)throw Error('Already completed '+lang+' matching');
 const expected=cues.slice(progress.reviewedSegments,progress.reviewedSegments+5);
 if(!payload||!Array.isArray(payload.decisions)||payload.decisions.length!==expected.length)
  throw Error('One Muse semantic decision required per measured '+lang+' narration segment');
 const source=loadProductionCues(sourceSrt);
 const sourceEnd=source.at(-1).endSeconds,used=progress.allDecisions.map(d=>[d.sourceStartSeconds,d.sourceEndSeconds]);
 const result=[];
 for(let i=0;i<expected.length;i++){
  const d=payload.decisions[i],segment=expected[i],index=progress.reviewedSegments+i+1;
  if(!d||d.segmentIndex!==index)throw Error('Missing/wrong Muse segment index: '+index);
  if(!n(d.sourceStartSeconds)||!n(d.sourceEndSeconds)||d.sourceStartSeconds<0||
   d.sourceEndSeconds<=d.sourceStartSeconds||d.sourceEndSeconds>sourceEnd+.01||
   d.sourceEndSeconds-d.sourceStartSeconds>30)throw Error('Invalid source anchor for segment '+index);
  if(!Array.isArray(d.sourceCueIds)||d.sourceCueIds.length<1||d.sourceCueIds.length>8||
   !d.sourceCueIds.every(id=>Number.isInteger(id)&&id>=1&&id<=source.length))
   throw Error('Original source cue IDs missing at segment '+index);
  const quote=clean(d.evidenceQuote);
  if(quote.length<6||!d.sourceCueIds.some(id=>clean(source[id-1].text).includes(quote)))
   throw Error('Exact quoted evidence not found in cited original cue at segment '+index);
  if(!d.sourceCueIds.some(id=>{
   const c=source[id-1];
   return d.sourceStartSeconds<=c.endSeconds+12&&d.sourceEndSeconds>=c.startSeconds-12;
  }))throw Error('Source anchor too far from cited original cue at segment '+index);
  if(typeof d.reason!=='string'||d.reason.trim().length<24)
   throw Error('Muse semantic rationale missing at segment '+index);
  if(!Array.isArray(d.alternatives)||!d.alternatives.some(a=>
   Number.isInteger(a?.cueId)&&a.cueId>=1&&a.cueId<=source.length&&
   !d.sourceCueIds.includes(a.cueId)&&typeof a.reason==='string'&&a.reason.trim().length>=8))
   throw Error('Rejected source alternative required at segment '+index);
  if(!n(d.confidence)||d.confidence<0||d.confidence>1)
   throw Error('Confidence invalid at segment '+index);
  if(typeof d.museRequestId!=='string'||d.museRequestId.trim().length<6)
   throw Error('Muse request reference missing at segment '+index);
  if(used.some(([a,b])=>d.sourceStartSeconds<b-.001&&d.sourceEndSeconds>a+.001))
   throw Error('Source anchor reused from previously accepted Muse segment '+index);
  used.push([d.sourceStartSeconds,d.sourceEndSeconds]);
  result.push({...d,narrationStartSeconds:segment.startSeconds,
   narrationEndSeconds:segment.endSeconds,narrationText:segment.text,visualVerified:false});
 }
 return {language:lang,batchIndex:progress.batchIndex,decisions:result,visualVerified:false};
}
export function validateProductionDeepCuts(lang,cues,cuts,accepted){
 const progress=deepProductionProgress(cues,accepted);
 if(!progress.complete)throw Error('Cannot generate '+lang+' cuts before Muse reviews every measured cue');
 const target=cues.at(-1).endSeconds;
 validateCompleteCutPlan(cuts,target);
 const decisions=progress.allDecisions,used=new Set(),verified=[];
 for(let i=0;i<cuts.length;i++){
  const c=cuts[i],refs=c.matchSegmentIndices;
  if(!Array.isArray(refs)||!refs.length||refs.length>6||
    !refs.every(k=>Number.isInteger(k)&&k>0&&k<=decisions.length))
   throw Error(lang+' cut '+(i+1)+' missing valid segment-to-Muse evidence linkage');
  const eligible=refs.map(k=>decisions[k-1]).filter(d=>
   c.narrationStartSeconds<d.narrationEndSeconds+3&&c.narrationEndSeconds>d.narrationStartSeconds-3&&
   c.sourceStartSeconds>=d.sourceStartSeconds-12&&c.sourceEndSeconds<=d.sourceEndSeconds+12);
  if(!eligible.length)throw Error(lang+' cut '+(i+1)+' has no nearby accepted Muse source anchor');
  for(const e of eligible)used.add(e.segmentIndex);
  verified.push({...c,language:lang,confidence:Math.min(...eligible.map(e=>e.confidence)),
   sourceEvidence:eligible.map(e=>'cue '+e.sourceCueIds.join(',')+': '+e.evidenceQuote).join(' | ')});
 }
 if(used.size!==decisions.length)
  throw Error(lang+' final cuts do not represent all Muse-reviewed narration cues ('+used.size+'/'+decisions.length+')');
 return {cuts:verified,totalSegments:decisions.length,batches:accepted.length,
  museRequestIds:[...new Set(decisions.map(d=>d.museRequestId))],
  visualVerified:false};
}
export function combineProductionDeepCuts(english,urdu,enCues,urCues,enBatches,urBatches){
 const a=validateProductionDeepCuts('english',enCues,english,enBatches);
 const b=validateProductionDeepCuts('urdu',urCues,urdu,urBatches);
 return {cuts:[...a.cuts,...b.cuts],
  provenance:{method:'muse_semantic_batches',mode:'permanent_deep',
   english:{reviewedSegments:a.totalSegments,batches:a.batches,requestIds:a.museRequestIds},
   urdu:{reviewedSegments:b.totalSegments,batches:b.batches,requestIds:b.museRequestIds},
   visualVerified:false}};
}
export function summariseProductionDeepMatches(enBatches,urBatches){
 return [...enBatches.flatMap(b=>b.decisions).map(d=>({language:'english',...d})),
  ...urBatches.flatMap(b=>b.decisions).map(d=>({language:'urdu',...d}))];
}
