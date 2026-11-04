import test from 'node:test';
import assert from 'node:assert/strict';
import {DEEP_BUILD,DEEP_PREPARE,DEEP_MATCH,DEEP_EXPORT,DEEP_BATCH_SIZE,
 normalizeDeepCreate,segmentBatch,validateDeepBatch,validateDeepFinalCuts,
 matchPrompt,preparePrompt,exportPrompt,publicDeepStatus} from '../src/scene-lab-deep.mjs';

const parent='81febfe9-bcf4-4a96-ab4c-2a9226503ea1';
const worker='ddd753f6-769c-4c31-9400-667a38a9f185';
const cue=(n,a,b,t)=>n+'\n'+time(a)+' --> '+time(b)+'\n'+t+'\n';
const time=t=>{
 const x=Math.round(t*1000),pad=v=>String(v).padStart(2,'0');
 return pad(Math.floor(x/3600000))+':'+pad(Math.floor(x/60000)%60)+':'+pad(Math.floor(x/1000)%60)+','+String(x%1000).padStart(3,'0');
};
const sourceCues=Array.from({length:300},(_,i)=>({startSeconds:i*10,endSeconds:(i+1)*10,text:'Peter Rabbit in the garden original source cue '+(i+1)}));
const sourceSrt=sourceCues.map((c,i)=>cue(i+1,c.startSeconds,c.endSeconds,c.text)).join('\n');
const excerpts=[0,1,2,3].map(i=>({startSeconds:i*90,endSeconds:i*90+75}));
const englishCues=excerpts.flatMap((e,k)=>Array.from({length:5},(_,i)=>({
 startSeconds:e.startSeconds+i*15,endSeconds:e.startSeconds+(i+1)*15,text:'Narration '+(k*5+i+1)
})));
const urduSrt=Array.from({length:6},(_,i)=>cue(i+1,i*5,(i+1)*5,'Urdu control '+i)).join('\n');
const urduCuts=Array.from({length:6},(_,i)=>({
 narrationStartSeconds:i*5,narrationEndSeconds:(i+1)*5,sourceStartSeconds:2600+i*10,sourceEndSeconds:2605+i*10
}));
const input={requestId:'peter-deep-muse-pilot-01',workerId:worker,parentProjectId:parent,
 strategy:'classic_reconstruction',excerpts,sourceSrt,
 sourceSrtSha256:'a'.repeat(64),englishCues,urduSrt,urduCuts,
 narrations:{english:'Fixed Peter Rabbit English narration',urdu:'Fixed Urdu control'},
 mp3Manifest:{english:{bytes:2492236,sha256:'0'.repeat(64),durationSeconds:300},
  urdu:{bytes:255340,sha256:'1'.repeat(64),durationSeconds:30}},
 baselineProject:{id:parent,title:'Peter Rabbit (2018)',
  cloudImport:{schema:'cinepulse.windows-muse.v4',cloudProjectId:parent},
  sourceFiles:[{name:'CinePulse_Source.srt',text:sourceSrt}],
  analysis:{narrations:{english:'Original',hindiUrdu:'Original Urdu'}},
  tracks:{english:{},hindiUrdu:{}},pipeline:{}}};
const normalized=normalizeDeepCreate(input);
const row={project_id:'11111111-2222-4333-8444-555555555555',parent_project_id:parent,
 worker_id:worker,strategy:input.strategy,manifest_json:JSON.stringify(normalized.manifest),
 english_cues_json:JSON.stringify(normalized.englishCues),
 expected_mp3s_json:JSON.stringify(normalized.expectedMp3s),
 segment_count:normalized.segmentCount,batch_count:normalized.batchCount,current_batch:0,status:'matching'};
const decision=i=>({
 segmentIndex:i+1,sourceStartSeconds:i*30,sourceEndSeconds:i*30+15,sourceCueIds:[i*3+1],
 evidenceQuote:'Peter Rabbit in the garden original source cue '+(i*3+1),
 reason:'Muse considered event, characters, chronology, and exact source dialogue context.',
 alternatives:[{cueId:i*3+2,reason:'Rejected because event sequence was less plausible'}],
 confidence:.85,museRequestId:'muse-semantic-call-'+Math.floor(i/5)
});
const outcome=()=>{
 const batches=[];for(let b=0;b<4;b++){
  const output={decisions:Array.from({length:5},(_,i)=>decision(b*5+i))};
  batches.push(validateDeepBatch(row,b,output,sourceSrt,batches));
 }
 return batches;
};
const cuts=()=>Array.from({length:60},(_,i)=>({
 narrationStartSeconds:i*5,narrationEndSeconds:(i+1)*5,
 sourceStartSeconds:Math.floor(i/3)*30+(i%3)*5,
 sourceEndSeconds:Math.floor(i/3)*30+(i%3)*5+5,
 matchSegmentIndices:[Math.floor(i/3)+1],confidence:.85
}));
test('deep create enforces original V4, 4 excerpts, MP3 manifests, Urdu control and idempotency key',()=>{
 assert.equal(normalized.segmentCount,20);assert.equal(normalized.batchCount,4);
 assert.equal(DEEP_BATCH_SIZE,5);assert.equal(DEEP_BUILD,'cinepulse-scene-lab-deep-muse-v1');
 assert.throws(()=>normalizeDeepCreate({...input,requestId:''}),/requestId/);
 assert.throws(()=>normalizeDeepCreate({...input,mp3Manifest:{}}),/MP3/);
 assert.throws(()=>normalizeDeepCreate({...input,baselineProject:{...input.baselineProject,cloudImport:{schema:'v3'}}}),/V4/);
});
test('deep task sequence explicitly names prepare, match, export',()=>{
 assert.equal(DEEP_PREPARE,'scene_lab_deep_prepare');
 assert.equal(DEEP_MATCH,'scene_lab_deep_match');
 assert.equal(DEEP_EXPORT,'scene_lab_deep_export');
 assert.equal(segmentBatch(row,0).length,5);
 assert.equal(segmentBatch(row,3).at(-1).segmentIndex,20);
 assert.match(matchPrompt(row,2),/MUSE FOR SEMANTIC REASONING/);
 assert.match(matchPrompt(row,2),/11/); // not decisive but strings must be informative
 assert.match(preparePrompt(row),/Upload the exact SAME/);
 assert.match(exportPrompt(row),/all/i);
});
test('all 20 Muse decisions in four batches can be checkpointed with exact evidence',()=>{
 const batches=outcome();
 assert.equal(batches.length,4);
 assert.equal(batches.flatMap(b=>b.decisions).length,20);
 assert.equal(batches[1].decisions[0].segmentIndex,6);
 assert.equal(batches[3].decisions[4].visualVerified,false);
});
test('citation checks reject nonexistent subtitles, forged quote, missing alternate and absent Muse trace',()=>{
 let b={decisions:Array.from({length:5},(_,i)=>decision(i))};
 let forged=structuredClone(b);forged.decisions[2].evidenceQuote='fictitious spoken dialogue';
 assert.throws(()=>validateDeepBatch(row,0,forged,sourceSrt,[]),/does not contain cited exact evidence/);
 let missing=structuredClone(b);missing.decisions[1].alternatives=[];
 assert.throws(()=>validateDeepBatch(row,0,missing,sourceSrt,[]),/Alternative candidate/);
 let fakeTrace=structuredClone(b);fakeTrace.decisions[1].museRequestId='';
 assert.throws(()=>validateDeepBatch(row,0,fakeTrace,sourceSrt,[]),/Muse request trace/);
 let invalid=structuredClone(b);invalid.decisions[1].sourceCueIds=[10000];
 assert.throws(()=>validateDeepBatch(row,0,invalid,sourceSrt,[]),/source cue IDs/);
});
test('completed batch source interval cannot be silently reused by a later Muse batch',()=>{
 const prior=[validateDeepBatch(row,0,{decisions:Array.from({length:5},(_,i)=>decision(i))},sourceSrt,[])];
 const wrong={decisions:Array.from({length:5},(_,i)=>decision(i+5))};
 wrong.decisions[0].sourceStartSeconds=0;wrong.decisions[0].sourceEndSeconds=15;
 assert.throws(()=>validateDeepBatch(row,1,wrong,sourceSrt,prior),/source time contradicts cited source cue|Previously accepted source footage reused/);
});
test('final cut plan must cover every spoken segment, be 3-6sec and cite a matching anchor',()=>{
 const checked=validateDeepFinalCuts(row,cuts(),outcome());
 assert.equal(checked.reviewedSegments,20);
 assert.equal(checked.completedBatches,4);
 assert.equal(checked.cuts.length,60);
 assert.ok(checked.cuts[0].sourceEvidence.includes('cue 1'));
 assert.equal(checked.visualVerified,false);
 const notLinked=cuts();notLinked[0].matchSegmentIndices=[];
 assert.throws(()=>validateDeepFinalCuts(row,notLinked,outcome()),/lacks Muse decision link/);
 const badSource=cuts();badSource[0].sourceStartSeconds=700;badSource[0].sourceEndSeconds=705;
 assert.throws(()=>validateDeepFinalCuts(row,badSource,outcome()),/lacks source-grounded Muse anchor nearby/);
 assert.throws(()=>validateDeepFinalCuts(row,cuts().slice(0,-1),outcome()),/fully covered/);
 assert.throws(()=>validateDeepFinalCuts(row,cuts(),outcome().slice(1)),/all measured segments/);
});
test('public status shows checkpoint progress but not private project files',()=>{
 const status=publicDeepStatus(row,[{status:'done',first_segment:1,last_segment:5},
  {status:'done',first_segment:6,last_segment:10},{status:'queued',first_segment:11,last_segment:15}]);
 assert.equal(status.completedSegments,10);assert.equal(status.acceptedBatches,2);
 assert.equal(status.visualVerified,false);
 assert.equal(status.backendBuild,DEEP_BUILD);
});
