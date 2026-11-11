import test from 'node:test';import assert from 'node:assert/strict';
import {checkCarRecoveryWrite,insertCarRecoveryCheckpoint,ensureCarRecoveryLedger} from '../src/car-recovery-ledger.mjs';
const id='fed941ad-ff7f-4b0f-8439-25cfda24d187';
const good=()=>({enabled:true,projectId:id,targetId:'english:81',inventory:{source:'d1_authoritative',complete:true,mutationPermitted:true,snapshotVersion:8,acceptedSegmentIds:[],recoveredSegmentIds:[],eligibility:{verified:true,unresolvedSegmentIds:['english:81']}},decision:{anchorMethod:'context',visualVerified:false,sourceCueIds:[480],museRequestId:'muse-123'}});
test('disabled by default',()=>assert.equal(checkCarRecoveryWrite({...good(),enabled:false}).reason,'feature_disabled'));
test('unknown D1 inventory cannot write',()=>{const x=good();x.inventory.mutationPermitted=false;assert.equal(checkCarRecoveryWrite(x).reason,'inventory_not_authoritative')});
test('cannot write a different accepted segment',()=>{const x=good();x.targetId='english:80';assert.equal(checkCarRecoveryWrite(x).reason,'target_not_unresolved')});
test('must carry real source cue provenance',()=>{const x=good();x.decision.sourceCueIds=[];assert.equal(checkCarRecoveryWrite(x).reason,'unverified_recovery_decision')});
test('requires production validation before touching D1',async()=>{let calls=0;const x=good();const r=await insertCarRecoveryCheckpoint({DB:{prepare(){calls++;throw Error('unexpected DB call')}}},x);assert.equal(r.saved,false);assert.equal(r.reason,'production_validation_required');assert.equal(calls,0)});
test('writes isolated ledger only and is retry-idempotent',async()=>{const sql=[],calls=[];const env={DB:{prepare(s){sql.push(s);return{bind(...a){calls.push(a);return{async run(){return{meta:{changes:calls.length===1?1:0}}}}},async run(){return{}}}}}};await ensureCarRecoveryLedger(env);const x={...good(),productionValidated:true};const first=await insertCarRecoveryCheckpoint(env,x),again=await insertCarRecoveryCheckpoint(env,x);assert.equal(first.saved,true);assert.equal(again.saved,false);assert.ok(sql.every(s=>!s.includes('UPDATE jobs')));assert.equal(calls[0][1],'english:81')});

test('rejects forged client-side inventory even with verified flag',()=>{
 const x=good();x.inventory.source='client';
 assert.equal(checkCarRecoveryWrite(x).reason,'inventory_not_authoritative');
});
test('accepted anchors are immutable',()=>{
 const x=good();x.inventory.acceptedSegmentIds=['english:81'];
 assert.equal(checkCarRecoveryWrite(x).reason,'target_not_unresolved');
});
test('previously recovered target cannot be overwritten',()=>{
 const x=good();x.inventory.recoveredSegmentIds=['english:81'];
 assert.equal(checkCarRecoveryWrite(x).reason,'target_not_unresolved');
});
test('recovered plus unresolved lifetime cap cannot exceed three',()=>{
 const x=good();x.inventory.recoveredSegmentIds=['urdu:9','english:42','english:12'];
 assert.equal(checkCarRecoveryWrite(x).reason,'target_not_unresolved');
});
test('read-only D1 diagnostic cannot be used as write authorization',()=>{
 const x=good();x.inventory.source='d1_read_only';x.inventory.mutationPermitted=false;
 assert.equal(checkCarRecoveryWrite(x).reason,'inventory_not_authoritative');
});
