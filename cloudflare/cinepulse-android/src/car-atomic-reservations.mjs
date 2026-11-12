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
       AND json_extract(decision_json,'$.museRequestId') IS NULL)
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
