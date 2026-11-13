import test from 'node:test';
import assert from 'node:assert/strict';
import {V5G_MARKER,V5G_STEPS,validateV5gEvidence,validateV5gPreTts,validateV5gMeasuredCues} from '../src/v5g-production-gate.mjs';
const srt=['1\n00:00:01,000 --> 00:00:02,000\nMorning, Sophie.',
 '2\n00:00:12,000 --> 00:00:13,000\nWhere are you?',
 '3\n00:00:25,000 --> 00:00:26,000\nMorning, Sophie.'].join('\n\n');
const evidence=()=>({beats:[
 {id:'b1',summary:'First greeting',evidence:[{kind:'subtitle',cueId:1,exactQuote:'Morning, Sophie.'}]},
 {id:'b2',summary:'Question',evidence:[{kind:'subtitle',cueId:2,exactQuote:'Where are you?'}]},
 {id:'b3',summary:'Later greeting',evidence:[{kind:'subtitle',cueId:3,exactQuote:'Morning, Sophie.'}]}
],blueprint:[
 {beatId:'b1',startSeconds:1,endSeconds:2},
 {beatId:'b2',startSeconds:12,endSeconds:13},
 {beatId:'b3',startSeconds:25,endSeconds:26}
]});
const units=()=>[
 {language:'english',id:'e1',text:'First greeting.',beatIds:['b1']},
 {language:'english',id:'e2',text:'The question follows.',beatIds:['b2']},
 {language:'english',id:'e3',text:'Then another greeting.',beatIds:['b3']},
 {language:'urdu',id:'u1',text:'پہلا سلام۔',beatIds:['b1']},
 {language:'urdu',id:'u2',text:'پھر سوال۔',beatIds:['b2']},
 {language:'urdu',id:'u3',text:'دوسرا سلام۔',beatIds:['b3']}
];
test('new grounded queue includes evidence and preflight before voice, and match plan before matching',()=>{
 assert.ok(V5G_MARKER);assert.ok(V5G_STEPS.indexOf('grounded_evidence')<V5G_STEPS.indexOf('narration_english'));
 assert.ok(V5G_STEPS.indexOf('grounded_preflight')<V5G_STEPS.indexOf('mp3_english'));
 assert.ok(V5G_STEPS.indexOf('grounded_match_plan')<V5G_STEPS.indexOf('deep_match_english'));
});
test('two identical spoken quotes must point to their own source cue ID',()=>{
 const r=validateV5gEvidence(srt,evidence());assert.equal(r.validation.digestBeats,3);
 const b=evidence();b.beats[2].evidence[0].cueId=2;
 assert.throws(()=>validateV5gEvidence(srt,b),/invalid/);
});
test('narration must match accepted exact script and retain all beat IDs in both languages',()=>{
 const r=validateV5gPreTts({sourceSrt:srt,evidence:evidence(),englishScript:'First greeting. The question follows. Then another greeting.',
 urduScript:'پہلا سلام۔ پھر سوال۔ دوسرا سلام۔',input:{narrationUnits:units()}});
 assert.equal(r.validation.ready,true);assert.equal(r.validation.urduUnits,3);
});
test('missing beat or invented narration text fails before audio',()=>{
 const a=units();a[4].beatIds=['missing'];
 assert.throws(()=>validateV5gPreTts({sourceSrt:srt,evidence:evidence(),englishScript:'First greeting. The question follows. Then another greeting.',urduScript:'پہلا سلام۔ پھر سوال۔ دوسرا سلام۔',input:{narrationUnits:a}}),/invalid/);
 const b=units();b[0].text='Invented first story.';
 assert.throws(()=>validateV5gPreTts({sourceSrt:srt,evidence:evidence(),englishScript:'First greeting. The question follows. Then another greeting.',urduScript:'پہلا سلام۔ پھر سوال۔ دوسرا سلام۔',input:{narrationUnits:b}}),/does not exactly correspond/);
});
test('measured subtitle evidence requires exact actual times and text',()=>{
 const a=[{language:'english',index:1,startSeconds:1,endSeconds:2,text:'Morning, Sophie.',unitIds:['e1']},
 {language:'english',index:2,startSeconds:12,endSeconds:13,text:'Where are you?',unitIds:['e2']},
 {language:'english',index:3,startSeconds:25,endSeconds:26,text:'Morning, Sophie.',unitIds:['e3']}];
 assert.equal(validateV5gMeasuredCues(srt,a,'english').count,3);
 a[2].endSeconds=26.11;
 assert.throws(()=>validateV5gMeasuredCues(srt,a,'english'),/timestamps differ/);
});
test('context gap bridges may be used without video or invented visual events',()=>{
 const base=evidence();base.beats.push({id:'gap',summary:'A transition separates the events',evidence:[{kind:'srt_context',
 precedingCueId:1,followingCueId:2,precedingExactQuote:'Morning, Sophie.',followingExactQuote:'Where are you?',
 role:'temporal_transition',reason:'The next question follows after an uncaptioned interval'}]});
 base.blueprint.push({beatId:'gap',startSeconds:2,endSeconds:12});
 assert.equal(validateV5gEvidence(srt,base).validation.digestBeats,4);
});
