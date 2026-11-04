import test from 'node:test';
import assert from 'node:assert/strict';
import {
 PERMANENT_DEEP_MARKER,PERMANENT_DEEP_BUILD,PERMANENT_DEEP_STEPS,
 PERMANENT_DEEP_MATCH_EN,PERMANENT_DEEP_MATCH_UR,PERMANENT_DEEP_CUTS,
 deepLanguage,loadProductionCues,deepProductionProgress,productionDeepPrompt,
 validateProductionDeepBatch,validateProductionDeepCuts,combineProductionDeepCuts,
 summariseProductionDeepMatches
} from '../src/permanent-deep-muse.mjs';
const t=x=>{
 const ms=Math.round(x*1000),p=y=>String(y).padStart(2,'0');
 return p(Math.floor(ms/3600000))+':'+p(Math.floor(ms/60000)%60)+':'+p(Math.floor(ms/1000)%60)+','+String(ms%1000).padStart(3,'0');
};
const src=Array.from({length:300},(_,i)=>(i+1)+'\n'+t(i*10)+' --> '+t((i+1)*10)+
 '\nPeter Rabbit original source cue '+(i+1)+' containing real dialogue evidence and actions\n').join('\n');
const measured=Array.from({length:6},(_,i)=>(i+1)+'\n'+t(i*5)+' --> '+t((i+1)*5)+
 '\nA measured narration sentence about Peter and his friends '+(i+1)+'\n').join('\n');
const cues=loadProductionCues(measured);
const decision=i=>({
 segmentIndex:i+1,sourceStartSeconds:100+i*20,sourceEndSeconds:105+i*20,
 sourceCueIds:[11+2*i],
 evidenceQuote:'Peter Rabbit original source cue '+(11+2*i)+' containing real dialogue evidence',
 reason:'Muse independently reviewed character, physical event, spoken context and movie chronology.',
 alternatives:[{cueId:12+2*i,reason:'Rejected because this later source scene does not depict the same action.'}],
 confidence:.82,museRequestId:'real-muse-call-'+i
});
const makeBatches=()=>{
 const a=validateProductionDeepBatch('english',cues,src,[],{decisions:Array.from({length:5},(_,i)=>decision(i))});
 const b=validateProductionDeepBatch('english',cues,src,[a],{decisions:[decision(5)]});
 return [a,b];
};
const cuts=()=>Array.from({length:6},(_,i)=>({
 narrationStartSeconds:i*5,narrationEndSeconds:(i+1)*5,
 sourceStartSeconds:100+i*20,sourceEndSeconds:105+i*20,
 matchSegmentIndices:[i+1]
}));
test('all NEW normal movies use independent deep English, Urdu, then native V4 export',()=>{
 assert.ok(PERMANENT_DEEP_MARKER.includes('PERMANENT'));
 assert.ok(PERMANENT_DEEP_BUILD.includes('production'));
 assert.equal(PERMANENT_DEEP_STEPS.at(-1),'windows_project');
 assert.deepEqual(PERMANENT_DEEP_STEPS.slice(-4),[PERMANENT_DEEP_MATCH_EN,PERMANENT_DEEP_MATCH_UR,PERMANENT_DEEP_CUTS,'windows_project']);
 assert.equal(PERMANENT_DEEP_STEPS.includes('scene_matching'),false);
 assert.equal(PERMANENT_DEEP_STEPS.includes('cut_plan'),false);
 assert.equal(deepLanguage(PERMANENT_DEEP_MATCH_UR),'urdu');
});
test('bilingual measured SRTs are parsed as plain text and Muse JSON envelopes',()=>{
 assert.equal(cues.length,6);
 assert.equal(loadProductionCues(JSON.stringify({format:'srt',text:measured})).length,6);
 assert.equal(cues[5].endSeconds,30);
});
test('first batch is five cues, second batch one cue, checkpoint order is immutable',()=>{
 const first=productionDeepPrompt('english',null,cues,src,[]);
 assert.equal(first.segments.length,5);
 assert.equal(first.progress.batchCount,2);
 assert.ok(first.ranked.candidates.length);
 assert.equal(first.ranked.budget,22000);
 assert.match(first.prompt,/MUSE SEMANTIC REASONING/);
 const result=makeBatches();
 assert.equal(result.length,2);
 assert.equal(deepProductionProgress(cues,result).reviewedSegments,6);
 assert.equal(deepProductionProgress(cues,result).complete,true);
 assert.throws(()=>productionDeepPrompt('english',null,cues,src,result),/already matched/i);
});
test('real source citation, alternatives and separate Muse request reference mandatory',()=>{
 const first={decisions:Array.from({length:5},(_,i)=>decision(i))};
 assert.equal(validateProductionDeepBatch('english',cues,src,[],first).decisions.length,5);
 const fake=structuredClone(first);fake.decisions[2].evidenceQuote='fabricated conversation';
 assert.throws(()=>validateProductionDeepBatch('english',cues,src,[],fake),/Exact quoted evidence/);
 const noAlt=structuredClone(first);noAlt.decisions[0].alternatives=[];
 assert.throws(()=>validateProductionDeepBatch('english',cues,src,[],noAlt),/alternative required/i);
 const noTrace=structuredClone(first);noTrace.decisions[1].museRequestId='';
 assert.throws(()=>validateProductionDeepBatch('english',cues,src,[],noTrace),/reference missing/);
 const wrongCue=structuredClone(first);wrongCue.decisions[3].sourceCueIds=[999];
 assert.throws(()=>validateProductionDeepBatch('english',cues,src,[],wrongCue),/cue IDs/);
 const incomplete=structuredClone(first);incomplete.decisions.pop();
 assert.throws(()=>validateProductionDeepBatch('english',cues,src,[],incomplete),/per measured/);
});
test('source intervals cannot be reused within language but English and Urdu are independent',()=>{
 const accepted=[validateProductionDeepBatch('english',cues,src,[],{decisions:Array.from({length:5},(_,i)=>decision(i))})];
 const repeated=decision(5);
 repeated.sourceStartSeconds=100;repeated.sourceEndSeconds=105;
 assert.throws(()=>validateProductionDeepBatch('english',cues,src,accepted,{decisions:[repeated]}),/anchor reused|too far/);
 // Urdu can use identical source anchors because its rendered video is independent.
 const urdu=[...makeBatches()].map(v=>({...v,language:'urdu'}));
 assert.equal(combineProductionDeepCuts(cuts(),cuts(),cues,cues,makeBatches(),urdu).cuts.length,12);
});
test('every final 3–6 sec shot must be linked to an accepted Muse segment and cover full audio',()=>{
 const accepted=makeBatches(),out=validateProductionDeepCuts('english',cues,cuts(),accepted);
 assert.equal(out.totalSegments,6);assert.equal(out.cuts.length,6);
 assert.ok(out.cuts[0].sourceEvidence.includes('cue 11'));
 const bad=cuts();bad[0].matchSegmentIndices=[];
 assert.throws(()=>validateProductionDeepCuts('english',cues,bad,accepted),/missing valid segment/);
 const shifted=cuts();shifted[0].sourceStartSeconds=1400;shifted[0].sourceEndSeconds=1405;
 assert.throws(()=>validateProductionDeepCuts('english',cues,shifted,accepted),/no nearby accepted/);
 assert.throws(()=>validateProductionDeepCuts('english',cues,cuts().slice(0,5),accepted),/fully covered/);
 assert.throws(()=>validateProductionDeepCuts('english',cues,cuts(),accepted.slice(0,1)),/before Muse reviews/);
 const merged=combineProductionDeepCuts(cuts(),cuts(),cues,cues,accepted,accepted);
 assert.equal(merged.provenance.english.reviewedSegments,6);
 assert.equal(merged.provenance.urdu.batches,2);
 assert.equal(merged.provenance.visualVerified,false);
 assert.equal(summariseProductionDeepMatches(accepted,accepted).length,12);
});
