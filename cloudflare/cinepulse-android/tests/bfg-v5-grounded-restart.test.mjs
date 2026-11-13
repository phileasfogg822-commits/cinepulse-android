import test from 'node:test';
import assert from 'node:assert/strict';
import {BFG_PILOT,inspectSourceIntake,inspectBeforeVoice,inspectAfterVoice,inspectGlobalSceneDryRun} from '../src/bfg-v5-grounded-restart.mjs';
const sourceSrt=[
'1\n00:00:01,000 --> 00:00:02,000\nMorning, Sophie.',
'2\n00:00:12,000 --> 00:00:13,000\nWhere are you?',
'3\n00:00:25,000 --> 00:00:26,000\nMorning, Sophie.'
].join('\n\n');
const hash='a'.repeat(64);
const data=()=>({sourceSrt,sourceMediaSha256:hash,
 blueprint:[
  {beatId:'greeting-first',startSeconds:.8,endSeconds:2.5},
  {beatId:'greeting-second',startSeconds:24.8,endSeconds:26.5},
  {beatId:'quiet-action',startSeconds:15,endSeconds:19}
 ],
 beats:[
  {id:'greeting-first',summary:'First greeting',evidence:[{kind:'subtitle',cueId:1,quote:'Morning, Sophie.'}]},
  {id:'greeting-second',summary:'Another greeting at another movie time',evidence:[{kind:'subtitle',cueId:3,quote:'Morning, Sophie.'}]},
  {id:'quiet-action',summary:'Characters react to a moving creature',evidence:[{kind:'visual',startSeconds:15,endSeconds:19,sourceMediaSha256:hash,verifiedFromVideo:true,verificationMethod:'frame_review',verificationRef:'visual-review-1',observedAction:'Characters react in alarm to something moving'}]}
 ],
 narrationUnits:[
  {language:'english',id:'en-first',text:'Morning, Sophie.',beatIds:['greeting-first']},
  {language:'english',id:'en-second',text:'Another greeting.',beatIds:['greeting-second']},
  {language:'urdu',id:'ur-action',text:'They react to the creature.',beatIds:['quiet-action']}
 ],
 measuredCues:[
  {language:'english',index:1,startSeconds:0,endSeconds:.5,text:'Morning,',unitIds:['en-first']},
  {language:'english',index:2,startSeconds:.5,endSeconds:1.2,text:'Sophie.',unitIds:['en-first']},
  {language:'english',index:3,startSeconds:1.2,endSeconds:2.5,text:'Another greeting.',unitIds:['en-second']},
  {language:'urdu',index:1,startSeconds:0,endSeconds:2,text:'They react to the creature.',unitIds:['ur-action']}
 ]});
test('BFG pilot never mutates live project',()=>{assert.equal(BFG_PILOT.worker,'INT');assert.equal(BFG_PILOT.allowProductionMutation,false)});
test('source intake sees time gaps but does not invent silent-scene content',()=>{
 const a=inspectSourceIntake(sourceSrt,{expectedCues:3,gapSeconds:5});
 assert.equal(a.ready,true);assert.equal(a.gaps.length,2);
 assert.ok(a.gaps.every(g=>g.status==='video_inspection_required'));
 assert.equal(a.productionProjectCreated,false);
});
test('source integrity fails closed on cue count discrepancy',()=>{
 assert.equal(inspectSourceIntake(sourceSrt,{expectedCues:1239}).ready,false);
});
test('source-to-digest-to-narration references pass using separate repeated greetings',()=>{
 const a=inspectBeforeVoice(data());
 assert.equal(a.ready,true,JSON.stringify(a.errors));assert.equal(a.digestBeats,3);
});
test('same spoken words cannot be relabeled as a different source cue',()=>{
 const a=data();a.beats[1].evidence[0].cueId=2;
 assert.equal(inspectBeforeVoice(a).ready,false);
});
test('invented digest text, missing beat, or unsupported visuals fail',()=>{
 const a=data();a.beats[0].evidence[0].quote='Unsaid dialogue';a.narrationUnits[0].beatIds=['invented'];
 delete a.beats[2].evidence[0].verificationRef;
 assert.equal(inspectBeforeVoice(a).ready,false);
});
test('short sentence remains one semantic narration group despite two STT cues',()=>{
 const a=data(),s=inspectAfterVoice({units:a.narrationUnits,measuredCues:a.measuredCues});
 assert.equal(s.ready,true,JSON.stringify(s.errors));
 assert.deepEqual(s.groups.find(g=>g.unitId==='en-first').cueIndices,[1,2]);assert.equal(s.measuredSrtUnchanged,true);
});
test('missing or out-of-order measured SRT cue does not become a valid scene',()=>{
 const a=data();a.measuredCues.splice(1,1);
 assert.equal(inspectAfterVoice({units:a.narrationUnits,measuredCues:a.measuredCues}).ready,false);
});
test('global plan refuses weak 0.60 match, and forbids lowered quality floor',()=>{
 const groups=[{language:'english',unitId:'en-first'}];
 const decisions=[{language:'english',unitId:'en-first',status:'verified',qualityScore:.6,startSeconds:1,endSeconds:2}];
 assert.deepEqual(inspectGlobalSceneDryRun({sourceSrt,groups,decisions}).precision,['english:en-first']);
 assert.equal(inspectGlobalSceneDryRun({sourceSrt,groups,decisions,qualityFloor:.6}).ready,false);
});
test('two narration units sharing one source time cannot silently overlap',()=>{
 const groups=[{language:'english',unitId:'one'},{language:'english',unitId:'two'}];
 const decisions=groups.map(g=>({...g,status:'verified',qualityScore:.96,startSeconds:1,endSeconds:2,sourceCueIds:[1],independentVisualReview:true,reviewerRef:'r1'}));
 assert.equal(inspectGlobalSceneDryRun({sourceSrt,groups,decisions}).ready,false);
});
test('English and Urdu can select same source time in independent rendered videos',()=>{
 const groups=[{language:'english',unitId:'one'},{language:'urdu',unitId:'one'}];
 const decisions=groups.map(g=>({...g,status:'verified',qualityScore:.96,startSeconds:1,endSeconds:2,sourceCueIds:[1],independentVisualReview:true,reviewerRef:'r1'}));
 assert.equal(inspectGlobalSceneDryRun({sourceSrt,groups,decisions}).ready,true);
});
test('unverified visual evidence cannot be auto-accepted',()=>{
 const groups=[{language:'urdu',unitId:'one'}];
 const decisions=[{language:'urdu',unitId:'one',status:'verified',qualityScore:.99,startSeconds:1,endSeconds:2,sourceCueIds:[1]}];
 const result=inspectGlobalSceneDryRun({sourceSrt,groups,decisions});
 assert.equal(result.ready,false);assert.deepEqual(result.precision,['urdu:one']);
});
