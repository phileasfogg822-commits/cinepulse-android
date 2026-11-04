import test from 'node:test';
import assert from 'node:assert/strict';
import {rankDeepMuseCandidates,DEEP_CANDIDATE_BUDGET} from '../src/scene-lab-deep-candidates.mjs';
const stamp=n=>{
 const x=Math.round(n*1000),p=y=>String(y).padStart(2,'0');
 return p(Math.floor(x/3600000))+':'+p(Math.floor(x/60000)%60)+':'+p(Math.floor(x/1000)%60)+','+String(x%1000).padStart(3,'0');
};
const source=Array.from({length:250},(_,i)=>(i+1)+'\n'+stamp(i*10)+' --> '+stamp(i*10+10)+'\n'+
 (i===239?'the secret rare-fossil emerald lantern dialogue':'Peter Rabbit speaks to his friends in the garden '+i)+'\n').join('\n');
const all=[0,1,2,3,4,5,6,7,8,9].map(i=>({segmentIndex:i+1,narrationStartSeconds:i*5,
 narrationEndSeconds:(i+1)*5,text:i===0?'Find the emerald lantern and rare-fossil':'Peter runs in the garden'}));
test('Windows-compatible whole movie ranking retrieves distant lexical evidence, not only nearby cues',()=>{
 const r=rankDeepMuseCandidates(source,all.slice(0,5),all);
 assert.equal(r.sourceCueCount,250);
 assert.equal(r.budget,DEEP_CANDIDATE_BUDGET);
 assert.ok(r.candidates.some(x=>x.cueId===240),'late-film strong lexical candidate must be considered');
 assert.ok(r.usedCharacters<=DEEP_CANDIDATE_BUDGET+1);
});
test('source reservation excludes previously selected source neighborhood',()=>{
 const prior=[{sourceStartSeconds:2390,sourceEndSeconds:2410}];
 const r=rankDeepMuseCandidates(source,all.slice(0,5),all,prior);
 assert.ok(!r.candidates.some(x=>x.cueId===240));
 assert.equal(r.priorReservedRanges,1);
});
test('ranked candidate budget keeps context near movie chronology and supports small budgets',()=>{
 const r=rankDeepMuseCandidates(source,all.slice(5),all,[],1000);
 assert.ok(r.candidateCount>0);
 assert.ok(r.usedCharacters<=1000);
 assert.ok(r.candidates.every(c=>Number.isInteger(c.cueId)&&c.sourceStartSeconds===undefined)); // schema is startSeconds/endSeconds
 assert.ok(r.candidates.some(c=>c.startSeconds>=0));
});
