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

test('Muse JSON envelope metadata cannot become phantom cue after final cue',()=>{
 const srt=cue(1,'00:00:00,000','00:00:07,640')+'\n'+cue(129,'00:08:45,039','00:08:48,959');
 const envelope=JSON.stringify({kind:'srt_english',format:'srt',language:'en',text:srt,segments:129,firstSegment:'00:00:00,000 --> 00:00:07,640',lastSegment:'00:08:45,039 --> 00:08:48,959'});
 assert.equal(srtLastTimestamp(envelope,'english_srt'),528.959);
});
test('Urdu Muse JSON envelope uses only measured text',()=>{
 const srt=cue(1,'00:00:00,000','00:00:09,000')+'\n'+cue(234,'00:09:26,680','00:09:29,180');
 assert.equal(srtLastTimestamp(JSON.stringify({kind:'srt_urdu',format:'srt',language:'ur',text:srt,segments:234,firstSegment:'00:00:00,000 --> 00:00:09,000'}),'urdu_srt'),569.18);
});
test('malformed and missing-text SRT envelopes fail closed',()=>{
 assert.throws(()=>srtLastTimestamp('{"format":"srt",','english_srt'),/Malformed SRT JSON envelope/);
 assert.throws(()=>srtLastTimestamp(JSON.stringify({format:'srt',firstSegment:'00:00:00,000 --> 00:00:07,640'}),'english_srt'),/Invalid SRT JSON envelope/);
});
test('genuine reversal inside JSON text is still rejected',()=>{
 const bad=cue(1,'00:00:05,000','00:00:08,000')+'\n'+cue(2,'00:00:04,000','00:00:07,000');
 assert.throws(()=>srtLastTimestamp(JSON.stringify({format:'srt',text:bad,firstSegment:'00:00:05,000 --> 00:00:08,000'}),'english_srt'),/cueIndex=2 rule=start_time_reversal/);
});
