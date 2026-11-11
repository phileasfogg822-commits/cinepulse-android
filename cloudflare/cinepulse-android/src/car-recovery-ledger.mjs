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
