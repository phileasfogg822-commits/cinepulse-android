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
