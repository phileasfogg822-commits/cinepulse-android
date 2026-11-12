import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCarReservationManifest,stageCarRecoveryReservations,stageCarExecutionIntents}
 from '../src/car-atomic-reservations.mjs';

const projectId='fed941ad-ff7f-4b0f-8439-25cfda24d187';
const hash='a'.repeat(64);
const operations=[
 {targetId:'english:81',sourceJobId:'job-1',snapshotVersion:12},
 {targetId:'urdu:41',sourceJobId:'job-2',snapshotVersion:12}
];
const manifest={prepared:true,enqueueAllowed:false,projectId,operations};
const validProof=async()=>({valid:true,productionValidated:true,
 projectId,fingerprint:hash,
 targets:operations.map(op=>({...op,valid:true,productionValidated:true}))});
function fakeD1(){
 const rows=[],statements=[];
 return {rows,statements,DB:{prepare(sql){
  statements.push(sql);
  return {async run(){return {meta:{changes:0}};},bind(...args){
   return {
    async all(){
     assert.match(sql,/SELECT target_id,source_job_id/);
     return {results:rows.map(r=>({...r}))};
    },
    async run(){
     assert.match(sql,/INSERT INTO car_recovery_reservations/);
     assert.match(sql,/FROM json_each\(\?\)/);
     assert.match(sql,/NOT EXISTS \(SELECT 1 FROM car_recovery_reservations/);
     assert.match(sql,/car_recovery_checkpoints/);
     assert.match(sql,/snapshot_version<>\?/);
     assert.match(sql,/target_id NOT IN/);
     assert.match(sql,/json_type\(decision_json,'\$\.museRequestId'\)/);
     assert.match(sql,/json_array_length\(decision_json,'\$\.sourceCueIds'\)/);
     assert.match(sql,/json_extract\(decision_json,'\$\.anchorMethod'\)/);
     assert.match(sql,/json_extract\(decision_json,'\$\.visualVerified'\)/);
     assert.equal(args[10],projectId);
     assert.equal(args[8],12);
     assert.equal(args[9],JSON.stringify(operations));
     assert.match(sql,/deep_match_english/);
     const ops=JSON.parse(args[3]);
     if(rows.length)return {meta:{changes:0}};
     for(const op of ops)rows.push({target_id:op.targetId,
      source_job_id:op.sourceJobId,snapshot_version:op.snapshotVersion,
      state_fingerprint:args[1]});
     return {meta:{changes:ops.length}};
    }
   };
  }};
 }}};
}

test('reservation manifest rejects partial, duplicate and mixed-snapshot targets',()=>{
 assert.equal(inspectCarReservationManifest({manifest:{...manifest,operations:[]},
  stateFingerprint:hash}).reason,'invalid_reservation_manifest');
 assert.equal(inspectCarReservationManifest({manifest:{...manifest,
  operations:[operations[0],operations[0]]},stateFingerprint:hash}).reason,'duplicate_or_invalid_reservation_target');
 assert.equal(inspectCarReservationManifest({manifest:{...manifest,
  operations:[operations[0],{...operations[1],snapshotVersion:13}]},
  stateFingerprint:hash}).reason,'mixed_reservation_snapshot');
 assert.equal(inspectCarReservationManifest({manifest,stateFingerprint:hash}).valid,true);
});
test('CAR reservation stage requires feature flag and independent validation',async()=>{
 const env=fakeD1();
 assert.equal((await stageCarRecoveryReservations(env,{manifest,
  stateFingerprint:hash,validateFreshProduction:validProof})).reason,'feature_disabled');
 assert.equal((await stageCarRecoveryReservations(env,{manifest,
  stateFingerprint:hash,enabled:true})).reason,'production_validator_missing');
 assert.equal(env.statements.length,0);
});
test('CAR reservation stage atomically stages full set and exact retry is idempotent',async()=>{
 const env=fakeD1();
 const args={manifest,stateFingerprint:hash,enabled:true,
  validateFreshProduction:validProof};
 const first=await stageCarRecoveryReservations(env,args);
 assert.equal(first.reserved,true);
 assert.equal(first.count,2);
 assert.equal(first.enqueueAllowed,false);
 assert.equal(env.rows.length,2);
 const second=await stageCarRecoveryReservations(env,args);
 assert.equal(second.reserved,true);
 assert.equal(second.idempotent,true);
 assert.equal(env.rows.length,2);
});
test('CAR reservation stage refuses partial preexisting rows without mutation',async()=>{
 const env=fakeD1();
 env.rows.push({target_id:'english:81',source_job_id:'job-1',
  snapshot_version:12,state_fingerprint:hash});
 const result=await stageCarRecoveryReservations(env,{manifest,
  stateFingerprint:hash,enabled:true,validateFreshProduction:validProof});
 assert.equal(result.reserved,false);
 assert.equal(result.reason,'conflicting_reservations');
 assert.equal(env.rows.length,1);
});
test('CAR reservation stage refuses stale production attestation without D1 access',async()=>{
 const env=fakeD1();
 const result=await stageCarRecoveryReservations(env,{manifest,
  stateFingerprint:hash,enabled:true,
  validateFreshProduction:async()=>({valid:true,productionValidated:true,
   projectId,fingerprint:'b'.repeat(64)})});
 assert.equal(result.reserved,false);
 assert.equal(result.reason,'production_validation_failed');
 assert.equal(env.statements.length,0);
});

test('CAR reservation refuses partial per-target production attestation',async()=>{
 const env=fakeD1();
 const result=await stageCarRecoveryReservations(env,{manifest,
  stateFingerprint:hash,enabled:true,
  validateFreshProduction:async()=>({valid:true,productionValidated:true,
   projectId,fingerprint:hash,targets:[{...operations[0],
    valid:true,productionValidated:true}]})});
 assert.equal(result.reserved,false);
 assert.equal(result.reason,'production_validation_failed');
 assert.equal(env.statements.length,0);
});

test('CAR execution intents remain disabled and reject duplicate target identities',async()=>{
 const env=fakeD1();
 const disabled=await stageCarExecutionIntents(env,{projectId,operations});
 assert.equal(disabled.staged,false);
 assert.equal(disabled.reason,'feature_disabled');
 const duplicate=await stageCarExecutionIntents(env,{projectId,enabled:true,
  operations:[operations[0],operations[0]]});
 assert.equal(duplicate.staged,false);
 assert.equal(duplicate.reason,'invalid_or_duplicate_intent');
 assert.equal(env.statements.length,0);
});

test('CAR execution intent exact retry is idempotent and conflict fails closed',async()=>{
 const rows=[],statements=[];
 const env={DB:{prepare(sql){
  statements.push(sql);
  return {async run(){return {meta:{changes:0}};},bind(...args){
   return {async all(){return {results:rows.map(r=>({...r}))};},
    async run(){
     if(!sql.includes('INSERT INTO car_recovery_execution_intents'))throw Error('unexpected write');
     assert.match(sql,/car_recovery_checkpoints c/);
     assert.match(sql,/c\.snapshot_version=r\.snapshot_version/);
     assert.equal(args[8],projectId);
     if(rows.length)return {meta:{changes:0}};
     for(const op of JSON.parse(args[2]))rows.push({
      target_id:op.targetId,source_job_id:op.sourceJobId,
      snapshot_version:op.snapshotVersion});
     return {meta:{changes:rows.length}};
    }};
  }};
 }}};
 const input={projectId,operations,enabled:true};
 const first=await stageCarExecutionIntents(env,input);
 assert.equal(first.staged,true);
 assert.equal(first.count,2);
 assert.equal(first.enqueueAllowed,false);
 const retry=await stageCarExecutionIntents(env,input);
 assert.equal(retry.staged,true);
 assert.equal(retry.idempotent,true);
 assert.equal(rows.length,2);
 const conflict=await stageCarExecutionIntents(env,{...input,operations:[
  {...operations[0],sourceJobId:'changed-job'},operations[1]]});
 assert.equal(conflict.staged,false);
 assert.equal(conflict.reason,'conflicting_execution_intents');
 assert.equal(rows.length,2);
 assert.equal(statements.filter(q=>q.includes('INSERT INTO car_recovery_execution_intents')).length,1);
});
