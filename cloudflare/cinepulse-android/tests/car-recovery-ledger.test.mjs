import test from 'node:test';import assert from 'node:assert/strict';
import {checkCarRecoveryWrite,insertCarRecoveryCheckpoint,ensureCarRecoveryLedger,authorizeCarD1Inventory,verifyCarSourceSrt,insertScopedCarRecoveryCheckpoint,loadScopedCarRecoveryCheckpoints,inspectScopedCarRecoveryReadiness,buildScopedCarRecoveryHandoff} from '../src/car-recovery-ledger.mjs';
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

test('D1 authorization never upgrades incomplete unknown coverage',()=>{
 const snapshot={source:'d1_read_only',readOnly:true,mutationPermitted:false,
  complete:false,snapshotVersion:12,unknownSegmentIds:['english:81'],
  acceptedSegmentIds:[],recoveredSegmentIds:[]};
 const verified={verified:true,snapshotVersion:12,unresolvedSegmentIds:['english:81'],lifetimeCount:1};
 assert.equal(authorizeCarD1Inventory(snapshot,verified).authorized,false);
});
test('D1 authorization refuses mismatched snapshot versions',()=>{
 const snapshot={source:'d1_read_only',readOnly:true,mutationPermitted:false,
  complete:true,snapshotVersion:12,unknownSegmentIds:[],acceptedSegmentIds:[],recoveredSegmentIds:[]};
 const verified={verified:true,snapshotVersion:13,unresolvedSegmentIds:['english:81'],lifetimeCount:1};
 assert.equal(authorizeCarD1Inventory(snapshot,verified).authorized,false);
});
test('D1 authorization accepts only verified complete noncolliding snapshot',()=>{
 const snapshot={source:'d1_read_only',readOnly:true,mutationPermitted:false,
  complete:true,snapshotVersion:12,unknownSegmentIds:[],acceptedSegmentIds:['english:1'],recoveredSegmentIds:[]};
 const verified={verified:true,snapshotVersion:12,unresolvedSegmentIds:['english:81'],lifetimeCount:1};
 const result=authorizeCarD1Inventory(snapshot,verified);
 assert.equal(result.authorized,true);
 assert.equal(checkCarRecoveryWrite({...good(),inventory:result.inventory}).ok,true);
 assert.equal(snapshot.mutationPermitted,false);
});
test('D1 authorization refuses unresolved collision with accepted decisions',()=>{
 const snapshot={source:'d1_read_only',readOnly:true,mutationPermitted:false,
  complete:true,snapshotVersion:12,unknownSegmentIds:[],acceptedSegmentIds:['english:81'],recoveredSegmentIds:[]};
 const verified={verified:true,snapshotVersion:12,unresolvedSegmentIds:['english:81'],lifetimeCount:1};
 assert.equal(authorizeCarD1Inventory(snapshot,verified).reason,'checkpoint_collision');
});

test('CAR source quote must occur in the original source cue',()=>{
 const source='25\n00:01:00,000 --> 00:01:04,000\nThe dragon is flying over the village.\n\n26\n00:01:05,000 --> 00:01:08,000\nThe villagers run away.\n';
 assert.equal(verifyCarSourceSrt(source,{sourceCueIds:[25],evidenceQuote:'dragon is flying over the village'}).verified,true);
 assert.equal(verifyCarSourceSrt(source,{sourceCueIds:[25],evidenceQuote:'the hero defeats the villain'}).reason,'source_quote_mismatch');
 assert.equal(verifyCarSourceSrt(source,{sourceCueIds:[999],evidenceQuote:'dragon is flying'}).reason,'source_cue_not_found');
});
test('CAR source verifier rejects missing or duplicate cue evidence',()=>{
 const source='25\n00:01:00,000 --> 00:01:04,000\nThe dragon is flying over the village.\n';
 assert.equal(verifyCarSourceSrt(source,{sourceCueIds:[],evidenceQuote:'dragon is flying'}).reason,'missing_source_provenance');
 assert.equal(verifyCarSourceSrt(source+ '\n'+source,{sourceCueIds:[25],evidenceQuote:'dragon is flying'}).reason,'duplicate_source_cue');
});

test('scoped CAR checkpoint rejects unverified candidate without D1 mutation',async()=>{
 let calls=0;
 const env={DB:{prepare(){calls++;throw Error('unexpected database write')}}};
 const audit={projectId:id,source:'d1_read_only',mutationPermitted:false,
  inventory:{source:'d1_read_only',readOnly:true,snapshotVersion:100,acceptedSegmentIds:[],unknownSegmentIds:['english:81']},
  evidenceStatus:'not_verified',verifiedSegmentIds:[]};
 const result=await insertScopedCarRecoveryCheckpoint(env,{projectId:id,targetId:'english:81',audit,enabled:true});
 assert.equal(result.saved,false);assert.equal(result.reason,'candidate_not_verified');assert.equal(calls,0);
});
test('scoped CAR checkpoint performs single conditional CAR-only insert',async()=>{
 const queries=[],bindings=[];
 const env={DB:{prepare(sql){queries.push(sql);return {bind(...args){bindings.push(args);return {async run(){return {meta:{changes:1}}}}}}}}};
 const audit={projectId:id,source:'d1_read_only',mutationPermitted:false,
  inventory:{source:'d1_read_only',readOnly:true,snapshotVersion:100,acceptedSegmentIds:[],unknownSegmentIds:['english:81']},
  evidenceStatus:'verified',verifiedSegmentIds:['english:81'],verifiedProvenance:[{
   targetId:'english:81',sourceJobId:'job-123',sourceCueIds:[25],
   sourceCueQuote:'dragon flies over village',museRequestId:'muse-123'}]};
 const decision={anchorMethod:'context',visualVerified:false,sourceCueIds:[25],
  evidenceQuote:'dragon flies over village',museRequestId:'muse-123'};
 const result=await insertScopedCarRecoveryCheckpoint(env,{projectId:id,targetId:'english:81',
  audit,decision,sourceSrt:'25\n00:01:00,000 --> 00:01:04,000\nThe dragon flies over village.\n',enabled:true});
 assert.equal(result.saved,true);assert.equal(queries.length,1);
 assert.match(queries[0],/INSERT INTO car_recovery_checkpoints/);
 assert.match(queries[0],/COUNT\(\*\)/);
 assert.match(queries[0],/MAX\(created_at\)/);
 assert.doesNotMatch(queries[0],/UPDATE jobs|DELETE FROM jobs/);
 assert.equal(bindings[0][9],100);
});

test('durable CAR reader returns bounded checkpoints without mutation',async()=>{
 const sql=[];
 const env={DB:{prepare(q){sql.push(q);return {bind(project){assert.equal(project,id);return {
  async all(){return {results:[{target_id:'english:81',snapshot_version:100,
   decision_json:JSON.stringify({anchorMethod:'context',visualVerified:false,sourceCueIds:[25]}),
   created_at:99}]}}}}}}}};
 const result=await loadScopedCarRecoveryCheckpoints(env,id);
 assert.equal(result.length,1);assert.equal(result[0].targetId,'english:81');
 assert.equal(sql.length,1);assert.match(sql[0],/^SELECT /);
});
test('durable CAR reader fails closed on corrupt stored decisions',async()=>{
 const env={DB:{prepare(){return {bind(){return {async all(){return {results:[
  {target_id:'urdu:4',snapshot_version:9,decision_json:'not-json',created_at:1}]}}}}}}}};
 await assert.rejects(loadScopedCarRecoveryCheckpoints(env,id),/corrupt_car_checkpoint/);
});

test('CAR scoped write rejects changed Muse provenance before D1 access',async()=>{
 let calls=0;
 const env={DB:{prepare(){calls++;throw Error('unexpected database access')}}};
 const audit={projectId:id,source:'d1_read_only',mutationPermitted:false,
  inventory:{source:'d1_read_only',readOnly:true,snapshotVersion:100,
   acceptedSegmentIds:[],unknownSegmentIds:['english:81']},
  evidenceStatus:'verified',verifiedSegmentIds:['english:81'],
  verifiedProvenance:[{targetId:'english:81',sourceJobId:'job-123',
   sourceCueIds:[25],sourceCueQuote:'dragon flies over village',museRequestId:'muse-123'}]};
 const decision={anchorMethod:'context',visualVerified:false,sourceCueIds:[25],
  evidenceQuote:'dragon flies over village',museRequestId:'forged-456'};
 const result=await insertScopedCarRecoveryCheckpoint(env,{projectId:id,targetId:'english:81',
  audit,decision,sourceSrt:'25\n00:01:00,000 --> 00:01:04,000\nThe dragon flies over village.\n',enabled:true});
 assert.equal(result.reason,'recovery_evidence_differs_from_muse');
 assert.equal(calls,0);
});

test('CAR consumption readiness rejects stale and accepted targets',()=>{
 const audit={source:'d1_read_only',evidenceStatus:'verified',
  inventory:{snapshotVersion:8,acceptedSegmentIds:['english:80'],unknownSegmentIds:['english:81']},
  verifiedSegmentIds:['english:81'],verifiedProvenance:[{targetId:'english:81',
   sourceJobId:'job-1',sourceCueIds:[25],sourceCueQuote:'dragon flies over village',
   museRequestId:'muse-123'}]};
 const decision={anchorMethod:'context',visualVerified:false,sourceCueIds:[25],
  evidenceQuote:'dragon flies over village',museRequestId:'muse-123'};
 const sourceSrt='25\n00:01:00,000 --> 00:01:04,000\nThe dragon flies over village.\n';
 const good=inspectScopedCarRecoveryReadiness({audit,sourceSrt,
  checkpoints:[{targetId:'english:81',snapshotVersion:8,decision}]});
 assert.equal(good.ready,true);assert.equal(good.resumeTriggered,false);
 assert.equal(good.eligible[0].sourceJobId,'job-1');
 const stale=inspectScopedCarRecoveryReadiness({audit,sourceSrt,
  checkpoints:[{targetId:'english:81',snapshotVersion:7,decision}]});
 assert.equal(stale.reason,'stale_or_colliding_checkpoint');
 const accepted=inspectScopedCarRecoveryReadiness({audit,sourceSrt,
  checkpoints:[{targetId:'english:80',snapshotVersion:8,decision}]});
 assert.equal(accepted.ready,false);
 const forged=inspectScopedCarRecoveryReadiness({audit,sourceSrt,
  checkpoints:[{targetId:'english:81',snapshotVersion:8,
   decision:{...decision,museRequestId:'different'}}]});
 assert.equal(forged.reason,'source_provenance_mismatch');
});

test('CAR handoff is project scoped, immutable and cannot enqueue jobs',()=>{
 const checkpoints=[{targetId:'english:81',snapshotVersion:12,
  decision:{visualVerified:false,anchorMethod:'context'}}];
 const readiness={ready:true,eligible:[{targetId:'english:81',
  snapshotVersion:12,sourceJobId:'muse-job-1'}]};
 const result=buildScopedCarRecoveryHandoff({projectId:id,readiness,checkpoints});
 assert.equal(result.authorized,true);
 assert.equal(result.projectId,id);
 assert.equal(result.targets.length,1);
 assert.equal(result.enqueueAllowed,false);
 assert.equal(result.acceptedJobsMutable,false);
 assert.equal(result.resumeTriggered,false);
 const stale=buildScopedCarRecoveryHandoff({projectId:id,readiness:{
  ready:true,eligible:[{...readiness.eligible[0],snapshotVersion:13}]},checkpoints});
 assert.equal(stale.authorized,false);
 assert.equal(stale.reason,'handoff_checkpoint_mismatch');
});

test('CAR handoff rejects partial checkpoint coverage rather than silently dropping a target',()=>{
 const checkpoints=[
  {targetId:'english:81',snapshotVersion:12,decision:{visualVerified:false}},
  {targetId:'urdu:41',snapshotVersion:12,decision:{visualVerified:false}}
 ];
 const readiness={ready:true,eligible:[{targetId:'english:81',
  snapshotVersion:12,sourceJobId:'job-1'}]};
 const result=buildScopedCarRecoveryHandoff({projectId:id,readiness,checkpoints});
 assert.equal(result.authorized,false);
 assert.equal(result.reason,'incomplete_handoff_coverage');
 assert.deepEqual(result.targets,[]);
});

test('CAR handoff rejects mixed D1 snapshots even when each checkpoint matches its target',()=>{
 const checkpoints=[
  {targetId:'english:81',snapshotVersion:12,decision:{visualVerified:false}},
  {targetId:'urdu:41',snapshotVersion:13,decision:{visualVerified:false}}
 ];
 const readiness={ready:true,eligible:[
  {targetId:'english:81',snapshotVersion:12,sourceJobId:'job-1'},
  {targetId:'urdu:41',snapshotVersion:13,sourceJobId:'job-2'}
 ]};
 const result=buildScopedCarRecoveryHandoff({projectId:id,readiness,checkpoints});
 assert.equal(result.authorized,false);
 assert.equal(result.reason,'mixed_snapshot_versions');
 assert.deepEqual(result.targets,[]);
});

test('CAR handoff refuses multiple targets tied to the same source job',()=>{
 const checkpoints=[
  {targetId:'english:81',snapshotVersion:12,decision:{visualVerified:false}},
  {targetId:'urdu:41',snapshotVersion:12,decision:{visualVerified:false}}
 ];
 const readiness={ready:true,eligible:[
  {targetId:'english:81',snapshotVersion:12,sourceJobId:'same-job'},
  {targetId:'urdu:41',snapshotVersion:12,sourceJobId:'same-job'}
 ]};
 const result=buildScopedCarRecoveryHandoff({projectId:id,readiness,checkpoints});
 assert.equal(result.authorized,false);
 assert.equal(result.reason,'duplicate_source_jobs');
 assert.deepEqual(result.targets,[]);
});

test('CAR handoff refuses blank source job identity',()=>{
 const checkpoints=[{targetId:'english:81',snapshotVersion:12,decision:{visualVerified:false}}];
 const readiness={ready:true,eligible:[{targetId:'english:81',
  snapshotVersion:12,sourceJobId:'   '}]};
 const result=buildScopedCarRecoveryHandoff({projectId:id,readiness,checkpoints});
 assert.equal(result.authorized,false);
 assert.equal(result.reason,'invalid_source_job_id');
 assert.deepEqual(result.targets,[]);
});

test('CAR handoff rejects missing and non-integer D1 snapshot versions',()=>{
 for(const snapshotVersion of [undefined,0,-1,1.5,'12']){
  const checkpoints=[{targetId:'english:81',snapshotVersion,decision:{visualVerified:false}}];
  const readiness={ready:true,eligible:[{targetId:'english:81',
   snapshotVersion,sourceJobId:'job-1'}]};
  const result=buildScopedCarRecoveryHandoff({projectId:id,readiness,checkpoints});
  assert.equal(result.authorized,false);
  assert.equal(result.reason,'invalid_snapshot_version');
  assert.deepEqual(result.targets,[]);
 }
});
