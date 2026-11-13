/**
 * Read-only V5 story-evidence preflight. NOT a queue stage.
 * Operates on original source subtitles only; no movie file or frame inspection.
 */
import {parseMeasuredCues} from './scene-lab-package.mjs';
import {analyzeSrtUncaptionedIntervals} from './srt-interval-context.mjs';
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(x);
const norm=x=>String(x||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
const interval=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&b>a;

/** Gaps indicate only missing subtitle captions, not proven silent scenes. */
export function findUncaptionedIntervals(srt,seconds=4){
 return analyzeSrtUncaptionedIntervals(srt,{minGapSeconds:seconds}).map(g=>({
  startSeconds:g.start,endSeconds:g.end,status:g.status,source:g.evidence,
  precedingCueId:g.precedingCue,followingCueId:g.followingCue,
  precedingDialogue:g.before,followingDialogue:g.after,
  bracketedCaptionEvidence:g.bracketedCaptionEvidence,
  contextPriority:g.contextPriority,
  autoNarrateSpecificUncaptionedAction:false,
  audioSilenceVerified:false,verifiedVisualAction:false
 }));
}

/** Links source SRT -> digest beats -> narration units -> measured audio cues.
 * One semantic narration unit may span multiple real subtitle cues. Captions
 * retain their measured timestamps; no source footage is assigned here. */
export function inspectStoryEvidenceBlueprint(input={}){
 const errors=[],warnings=[],groups=[];
 let source;
 try{source=parseMeasuredCues(input.sourceSrt)}catch(e){
  return {ready:false,errors:['Invalid original SRT: '+e.message],warnings,groups};
 }
 const beats=input.beats,units=input.narrationUnits,measured=input.measuredCues;
 if(!Array.isArray(beats)||!Array.isArray(units)||!Array.isArray(measured))
  return {ready:false,errors:['beats, narrationUnits and measuredCues must all be arrays'],warnings,groups};
 const knownBeats=new Set();
 for(const beat of beats){
  if(!id(beat?.id)||knownBeats.has(beat.id)){errors.push('Invalid or duplicate digest beat ID');continue;}
  knownBeats.add(beat.id);
  if(!String(beat.summary||'').trim())errors.push('Digest beat '+beat.id+' lacks a story description');
  if(!Array.isArray(beat.evidence)||beat.evidence.length===0){errors.push('Digest beat '+beat.id+' lacks source evidence');continue;}
  for(const item of beat.evidence){
   if(item?.kind==='subtitle'){
    const cue=Number.isInteger(item.cueId)?source[item.cueId-1]:null;
    if(!cue||norm(item.quote).length<2||!norm(cue.text).includes(norm(item.quote)))
     errors.push('Digest beat '+beat.id+' has invalid exact source quote/cue');
   }else if(item?.kind==='visual'){
    errors.push('Digest beat '+beat.id+' relies on excluded visual-only evidence');
   }else errors.push('Digest beat '+beat.id+' has unknown evidence kind');
  }
 }
 const unitMap=new Map();
 for(const unit of units){
  const key=unit?.language+':'+unit?.id;
  if(!['english','urdu'].includes(unit?.language)||!id(unit.id)||unitMap.has(key)){
   errors.push('Invalid or duplicate narration unit');continue;
  }
  unitMap.set(key,unit);
  if(!String(unit.text||'').trim())errors.push('Narration '+key+' has no text');
  if(!Array.isArray(unit.beatIds)||!unit.beatIds.length)errors.push('Narration '+key+' lacks digest references');
  else for(const beatId of unit.beatIds)if(!knownBeats.has(beatId))errors.push('Narration '+key+' references unknown digest beat '+beatId);
 }
 const byUnit=new Map(),byLanguage={english:[],urdu:[]},seen=new Set();
 for(const cue of measured){
  const key=cue?.language+':'+cue?.index;
  if(!['english','urdu'].includes(cue?.language)||!Number.isInteger(cue.index)||cue.index<=0||seen.has(key)){
   errors.push('Duplicate or invalid measured narration cue');continue;
  }
  seen.add(key);
  if(!interval(cue.startSeconds,cue.endSeconds)||!String(cue.text||'').trim())
   errors.push('Invalid real measured time/text for cue '+key);
  if(!Array.isArray(cue.unitIds)||!cue.unitIds.length)errors.push('Measured cue '+key+' has no narration alignment');
  else for(const uid of cue.unitIds){
   const ukey=cue.language+':'+uid;
   if(!unitMap.has(ukey))errors.push('Measured cue '+key+' references unknown narration unit '+uid);
   if(!byUnit.has(ukey))byUnit.set(ukey,[]);
   byUnit.get(ukey).push(cue);
  }
  byLanguage[cue.language].push(cue);
 }
 for(const [lang,cues] of Object.entries(byLanguage)){
  cues.sort((a,b)=>a.index-b.index);
  for(let i=0;i<cues.length;i++){
   if(cues[i].index!==i+1)errors.push(lang+' measured cue indices are not complete/ordered');
   if(i&&cues[i].startSeconds<cues[i-1].startSeconds)errors.push(lang+' measured cue timestamps are reversed');
  }
 }
 for(const [key,unit] of unitMap){
  const cues=(byUnit.get(key)||[]).sort((a,b)=>a.index-b.index);
  if(!cues.length){errors.push('Narration '+key+' has no measured audio alignment');continue;}
  if(cues.some((x,i)=>i&&x.index!==cues[i-1].index+1))
   errors.push('Narration '+key+' has noncontiguous measured cue alignment');
  groups.push({language:unit.language,unitId:unit.id,beatIds:Array.isArray(unit.beatIds)?[...unit.beatIds]:[],
   measuredCueIndices:cues.map(x=>x.index),startSeconds:cues[0].startSeconds,endSeconds:cues.at(-1).endSeconds});
 }
 if(!knownBeats.size)errors.push('No source-backed digest beats');
 for(const lang of ['english','urdu'])if(!units.some(x=>x.language===lang))warnings.push(lang+' narration not supplied');
 return {ready:errors.length===0,errors,warnings,groups,
  counts:{sourceCues:source.length,beats:knownBeats.size,narrationUnits:unitMap.size,measuredCues:seen.size}};
}
