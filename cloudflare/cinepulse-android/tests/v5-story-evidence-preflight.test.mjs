import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectStoryEvidenceBlueprint,findUncaptionedIntervals} from '../src/v5-story-evidence-preflight.mjs';
const sourceSrt=[
 '1','00:00:01,000 --> 00:00:02,000','Morning, Sophie.','',
 '2','00:00:12,000 --> 00:00:13,000','Where are you?','',
 '3','00:00:25,000 --> 00:00:26,000','Morning, Sophie.'
].join('\n');
const hash='a'.repeat(64);
const fixture=()=>({
 sourceSrt,sourceMediaSha256:hash,
 beats:[
  {id:'greeting-1',summary:'First greeting',evidence:[{kind:'subtitle',cueId:1,quote:'Morning, Sophie.'}]},
  {id:'greeting-2',summary:'Another greeting',evidence:[{kind:'subtitle',cueId:3,quote:'Morning, Sophie.'}]},
  {id:'silent-reaction',summary:'Characters react silently',evidence:[{kind:'visual',startSeconds:15,endSeconds:19,sourceMediaSha256:hash,verifiedFromVideo:true,verificationMethod:'frame_review',verificationRef:'inspection-1',observedAction:'Characters react to approaching dinosaurs'}]}
 ],
 narrationUnits:[
  {language:'english',id:'en-1',text:'Morning, Sophie.',beatIds:['greeting-1']},
  {language:'english',id:'en-2',text:'Another greeting.',beatIds:['greeting-2']},
  {language:'urdu',id:'ur-1',text:'They react silently.',beatIds:['silent-reaction']}
 ],
 measuredCues:[
  {language:'english',index:1,startSeconds:0,endSeconds:.5,text:'Morning,',unitIds:['en-1']},
  {language:'english',index:2,startSeconds:.5,endSeconds:1.2,text:'Sophie.',unitIds:['en-1']},
  {language:'english',index:3,startSeconds:1.2,endSeconds:2.5,text:'Another greeting.',unitIds:['en-2']},
  {language:'urdu',index:1,startSeconds:0,endSeconds:2,text:'They react silently.',unitIds:['ur-1']}
 ]
});
test('source to digest to narration to measured cue lineage succeeds',()=>{
 const x=inspectStoryEvidenceBlueprint(fixture());assert.equal(x.ready,true,JSON.stringify(x.errors));
 assert.deepEqual(x.groups[0].measuredCueIndices,[1,2]);
});
test('identical quotes at different movie times must cite the correct cue',()=>{
 const x=fixture();x.beats[1].evidence[0].cueId=2;
 assert.match(inspectStoryEvidenceBlueprint(x).errors.join(' '),/invalid exact source quote/);
});
test('missing digest provenance and fabricated source quote fail closed',()=>{
 const x=fixture();x.narrationUnits[0].beatIds=['missing'];
 x.beats[0].evidence[0].quote='invented words';
 assert.equal(inspectStoryEvidenceBlueprint(x).ready,false);
});
test('visual scene without actual video verification metadata fails',()=>{
 const x=fixture();delete x.beats[2].evidence[0].verificationRef;
 assert.match(inspectStoryEvidenceBlueprint(x).errors.join(' '),/unverified visual evidence/);
});
test('subtitle gaps are suggestions, not proven silent events',()=>{
 const gaps=findUncaptionedIntervals(sourceSrt,4);
 assert.equal(gaps.length,2);
 assert.ok(gaps.every(x=>x.status==='video_inspection_required'));
});
test('missing measured cue cannot be hidden by sentence grouping',()=>{
 const x=fixture();x.measuredCues.splice(1,1);
 assert.equal(inspectStoryEvidenceBlueprint(x).ready,false);
});
test('malformed beat links fail closed without exception',()=>{
 const x=fixture();x.narrationUnits[0].beatIds=null;
 assert.equal(inspectStoryEvidenceBlueprint(x).ready,false);
});
