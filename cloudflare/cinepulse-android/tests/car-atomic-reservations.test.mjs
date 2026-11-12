import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCarReservationManifest,stageCarRecoveryReservations,stageCarExecutionIntents,inspectCarDispatchHandoff,stageCarDispatchClaims,planCarRecoveryJobs,stageCarRecoveryOutbox,enqueueCarRecoveryOutboxJob,inspectCarMovieDispatchControls}
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
     assert.match(sql,/j\.created_at>/);
     assert.match(sql,/MAX\(created_at\)/);
     assert.equal(args[9],projectId);
     assert.equal(args[10],projectId);
     assert.equal(args[11],projectId);
     assert.match(sql,/length\(r\.state_fingerprint\)<>64/);
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

/**
 * Integration checks against real SQLite rather than a mocked D1 statement.
 * The CAR tables are isolated; accepted V5 jobs must never be mutated.
 */
test('real SQLite stages both reservations and intents, retries without duplicate rows',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE jobs (
   id TEXT PRIMARY KEY,project_id TEXT NOT NULL,step_id TEXT NOT NULL,
   status TEXT NOT NULL,created_at INTEGER NOT NULL,output TEXT
  );
  CREATE TABLE car_recovery_checkpoints (
   project_id TEXT NOT NULL,target_id TEXT NOT NULL,snapshot_version INTEGER NOT NULL,
   decision_json TEXT NOT NULL,created_at INTEGER NOT NULL,
   PRIMARY KEY(project_id,target_id)
  );`);
  const decision=JSON.stringify({museRequestId:'muse-request-123',
   sourceCueIds:[1],anchorMethod:'context',visualVerified:false});
  for(const op of operations){
   db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?)').run(
    op.sourceJobId,projectId,op.targetId.startsWith('english:')?
     'deep_match_english':'deep_match_urdu','done',12,'accepted-original');
   db.prepare('INSERT INTO car_recovery_checkpoints VALUES(?,?,?,?,?)').run(
    projectId,op.targetId,12,decision,12);
  }
  const env={DB:{prepare(sql){
   const stmt=db.prepare(sql);
   const run=(args)=>async()=>({meta:{changes:Number(stmt.run(...args).changes)}});
   return {run:run([]),bind(...args){return {
    run:run(args),all:async()=>({results:stmt.all(...args)})
   };}};
  }}};
  const reserve=()=>stageCarRecoveryReservations(env,{manifest,
   stateFingerprint:hash,enabled:true,validateFreshProduction:validProof});
  const intent=()=>stageCarExecutionIntents(env,{projectId,operations,enabled:true});
  assert.equal((await reserve()).reserved,true);
  assert.equal((await reserve()).idempotent,true);
  assert.equal((await intent()).staged,true);
  assert.equal((await intent()).idempotent,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM car_recovery_reservations').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM car_recovery_execution_intents').get().n,2);
  assert.deepEqual(db.prepare('SELECT output FROM jobs ORDER BY id').all().map(row=>row.output),
   ['accepted-original','accepted-original']);
 }finally{db.close();}
});

test('real SQLite refuses stale deep-match jobs before any CAR write',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE jobs (
   id TEXT PRIMARY KEY,project_id TEXT,step_id TEXT,created_at INTEGER
  );
  CREATE TABLE car_recovery_checkpoints (
   project_id TEXT,target_id TEXT,snapshot_version INTEGER,
   decision_json TEXT,created_at INTEGER,PRIMARY KEY(project_id,target_id)
  );`);
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?)').run(
   'newer-job',projectId,'deep_match_english',13);
  const decision=JSON.stringify({museRequestId:'muse-request-123',
   sourceCueIds:[1],anchorMethod:'context',visualVerified:false});
  for(const op of operations)db.prepare(
   'INSERT INTO car_recovery_checkpoints VALUES(?,?,?,?,?)').run(
    projectId,op.targetId,12,decision,12);
  const env={DB:{prepare(sql){
   const stmt=db.prepare(sql);
   return {run:async()=>({meta:{changes:Number(stmt.run().changes)}}),
    bind(...args){return {
     run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}}),
     all:async()=>({results:stmt.all(...args)})
    };}};
  }}};
  const result=await stageCarRecoveryReservations(env,{manifest,
   stateFingerprint:hash,enabled:true,validateFreshProduction:validProof});
  assert.equal(result.reserved,false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM car_recovery_reservations').get().n,0);
 }finally{db.close();}
});

test('real SQLite rejects conflicting intent after reservations without touching accepted jobs',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,step_id TEXT,created_at INTEGER,output TEXT);
   CREATE TABLE car_recovery_checkpoints(project_id TEXT,target_id TEXT,snapshot_version INTEGER,
    decision_json TEXT,created_at INTEGER,PRIMARY KEY(project_id,target_id));`);
  const decision=JSON.stringify({museRequestId:'muse-request-123',
   sourceCueIds:[1],anchorMethod:'context',visualVerified:false});
  for(const op of operations){
   db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(op.sourceJobId,projectId,
    op.targetId.startsWith('english:')?'deep_match_english':'deep_match_urdu',
    12,'accepted-original');
   db.prepare('INSERT INTO car_recovery_checkpoints VALUES(?,?,?,?,?)').run(
    projectId,op.targetId,12,decision,12);
  }
  const env={DB:{prepare(sql){
   const stmt=db.prepare(sql);
   return {run:async()=>({meta:{changes:Number(stmt.run().changes)}}),
    bind(...args){return {
     run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}}),
     all:async()=>({results:stmt.all(...args)})
    };}};
  }}};
  const reservation=await stageCarRecoveryReservations(env,{manifest,
   stateFingerprint:hash,enabled:true,validateFreshProduction:validProof});
  assert.equal(reservation.reserved,true);
  const first=await stageCarExecutionIntents(env,{projectId,operations,enabled:true});
  assert.equal(first.staged,true);
  const conflict=await stageCarExecutionIntents(env,{projectId,enabled:true,
   operations:[{...operations[0],sourceJobId:'another-job'},operations[1]]});
  assert.equal(conflict.staged,false);
  assert.equal(conflict.reason,'conflicting_execution_intents');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM car_recovery_execution_intents').get().n,2);
  assert.deepEqual(db.prepare('SELECT output FROM jobs ORDER BY id').all().map(r=>r.output),
   ['accepted-original','accepted-original']);
 }finally{db.close();}
});

test('dispatcher handoff requires exact reservation and intent sets without writing jobs',async()=>{
 const calls=[];
 const env={DB:{prepare(sql){
  calls.push(sql);
  return {bind(project){
   assert.equal(project,projectId);
   return {all:async()=>({results:operations.map(op=>({
    target_id:op.targetId,source_job_id:op.sourceJobId,
    snapshot_version:op.snapshotVersion
   }))})};
  }};
 }}};
 const result=await inspectCarDispatchHandoff(env,{projectId,operations});
 assert.equal(result.ready,true);
 assert.equal(result.enqueueAllowed,false);
 assert.equal(result.resumeTriggered,false);
 assert.equal(result.operations.length,2);
 assert.equal(calls.length,2);
 assert.ok(calls.every(sql=>sql.startsWith('SELECT ')));
 const mismatch=await inspectCarDispatchHandoff(env,{projectId,
  operations:[{...operations[0],sourceJobId:'changed'},operations[1]]});
 assert.equal(mismatch.ready,false);
 assert.equal(mismatch.reason,'dispatch_handoff_mismatch');
 const invalid=await inspectCarDispatchHandoff(env,{projectId,
  operations:[operations[0],operations[0]]});
 assert.equal(invalid.reason,'invalid_dispatch_identity');
});

test('dispatch claims are disabled without a verified handoff and never authorize enqueue',async()=>{
 const env={DB:{prepare(){throw Error('must not access DB');}}};
 const handoff={ready:true,enqueueAllowed:false,resumeTriggered:false,projectId,operations};
 assert.equal((await stageCarDispatchClaims(env,{handoff})).reason,'feature_disabled');
 assert.equal((await stageCarDispatchClaims(env,{enabled:true,
  handoff:{...handoff,enqueueAllowed:true}})).reason,'unverified_dispatch_handoff');
});

test('real SQLite stages dispatch claims exactly once after reservations and intents',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,step_id TEXT,created_at INTEGER,output TEXT);
   CREATE TABLE car_recovery_checkpoints(project_id TEXT,target_id TEXT,snapshot_version INTEGER,
    decision_json TEXT,created_at INTEGER,PRIMARY KEY(project_id,target_id));`);
  const decision=JSON.stringify({museRequestId:'muse-request-123',
   sourceCueIds:[1],anchorMethod:'context',visualVerified:false});
  for(const op of operations){
   db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(op.sourceJobId,projectId,
    op.targetId.startsWith('english:')?'deep_match_english':'deep_match_urdu',
    12,'accepted-original');
   db.prepare('INSERT INTO car_recovery_checkpoints VALUES(?,?,?,?,?)').run(
    projectId,op.targetId,12,decision,12);
  }
  const env={DB:{prepare(sql){
   const stmt=db.prepare(sql);
   return {run:async()=>({meta:{changes:Number(stmt.run().changes)}}),
    bind(...args){return {
     run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}}),
     all:async()=>({results:stmt.all(...args)})
    };}};
  }}};
  assert.equal((await stageCarRecoveryReservations(env,{manifest,stateFingerprint:hash,
   enabled:true,validateFreshProduction:validProof})).reserved,true);
  assert.equal((await stageCarExecutionIntents(env,{projectId,operations,enabled:true})).staged,true);
  const handoff=await inspectCarDispatchHandoff(env,{projectId,operations});
  assert.equal(handoff.ready,true);
  // A reservation can change after the read-only handoff. The INSERT itself
  // must reject that stale state without writing a partial claim set.
  db.prepare('UPDATE car_recovery_reservations SET source_job_id=? WHERE project_id=? AND target_id=?')
   .run('tampered-source',projectId,operations[0].targetId);
  const stale=await stageCarDispatchClaims(env,{handoff,enabled:true});
  assert.equal(stale.claimed,false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='car_recovery_dispatch_claims'").get().n,0);
  db.prepare('UPDATE car_recovery_reservations SET source_job_id=? WHERE project_id=? AND target_id=?')
   .run(operations[0].sourceJobId,projectId,operations[0].targetId);
  const first=await stageCarDispatchClaims(env,{handoff,enabled:true});
  assert.equal(first.claimed,true);
  assert.equal(first.count,2);
  assert.equal(first.enqueueAllowed,false);
  const retry=await stageCarDispatchClaims(env,{handoff,enabled:true});
  assert.equal(retry.claimed,true);
  assert.equal(retry.idempotent,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM car_recovery_dispatch_claims').get().n,2);
  assert.deepEqual(db.prepare('SELECT output FROM jobs ORDER BY id').all().map(r=>r.output),
   ['accepted-original','accepted-original']);
 }finally{db.close();}
});

test('job specifications are deterministic and require complete matching dispatch claims',async()=>{
 const handoff={ready:true,enqueueAllowed:false,resumeTriggered:false,projectId,operations};
 const env={DB:{prepare(sql){
  return {bind(id){
   assert.equal(id,projectId);
   return {all:async()=>({results:operations.map(op=>({
    target_id:op.targetId,source_job_id:op.sourceJobId,
    snapshot_version:op.snapshotVersion
   }))})};
  }};
 }}};
 assert.equal((await planCarRecoveryJobs(env,{handoff})).reason,'feature_disabled');
 const first=await planCarRecoveryJobs(env,{handoff,enabled:true});
 assert.equal(first.planned,true);
 assert.equal(first.jobs.length,2);
 assert.deepEqual(first.jobs.map(j=>j.stepId),['deep_match_english','deep_match_urdu']);
 assert.equal(first.enqueueAllowed,false);
 const second=await planCarRecoveryJobs(env,{handoff,enabled:true});
 assert.deepEqual(first.jobs,second.jobs);
 const invalid=await planCarRecoveryJobs(env,{handoff:{...handoff,ready:false},enabled:true});
 assert.equal(invalid.reason,'unverified_dispatch_handoff');
});

test('CAR recovery outbox remains disabled and rejects forged job plans before D1 writes',async()=>{
 const env={DB:{prepare(){throw Error('unexpected D1 access');}}};
 const job={projectId,targetId:operations[0].targetId,
  sourceJobId:operations[0].sourceJobId,snapshotVersion:operations[0].snapshotVersion,
  stepId:'deep_match_english',
  idempotencyKey:'car-v1.1:'+projectId+':'+operations[0].targetId+':'+operations[0].snapshotVersion};
 const plan={planned:true,enqueueAllowed:false,resumeTriggered:false,jobs:[job]};
 assert.equal((await stageCarRecoveryOutbox(env,{plan})).reason,'feature_disabled');
 assert.equal((await stageCarRecoveryOutbox(env,{plan:{...plan,enqueueAllowed:true},
  enabled:true})).reason,'unverified_job_plan');
 assert.equal((await stageCarRecoveryOutbox(env,{plan:{...plan,
  jobs:[{...job,idempotencyKey:'forged'}]},enabled:true})).reason,'invalid_outbox_job');
});

test('CAR production enqueue is disabled by default and rejects unsafe requests',async()=>{
 const env={DB:{prepare(){throw Error('must not touch production jobs');}}};
 const args={projectId,targetId:operations[0].targetId,
  jobId:'recovery-job-1',workerId:'worker-1',
  prompt:'[CAR-V1.1-RECOVERY] Review only the missing target'};
 assert.equal((await enqueueCarRecoveryOutboxJob(env,args)).reason,'feature_disabled');
 assert.equal((await enqueueCarRecoveryOutboxJob(env,{...args,enabled:true,
  prompt:'unverified prompt'})).reason,'invalid_enqueue_request');
 assert.equal((await enqueueCarRecoveryOutboxJob(env,{...args,enabled:true,
  targetId:'not-a-target'})).reason,'invalid_enqueue_request');
});

test('real SQLite CAR production enqueue creates one job and blocks concurrent duplicates',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,worker_id TEXT);
   CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,worker_id TEXT,
    step_id TEXT,status TEXT,prompt TEXT,created_at INTEGER,output TEXT);
   CREATE TABLE car_recovery_dispatch_claims(project_id TEXT,target_id TEXT,
    source_job_id TEXT,snapshot_version INTEGER,PRIMARY KEY(project_id,target_id));
   CREATE TABLE car_recovery_job_outbox(project_id TEXT,target_id TEXT,
    source_job_id TEXT,snapshot_version INTEGER,step_id TEXT,
    idempotency_key TEXT,created_at INTEGER,PRIMARY KEY(project_id,target_id));`);
  db.prepare('INSERT INTO projects VALUES(?,?)').run(projectId,'worker-1');
  const op=operations[0];
  db.prepare('INSERT INTO car_recovery_dispatch_claims VALUES(?,?,?,?)').run(
   projectId,op.targetId,op.sourceJobId,op.snapshotVersion);
  db.prepare('INSERT INTO car_recovery_job_outbox VALUES(?,?,?,?,?,?,?)').run(
   projectId,op.targetId,op.sourceJobId,op.snapshotVersion,'deep_match_english',
   'car-v1.1:'+projectId+':'+op.targetId+':'+op.snapshotVersion,12);
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)').run(
   op.sourceJobId,projectId,'worker-1','deep_match_english','done',
   'original accepted',11,'accepted-original');
  const env={DB:{prepare(sql){
   const stmt=db.prepare(sql);
   return {bind(...args){return {run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}})};}};
  }}};
  const args={projectId,targetId:op.targetId,jobId:'car-new-job-1',
   workerId:'worker-1',prompt:'[CAR-V1.1-RECOVERY] Only recover missing segment',enabled:true};
  const first=await enqueueCarRecoveryOutboxJob(env,args);
  assert.equal(first.enqueued,true);
  const queued=db.prepare('SELECT * FROM jobs WHERE id=?').get(args.jobId);
  assert.equal(queued.worker_id,'worker-1');
  assert.equal(queued.status,'queued');
  assert.equal(queued.step_id,'deep_match_english');
  assert.equal((await enqueueCarRecoveryOutboxJob(env,{...args,
   jobId:'car-new-job-2'})).reason,'queue_guard_rejected');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n,2);
  assert.equal(db.prepare('SELECT output FROM jobs WHERE id=?').get(op.sourceJobId).output,
   'accepted-original');
 }finally{db.close();}
});

test('real SQLite CAR enqueue refuses wrong worker and existing active movie jobs',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,worker_id TEXT);
   CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,worker_id TEXT,
    step_id TEXT,status TEXT,prompt TEXT,created_at INTEGER);
   CREATE TABLE car_recovery_dispatch_claims(project_id TEXT,target_id TEXT,
    source_job_id TEXT,snapshot_version INTEGER);
   CREATE TABLE car_recovery_job_outbox(project_id TEXT,target_id TEXT,
    source_job_id TEXT,snapshot_version INTEGER,step_id TEXT,
    idempotency_key TEXT,created_at INTEGER);`);
  const op=operations[0];
  db.prepare('INSERT INTO projects VALUES(?,?)').run(projectId,'worker-1');
  db.prepare('INSERT INTO car_recovery_dispatch_claims VALUES(?,?,?,?)').run(
   projectId,op.targetId,op.sourceJobId,op.snapshotVersion);
  db.prepare('INSERT INTO car_recovery_job_outbox VALUES(?,?,?,?,?,?,?)').run(
   projectId,op.targetId,op.sourceJobId,op.snapshotVersion,'deep_match_english','key',12);
  const env={DB:{prepare(sql){const stmt=db.prepare(sql);return {
   bind(...args){return {run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}})};}
  };}}};
  const args={projectId,targetId:op.targetId,jobId:'car-new-job-1',
   workerId:'wrong-worker',prompt:'[CAR-V1.1-RECOVERY] Target only',enabled:true};
  assert.equal((await enqueueCarRecoveryOutboxJob(env,args)).reason,'queue_guard_rejected');
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?)').run('active',projectId,
   'worker-1','deep_match_urdu','working','active job',11);
  assert.equal((await enqueueCarRecoveryOutboxJob(env,{...args,workerId:'worker-1'}))
   .reason,'queue_guard_rejected');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);
 }finally{db.close();}
});

test('real SQLite CAR outbox stages exact claims atomically and retries without duplicate rows',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE car_recovery_dispatch_claims(project_id TEXT,target_id TEXT,
   source_job_id TEXT,snapshot_version INTEGER,PRIMARY KEY(project_id,target_id));`);
  for(const op of operations)db.prepare(
   'INSERT INTO car_recovery_dispatch_claims VALUES(?,?,?,?)'
  ).run(projectId,op.targetId,op.sourceJobId,op.snapshotVersion);
  const jobs=operations.map(op=>({projectId,targetId:op.targetId,
   sourceJobId:op.sourceJobId,snapshotVersion:op.snapshotVersion,
   stepId:op.targetId.startsWith('english:')?'deep_match_english':'deep_match_urdu',
   idempotencyKey:'car-v1.1:'+projectId+':'+op.targetId+':'+op.snapshotVersion}));
  const plan={planned:true,enqueueAllowed:false,resumeTriggered:false,jobs};
  const env={DB:{prepare(sql){const stmt=db.prepare(sql);return {
   run:async()=>({meta:{changes:Number(stmt.run().changes)}}),
   bind(...args){return {
    run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}}),
    all:async()=>({results:stmt.all(...args)})
   };}
  };}}};
  const first=await stageCarRecoveryOutbox(env,{plan,enabled:true});
  assert.equal(first.staged,true);
  assert.equal(first.count,2);
  const retry=await stageCarRecoveryOutbox(env,{plan,enabled:true});
  assert.equal(retry.staged,true);
  assert.equal(retry.idempotent,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM car_recovery_job_outbox').get().n,2);
  const conflict=await stageCarRecoveryOutbox(env,{plan:{...plan,
   jobs:[{...jobs[0],sourceJobId:'changed'},jobs[1]]},enabled:true});
  assert.equal(conflict.staged,false);
  assert.equal(conflict.reason,'conflicting_outbox');
 }finally{db.close();}
});

test('real SQLite CAR outbox refuses changed claims before writing rows',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE car_recovery_dispatch_claims(project_id TEXT,target_id TEXT,
   source_job_id TEXT,snapshot_version INTEGER,PRIMARY KEY(project_id,target_id));`);
  const jobs=operations.map(op=>({projectId,targetId:op.targetId,
   sourceJobId:op.sourceJobId,snapshotVersion:op.snapshotVersion,
   stepId:op.targetId.startsWith('english:')?'deep_match_english':'deep_match_urdu',
   idempotencyKey:'car-v1.1:'+projectId+':'+op.targetId+':'+op.snapshotVersion}));
  for(const op of operations)db.prepare(
   'INSERT INTO car_recovery_dispatch_claims VALUES(?,?,?,?)'
  ).run(projectId,op.targetId,op.sourceJobId,op.snapshotVersion);
  db.prepare('UPDATE car_recovery_dispatch_claims SET source_job_id=? WHERE project_id=? AND target_id=?')
   .run('tampered',projectId,operations[0].targetId);
  const env={DB:{prepare(sql){const stmt=db.prepare(sql);return {
   run:async()=>({meta:{changes:Number(stmt.run().changes)}}),
   bind(...args){return {
    run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}}),
    all:async()=>({results:stmt.all(...args)})
   };}
  };}}};
  const result=await stageCarRecoveryOutbox(env,{plan:{
   planned:true,enqueueAllowed:false,resumeTriggered:false,jobs},enabled:true});
  assert.equal(result.staged,false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM car_recovery_job_outbox').get().n,0);
 }finally{db.close();}
});

test('CAR dispatch control inspection blocks stopped movies, busy movies and paused workers',async()=>{
 const inspect=async({status='ready',active=0,enabled=1,paused=0}={})=>{
  const env={DB:{prepare(sql){return {bind(){return {first:async()=>{
   if(sql.includes('FROM projects'))return {id:projectId,worker_id:'worker-1',status};
   if(sql.includes('FROM jobs'))return {n:active};
   if(sql.includes('FROM workers'))return {enabled,paused};
   throw Error('unexpected query');
  }};}};}};
  return inspectCarMovieDispatchControls(env,{projectId});
 };
 assert.equal((await inspect()).ready,true);
 assert.equal((await inspect({status:'stopped'})).reason,'movie_control_blocks_recovery');
 assert.equal((await inspect({status:'paused'})).reason,'movie_control_blocks_recovery');
 assert.equal((await inspect({active:1})).reason,'movie_has_active_jobs');
 assert.equal((await inspect({paused:1})).reason,'worker_unavailable_or_paused');
 assert.equal((await inspect({enabled:0})).reason,'worker_unavailable_or_paused');
});
