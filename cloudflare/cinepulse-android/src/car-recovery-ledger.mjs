/**
 * CAR v1.1 isolated recovery checkpoint ledger.
 * No existing Muse job/output is overwritten. An insert is conditional on a
 * preverified snapshot and an explicit unresolved target. D1 unique key
 * guarantees retry idempotence. Caller must revalidate source evidence.
 */
const validId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);
const validTarget=x=>typeof x==='string'&&/^(english|urdu):[1-9][0-9]*$/.test(x);
export function checkCarRecoveryWrite({projectId,targetId,inventory,decision,enabled=false}={}){
 if(!enabled)return {ok:false,reason:'feature_disabled'};
 if(!validId(projectId)||!validTarget(targetId))return {ok:false,reason:'invalid_target'};
 if(!inventory||inventory.source!=='d1_authoritative'||inventory.eligibility?.verified!==true||
    inventory.complete!==true||inventory.mutationPermitted!==true||
    !Number.isSafeInteger(inventory.snapshotVersion))
   return {ok:false,reason:'inventory_not_authoritative'};
 if(!Array.isArray(inventory.eligibility.unresolvedSegmentIds)||
    !inventory.eligibility.unresolvedSegmentIds.includes(targetId)||
    inventory.eligibility.unresolvedSegmentIds.length>3||
    !Array.isArray(inventory.acceptedSegmentIds)||
    inventory.acceptedSegmentIds.includes(targetId)||
    !Array.isArray(inventory.recoveredSegmentIds)||
    inventory.recoveredSegmentIds.includes(targetId)||
    inventory.eligibility.unresolvedSegmentIds.length+inventory.recoveredSegmentIds.length>3)
   return {ok:false,reason:'target_not_unresolved'};
 if(!decision||decision.visualVerified!==false||decision.anchorMethod!=='context'||
    !Array.isArray(decision.sourceCueIds)||decision.sourceCueIds.length<1||
    typeof decision.museRequestId!=='string'||decision.museRequestId.length<6)
   return {ok:false,reason:'unverified_recovery_decision'};
 return {ok:true};
}
/**
 * Check literal source-cue provenance against the original movie SRT.
 * Does not modify or bypass the normal V5 batch validator.
 */
export function verifyCarSourceSrt(sourceSrt,decision){
 if(typeof sourceSrt!=='string'||!sourceSrt.trim()||
    !decision||!Array.isArray(decision.sourceCueIds)||!decision.sourceCueIds.length||
    typeof decision.evidenceQuote!=='string'||!decision.evidenceQuote.trim())
  return {verified:false,reason:'missing_source_provenance'};
 const cues=new Map();
 for(const block of sourceSrt.replace(/\r/g,'').split(/\n\s*\n/)){
  const lines=block.trim().split('\n');
  if(lines.length<3||!/^\d+$/.test(lines[0].trim())||!lines[1].includes('-->'))continue;
  const id=Number(lines[0].trim());
  if(cues.has(id))return {verified:false,reason:'duplicate_source_cue'};
  cues.set(id,lines.slice(2).join(' '));
 }
 const selected=[];
 for(const id of decision.sourceCueIds){
  if(!Number.isSafeInteger(id)||id<1||!cues.has(id))
   return {verified:false,reason:'source_cue_not_found'};
  selected.push(cues.get(id));
 }
 const normalize=t=>t.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
 const quote=normalize(decision.evidenceQuote);
 if(quote.length<8||!normalize(selected.join(' ')).includes(quote))
  return {verified:false,reason:'source_quote_mismatch'};
 return {verified:true,sourceCueCount:selected.length};
}
export async function ensureCarRecoveryLedger(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS car_recovery_checkpoints (
  project_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  snapshot_version INTEGER NOT NULL,
  decision_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(project_id,target_id)
 )`).run();
}
/**
 * Prepare an authorization envelope from a fully reconciled D1 snapshot.
 * This function NEVER promotes unknown segments into unresolved ones.
 * The inventory must have been checked by verifyCarLiveInventory upstream.
 */
export function authorizeCarD1Inventory(snapshot,verified){
 if(!snapshot||snapshot.source!=='d1_read_only'||snapshot.readOnly!==true||
    snapshot.mutationPermitted!==false||snapshot.complete!==true||
    !verified||verified.verified!==true||
    verified.snapshotVersion!==snapshot.snapshotVersion||
    !Array.isArray(snapshot.unknownSegmentIds)||snapshot.unknownSegmentIds.length!==0||
    !Array.isArray(snapshot.acceptedSegmentIds)||
    !Array.isArray(snapshot.recoveredSegmentIds)||
    !Array.isArray(verified.unresolvedSegmentIds)||
    verified.unresolvedSegmentIds.length<1||verified.lifetimeCount>3)
   return {authorized:false,reason:'unverified_d1_snapshot'};
 const unresolved=new Set(verified.unresolvedSegmentIds);
 if(snapshot.acceptedSegmentIds.some(id=>unresolved.has(id))||
    snapshot.recoveredSegmentIds.some(id=>unresolved.has(id)))
   return {authorized:false,reason:'checkpoint_collision'};
 return {authorized:true,inventory:{
  source:'d1_authoritative',snapshotVersion:snapshot.snapshotVersion,
  complete:true,mutationPermitted:true,
  acceptedSegmentIds:[...snapshot.acceptedSegmentIds],
  recoveredSegmentIds:[...snapshot.recoveredSegmentIds],
  eligibility:{verified:true,unresolvedSegmentIds:[...verified.unresolvedSegmentIds]}
 }};
}
export async function insertCarRecoveryCheckpoint(env,args){
 const check=checkCarRecoveryWrite(args);
 if(!check.ok)return {saved:false,reason:check.reason};
 const {projectId,targetId,inventory,decision}=args;
 // The calling handler must validate against the original movie SRT and the
 // unmodified production batch validator before enabling this write path.
 if(args.productionValidated!==true)return {saved:false,reason:'production_validation_required'};
 const serialized=JSON.stringify(decision);
 const now=Math.floor(Date.now()/1000);
 const result=await env.DB.prepare(`INSERT INTO car_recovery_checkpoints
  (project_id,target_id,snapshot_version,decision_json,created_at)
  VALUES(?,?,?,?,?)
  ON CONFLICT(project_id,target_id) DO NOTHING`)
  .bind(projectId,targetId,inventory.snapshotVersion,serialized,now).run();
 return {saved:(result.meta?.changes||0)===1,
  reason:(result.meta?.changes||0)===1?'inserted':'existing_checkpoint_unchanged'};
}

/**
 * Atomic, bounded CAR-only checkpoint insert. Caller must supply a fresh
 * server-generated audit and original SRT; a client inventory cannot authorize.
 * The SQL statement enforces the project-wide cap and retry immutability.
 * No normal jobs, accepted batches or project state are modified.
 */
export async function insertScopedCarRecoveryCheckpoint(env,{projectId,targetId,audit,decision,sourceSrt,enabled=false}={}){
 if(!enabled)return {saved:false,reason:'feature_disabled'};
 if(!validId(projectId)||!validTarget(targetId)||audit?.projectId!==projectId||
    audit?.source!=='d1_read_only'||audit?.mutationPermitted!==false||
    audit?.inventory?.source!=='d1_read_only'||audit?.inventory?.readOnly!==true||
    !Number.isSafeInteger(audit?.inventory?.snapshotVersion))
  return {saved:false,reason:'invalid_server_audit'};
 const base=audit.inventory;
 if(base.acceptedSegmentIds?.includes(targetId)||!base.unknownSegmentIds?.includes(targetId)||
    audit.evidenceStatus!=='verified'||!audit.verifiedSegmentIds?.includes(targetId)||
    audit.verifiedSegmentIds.length>3)
  return {saved:false,reason:'candidate_not_verified'};
 if(decision?.anchorMethod!=='context'||decision?.visualVerified!==false||
    typeof decision.museRequestId!=='string'||decision.museRequestId.length<6)
  return {saved:false,reason:'invalid_recovery_decision'};
 const evidence=(audit.verifiedProvenance||[]).filter(x=>x.targetId===targetId);
 if(evidence.length!==1)return {saved:false,reason:'unique_muse_provenance_required'};
 const original=evidence[0];
 if(decision?.museRequestId!==original.museRequestId||
    decision?.evidenceQuote!==original.sourceCueQuote||
    !Array.isArray(decision?.sourceCueIds)||
    JSON.stringify(decision.sourceCueIds)!==JSON.stringify(original.sourceCueIds))
  return {saved:false,reason:'recovery_evidence_differs_from_muse'};
 const source=verifyCarSourceSrt(sourceSrt,decision);
 if(!source.verified)return {saved:false,reason:source.reason};
 // A successful INSERT is conditional on the ledger's existing lifetime count.
 // An existing target remains unchanged even when retried with new content.
 const sql=`INSERT INTO car_recovery_checkpoints
  (project_id,target_id,snapshot_version,decision_json,created_at)
  SELECT ?,?,?,?,?
  WHERE (SELECT COUNT(*) FROM car_recovery_checkpoints WHERE project_id=?) < 3
    AND NOT EXISTS(SELECT 1 FROM car_recovery_checkpoints WHERE project_id=? AND target_id=?)
    AND (SELECT COALESCE(MAX(created_at),0) FROM jobs
         WHERE project_id=? AND step_id IN ('deep_match_english','deep_match_urdu')) <= ?
  ON CONFLICT(project_id,target_id) DO NOTHING`;
 const now=Math.floor(Date.now()/1000);
 const result=await env.DB.prepare(sql).bind(projectId,targetId,base.snapshotVersion,
  JSON.stringify(decision),now,projectId,projectId,targetId,projectId,base.snapshotVersion).run();
 return {saved:(result.meta?.changes||0)===1,
  reason:(result.meta?.changes||0)===1?'inserted':'stale_duplicate_or_limit',
  mutationScope:'car_recovery_checkpoints_only'};
}

/**
 * Load the bounded durable recovery ledger without changing V5 jobs or batches.
 * Never promote a checkpoint into an accepted scene automatically.
 */
export async function loadScopedCarRecoveryCheckpoints(env,projectId){
 if(!validId(projectId))throw Error('invalid_car_project');
 const rows=await env.DB.prepare(
  'SELECT target_id,snapshot_version,decision_json,created_at FROM car_recovery_checkpoints WHERE project_id=? ORDER BY created_at ASC,target_id ASC LIMIT 4'
 ).bind(projectId).all();
 const result=[];
 for(const row of rows.results||[]){
  if(!validTarget(row.target_id)||!Number.isSafeInteger(row.snapshot_version))
   throw Error('corrupt_car_checkpoint');
  let decision;
  try{decision=JSON.parse(row.decision_json)}catch{throw Error('corrupt_car_checkpoint')}
  if(!decision||decision.anchorMethod!=='context'||decision.visualVerified!==false||
     !Array.isArray(decision.sourceCueIds)||!decision.sourceCueIds.length)
   throw Error('corrupt_car_checkpoint');
  result.push({targetId:row.target_id,snapshotVersion:row.snapshot_version,
   decision,createdAt:row.created_at});
 }
 if(result.length>3)throw Error('car_recovery_limit_exceeded');
 return result;
}

/**
 * Fail-closed recovery consumption gate. Reading a saved checkpoint never
 * advances a movie; only independently verified, current Muse evidence may
 * be handed to a future resume operation.
 */
export function inspectScopedCarRecoveryReadiness({audit,checkpoints,sourceSrt}={}){
 if(!audit||audit.source!=='d1_read_only'||audit.evidenceStatus!=='verified'||
    !Number.isSafeInteger(audit.inventory?.snapshotVersion)||
    !Array.isArray(checkpoints)||checkpoints.length>3)
  return {ready:false,reason:'unverified_recovery_snapshot',eligible:[]};
 const accepted=new Set(audit.inventory.acceptedSegmentIds||[]);
 const unknown=new Set(audit.inventory.unknownSegmentIds||[]);
 const verified=new Set(audit.verifiedSegmentIds||[]);
 const seen=new Set(),eligible=[];
 for(const checkpoint of checkpoints){
  const target=checkpoint?.targetId,decision=checkpoint?.decision;
  if(!validTarget(target)||seen.has(target)||accepted.has(target)||!unknown.has(target)||
     !verified.has(target)||checkpoint.snapshotVersion!==audit.inventory.snapshotVersion)
   return {ready:false,reason:'stale_or_colliding_checkpoint',eligible:[]};
  seen.add(target);
  const evidence=(audit.verifiedProvenance||[]).filter(x=>x.targetId===target);
  if(evidence.length!==1||decision?.anchorMethod!=='context'||decision?.visualVerified!==false||
     decision.museRequestId!==evidence[0].museRequestId||
     decision.evidenceQuote!==evidence[0].sourceCueQuote||
     JSON.stringify(decision.sourceCueIds)!==JSON.stringify(evidence[0].sourceCueIds)||
     !verifyCarSourceSrt(sourceSrt,decision).verified)
   return {ready:false,reason:'source_provenance_mismatch',eligible:[]};
  eligible.push({targetId:target,snapshotVersion:checkpoint.snapshotVersion,
   sourceJobId:evidence[0].sourceJobId});
 }
 return {ready:eligible.length>0,reason:eligible.length?'verified_read_only':'no_checkpoints',
  eligible,resumeTriggered:false};
}

/**
 * Project-scoped, immutable recovery handoff plan. A handoff is not a queue
 * operation and cannot be treated as authorization to alter accepted V5 jobs.
 */
export function buildScopedCarRecoveryHandoff({projectId,readiness,checkpoints}={}){
 if(!validId(projectId)||readiness?.ready!==true||
    !Array.isArray(readiness.eligible)||!readiness.eligible.length||
    readiness.eligible.length>3||!Array.isArray(checkpoints))
  return {authorized:false,reason:'recovery_not_ready',targets:[]};
 const byId=new Map(checkpoints.map(row=>[row.targetId,row]));
 if(byId.size!==checkpoints.length)return {authorized:false,reason:'duplicate_checkpoints',targets:[]};
 const targets=[];
 for(const item of readiness.eligible){
  const row=byId.get(item.targetId);
  if(!row||!validTarget(item.targetId)||row.snapshotVersion!==item.snapshotVersion||
     !item.sourceJobId||!row.decision||row.decision.visualVerified!==false)
   return {authorized:false,reason:'handoff_checkpoint_mismatch',targets:[]};
  targets.push({targetId:item.targetId,sourceJobId:item.sourceJobId,
   snapshotVersion:item.snapshotVersion,anchorMethod:'context',
   visualVerified:false,requiresIndependentProductionValidation:true});
 }
 if(new Set(targets.map(t=>t.targetId)).size!==targets.length)
  return {authorized:false,reason:'duplicate_targets',targets:[]};
 return {authorized:true,reason:'read_only_handoff',projectId,targets,
  enqueueAllowed:false,acceptedJobsMutable:false,resumeTriggered:false};
}
