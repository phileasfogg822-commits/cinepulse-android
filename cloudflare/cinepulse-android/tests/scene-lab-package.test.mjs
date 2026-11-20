import test from 'node:test';import assert from 'node:assert/strict';
import {experimentPlan,planAudioExtraction,renderMeasuredSrt,buildSceneLabPackage,unwrapMeasuredSrt,parseMeasuredCues} from '../src/scene-lab-package.mjs';
test('ten experiment manifests reuse four excerpts',()=>{const p=experimentPlan('12345678-1234-1234-1234-123456789abc',[0,1,2,3].map(i=>({startSeconds:i*90,endSeconds:i*90+75})));assert.equal(p.length,10);assert.equal(new Set(p.map(x=>x.strategy)).size,10);});
test('audio extraction offsets maintain concatenation',()=>{const x=planAudioExtraction([{startSeconds:12,endSeconds:72},{startSeconds:92,endSeconds:152}]);assert.equal(x[1].outputStartSeconds,60);assert.equal(x[1].outputEndSeconds,120)});
test('rebased SRT uses proper subrip timing',()=>assert.match(renderMeasuredSrt([{startSeconds:1.2,endSeconds:3.3,text:'Peter'}]),/00:00:01,200 --> 00:00:03,300/));
test('package rejects missing MP3 and incomplete cut plans',()=>{const m=experimentPlan('12345678-1234-1234-1234-123456789abc',[0,1,2,3].map(i=>({startSeconds:i*90,endSeconds:i*90+75})))[0];assert.throws(()=>buildSceneLabPackage({manifest:m,englishCues:[{startSeconds:0,endSeconds:75,text:'Peter'}],englishAudio:{bytes:0,durationSeconds:300},urduAudio:{bytes:1,durationSeconds:30},englishCuts:[],urduCuts:[]}),/Missing or incorrect measured MP3 duration/);});


test('Muse v4 JSON SRT envelopes are unwrapped and parsed',()=>{
 const LF=String.fromCharCode(10);
 // Extracted format of Peter.zip: JSON envelope stores newline-delimited SRT text.
 const inner=[
 '1','00:00:00,000 --> 00:00:04,639',
 'Peter Rabbit lives in the Lake District with his sisters Flopsie, Mopsie, and Cottontail,',
 '','2','00:00:04,639 --> 00:00:09,519',
 'and with his cousin Benjamin Bunny. He wears a blue coat, he tells his own story,',''
 ].join(LF);
 const wrapped=JSON.stringify({kind:'srt_english',format:'srt',language:'en',text:inner});
 assert.equal(unwrapMeasuredSrt(wrapped),inner);
 const cues=parseMeasuredCues(wrapped);
 assert.equal(cues.length,2);
 assert.equal(cues[0].endSeconds,4.639);
 assert.equal(cues[1].startSeconds,4.639);
 assert.match(cues[0].text,/Flopsie, Mopsie, and Cottontail/);
 assert.match(cues[1].text,/Benjamin Bunny/);
});
test('Muse subtitle parser supports CRLF, multiline subtitles, and decimal separators',()=>{
 const CRLF=String.fromCharCode(13,10);
 const raw=['1','00:00:00.000 --> 00:00:03.000','First line','Second line','','2','00:00:03,000 --> 00:00:06,000','Second cue',''].join(CRLF);
 const cues=parseMeasuredCues(JSON.stringify({format:'srt',text:raw}));
 assert.equal(cues.length,2);
 assert.equal(cues[0].text,'First line'+String.fromCharCode(10)+'Second line');
 assert.equal(cues[1].endSeconds,6);
});
test('Muse subtitle parser rejects malformed envelopes and empty cue streams',()=>{
 assert.throws(()=>parseMeasuredCues(JSON.stringify({format:'srt',text:'invalid'})),/SRT envelope missing measured text/);
 assert.throws(()=>parseMeasuredCues('not an srt'),/No measured subtitle cues found/);
 assert.throws(()=>parseMeasuredCues(JSON.stringify({format:'not-srt',text:'1 --> 2'})),/SRT envelope missing measured text/);
});


test('stored Urdu SRT with embedded blank text lines retains every word and exact two cue headers',()=>{
 const raw=[
  '61','00:01:00,000 --> 00:01:02,000','پہلے الفاظ','','',
  '62','00:01:02,000 --> 00:01:05,000','پھر پہلا جملہ۔','','پھر ڈیلیا اپنا قدم اٹھاتی ہے۔','',
  '63','00:01:05,000 --> 00:01:07,000','اگلا جملہ۔',''
 ].join('\n');
 const cues=parseMeasuredCues(raw);
 assert.equal(cues.length,3);
 assert.equal(cues[1].startSeconds,62);
 assert.equal(cues[1].endSeconds,65);
 assert.equal(cues[1].text,'پھر پہلا جملہ۔\n\nپھر ڈیلیا اپنا قدم اٹھاتی ہے۔');
 assert.equal(cues[2].text,'اگلا جملہ۔');
});
test('SRT parser does not invent a new cue from a blank line and ordinary number',()=>{
 const raw=[
  '1','00:00:00,000 --> 00:00:04,000','Beginning of phrase.','','42','continuation is part of same cue.',
  '','2','00:00:04,000 --> 00:00:08,000','Last phrase.'
 ].join('\n');
 const cues=parseMeasuredCues(raw);
 assert.equal(cues.length,2);
 assert.match(cues[0].text,/continuation is part/);
});
test('SRT parser keeps precise measured count and rejects malformed header text',()=>{
 const raw=[
  'Garbage before first cue','',
  '1','00:00:00,000 --> 00:00:02,000','First.'
 ].join('\n');
 assert.throws(()=>parseMeasuredCues(raw),/Unexpected text before first/);
 assert.throws(()=>parseMeasuredCues('1\n00:00:00,000 --> 00:00:02,000\n'),/Empty measured subtitle cue/);
});
