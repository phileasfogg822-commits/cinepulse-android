/**
 * Read-only CAR D1 preflight state fingerprint.
 * This detects changes between an audited handoff and a later re-read,
 * including accepted Muse batch outputs and checkpoint decisions.
 * It is NOT a D1 transaction, a production validator, or enqueue permission.
 */
import {sha256} from './helpers.mjs';

export async function fingerprintCarD1State({
 projectId,audit,checkpoints,sourceSrt,englishSrt,urduSrt,jobRows
}={}){
 if(typeof projectId!=='string'||audit?.projectId!==projectId||
    audit?.source!=='d1_read_only'||!audit.inventory||
    !Array.isArray(checkpoints)||typeof sourceSrt!=='string'||
    typeof englishSrt!=='string'||typeof urduSrt!=='string'||
    !Array.isArray(jobRows))
  throw Error('car_d1_fingerprint_incomplete');
 // The query supplying jobRows must include every deep-match job (not only
 // accepted rows), with its status and output, in stable database order.
 const state={projectId,snapshotVersion:audit.inventory.snapshotVersion,
  acceptedSegmentIds:audit.inventory.acceptedSegmentIds,
  unknownSegmentIds:audit.inventory.unknownSegmentIds,
  verifiedSegmentIds:audit.verifiedSegmentIds,
  verifiedProvenance:audit.verifiedProvenance,
  evidenceStatus:audit.evidenceStatus,
  checkpoints:checkpoints.map(x=>({targetId:x.targetId,
   snapshotVersion:x.snapshotVersion,decision:x.decision})),
  sourceSrt,englishSrt,urduSrt,
  jobs:jobRows.map(x=>({id:x.id,stepId:x.step_id,status:x.status,
   output:x.output,createdAt:x.created_at,finishedAt:x.finished_at}))};
 return sha256('cinepulse-car-d1-preflight-v1:'+JSON.stringify(state));
}

/**
 * Re-query authoritative D1 state twice around an asynchronous production
 * validation step. The two reads must match exactly; this is a read-only
 * optimistic guard, NOT a transaction or permission to enqueue.
 */
export async function validateCarStableD1Window({readFingerprint,validateProduction}={}){
 const deny=reason=>({validated:false,reason,enqueueAllowed:false,resumeTriggered:false});
 if(typeof readFingerprint!=='function'||typeof validateProduction!=='function')
  return deny('missing_validation_dependency');
 let before,after,production;
 try{
  before=await readFingerprint();
  if(typeof before!=='string'||!/^[a-f0-9]{64}$/i.test(before))
   return deny('invalid_d1_fingerprint');
  production=await validateProduction();
  if(production?.productionValidated!==true||production?.valid!==true)
   return deny('production_validation_failed');
  after=await readFingerprint();
 }catch{return deny('validation_dependency_error');}
 if(after!==before)return deny('d1_changed_during_validation');
 return {validated:true,reason:'stable_read_only_validation',
  fingerprint:before,enqueueAllowed:false,resumeTriggered:false};
}

/**
 * Validate a prospective recovery batch before any transactional write.
 * The executor must still re-check all invariants inside its D1 transaction.
 */
export function planAtomicCarRecovery({handoff,proof,productionResults}={}){
 const deny=reason=>({prepared:false,reason,operations:[],enqueueAllowed:false});
 if(handoff?.authorized!==true||handoff.enqueueAllowed!==false||
    handoff.acceptedJobsMutable!==false||handoff.resumeTriggered!==false||
    !Array.isArray(handoff.targets)||handoff.targets.length<1||
    handoff.targets.length>3||proof?.verified!==true||
    proof.projectId!==handoff.projectId||
    proof.acceptedJobsUnchanged!==true||proof.unresolvedTargetsVerified!==true||
    !Array.isArray(productionResults))
  return deny('unverified_atomic_recovery_input');
 const byTarget=new Map();
 for(const r of productionResults){
  if(typeof r?.targetId!=='string'||byTarget.has(r.targetId))
   return deny('duplicate_production_result');
  byTarget.set(r.targetId,r);
 }
 if(byTarget.size!==handoff.targets.length)return deny('incomplete_production_coverage');
 const operations=[],seenJobs=new Set();
 for(const t of handoff.targets){
  const r=byTarget.get(t.targetId);
  if(!r||r.valid!==true||r.productionValidated!==true||
     r.targetId!==t.targetId||r.sourceJobId!==t.sourceJobId||
     r.snapshotVersion!==t.snapshotVersion||
     proof.snapshotVersion!==t.snapshotVersion||
     seenJobs.has(t.sourceJobId))
   return deny('invalid_production_target');
  seenJobs.add(t.sourceJobId);
  operations.push(Object.freeze({targetId:t.targetId,sourceJobId:t.sourceJobId,
   snapshotVersion:t.snapshotVersion}));
 }
 return {prepared:true,reason:'transaction_required',operations,
  projectId:handoff.projectId,enqueueAllowed:false,resumeTriggered:false};
}
