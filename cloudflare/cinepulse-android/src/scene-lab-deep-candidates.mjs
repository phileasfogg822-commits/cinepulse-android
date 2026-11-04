/* CinePulse Windows SRT-first compatibility: 22k characters of whole-film cue
   evidence, chronological backbone, context neighbors, prior-usage guard.
   Rankings are candidate retrieval ONLY. Muse owns semantic cut decisions. */
import {parseMeasuredCues} from './scene-lab-package.mjs';
export const DEEP_CANDIDATE_BUDGET=22000;
const STOP=new Set('the and that this with from have has had were was are for but not you your his her their they them then than into onto out about after before when where what who why how can could would should will just like also only over under again still more most some any all one two three very now him she he it its we our of into'.split(' '));
const tok=x=>String(x||'').toLowerCase().replace(/[^\p{L}\p{N}']+/gu,' ').split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w));
export function rankDeepMuseCandidates(movieSrt,batch,all,prior=[],limit=DEEP_CANDIDATE_BUDGET){
 const cues=parseMeasuredCues(movieSrt),end=cues.at(-1).endSeconds;
 const first=all[0].narrationStartSeconds,last=all.at(-1).narrationEndSeconds;
 const mid=(batch[0].narrationStartSeconds+batch.at(-1).narrationEndSeconds)/2;
 const expected=end*Math.max(0,Math.min(1,(mid-first)/Math.max(1,last-first)));
 const words=tok(batch.map(s=>s.text).join(' ')),set=new Set(words),long=new Set(words.filter(w=>w.length>=5));
 const scale=Math.max(240,end*.12);
 const ranked=cues.map((c,i)=>{
  const blocked=prior.some(r=>c.endSeconds>r.sourceStartSeconds-1&&c.startSeconds<r.sourceEndSeconds+1);
  const t=tok(c.text),distance=Math.abs((c.startSeconds+c.endSeconds)/2-expected);
  return {i,blocked,distance,score:blocked?-Infinity:4*t.filter(w=>set.has(w)).length+
   2*t.filter(w=>long.has(w)).length+3*Math.max(0,1-distance/scale)};
 });
 const available=ranked.filter(r=>!r.blocked);
 const ordered=[...available].sort((a,b)=>b.score-a.score||a.distance-b.distance);
 const chosen=new Set();
 for(const row of ordered.slice(0,Math.min(90,Math.max(36,batch.length*7)))){
  chosen.add(row.i);
  if(row.i>0&&!ranked[row.i-1].blocked)chosen.add(row.i-1);
  if(row.i+1<ranked.length&&!ranked[row.i+1].blocked)chosen.add(row.i+1);
 }
 for(const row of [...available].sort((a,b)=>a.distance-b.distance).slice(0,Math.max(30,batch.length*4)))chosen.add(row.i);
 let chars=0;const selected=[];
 for(const row of [...chosen].map(i=>ranked[i]).sort((a,b)=>b.score-a.score||a.distance-b.distance)){
  const c=cues[row.i],line='CinePulse_Source.srt|'+c.startSeconds+'>'+c.endSeconds+'|'+c.text.replace(/\s+/g,' ');
  if(selected.length&&chars+line.length+1>limit)continue;
  selected.push({cueId:row.i+1,startSeconds:c.startSeconds,endSeconds:c.endSeconds,text:c.text,line});
  chars+=line.length+1;if(chars>=limit)break;
 }
 selected.sort((a,b)=>a.startSeconds-b.startSeconds);
 return {sourceCueCount:cues.length,candidateCount:selected.length,expectedStoryPositionSeconds:expected,
  budget:limit,usedCharacters:chars,priorReservedRanges:prior.length,
  candidates:selected.map(({line,...rest})=>rest),
  candidateEvidenceText:selected.map(x=>x.line).join('\n')};
}
