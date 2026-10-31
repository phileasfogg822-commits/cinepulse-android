import test from 'node:test';
import assert from 'node:assert/strict';
import {srtLastTimestamp,validateFinalCutPlan} from '../src/longform-policy.mjs';
const cue=(i,start,end)=>`${i}\n${start} --> ${end}\nTest text\n`;
const normal=cue(1,'00:00:00,000','00:00:04,000')+'\n'+cue(2,'00:00:03,999','00:00:08,000');
test('one millisecond Whisper end/start overlap is not mislabeled reversed cue ordering',()=>{
  assert.equal(srtLastTimestamp(normal,'english_srt'),8);
});
test('real start reversal emits artifact, cue index and timestamps',()=>{
  const bad=cue(1,'00:00:05,000','00:00:08,000')+'\n'+cue(2,'00:00:04,000','00:00:07,000');
  assert.throws(()=>srtLastTimestamp(bad,'urdu_srt'),err=>err.code==='SRT_TIMESTAMP_INVALID'&&
    err.details.artifactKind==='urdu_srt'&&err.details.cueIndex===2&&
    err.details.previousStartMs===5000&&err.details.currentStartMs===4000);
});
test('cut plan distinguishes original SRT source failures from measured narrations',()=>{
 const source=cue(1,'00:00:00,000','00:00:08,000');
 const bad=cue(1,'00:00:05,000','00:00:08,000')+'\n'+cue(2,'00:00:04,000','00:00:07,000');
 assert.throws(()=>validateFinalCutPlan([{language:'english',sourceStartSeconds:0,sourceEndSeconds:4,narrationStartSeconds:0,narrationEndSeconds:4}],{sourceSrt:source,englishSrt:bad,urduSrt:normal}),/artifact=english_srt cueIndex=2/);
});
