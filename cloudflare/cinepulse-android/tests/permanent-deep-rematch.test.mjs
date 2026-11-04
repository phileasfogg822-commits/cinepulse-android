import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadProductionCues} from '../src/permanent-deep-muse.mjs';
import {
 URDU_REPAIR_STAGE,URDU_REPAIR_BUILD,URDU_REPAIR_BATCH_MAX,
 LOST_WORLD_URDU_REPAIR_INDICES,parseUrduRepairPrompt,makeUrduRepairPrompt,
 applyAcceptedUrduRepairs,UrduRepairTaskEvidence,validateTargetedUrduRematch
} from '../src/permanent-deep-rematch.mjs';
const stamp=n=>{const ms=Math.round(n*1000),p=i=>String(i).padStart(2,'0');return p(Math.floor(ms/3600000))+':'+p(Math.floor(ms/60000)%60)+':'+p(Math.floor(ms/1000)%60)+','+String(ms%1000).padStart(3,'0')};
const sourceSrt=Array.from({length:320},(_,i)=>(i+1)+'\n'+stamp(i*10)+' --> '+stamp(i*10+9)+
 '\nPeter Rabbit original movie source cue '+(i+1)+' describes the characters on screen clearly.\n').join('\n');
const urduSrt=Array.from({length:10},(_,i)=>(i+1)+'\n'+stamp(i*5)+' --> '+stamp((i+1)*5)+
 '\nThe original measured Urdu narration segment '+(i+1)+'\n').join('\n');
const cues=loadProductionCues(urduSrt);
const sourceCueId=(i,updated=false)=>updated?101+i:21+i;
const decision=(i,updated=false)=>{
 const id=sourceCueId(i,updated),start=(id-1)*10;
 return {segmentIndex:i,sourceStartSeconds:start,sourceEndSeconds:start+5,sourceCueIds:[id],
 evidenceQuote:'Peter Rabbit original movie source cue '+id+' describes the characters on screen',
 reason:'Muse independently considered the actual character, action, dialogue and chronology of this scene.',
 alternatives:[{cueId:id+1,reason:'Other candidate is less faithful to narrated event'}],
 confidence:.78,museRequestId:'muse-call-verified-'+i+(updated?'-replacement':''),
 narrationStartSeconds:(i-1)*5,narrationEndSeconds:i*5,
 narrationText:cues[i-1].text,visualVerified:false};
};
const originals=[
 {language:'urdu',batchIndex:0,decisions:Array.from({length:5},(_,i)=>decision(i+1))},
 {language:'urdu',batchIndex:1,decisions:Array.from({length:5},(_,i)=>decision(i+6))}
];
const initial=JSON.stringify(originals);
const plan={indices:[2,5],offset:0,sourceCutJobId:'6e40cd52-0b14-4161-bb67-ed2e58edd678'};
const payload={decisions:[decision(2,true),decision(5,true)]};
test('only explicitly sorted target indices can start an immutable repair plan',()=>{
 assert.equal(URDU_REPAIR_STAGE,'deep_rematch_urdu');
 assert.equal(URDU_REPAIR_BATCH_MAX,5);
 assert.equal(URDU_REPAIR_BUILD,'cinepulse-urdu-targeted-rematch-v5.2');
 assert.deepEqual(LOST_WORLD_URDU_REPAIR_INDICES,[41,50,127,130,141,146,186,233]);
 const encoded=makeUrduRepairPrompt(plan);
 assert.deepEqual(parseUrduRepairPrompt(encoded),plan);
 assert.throws(()=>makeUrduRepairPrompt({...plan,indices:[5,2]}),/unordered/);
 assert.throws(()=>makeUrduRepairPrompt({...plan,indices:[2,2]}),/unordered/);
 assert.throws(()=>makeUrduRepairPrompt({...plan,offset:2}),/Invalid/);
 assert.throws(()=>makeUrduRepairPrompt({...plan,indices:[]}),/Invalid/);
});
test('targeted Muse tasks only contain named narration segments and whole-film evidence',()=>{
 const task=UrduRepairTaskEvidence({sourceSrt,urduCues:cues,acceptedBatches:originals,
   prompt:makeUrduRepairPrompt(plan)});
 assert.deepEqual(task.taskSegments.map(x=>x.segmentIndex),[2,5]);
 assert.ok(task.instructions.includes('WHOLE-MOVIE RANKED CANDIDATES'));
 assert.equal(task.evidence.length,2);
 assert.ok(task.evidence.every(e=>e.usedCharacters<=4001));
 assert.match(task.instructions,/NEVER change them|Preserve all accepted English/);
});
test('two genuine Muse re-matches are validated, append-only, and leave old decisions untouched',()=>{
 const verified=validateTargetedUrduRematch({sourceSrt,urduCues:cues,acceptedBatches:originals,
   completedRepairs:[],plan,payload});
 assert.deepEqual(verified.decisions.map(d=>d.segmentIndex),[2,5]);
 assert.equal(verified.language,'urdu');assert.equal(verified.targetedRepair,true);
 const out=applyAcceptedUrduRepairs(originals,[verified]);
 assert.equal(JSON.stringify(originals),initial);
 const before=originals.flatMap(b=>b.decisions),after=out.flatMap(b=>b.decisions);
 assert.equal(after.length,10);
 assert.equal(after[1].sourceStartSeconds,1020);
 assert.equal(after[4].sourceStartSeconds,1050);
 assert.equal(after[0].sourceStartSeconds,before[0].sourceStartSeconds);
 assert.equal(after[9].sourceStartSeconds,before[9].sourceStartSeconds);
 assert.equal(verified.visualVerified,false);
});
test('no changed source quote, fabricated reference, old anchor or overlapping preserved source is accepted',()=>{
 const bad=structuredClone(payload);bad.decisions[0].evidenceQuote='A fictional scene does not exist in original SRT';
 assert.throws(()=>validateTargetedUrduRematch({sourceSrt,urduCues:cues,acceptedBatches:originals,completedRepairs:[],plan,payload:bad}),/Exact quoted evidence/);
 const noChange=structuredClone(payload);noChange.decisions[0]=decision(2);
 assert.throws(()=>validateTargetedUrduRematch({sourceSrt,urduCues:cues,acceptedBatches:originals,completedRepairs:[],plan,payload:noChange}),/old source anchor unchanged/);
 const conflict=structuredClone(payload);conflict.decisions[0]=decision(1);
 conflict.decisions[0].segmentIndex=2;
 assert.throws(()=>validateTargetedUrduRematch({sourceSrt,urduCues:cues,acceptedBatches:originals,completedRepairs:[],plan,payload:conflict}),/overlaps existing preserved Urdu decision/);
 assert.throws(()=>validateTargetedUrduRematch({sourceSrt,urduCues:cues,acceptedBatches:originals,completedRepairs:[],plan,payload:{decisions:[]}}),/exact 2 specified/);
});
test('completed repairs cannot silently overwrite a second time or alter unaffected segments',()=>{
 const verified=validateTargetedUrduRematch({sourceSrt,urduCues:cues,acceptedBatches:originals,completedRepairs:[],plan,payload});
 assert.throws(()=>applyAcceptedUrduRepairs(originals,[verified,verified]),/Duplicate/);
 assert.throws(()=>applyAcceptedUrduRepairs(originals,[{decisions:[{segmentIndex:100,sourceStartSeconds:900}]}]),/unknown original/);
 assert.throws(()=>validateTargetedUrduRematch({sourceSrt,urduCues:cues,acceptedBatches:originals,completedRepairs:[verified],plan,payload}),/already re-matched/);
});
test('new routes retain lease checks, admin project ownership and do not modify original job output',()=>{
 const backend=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(backend,/if\(method==='POST'&&action==='request-urdu-rematch'\)/);
 assert.match(backend,/if\(action==='deep-muse\/rematch-urdu'&&method==='POST'\)/);
 assert.match(backend,/if\(job.step_id===URDU_REPAIR_STAGE\)/);
 assert.match(backend,/status='cancelled',error=\?,finished_at=\?,lease=NULL/);
 assert.match(backend,/if\(action==='deep-muse\/rematch-urdu\/resume'&&method==='POST'\)/);
 assert.match(backend,/applyAcceptedUrduRepairs\(original,await acceptedUrduRepairOutputs/);
 assert.match(backend,/Only the pending Muse stage has been requeued|Only an active permanent Deep Muse movie can request a repair/);
});
