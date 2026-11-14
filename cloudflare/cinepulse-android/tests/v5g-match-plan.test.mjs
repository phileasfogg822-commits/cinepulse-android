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
test('one real measured cue may span two consecutive narration units without splitting accepted SRT',()=>{
 const p=make();p.measuredCues[2].unitIds=['ur1','ur2'];
 const result=validateV5gGlobalPlan(args(p));
 assert.equal(result.validation.urdu.cues,2);
 assert.equal(result.validation.urdu.units,2);
 assert.equal(result.validation.english.cues,2);
 assert.equal(result.validation.status,'reviewed_all_units');
});
test('merged measured cues cannot cite nonconsecutive, reversed, repeated, unknown or cross-language units',()=>{
 for(const unitIds of [['ur2','ur1'],['ur1','ur1'],['ur1','ur3'],['ur1','en2']]){
  const p=make();p.measuredCues[2].unitIds=unitIds;
  assert.throws(()=>validateV5gGlobalPlan(args(p)),
   /merges non-consecutive or unknown narration units/,JSON.stringify(unitIds));
 }
});
test('splitting a stored SRT cue into extra virtual cues remains forbidden by measured count guard',()=>{
 const p=make();
 p.measuredCues.push({...p.measuredCues[3],index:3});
 assert.throws(()=>validateV5gGlobalPlan(args(p)),/Measured cue count mismatch/);
});
test('long unit needs one in-blueprint source decision, not one for each of its measured fragments',()=>{
 // Three actual English SRT cues cover two approved units. The second
 // decision for en1 honestly cites a source cue outside en1's blueprint.
 // Another reviewed decision for en1 cites its real in-window source cue.
 const enThree=`1
00:00:00,000 --> 00:00:02,000
First greeting.

2
00:00:02,000 --> 00:00:03,000
First passage continues.

3
00:00:03,000 --> 00:00:04,000
Then a question.`;
 const p=make();
 p.measuredCues=p.measuredCues.filter(c=>c.language==='urdu');
 const english=[
  {language:'english',index:1,startSeconds:0,endSeconds:2,text:'First greeting.',unitIds:['en1']},
  {language:'english',index:2,startSeconds:2,endSeconds:3,text:'First passage continues.',unitIds:['en1']},
  {language:'english',index:3,startSeconds:3,endSeconds:4,text:'Then a question.',unitIds:['en2']}
 ];
 p.measuredCues.unshift(...english);
 const template=p.decisions.english[0];
 p.decisions.english=[
  {...template,segmentIndex:1,unitId:'en1',sourceCueIds:[1],
   sourceStartSeconds:1,sourceEndSeconds:2,evidenceQuote:'Morning, Sophie.'},
  {...template,segmentIndex:2,unitId:'en1',sourceCueIds:[2],
   sourceStartSeconds:12,sourceEndSeconds:13,evidenceQuote:'Where are you?'},
  {...template,segmentIndex:3,unitId:'en2',sourceCueIds:[3],
   sourceStartSeconds:25,sourceEndSeconds:26,evidenceQuote:'Morning, Sophie.'}
 ];
 const blueprint={beats:evidenceBlueprint.beats,
  blueprint:[{beatId:'b1',startSeconds:1,endSeconds:2},
   {beatId:'b2',startSeconds:25,endSeconds:26}]};
 const input={...args(p),englishSrt:enThree,evidence:blueprint};
 const good=validateV5gGlobalPlan(input);
 assert.equal(good.validation.english.cues,3);
 assert.equal(good.validation.english.units,2);
 // All en1 source decisions are now outside b1's blueprint.
 const broken=structuredClone(p);
 broken.decisions.english[0]={
  ...broken.decisions.english[0],sourceCueIds:[4],
  sourceStartSeconds:32,sourceEndSeconds:33,evidenceQuote:'Listen to me.'
 };
 assert.throws(()=>validateV5gGlobalPlan({...input,input:broken}),
  /outside its narration beat blueprint for unit en1/);
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
