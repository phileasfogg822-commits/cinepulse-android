/**
 * CAR v1.1 isolated D1 reservation stage. NOT a production queue executor.
 * A single INSERT ... SELECT reserves the complete 1-3 target set or none.
 * No existing jobs, accepted Muse decisions or project state are modified.
 * This module is intentionally NOT wired to an HTTP route.
 */
const validProject=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);
const validTarget=x=>typeof x==='string'&&/^(english|urdu):[1-9][0-9]*$/.test(x);
const fingerprint=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const deny=reason=>({reserved:false,reason,enqueueAllowed:false,resumeTriggered:false});

export function inspectCarReservationManifest({manifest,stateFingerprint}={}){
 if(manifest?.prepared!==true||manifest.enqueueAllowed!==false||
    !validProject(manifest.projectId)||!fingerprint(stateFingerprint)||
    !Array.isArray(manifest.operations)||manifest.operations.length<1||
    manifest.operations.length>3)return deny('invalid_reservation_manifest');
 const targets=new Set(),jobs=new Set(),versions=new Set();
 for(const op of manifest.operations){
  if(!validTarget(op?.targetId)||typeof op.sourceJobId!=='string'||
     !op.sourceJobId.trim()||!Number.isSafeInteger(op.snapshotVersion)||
     op.snapshotVersion<=0||targets.has(op.targetId)||jobs.has(op.sourceJobId))
   return deny('duplicate_or_invalid_reservation_target');
  targets.add(op.targetId);jobs.add(op.sourceJobId);versions.add(op.snapshotVersion);
 }
 if(versions.size!==1)return deny('mixed_reservation_snapshot');
 return {valid:true,projectId:manifest.projectId,
  operations:manifest.operations.map(op=>({targetId:op.targetId,
   sourceJobId:op.sourceJobId,snapshotVersion:op.snapshotVersion})),
  snapshotVersion:manifest.operations[0].snapshotVersion,stateFingerprint};
}

export async function ensureCarReservationTable(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS car_recovery_reservations (
  project_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_job_id TEXT NOT NULL,
  snapshot_version INTEGER NOT NULL,
  state_fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(project_id,target_id),
  UNIQUE(project_id,source_job_id)
 )`).run();
}

const SELECT_RESERVATIONS=`SELECT target_id,source_job_id,snapshot_version,state_fingerprint
 FROM car_recovery_reservations WHERE project_id=? ORDER BY target_id`;

function matchesExisting(rows,plan){
 if(rows.length!==plan.operations.length)return false;
 const expected=new Map(plan.operations.map(op=>[op.targetId,op]));
 return rows.every(row=>{
  const op=expected.get(row.target_id);
  return !!op&&row.source_job_id===op.sourceJobId&&
   row.snapshot_version===op.snapshotVersion&&
   row.state_fingerprint===plan.stateFingerprint;
 });
}

/**
 * Stage only: requires an internal, independently verified validation callback.
 * The callback is not a substitute for an in-transaction accepted-output
 * comparison; therefore these reservations NEVER authorize enqueue/resume.
 * SQL statement atomicity prevents partial reservation on uniqueness failure.
 */
export async function stageCarRecoveryReservations(env,{
 manifest,stateFingerprint,enabled=false,validateFreshProduction
}={}){
 if(!enabled)return deny('feature_disabled');
 const plan=inspectCarReservationManifest({manifest,stateFingerprint});
 if(plan.valid!==true)return plan;
 if(typeof validateFreshProduction!=='function')return deny('production_validator_missing');
 let proof;
 try{proof=await validateFreshProduction({projectId:plan.projectId,
  operations:plan.operations.map(op=>Object.freeze({...op})),
  stateFingerprint:plan.stateFingerprint});}
 catch{return deny('production_validation_error');}
 if(proof?.valid!==true||proof.productionValidated!==true||
    proof.fingerprint!==plan.stateFingerprint||
    proof.projectId!==plan.projectId||
    !Array.isArray(proof.targets)||proof.targets.length!==plan.operations.length)
  return deny('production_validation_failed');
 const attestations=new Map();
 for(const target of proof.targets){
  if(typeof target?.targetId!=='string'||attestations.has(target.targetId))
   return deny('duplicate_production_attestation');
  attestations.set(target.targetId,target);
 }
 if(plan.operations.some(op=>{
  const attestation=attestations.get(op.targetId);
  return attestation?.valid!==true||attestation.productionValidated!==true||
   attestation.sourceJobId!==op.sourceJobId||
   attestation.snapshotVersion!==op.snapshotVersion;
 }))return deny('production_target_mismatch');
 try{
  await ensureCarReservationTable(env);
  const prior=await env.DB.prepare(SELECT_RESERVATIONS).bind(plan.projectId).all();
  const rows=prior.results||[];
  if(rows.length)return matchesExisting(rows,plan)?
   {reserved:true,idempotent:true,reason:'identical_reservations_exist',
    enqueueAllowed:false,resumeTriggered:false}:deny('conflicting_reservations');
  const payload=JSON.stringify(plan.operations);
  // The complete set is inserted by ONE SQLite statement. If any unique
  // constraint fails, SQLite aborts the entire statement, not just one row.
  const sql=`INSERT INTO car_recovery_reservations
   (project_id,target_id,source_job_id,snapshot_version,state_fingerprint,created_at)
   SELECT ?,json_extract(j.value,'$.targetId'),
     json_extract(j.value,'$.sourceJobId'),
     json_extract(j.value,'$.snapshotVersion'),?,?
   FROM json_each(?) AS j
   WHERE NOT EXISTS (SELECT 1 FROM car_recovery_reservations WHERE project_id=?)
     AND (SELECT COUNT(*) FROM car_recovery_checkpoints WHERE project_id=?)=?
     AND NOT EXISTS (SELECT 1 FROM car_recovery_checkpoints WHERE project_id=?
       AND (snapshot_version<>? OR target_id NOT IN
         (SELECT json_extract(value,'$.targetId') FROM json_each(?))))
     AND NOT EXISTS (SELECT 1 FROM car_recovery_checkpoints WHERE project_id=?
       AND (json_type(decision_json,'$.museRequestId')<>'text'
         OR length(trim(json_extract(decision_json,'$.museRequestId')))<6
         OR json_type(decision_json,'$.sourceCueIds')<>'array'
         OR json_array_length(decision_json,'$.sourceCueIds')<1
         OR json_extract(decision_json,'$.anchorMethod')<>'context'
         OR json_extract(decision_json,'$.visualVerified')<>0))
     AND (SELECT COALESCE(MAX(created_at),0) FROM jobs
          WHERE project_id=? AND step_id IN ('deep_match_english','deep_match_urdu'))<=?`;
  const result=await env.DB.prepare(sql).bind(
   plan.projectId,plan.stateFingerprint,Math.floor(Date.now()/1000),
   payload,plan.projectId,plan.projectId,plan.operations.length,
   plan.projectId,plan.snapshotVersion,payload,plan.projectId,plan.projectId,plan.snapshotVersion).run();
  if(result.meta?.changes!==plan.operations.length)
   return deny('reservation_insert_not_complete');
  const verified=await env.DB.prepare(SELECT_RESERVATIONS).bind(plan.projectId).all();
  if(!matchesExisting(verified.results||[],plan))return deny('reservation_readback_mismatch');
  return {reserved:true,idempotent:false,reason:'isolated_reservations_staged',
   count:plan.operations.length,enqueueAllowed:false,resumeTriggered:false};
 }catch{return deny('reservation_transaction_conflict');}
}

/**
 * Durable execution intent, isolated from the production jobs table.
 * A unique project/target reservation permits at most one intent per target.
 * This is NOT a dispatcher and never creates a Muse job.
 */
export async function stageCarExecutionIntents(env,{projectId,operations,enabled=false}={}){
 const fail=reason=>({staged:false,reason,enqueueAllowed:false,resumeTriggered:false});
 if(!enabled)return fail('feature_disabled');
 if(!validProject(projectId)||!Array.isArray(operations)||operations.length<1||
    operations.length>3)return fail('invalid_intent_batch');
 const targets=new Set(),jobs=new Set();
 for(const op of operations){
  if(!validTarget(op?.targetId)||typeof op.sourceJobId!=='string'||
     !op.sourceJobId.trim()||!Number.isSafeInteger(op.snapshotVersion)||
     op.snapshotVersion<=0||targets.has(op.targetId)||jobs.has(op.sourceJobId))
   return fail('invalid_or_duplicate_intent');
  targets.add(op.targetId);jobs.add(op.sourceJobId);
 }
 try{
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS car_recovery_execution_intents (
   project_id TEXT NOT NULL,target_id TEXT NOT NULL,
   source_job_id TEXT NOT NULL,snapshot_version INTEGER NOT NULL,
   created_at INTEGER NOT NULL,PRIMARY KEY(project_id,target_id),
   UNIQUE(project_id,source_job_id)
  )`).run();
  const payload=JSON.stringify(operations);
  const existing=await env.DB.prepare(
   'SELECT target_id,source_job_id,snapshot_version FROM car_recovery_execution_intents WHERE project_id=? ORDER BY target_id'
  ).bind(projectId).all();
  const prior=existing.results||[];
  const matches=rows=>rows.length===operations.length&&rows.every(row=>
   operations.some(op=>op.targetId===row.target_id&&
    op.sourceJobId===row.source_job_id&&op.snapshotVersion===row.snapshot_version));
  if(prior.length)return matches(prior)?
   {staged:true,idempotent:true,count:operations.length,
    reason:'identical_intents_exist',enqueueAllowed:false,resumeTriggered:false}:
   fail('conflicting_execution_intents');
  const sql=`INSERT INTO car_recovery_execution_intents
   (project_id,target_id,source_job_id,snapshot_version,created_at)
   SELECT ?,json_extract(value,'$.targetId'),json_extract(value,'$.sourceJobId'),
    json_extract(value,'$.snapshotVersion'),?
   FROM json_each(?)
   WHERE (SELECT COUNT(*) FROM car_recovery_reservations WHERE project_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM car_recovery_execution_intents WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM car_recovery_reservations WHERE project_id=?
     AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE
      json_extract(j.value,'$.targetId')=car_recovery_reservations.target_id
      AND json_extract(j.value,'$.sourceJobId')=car_recovery_reservations.source_job_id
      AND json_extract(j.value,'$.snapshotVersion')=car_recovery_reservations.snapshot_version))
    AND NOT EXISTS(SELECT 1 FROM car_recovery_reservations r WHERE r.project_id=?
      AND NOT EXISTS(SELECT 1 FROM car_recovery_checkpoints c
        WHERE c.project_id=r.project_id AND c.target_id=r.target_id
         AND c.snapshot_version=r.snapshot_version))
    AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=?
      AND j.step_id IN ('deep_match_english','deep_match_urdu')
      AND j.created_at>(SELECT MAX(created_at) FROM car_recovery_reservations WHERE project_id=?))
    AND NOT EXISTS(SELECT 1 FROM car_recovery_reservations r WHERE r.project_id=?
      AND (r.state_fingerprint IS NULL OR length(r.state_fingerprint)<>64))`;
  const result=await env.DB.prepare(sql).bind(projectId,Math.floor(Date.now()/1000),
   payload,projectId,operations.length,projectId,projectId,payload,projectId,projectId,projectId,projectId).run();
  if(result.meta?.changes!==operations.length)return fail('intent_conflict_or_stale_reservation');
  const readback=await env.DB.prepare(
   'SELECT target_id,source_job_id,snapshot_version FROM car_recovery_execution_intents WHERE project_id=? ORDER BY target_id'
  ).bind(projectId).all();
  if(!matches(readback.results||[]))return fail('execution_intent_readback_mismatch');
  return {staged:true,count:operations.length,reason:'durable_intents_only',
   enqueueAllowed:false,resumeTriggered:false};
 }catch{return fail('intent_transaction_failed');}
}

/**
 * Read-only dispatcher handoff: return a complete, exact-match set of intents.
 * This is NOT a queue insertion, a permission to enqueue, or a movie resume.
 * The production dispatcher must perform its own transactional validation.
 */
export async function inspectCarDispatchHandoff(env,{projectId,operations}={}){
 const reject=reason=>({ready:false,reason,enqueueAllowed:false,resumeTriggered:false});
 if(!validProject(projectId)||!Array.isArray(operations)||
    operations.length<1||operations.length>3)return reject('invalid_dispatch_batch');
 const targetIds=new Set(),jobIds=new Set(),snapshots=new Set();
 for(const op of operations){
  if(!validTarget(op?.targetId)||typeof op.sourceJobId!=='string'||
     !op.sourceJobId.trim()||!Number.isSafeInteger(op.snapshotVersion)||
     op.snapshotVersion<=0||targetIds.has(op.targetId)||jobIds.has(op.sourceJobId))
   return reject('invalid_dispatch_identity');
  targetIds.add(op.targetId);jobIds.add(op.sourceJobId);snapshots.add(op.snapshotVersion);
 }
 if(snapshots.size!==1)return reject('mixed_dispatch_snapshot');
 try{
  const [reservations,intents]=await Promise.all([
   env.DB.prepare('SELECT target_id,source_job_id,snapshot_version FROM car_recovery_reservations WHERE project_id=? ORDER BY target_id').bind(projectId).all(),
   env.DB.prepare('SELECT target_id,source_job_id,snapshot_version FROM car_recovery_execution_intents WHERE project_id=? ORDER BY target_id').bind(projectId).all()
  ]);
  const matches=rows=>Array.isArray(rows)&&rows.length===operations.length&&
   rows.every(row=>operations.some(op=>op.targetId===row.target_id&&
    op.sourceJobId===row.source_job_id&&op.snapshotVersion===row.snapshot_version));
  if(!matches(reservations.results)||!matches(intents.results))
   return reject('dispatch_handoff_mismatch');
  return {ready:true,reason:'isolated_dispatch_handoff_verified',
   projectId,operations:operations.map(op=>Object.freeze({
    targetId:op.targetId,sourceJobId:op.sourceJobId,snapshotVersion:op.snapshotVersion
   })),enqueueAllowed:false,resumeTriggered:false};
 }catch{return reject('dispatch_handoff_unavailable');}
}

/**
 * Isolated executor preparation: never writes to production jobs.
 * It records one durable dispatch claim per target, only for exact handoffs.
 * Actual production queue creation remains a separate, disabled integration.
 */
export async function stageCarDispatchClaims(env,{handoff,enabled=false}={}){
 const reject=reason=>({claimed:false,reason,enqueueAllowed:false,resumeTriggered:false});
 if(!enabled)return reject('feature_disabled');
 if(handoff?.ready!==true||handoff.enqueueAllowed!==false||
    handoff.resumeTriggered!==false)return reject('unverified_dispatch_handoff');
 const {projectId,operations}=handoff;
 const verified=await inspectCarDispatchHandoff(env,{projectId,operations});
 if(verified.ready!==true)return reject(verified.reason);
 try{
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS car_recovery_dispatch_claims (
   project_id TEXT NOT NULL,target_id TEXT NOT NULL,source_job_id TEXT NOT NULL,
   snapshot_version INTEGER NOT NULL,created_at INTEGER NOT NULL,
   PRIMARY KEY(project_id,target_id),UNIQUE(project_id,source_job_id)
  )`).run();
  const existing=await env.DB.prepare(
   'SELECT target_id,source_job_id,snapshot_version FROM car_recovery_dispatch_claims WHERE project_id=?'
  ).bind(projectId).all();
  const matches=rows=>rows.length===operations.length&&rows.every(row=>
   operations.some(op=>op.targetId===row.target_id&&
    op.sourceJobId===row.source_job_id&&op.snapshotVersion===row.snapshot_version));
  if(existing.results?.length)return matches(existing.results)?
   {claimed:true,idempotent:true,count:operations.length,enqueueAllowed:false,resumeTriggered:false}:
   reject('conflicting_dispatch_claims');
  const payload=JSON.stringify(operations);
  const result=await env.DB.prepare(`INSERT INTO car_recovery_dispatch_claims
   (project_id,target_id,source_job_id,snapshot_version,created_at)
   SELECT ?,json_extract(value,'$.targetId'),json_extract(value,'$.sourceJobId'),
    json_extract(value,'$.snapshotVersion'),?
   FROM json_each(?)
   WHERE (SELECT COUNT(*) FROM car_recovery_execution_intents WHERE project_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM car_recovery_dispatch_claims WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM car_recovery_execution_intents i WHERE i.project_id=?
     AND NOT EXISTS(SELECT 1 FROM json_each(?) j
      WHERE json_extract(j.value,'$.targetId')=i.target_id
       AND json_extract(j.value,'$.sourceJobId')=i.source_job_id
       AND json_extract(j.value,'$.snapshotVersion')=i.snapshot_version))
    AND (SELECT COUNT(*) FROM car_recovery_reservations WHERE project_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM car_recovery_execution_intents i WHERE i.project_id=?
     AND NOT EXISTS(SELECT 1 FROM car_recovery_reservations r
      WHERE r.project_id=i.project_id AND r.target_id=i.target_id
       AND r.source_job_id=i.source_job_id AND r.snapshot_version=i.snapshot_version))
    AND NOT EXISTS(SELECT 1 FROM car_recovery_reservations r WHERE r.project_id=?
     AND (r.state_fingerprint IS NULL OR length(r.state_fingerprint)<>64))
    AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=?
     AND j.step_id IN ('deep_match_english','deep_match_urdu')
     AND j.created_at>(SELECT MAX(created_at) FROM car_recovery_reservations
      WHERE project_id=?))`).bind(
    projectId,Math.floor(Date.now()/1000),payload,projectId,
    operations.length,projectId,projectId,payload,
    projectId,operations.length,projectId,projectId,projectId,projectId).run();
  if(result.meta?.changes!==operations.length)return reject('dispatch_claim_incomplete');
  const readback=await env.DB.prepare(
   'SELECT target_id,source_job_id,snapshot_version FROM car_recovery_dispatch_claims WHERE project_id=?'
  ).bind(projectId).all();
  if(!matches(readback.results||[]))return reject('dispatch_claim_readback_mismatch');
  return {claimed:true,idempotent:false,count:operations.length,
   reason:'isolated_dispatch_claims_staged',enqueueAllowed:false,resumeTriggered:false};
 }catch{return reject('dispatch_claim_transaction_failed');}
}

/**
 * Build deterministic production job specifications from a verified claim.
 * No D1 writes, no queue side effects. The executor must bind these to a
 * real project worker and perform an atomic production transaction separately.
 */
export async function planCarRecoveryJobs(env,{handoff,enabled=false}={}){
 const reject=reason=>({planned:false,reason,enqueueAllowed:false,resumeTriggered:false});
 if(!enabled)return reject('feature_disabled');
 if(handoff?.ready!==true||handoff.enqueueAllowed!==false||
    handoff.resumeTriggered!==false)return reject('unverified_dispatch_handoff');
 const {projectId,operations}=handoff;
 const verified=await inspectCarDispatchHandoff(env,{projectId,operations});
 if(!verified.ready)return reject(verified.reason);
 try{
  const claims=await env.DB.prepare(
   'SELECT target_id,source_job_id,snapshot_version FROM car_recovery_dispatch_claims WHERE project_id=?'
  ).bind(projectId).all();
  const rows=claims.results||[];
  if(rows.length!==operations.length||!rows.every(row=>operations.some(op=>
    op.targetId===row.target_id&&op.sourceJobId===row.source_job_id&&
    op.snapshotVersion===row.snapshot_version)))return reject('dispatch_claim_mismatch');
  const specs=operations.map(op=>Object.freeze({
   projectId,targetId:op.targetId,sourceJobId:op.sourceJobId,
   snapshotVersion:op.snapshotVersion,
   stepId:op.targetId.startsWith('english:')?'deep_match_english':'deep_match_urdu',
   idempotencyKey:'car-v1.1:'+projectId+':'+op.targetId+':'+op.snapshotVersion
  }));
  return {planned:true,reason:'job_specs_ready_for_transactional_executor',
   jobs:specs,enqueueAllowed:false,resumeTriggered:false};
 }catch{return reject('job_spec_planning_failed');}
}

/**
 * Atomically prepare isolated queue outbox rows from verified job specs.
 * The outbox is not the production jobs table and has no worker-visible jobs.
 * A separate production executor must validate, enqueue and acknowledge.
 */
export async function stageCarRecoveryOutbox(env,{plan,enabled=false}={}){
 const reject=reason=>({staged:false,reason,enqueueAllowed:false,resumeTriggered:false});
 if(!enabled)return reject('feature_disabled');
 if(plan?.planned!==true||plan.enqueueAllowed!==false||
    plan.resumeTriggered!==false||!Array.isArray(plan.jobs)||
    plan.jobs.length<1||plan.jobs.length>3)return reject('unverified_job_plan');
 const jobs=plan.jobs,projectId=jobs[0]?.projectId;
 if(!validProject(projectId))return reject('invalid_outbox_project');
 const targets=new Set(),keys=new Set();
 for(const job of jobs){
  if(job.projectId!==projectId||!validTarget(job.targetId)||
     typeof job.sourceJobId!=='string'||!job.sourceJobId.trim()||
     !Number.isSafeInteger(job.snapshotVersion)||job.snapshotVersion<=0||
     job.stepId!==(job.targetId.startsWith('english:')?
      'deep_match_english':'deep_match_urdu')||
     job.idempotencyKey!=='car-v1.1:'+projectId+':'+job.targetId+':'+job.snapshotVersion||
     targets.has(job.targetId)||keys.has(job.idempotencyKey))
   return reject('invalid_outbox_job');
  targets.add(job.targetId);keys.add(job.idempotencyKey);
 }
 try{
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS car_recovery_job_outbox (
   project_id TEXT NOT NULL,target_id TEXT NOT NULL,
   source_job_id TEXT NOT NULL,snapshot_version INTEGER NOT NULL,
   step_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,
   created_at INTEGER NOT NULL,PRIMARY KEY(project_id,target_id),
   UNIQUE(idempotency_key)
  )`).run();
  const matches=rows=>rows.length===jobs.length&&rows.every(row=>jobs.some(job=>
   row.target_id===job.targetId&&row.source_job_id===job.sourceJobId&&
   row.snapshot_version===job.snapshotVersion&&row.step_id===job.stepId&&
   row.idempotency_key===job.idempotencyKey));
  const prior=await env.DB.prepare(
   'SELECT target_id,source_job_id,snapshot_version,step_id,idempotency_key FROM car_recovery_job_outbox WHERE project_id=?'
  ).bind(projectId).all();
  if(prior.results?.length)return matches(prior.results)?
   {staged:true,idempotent:true,count:jobs.length,enqueueAllowed:false,resumeTriggered:false}:
   reject('conflicting_outbox');
  const payload=JSON.stringify(jobs);
  const sql=`INSERT INTO car_recovery_job_outbox
   (project_id,target_id,source_job_id,snapshot_version,step_id,idempotency_key,created_at)
   SELECT ?,json_extract(value,'$.targetId'),json_extract(value,'$.sourceJobId'),
    json_extract(value,'$.snapshotVersion'),json_extract(value,'$.stepId'),
    json_extract(value,'$.idempotencyKey'),?
   FROM json_each(?)
   WHERE (SELECT COUNT(*) FROM car_recovery_dispatch_claims WHERE project_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM car_recovery_job_outbox WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM car_recovery_dispatch_claims c WHERE c.project_id=?
     AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE
      json_extract(j.value,'$.targetId')=c.target_id AND
      json_extract(j.value,'$.sourceJobId')=c.source_job_id AND
      json_extract(j.value,'$.snapshotVersion')=c.snapshot_version))`;
  const result=await env.DB.prepare(sql).bind(projectId,
   Math.floor(Date.now()/1000),payload,projectId,jobs.length,projectId,projectId,payload).run();
  if(result.meta?.changes!==jobs.length)return reject('outbox_insert_incomplete');
  const verified=await env.DB.prepare(
   'SELECT target_id,source_job_id,snapshot_version,step_id,idempotency_key FROM car_recovery_job_outbox WHERE project_id=?'
  ).bind(projectId).all();
  if(!matches(verified.results||[]))return reject('outbox_readback_mismatch');
  return {staged:true,idempotent:false,count:jobs.length,
   reason:'isolated_outbox_staged',enqueueAllowed:false,resumeTriggered:false};
 }catch{return reject('outbox_transaction_failed');}
}

/**
 * Atomically enqueue one CAR outbox item to the production jobs table.
 * Disabled by default. Only a single queued job per movie is permitted,
 * preserving the existing worker's sequential processing contract.
 * Existing accepted jobs are never updated or deleted.
 */
export async function enqueueCarRecoveryOutboxJob(env,{
 projectId,targetId,jobId,workerId,prompt,enabled=false
}={}){
 const reject=reason=>({enqueued:false,reason,resumeTriggered:false});
 if(!enabled)return reject('feature_disabled');
 if(!validProject(projectId)||!validTarget(targetId)||
    typeof jobId!=='string'||!jobId.trim()||
    typeof workerId!=='string'||!workerId.trim()||
    typeof prompt!=='string'||!prompt.startsWith('[CAR-V1.1-RECOVERY] ')||
    prompt.length>12000)return reject('invalid_enqueue_request');
 try{
  const now=Math.floor(Date.now()/1000);
  const sql=`INSERT INTO jobs
   (id,project_id,worker_id,step_id,status,prompt,created_at)
   SELECT ?,o.project_id,p.worker_id,o.step_id,'queued',?,?
   FROM car_recovery_job_outbox o
   JOIN car_recovery_dispatch_claims c
    ON c.project_id=o.project_id AND c.target_id=o.target_id
    AND c.source_job_id=o.source_job_id AND c.snapshot_version=o.snapshot_version
   JOIN projects p ON p.id=o.project_id AND p.worker_id=?
    AND p.status='needs_review'
   WHERE o.project_id=? AND o.target_id=?
    AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=o.project_id
     AND j.status IN ('queued','working'))
    AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=?)
    AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=o.project_id
     AND j.created_at>=(SELECT MIN(created_at) FROM car_recovery_job_outbox
      WHERE project_id=o.project_id)
     AND j.step_id IN ('deep_match_english','deep_match_urdu'))`;
  const result=await env.DB.prepare(sql).bind(
   jobId,prompt,now,workerId,projectId,targetId,jobId).run();
  if(result.meta?.changes!==1)return reject('queue_guard_rejected');
  return {enqueued:true,jobId,projectId,targetId,
   reason:'production_job_queued',resumeTriggered:false};
 }catch{return reject('queue_transaction_failed');}
}

/**
 * Read-only readiness gate for administrator-controlled CAR dispatch.
 * Does not authorize enqueue. Existing movie pause/stop and worker pause
 * always take precedence over any recovery outbox state.
 */
export async function inspectCarMovieDispatchControls(env,{projectId}={}){
 const reject=reason=>({ready:false,reason,enqueueAllowed:false,resumeTriggered:false});
 if(!validProject(projectId))return reject('invalid_project');
 try{
  const project=await env.DB.prepare(
   'SELECT p.id,p.worker_id,p.status FROM projects p WHERE p.id=?'
  ).bind(projectId).first();
  if(!project?.worker_id)return reject('project_or_worker_missing');
  if(String(project.status||'').toLowerCase()!=='needs_review')
   return reject('movie_control_blocks_recovery');
  const active=await env.DB.prepare(
   "SELECT COUNT(*) AS n FROM jobs WHERE project_id=? AND status IN ('queued','working')"
  ).bind(projectId).first();
  if(Number(active?.n)!==0)return reject('movie_has_active_jobs');
  const worker=await env.DB.prepare(
   'SELECT enabled,paused FROM workers WHERE id=?'
  ).bind(project.worker_id).first();
  if(!worker||!Number(worker.enabled)||Number(worker.paused))
   return reject('worker_unavailable_or_paused');
  return {ready:true,projectId,workerId:project.worker_id,
   reason:'controls_read_only_ready',enqueueAllowed:false,resumeTriggered:false};
 }catch{return reject('movie_control_inspection_failed');}
}
