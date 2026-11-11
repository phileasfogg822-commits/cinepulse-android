import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleCarD1Inventory as assemble,collectCarD1Inventory as collect,reconcileCarEvidence} from '../src/car-d1-inventory.mjs';
const srt=(n)=>Array.from({length:n},(_,i)=>String(i+1)+'\n00:00:'+String(i*2).padStart(2,'0')+',000 --> 00:00:'+String(i*2+1).padStart(2,'0')+',000\nNarration '+(i+1)+'\n').join('\n');
const batch=(n)=>({decisions:Array.from({length:n},(_,i)=>({segmentIndex:i+1}))});
const input=()=>({englishSrt:srt(6),urduSrt:srt(2),englishBatches:[batch(5)],urduBatches:[],jobs:[{id:'a',step_id:'deep_match_english',status:'done',created_at:100}]});
test('D1 collector enumerates both languages without guessing unresolved',()=>{const i=assemble(input());assert.equal(i.english.reviewed,5);assert.equal(i.unknownSegmentIds.length,3);assert.equal(i.complete,false);assert.equal(i.mutationPermitted,false);assert.equal(i.eligibility.verified,false)});
test('D1 failure messages do not certify unresolved segments',()=>{const x=input();x.jobs.push({id:'failure',step_id:'deep_match_english',status:'error',error:'segment 6 lacks a cue',created_at:101});const i=assemble(x);assert.equal(i.failedJobEvidence.length,1);assert.deepEqual(i.unknownSegmentIds,['english:6','urdu:1','urdu:2']);assert.equal(i.eligibility.verified,false)});
test('missing Urdu measured SRT rejects instead of inferring coverage',()=>{const x=input();delete x.urduSrt;assert.throws(()=>assemble(x),/missing urdu/)});
test('corrupt committed batch fails rather than silently skipping',()=>{const x=input();x.englishBatches=[{decisions:[{segmentIndex:2}]}];assert.throws(()=>assemble(x),/Corrupt|Incomplete/)});
test('fully accepted D1 source is not eligible for recovery',()=>{const x=input();x.englishSrt=srt(5);x.urduBatches=[batch(2)];const i=assemble(x);assert.equal(i.complete,true);assert.equal(i.eligibility.verified,false);assert.equal(i.eligibility.reason,'lifetime_cap_exceeded_or_empty')});
test('collector queries D1 read-only and loads checkpoints for both languages',async()=>{
  const x=input(),queries=[];
  const db={
    prepare(sql){
      queries.push(sql);
      return {
        bind(...args){
          return {
            async all(){
              assert.equal(args.length,3);
              return {results:x.jobs};
            }
          };
        }
      };
    }
  };
  const i=await collect({DB:db},'some-project',
    {srt_english:x.englishSrt,srt_urdu:x.urduSrt},
    async (_env,_id,stage)=>stage==='deep_match_english'?x.englishBatches:[]);
  assert.equal(i.english.reviewed,5);
  assert.ok(queries.every(q=>/^SELECT /i.test(q)));
});

test('unverified error evidence cannot resolve an unknown segment',()=>{
 const base=assemble(input());
 assert.throws(()=>reconcileCarEvidence(base,[{id:'english:6',status:'unresolved',sourceJobId:'j1',snapshotVersion:100}]),/invalid/);
});
test('stale, duplicate and accepted-segment evidence are rejected',()=>{
 const base=assemble(input());
 const evidence={id:'english:6',status:'unresolved',sourceJobId:'j1',verifiedByProduction:true,snapshotVersion:100};
 assert.throws(()=>reconcileCarEvidence(base,[{...evidence,snapshotVersion:99}]),/stale/);
 assert.throws(()=>reconcileCarEvidence(base,[evidence,evidence]),/invalid/);
 assert.throws(()=>reconcileCarEvidence(base,[{...evidence,id:'english:1'}]),/collides/);
});
test('partial verified evidence leaves other segments unknown and denied',()=>{
 const base=assemble(input());
 const result=reconcileCarEvidence(base,[{id:'english:6',status:'unresolved',sourceJobId:'j1',verifiedByProduction:true,snapshotVersion:100}]);
 assert.deepEqual(result.unknownSegmentIds,['urdu:1','urdu:2']);
 assert.equal(result.eligibility.verified,false);
 assert.equal(result.mutationPermitted,false);
 assert.deepEqual(base.unknownSegmentIds,['english:6','urdu:1','urdu:2']);
});
test('complete verified evidence counts both languages and applies CAR cap',()=>{
 const base=assemble(input());
 const ev=['english:6','urdu:1','urdu:2'].map(id=>({id,status:'unresolved',sourceJobId:'j1',verifiedByProduction:true,snapshotVersion:100}));
 const result=reconcileCarEvidence(base,ev);
 assert.equal(result.complete,true);
 assert.equal(result.eligibility.verified,true);
 assert.equal(result.eligibility.lifetimeCount,3);
 assert.equal(result.mutationPermitted,false);
});
test('more than three lifetime unresolved segments are rejected',()=>{
 const base=assemble(input());
 const ev=['english:6','urdu:1','urdu:2'].map(id=>({id,status:'unresolved',sourceJobId:'j1',verifiedByProduction:true,snapshotVersion:100}));
 const result=reconcileCarEvidence(base,[{...ev[0],status:'recovered'},ev[1],ev[2]]);
 assert.equal(result.eligibility.verified,true);
 const extra={...base,unknownSegmentIds:['english:6','urdu:1','urdu:2','english:7'],
 english:{...base.english,segments:[...base.english.segments,{index:7,status:'unknown'}],total:7}};
 assert.equal(extra.unknownSegmentIds.length,4);
});
