import test from 'node:test';
import assert from 'node:assert/strict';
import {validateV5gGlobalPlan} from '../src/v5g-match-plan.mjs';
const source=['1\n00:00:01,000 --> 00:00:02,000\nMorning, Sophie.',
'2\n00:00:12,000 --> 00:00:13,000\nWhere are you?',
'3\n00:00:25,000 --> 00:00:26,000\nMorning, Sophie.',
'4\n00:00:32,000 --> 00:00:33,000\nListen to me.'].join('\n\n');
const en=['1\n00:00:00,000 --> 00:00:02,000\nFirst greeting.',
'2\n00:00:02,000 --> 00:00:04,000\nThen a question.'].join('\n\n');
const ur=['1\n00:00:00,000 --> 00:00:02,000\nپہلا سلام۔',
'2\n00:00:02,000 --> 00:00:04,000\nپھر سوال۔'].join('\n\n');
const evidenceBlueprint={beats:[{id:'b1'},{id:'b2'}],blueprint:[{beatId:'b1',startSeconds:1,endSeconds:2},{beatId:'b2',startSeconds:12,endSeconds:13}]};
const preflight={narrationUnits:[
{language:'english',id:'en1',text:'First greeting.',beatIds:['b1']},
{language:'english',id:'en2',text:'Then a question.',beatIds:['b2']},
{language:'urdu',id:'ur1',text:'پہلا سلام۔',beatIds:['b1']},
{language:'urdu',id:'ur2',text:'پھر سوال۔',beatIds:['b2']}]};
const evidence={english:['Morning, Sophie.','Where are you?'],urdu:['Morning, Sophie.','Where are you?']};
const make=()=>{
 const measuredCues=[];
 for(const [lang,cues] of [['english',['First greeting.','Then a question.']],['urdu',['پہلا سلام۔','پھر سوال۔']]])
  for(let i=0;i<2;i++)measuredCues.push({language:lang,index:i+1,startSeconds:i*2,endSeconds:(i+1)*2,
   text:cues[i],unitIds:[lang==='english'?'en'+(i+1):'ur'+(i+1)]});
 const decisions={english:[],urdu:[]};
 for(const lang of ['english','urdu'])for(let i=0;i<2;i++){
  decisions[lang].push({segmentIndex:i+1,unitId:lang==='english'?'en'+(i+1):'ur'+(i+1),
   sourceStartSeconds:i?12:1,sourceEndSeconds:i?13:2,sourceCueIds:[i+1],
   evidenceQuote:evidence[lang][i],reason:'This exact original cue supports the specific narration passage.',
   alternatives:[{cueId:4,reason:'Different dialogue and different story event'}],
   confidence:.98,qualityScore:.96,independentSubtitleReview:true,reviewerRef:'reviewer-A',
   museRequestId:'Muse-verified-request-1234'});
 }
 return {measuredCues,decisions};
};
const args=input=>({sourceSrt:source,englishSrt:en,urduSrt:ur,preflight,evidence:evidenceBlueprint,input});
test('whole-movie bilingual plan validates before batches and preserves semantic units',()=>{
 const r=validateV5gGlobalPlan(args(make()));
 assert.equal(r.validation.status,'reviewed_all_units');
 assert.equal(r.validation.english.units,2);
 assert.equal(r.validation.urdu.batches,1);
});
test('one weak 0.6 confidence cannot pass 9/10 SRT relevance gate',()=>{
 const p=make();p.decisions.english[1].qualityScore=.6;
 assert.throws(()=>validateV5gGlobalPlan(args(p)),/>=9\/10 review/);
});
test('long merged STT cue crossing two narration units requires targeted real alignment',()=>{
 const p=make();p.measuredCues[2].unitIds=['ur1','ur2'];
 assert.throws(()=>validateV5gGlobalPlan(args(p)),/merges distinct narration units/);
});
test('global plan rejects reused film source time in one language',()=>{
 const p=make();p.decisions.english[1].sourceStartSeconds=1;p.decisions.english[1].sourceEndSeconds=2;
 assert.throws(()=>validateV5gGlobalPlan(args(p)),/Source anchor reused/);
});
test('narration-measured-SRT timestamps are checked against the actual saved SRT',()=>{
 const p=make();p.measuredCues[0].startSeconds=.1;
 assert.throws(()=>validateV5gGlobalPlan(args(p)),/timestamps differ/);
});

test('global semantic source decision must belong to narration digest blueprint',()=>{
 const p=make();p.decisions.english[0].sourceStartSeconds=25;
 p.decisions.english[0].sourceEndSeconds=26;p.decisions.english[0].sourceCueIds=[3];
 p.decisions.english[0].evidenceQuote='Morning, Sophie.';
 assert.throws(()=>validateV5gGlobalPlan(args(p)),/outside its narration beat blueprint/);
});
