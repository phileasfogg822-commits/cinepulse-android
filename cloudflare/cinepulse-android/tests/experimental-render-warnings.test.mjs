import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFinalCutPlan} from '../src/longform-policy.mjs';

const srt=t=>`1\n00:00:00,000 --> 00:00:${t},000\nPeter and the garden scene.\n`;
const cuts=[];
for(const language of ['english','urdu']){
 cuts.push({language,sourceStartSeconds:0,sourceEndSeconds:5,narrationStartSeconds:0,narrationEndSeconds:5});
 cuts.push({language,sourceStartSeconds:0,sourceEndSeconds:5,narrationStartSeconds:5,narrationEndSeconds:10});
}
const input={sourceSrt:srt('15'),englishSrt:srt('10'),urduSrt:srt('10')};
test('stable Muse cut validation still rejects repeated source frames',()=>{
 assert.throws(()=>validateFinalCutPlan(cuts,input),/source movie footage overlaps/);
});
test('experimental quality gate preserves complete sound timings but reports repeated frames',()=>{
 const result=validateFinalCutPlan(cuts,{...input,experimentalReview:true});
 assert.equal(result.english.cuts,2);
 assert.ok(result.english.reviewWarnings.some(x=>x.includes('repeats')));
 assert.ok(result.urdu.reviewWarnings.some(x=>x.includes('repeats')));
});
test('experimental preview still rejects impossible source timestamps and narration gaps',()=>{
 const broken=cuts.map(c=>({...c}));
 broken[0].sourceEndSeconds=20;
 assert.throws(()=>validateFinalCutPlan(broken,{...input,experimentalReview:true}),/outside movie SRT timeline/);
 const gap=cuts.map(c=>({...c}));
 gap[1].narrationStartSeconds=6;
 assert.throws(()=>validateFinalCutPlan(gap,{...input,experimentalReview:true}),/lengths differ|gap|overlap/);
});
