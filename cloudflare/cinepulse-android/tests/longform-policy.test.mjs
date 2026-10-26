import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFinalCutPlan,isLongFormCreateRequest,normalizePublishingMetadata,srtLastTimestamp} from '../src/longform-policy.mjs';
const time=t=>{let ms=Math.round(t*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`};
const srt=end=>`1\n${time(0)} --> ${time(end)}\nSome text\n`;
const fixture=()=>({sourceSrt:srt(6000),englishSrt:srt(12),urduSrt:srt(12)});
const cuts=()=>[
 {language:'english',sourceStartSeconds:50,sourceEndSeconds:56,narrationStartSeconds:0,narrationEndSeconds:6},
 {language:'english',sourceStartSeconds:150,sourceEndSeconds:156,narrationStartSeconds:6,narrationEndSeconds:12},
 {language:'urdu',sourceStartSeconds:300,sourceEndSeconds:306,narrationStartSeconds:0,narrationEndSeconds:6},
 {language:'urdu',sourceStartSeconds:350,sourceEndSeconds:356,narrationStartSeconds:6,narrationEndSeconds:12}
];
test('valid 3-6 second timeline for two 12-second narrator tracks',()=>{const r=validateFinalCutPlan(cuts(),fixture());assert.equal(r.english.cuts,2);assert.equal(r.urdu.audioSeconds,12)});
test('clip under 3 seconds is rejected',()=>{const c=cuts();c[0].sourceEndSeconds=52;c[0].narrationEndSeconds=2;assert.throws(()=>validateFinalCutPlan(c,fixture()),/3–6/)});
test('clip above 6 seconds is rejected',()=>{const c=cuts();c[0].sourceEndSeconds=57;c[0].narrationEndSeconds=7;assert.throws(()=>validateFinalCutPlan(c,fixture()),/3–6/)});
test('source overlap rejected',()=>{const c=cuts();c[1].sourceStartSeconds=54;c[1].sourceEndSeconds=60;assert.throws(()=>validateFinalCutPlan(c,fixture()),/overlaps/)});
test('narration gap rejected',()=>{const c=cuts();c[1].narrationStartSeconds=6.5;c[1].narrationEndSeconds=12.5;assert.throws(()=>validateFinalCutPlan(c,fixture()),/gap/)});
test('incomplete Urdu timeline rejected',()=>{const c=cuts();c.pop();assert.throws(()=>validateFinalCutPlan(c,fixture()),/Urdu|urdu/)});
test('long source window is rejected rather than turned into short movie',()=>{const c=cuts();c[0].sourceEndSeconds=210;assert.throws(()=>validateFinalCutPlan(c,fixture()),/3–6/)});
test('source bounds rejected',()=>{const c=cuts();c[1].sourceStartSeconds=5998;c[1].sourceEndSeconds=6004;assert.throws(()=>validateFinalCutPlan(c,fixture()),/outside movie SRT/)});
test('metadata has no viral payload',()=>{assert.deepEqual(normalizePublishingMetadata({metadata:{description:'A chronological recap with cinematic narration.',keywords:['movie'],hashtags:['#movie']}}).keywords,['movie']);assert.throws(()=>normalizePublishingMetadata({metadata:{description:'A chronological recap with cinematic narration.',keywords:['movie'],hashtags:['#movie']},viralScenes:[]}),/must not/)});
test('create request defaults to long form only',()=>{assert.equal(isLongFormCreateRequest({}).outputMode,'long_form_only');assert.throws(()=>isLongFormCreateRequest({modules:{shorts:true}}),/disabled/)});
test('SRT timing reads measured end',()=>{assert.equal(srtLastTimestamp(srt(540)),540)});