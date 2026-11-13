/**
 * Isolated CinePulse V5-G restart preflight (NO D1/R2, worker, queue or cut writes).
 * This SRT-only variant does not inspect movie frames or require source video.
 * Subtitle gaps remain unknown context; they never prove visual action.
 */
import {parseMeasuredCues} from './scene-lab-package.mjs';
const okId=x=>typeof x==='string'&&/^[A-Za-z0-9][\w:.+-]{0,127}$/.test(x);
const norm=x=>String(x??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const time=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&b>a;
const overlap=(a,b)=>a.start<b.end-.001&&a.end>b.start+.001;
const R=(errors,warnings,fields={})=>({ready:errors.length===0,errors,warnings,...fields});
export const BFG_PILOT={movie:'The BFG (2016)',originalProjectId:'796b9f28-9f31-484f-91e2-e40a385950c6',
 worker:'INT',reportedSourceCues:1239,expectedSourceSha256:'c8ba15b4dd98e7d5c50266f2d01fcb689c0d5fb15fd63b240802f91bf91c9268',allowProductionMutation:false};
export function inspectSourceIntake(srt,{expectedCues=null,gapSeconds=5}={}){
 let cues;try{cues=parseMeasuredCues(srt)}catch(e){return R(['Invalid source SRT: '+e.message],[],{sourceCueCount:0,gaps:[]})}
 const errors=[],gaps=[];
 if(expectedCues!==null&&cues.length!==expectedCues)errors.push('Expected '+expectedCues+' original cues; got '+cues.length);
 for(let i=1;i<cues.length;i++)if(cues[i].startSeconds-cues[i-1].endSeconds>=gapSeconds)
  gaps.push({start:cues[i-1].endSeconds,end:cues[i].startSeconds,
   precedingCue:i,followingCue:i+1,status:'uncaptioned_interval_only',evidence:'subtitle_gap_only'});
 return R(errors,[],{sourceCueCount:cues.length,gaps,sourceSrtLastCueEnd:cues.at(-1).endSeconds,
  videoInputRequired:false,uncaptionedActionsInferred:false,productionProjectCreated:false});
}
/** SRT-only pre-TTS check: source cue -> digest beat -> source window -> bilingual narration. */
export function inspectBeforeVoice({sourceSrt,beats,blueprint,narrationUnits}={}){
 let source;try{source=parseMeasuredCues(sourceSrt)}catch(e){return R(['Invalid source SRT: '+e.message],[])};
 const errors=[],warnings=[],beatMap=new Map(),blue=new Map(),usedCue=new Map();
 if(!Array.isArray(beats)||!Array.isArray(blueprint)||!Array.isArray(narrationUnits))
  return R(['beats, blueprint, narrationUnits must be arrays'],warnings);
 for(const b of beats){
  if(!okId(b?.id)||beatMap.has(b.id)){errors.push('Invalid/duplicate digest ID');continue}
  beatMap.set(b.id,b);
  if(!String(b.summary||'').trim()||!Array.isArray(b.evidence)||!b.evidence.length){
   errors.push('Unbacked digest beat '+b.id);continue;
  }
  for(const ev of b.evidence){
   if(ev?.kind==='subtitle'){
    const c=Number.isInteger(ev.cueId)&&ev.cueId>0?source[ev.cueId-1]:null;
    if(!c||norm(ev.exactQuote).length<2||!norm(c.text).includes(norm(ev.exactQuote)))
     errors.push('Digest beat '+b.id+' has false source citation');
    else{
     if(usedCue.has(ev.cueId)&&usedCue.get(ev.cueId)!==b.id)
      errors.push('Original cue '+ev.cueId+' claimed by distinct story beats');
     usedCue.set(ev.cueId,b.id);
    }
   }else if(ev?.kind==='visual'){
    errors.push('Video-derived scene evidence is excluded from the SRT-only workflow at beat '+b.id);
   }else errors.push('Unknown digest evidence type '+b.id);
  }
 }
 for(const x of blueprint){
  if(!okId(x?.beatId)||blue.has(x.beatId)){errors.push('Duplicate/invalid blueprint entry');continue}
  blue.set(x.beatId,x);
  if(!beatMap.has(x.beatId))errors.push('Unknown blueprint beat '+x.beatId);
  if(!time(x.startSeconds,x.endSeconds)||x.endSeconds>source.at(-1).endSeconds+0.001)errors.push('Invalid SRT source window '+x.beatId);
  const b=beatMap.get(x.beatId);
  if(b?.evidence.some(e=>e.kind==='subtitle')&&!b.evidence.some(e=>{
    const c=source[e.cueId-1];return e.kind==='subtitle'&&c&&x.startSeconds<=c.endSeconds&&x.endSeconds>=c.startSeconds;
  }))errors.push('Blueprint misses cited SRT source cue '+x.beatId);
 }
 for(const id of beatMap.keys())if(!blue.has(id))errors.push('Missing scene blueprint '+id);
 const byLang={english:new Set(),urdu:new Set()},unitKeys=new Set();
 for(const u of narrationUnits){
  const key=u?.language+':'+u?.id;
  if(!['english','urdu'].includes(u?.language)||!okId(u?.id)||unitKeys.has(key)){
   errors.push('Duplicate or invalid narration unit');continue}
  unitKeys.add(key);
  if(!String(u.text||'').trim()||!Array.isArray(u.beatIds)||!u.beatIds.length)
   errors.push('Narration '+key+' not backed by digest');
  else for(const id of u.beatIds){
   if(!beatMap.has(id))errors.push('Narration '+key+' cites missing beat '+id);
   else byLang[u.language].add(id);
  }
 }
 for(const lang of ['english','urdu']){
  if([...unitKeys].some(k=>k.startsWith(lang+':'))){
   for(const id of beatMap.keys())if(!byLang[lang].has(id))
    errors.push(lang+' narration omits story beat '+id);
  }else warnings.push(lang+' narration not yet supplied');
 }
 if(!beatMap.size)errors.push('Empty digest');
 return R(errors,warnings,{stage:'before_voice',sourceCueCount:source.length,digestBeats:beatMap.size,
   narrationUnitCount:unitKeys.size,sourceAnchorPlanCount:blue.size,videoInputRequired:false,
   allSourceAndAudioImmutable:true,productionApplyAuthorized:false});
}
/** Keep actual STT cue timestamps while grouping short speech as ONE semantic event. */
export function inspectAfterVoice({units,measuredCues}={}){
 const errors=[],groups=[],uMap=new Map(),byUnit=new Map(),perLang={english:[],urdu:[]};
 if(!Array.isArray(units)||!Array.isArray(measuredCues))return R(['units and measuredCues arrays required'],[],{groups});
 for(const u of units){const key=u?.language+':'+u?.id;
  if(!['english','urdu'].includes(u?.language)||!okId(u?.id)||uMap.has(key))errors.push('Duplicate/invalid unit');
  else uMap.set(key,u);
 }
 for(const c of measuredCues){
  const key=c?.language+':'+c?.index;
  if(!['english','urdu'].includes(c?.language)||!Number.isInteger(c.index)||c.index<1||
      !time(c.startSeconds,c.endSeconds)||!String(c.text||'').trim()){errors.push('Invalid measured cue '+key);continue}
  perLang[c.language].push(c);
  if(!Array.isArray(c.unitIds)||!c.unitIds.length)errors.push('Unaligned measured cue '+key);
  else for(const id of c.unitIds){
   const uid=c.language+':'+id;
   if(!uMap.has(uid)){errors.push('STT cue cites unknown unit '+uid);continue}
   if(!byUnit.has(uid))byUnit.set(uid,[]);
   byUnit.get(uid).push(c);
  }
 }
 for(const lang of ['english','urdu']){
  const a=perLang[lang].sort((x,y)=>x.index-y.index);
  for(let i=0;i<a.length;i++)if(a[i].index!==i+1||(i&&a[i].startSeconds<a[i-1].startSeconds-.003))
   errors.push(lang+' STT cue index/timing gap or reversal');
 }
 for(const [key,u] of uMap){
  const a=(byUnit.get(key)||[]).sort((x,y)=>x.index-y.index);
  if(!a.length){errors.push('Unit '+key+' has no timed audio');continue}
  if(a.some((x,i)=>i>0&&x.index!==a[i-1].index+1))errors.push('Noncontiguous sentence '+key);
  groups.push({language:u.language,unitId:u.id,beatIds:u.beatIds,cueIndices:a.map(x=>x.index),
    startSeconds:a[0].startSeconds,endSeconds:a.at(-1).endSeconds});
 }
 return R(errors,[],{groups,measuredSrtUnchanged:true,productionApplyAuthorized:false});
}
/** An SRT-only dry run checks cited source text and semantic score, never pixels. */
export function inspectGlobalSceneDryRun({sourceSrt,groups,decisions,qualityFloor=.9}={}){
 let source;try{source=parseMeasuredCues(sourceSrt)}catch(e){return R(['Invalid source SRT: '+e.message],[])};
 const errors=[],warnings=[],precision=[],unsupported=[],verified=[],reserved={english:[],urdu:[]};
 if(!Array.isArray(groups)||!Array.isArray(decisions))return R(['groups and decisions arrays required'],[]);
 if(!Number.isFinite(qualityFloor)||qualityFloor<.9||qualityFloor>1)errors.push('9/10 quality floor cannot be lowered');
 const wanted=new Set(groups.map(g=>g.language+':'+g.unitId)),seen=new Set();
 for(const d of decisions){
  const key=d?.language+':'+d?.unitId;
  if(!wanted.has(key)||seen.has(key)){errors.push('Unknown/repeated scene decision '+key);continue}
  seen.add(key);
  if(d.status==='unsupported'){unsupported.push(key);continue}
  if(!time(d.startSeconds,d.endSeconds)||d.endSeconds>source.at(-1).endSeconds+30){
   errors.push('Invalid source time '+key);continue
  }
  if(d.status==='precision'||!Number.isFinite(d.qualityScore)||d.qualityScore<qualityFloor){
   precision.push(key);continue
  }
  if(d.status!=='verified'){errors.push('Unknown dry-run status '+key);continue}
  const hasExactSubtitleProof=Array.isArray(d.sourceCueIds)&&
   d.sourceCueIds.some(id=>{
    const cue=Number.isInteger(id)&&id>0?source[id-1]:null;
    return cue&&norm(d.evidenceQuote).length>=2&&norm(cue.text).includes(norm(d.evidenceQuote))&&
     d.startSeconds<=cue.endSeconds+12&&d.endSeconds>=cue.startSeconds-12;
   });
  if(d.independentSubtitleReview!==true||!okId(d.reviewerRef)||
     typeof d.reason!=='string'||d.reason.trim().length<24||!hasExactSubtitleProof){
   warnings.push('Independent source-SRT citation or semantic rationale missing '+key);
   precision.push(key);continue;
  }
  const win={start:d.startSeconds,end:d.endSeconds};
  if(reserved[d.language]?.some(x=>overlap(x,win))){
   errors.push('Same-language source footage overlap '+key);continue
  }
  reserved[d.language].push(win);verified.push(key);
 }
 for(const key of wanted)if(!seen.has(key))errors.push('Dry run missing scene decision '+key);
 const v=R(errors,warnings,{verified,precision,unsupported,stage:'dry_run',
   allSegmentsAccounted:seen.size===wanted.size,mutationsPerformed:false,productionApplyAuthorized:false});
 v.ready=v.ready&&precision.length===0&&unsupported.length===0;
 return v;
}
