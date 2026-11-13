/**
 * Read-only source-SRT contextual interval analysis.
 *
 * Never infers pixels, visual actions, or actual silence from missing captions.
 * Dialogue before/after a gap and explicitly bracketed sound/action captions
 * are reviewable SOURCE EVIDENCE, not evidence of what was seen in a movie.
 */
import {parseMeasuredCues} from './scene-lab-package.mjs';

const finitePositive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function extractBracketedSrtCaptions(text){
 const pattern=/\(([^)\n]{2,140})\)|\[([^\]\n]{2,140})\]/g;
 return [...String(text||'').matchAll(pattern)].map(m=>({
  quote:m[0],
  captionText:(m[1]||m[2]).trim(),
  evidenceKind:'literal_srt_caption',
  impliesVisibleAction:false
 })).filter(x=>x.captionText.length>=2);
}
/**
 * Verify an SRT-only gap transition cited by a digest beat. The gap is between
 * two ADJACENT original cues, both quotes are exact, and any cited bracket
 * caption actually occurs in its neighboring source context. No visible event
 * can be proved by this receipt.
 *
 * The optional caption is evidence of a captioned sound/action, not evidence
 * that it happened inside the gap or that it appeared on screen.
 */
export function verifySrtContextBridge(cues, evidence){
 if(!Array.isArray(cues)||!evidence||evidence.kind!=='srt_context')
  return {valid:false,reason:'SRT bridge evidence missing'};
 const left=evidence.precedingCueId,right=evidence.followingCueId;
 if(!Number.isInteger(left)||left<1||!Number.isInteger(right)||
    right!==left+1||right>cues.length)
  return {valid:false,reason:'SRT gap boundary cues must be adjacent'};
 const a=cues[left-1],b=cues[right-1];
 const gap=b.startSeconds-a.endSeconds;
 if(gap<5||!Number.isFinite(gap))
  return {valid:false,reason:'SRT gap is not at least five seconds'};
 const exact=(source,quote)=>typeof quote==='string'&&quote.trim().length>=2&&
  source.toLowerCase().replace(/\s+/g,' ').includes(quote.trim().toLowerCase().replace(/\s+/g,' '));
 if(!exact(a.text,evidence.precedingExactQuote)||!exact(b.text,evidence.followingExactQuote))
  return {valid:false,reason:'SRT gap surrounding quote is not exact'};
 const mode=evidence.role;
 if(!['temporal_transition','caption_supported_context'].includes(mode)||
    typeof evidence.reason!=='string'||evidence.reason.trim().length<18)
  return {valid:false,reason:'SRT context role or explanation missing'};
 if(mode==='caption_supported_context'){
  const captionId=evidence.captionCueId;
  if(!Number.isInteger(captionId)||captionId<Math.max(1,left-2)||
     captionId>Math.min(cues.length,right+2))
   return {valid:false,reason:'SRT caption cue is not neighboring context'};
  const c=cues[captionId-1];
  if((captionId<right&&c.endSeconds<a.endSeconds-30)||
     (captionId>=right&&c.startSeconds>b.startSeconds+30))
   return {valid:false,reason:'SRT caption is too far from gap'};
  const phrases=extractBracketedSrtCaptions(c.text);
  if(!phrases.some(p=>p.quote===evidence.exactCaption))
   return {valid:false,reason:'Claimed sound/action caption is absent from source SRT'};
 }
 return {valid:true,kind:'srt_context',startSeconds:a.endSeconds,endSeconds:b.startSeconds,
  reason:'Verified SRT time and context citation only',
  visualContentVerified:false,audioSilenceVerified:false,
  requiresSemanticReview:true,automaticVisibleActionClaimsAllowed:false};
}
const cueRecord=(cue,i)=>({
 cueId:i+1,startSeconds:cue.startSeconds,endSeconds:cue.endSeconds,
 text:cue.text,bracketedCaptions:extractBracketedSrtCaptions(cue.text)
});
export function analyzeSrtUncaptionedIntervals(srt,{
 minGapSeconds=5,neighborCues=3,captionRadiusSeconds=30
}={}){
 if(!finitePositive(minGapSeconds)||!Number.isInteger(neighborCues)||
    neighborCues<1||neighborCues>6||!finitePositive(captionRadiusSeconds))
  throw Error('Invalid SRT context window settings');
 const cues=parseMeasuredCues(srt);
 const gaps=[];
 for(let i=1;i<cues.length;i++){
  const start=cues[i-1].endSeconds,end=cues[i].startSeconds;
  if(end-start<minGapSeconds)continue;
  const before=cues.slice(Math.max(0,i-neighborCues),i).map((c,j)=>cueRecord(c,Math.max(0,i-neighborCues)+j));
  const after=cues.slice(i,Math.min(cues.length,i+neighborCues)).map((c,j)=>cueRecord(c,i+j));
  const bracketedCaptionEvidence=[];
  for(const side of ['before','after']){
   const list=side==='before'?before:after;
   for(const c of list){
    if((side==='before'&&c.endSeconds<start-captionRadiusSeconds)||
       (side==='after'&&c.startSeconds>end+captionRadiusSeconds))continue;
    for(const caption of c.bracketedCaptions)
     bracketedCaptionEvidence.push({
      side,cueId:c.cueId,startSeconds:c.startSeconds,endSeconds:c.endSeconds,
      exactCaption:caption.quote,evidenceKind:'literal_srt_caption',
      locatedInsideGap:false
     });
   }
  }
  gaps.push({
   start,end,durationSeconds:Number((end-start).toFixed(3)),
   precedingCue:i,followingCue:i+1,
   status:'uncaptioned_interval_only',evidence:'subtitle_gap_only',
   before,after,bracketedCaptionEvidence,
   contextPriority:bracketedCaptionEvidence.length?'caption_context_priority':'dialogue_context_review',
   contextUsableForDraft:true,
   verifiedVisualAction:false,
   audioSilenceVerified:false,
   autoNarrateSpecificUncaptionedAction:false,
   interpretationRule:'Interpret neighboring dialogue and literal captions; do not invent events inside gap'
  });
 }
 return gaps;
}
