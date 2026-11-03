/**
 * CinePulse Scene Lab v1: isolated, deterministic experiment planning.
 * Does not change the production queue, cut validator, or Windows renderer.
 */
export const STRATEGIES=Object.freeze([
 'classic_reconstruction','character_first','dialogue_first','event_first',
 'character_dialogue_event','dialogue_event_character','event_character_dialogue',
 'chronological_graph','context_window','evidence_ensemble'
]);
export const WEIGHTS=Object.freeze({
 classic_reconstruction:[.2,.2,.2,.2,.2],
 character_first:[.42,.22,.16,.12,.08],
 dialogue_first:[.12,.46,.20,.14,.08],
 event_first:[.12,.18,.46,.16,.08],
 character_dialogue_event:[.38,.30,.20,.08,.04],
 dialogue_event_character:[.20,.40,.30,.07,.03],
 event_character_dialogue:[.30,.20,.40,.07,.03],
 chronological_graph:[.14,.16,.20,.42,.08],
 context_window:[.16,.22,.22,.32,.08],
 evidence_ensemble:[.25,.25,.25,.15,.10]
});
const SIGNALS=['character','dialogue','event','chronology','context'];
export function scoreCandidate(strategy,candidate){
 if(!STRATEGIES.includes(strategy))throw new Error('Unknown matching strategy');
 if(!candidate||typeof candidate!=='object')throw new Error('Candidate required');
 if(candidate.contradiction===true||candidate.supported===false)return {accepted:false,score:0,reason:'unsupported_or_contradictory'};
 const vals=SIGNALS.map(key=>{
  const n=candidate[key];
  if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)throw new Error('Invalid evidence score: '+key);
  return n;
 });
 const score=WEIGHTS[strategy].reduce((sum,w,i)=>sum+w*vals[i],0);
 return {accepted:score>=.6,score:Number(score.toFixed(4)),reason:score>=.6?'supported':'below_threshold'};
}
export function validateExperimentManifest(m){
 if(!m||m.mode!=='scene_matching_lab'||m.language!=='english'||!STRATEGIES.includes(m.strategy))throw new Error('Invalid lab manifest');
 if(!/^[a-zA-Z0-9_-]{6,128}$/.test(m.parentProjectId??''))throw new Error('Invalid parent project ID');
 if(!Array.isArray(m.excerpts)||m.excerpts.length!==4)throw new Error('Exactly four excerpts required');
 let total=0,last=-1;
 for(const e of m.excerpts){
  if(!Number.isFinite(e.startSeconds)||!Number.isFinite(e.endSeconds)||e.startSeconds<0||e.endSeconds<=e.startSeconds)throw new Error('Invalid excerpt');
  if(e.startSeconds<last)throw new Error('Excerpts must be ordered and disjoint');
  const duration=e.endSeconds-e.startSeconds;
  if(duration<60||duration>90)throw new Error('Excerpt outside 60-90 seconds');
  total+=duration;last=e.endSeconds;
 }
 return Object.freeze({strategy:m.strategy,totalSeconds:total,experimentId:m.parentProjectId+'-'+m.strategy});
}
/** Rebase measured cues against the concatenated excerpt timeline. */
export function rebaseCues(cues,excerpts){
 const out=[];let offset=0;
 for(const e of excerpts){
  for(const cue of cues){
   if(cue.startSeconds>=e.startSeconds&&cue.endSeconds<=e.endSeconds&&cue.endSeconds>cue.startSeconds){
    out.push({...cue,startSeconds:Number((offset+cue.startSeconds-e.startSeconds).toFixed(3)),endSeconds:Number((offset+cue.endSeconds-e.startSeconds).toFixed(3))});
   }else if(cue.startSeconds<e.endSeconds&&cue.endSeconds>e.startSeconds){
    throw new Error('Excerpt boundary cuts a measured subtitle cue');
   }
  }
  offset+=e.endSeconds-e.startSeconds;
 }
 return out;
}
export function validateCompleteCutPlan(cuts,duration){
 if(!Array.isArray(cuts)||!cuts.length||!Number.isFinite(duration)||duration<=0)throw new Error('Invalid cut plan');
 let cursor=0;const source=[];
 for(const c of cuts){
  const {narrationStartSeconds:a,narrationEndSeconds:b,sourceStartSeconds:s,sourceEndSeconds:t}=c;
  if(![a,b,s,t].every(Number.isFinite)||Math.abs(a-cursor)>.025||b<=a||s<0||t<=s)throw new Error('Invalid cut timing or narration gap');
  if(b-a<2.999||b-a>6.001||Math.abs((b-a)-(t-s))>.025)throw new Error('Cut duration mismatch');
  if(source.some(([x,y])=>s<y-.001&&t>x+.001))throw new Error('Reused or overlapping source footage');
  source.push([s,t]);cursor=b;
 }
 if(Math.abs(cursor-duration)>.025)throw new Error('Narration not fully covered');
 return true;
}
