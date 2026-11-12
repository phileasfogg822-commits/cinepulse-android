import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprintCarD1State,validateCarStableD1Window} from '../src/car-d1-preflight.mjs';
import {inspectScopedCarRecoveryReadiness,buildScopedCarRecoveryHandoff,
 verifyFreshCarD1Snapshot} from '../src/car-recovery-ledger.mjs';

const projectId='fed941ad-ff7f-4b0f-8439-25cfda24d187';
const sourceSrt='25\n00:01:00,000 --> 00:01:04,000\nThe dragon flies over village.\n';
const decision={anchorMethod:'context',visualVerified:false,sourceCueIds:[25],
 evidenceQuote:'dragon flies over village',museRequestId:'muse-123'};
const checkpoints=[{targetId:'english:81',snapshotVersion:12,decision}];
const audit={projectId,source:'d1_read_only',evidenceStatus:'verified',
 inventory:{snapshotVersion:12,acceptedSegmentIds:['english:80'],
  unknownSegmentIds:['english:81']},
 verifiedSegmentIds:['english:81'],verifiedProvenance:[{
  targetId:'english:81',sourceJobId:'job-1',sourceCueIds:[25],
  sourceCueQuote:'dragon flies over village',museRequestId:'muse-123'}]};
const baseJobs=[{id:'job-1',step_id:'deep_match_english',status:'done',
 output:'{"decisions":[{"segmentIndex":80,"sourceCueIds":[25]}]}',
 created_at:12,finished_at:13}];
const digest=jobs=>fingerprintCarD1State({projectId,audit,checkpoints,sourceSrt,
 englishSrt:'English measured SRT',urduSrt:'Urdu measured SRT',jobRows:jobs});

test('live D1 preflight accepts matching audited state but never grants enqueue',async()=>{
 const stateFingerprint=await digest(baseJobs);
 assert.match(stateFingerprint,/^[a-f0-9]{64}$/);
 const readiness=inspectScopedCarRecoveryReadiness({audit,checkpoints,sourceSrt});
 assert.equal(readiness.ready,true);
 const plan=buildScopedCarRecoveryHandoff({projectId,readiness,checkpoints});
 assert.equal(plan.authorized,true);
 const proof=verifyFreshCarD1Snapshot({projectId,
  handoff:{...plan,stateFingerprint},audit,checkpoints,sourceSrt,
  freshFingerprint:stateFingerprint});
 assert.equal(proof.verified,true);
 assert.equal(proof.acceptedJobsUnchanged,true);
 assert.equal(plan.enqueueAllowed,false);
 assert.equal(plan.resumeTriggered,false);
});

test('accepted Muse output change invalidates preflight even if created_at snapshot stays equal',async()=>{
 const original=await digest(baseJobs);
 const modified=await digest([{...baseJobs[0],output:'{"decisions":[{"segmentIndex":80,"sourceCueIds":[26]}]}'}]);
 assert.notEqual(original,modified);
 const readiness=inspectScopedCarRecoveryReadiness({audit,checkpoints,sourceSrt});
 const plan=buildScopedCarRecoveryHandoff({projectId,readiness,checkpoints});
 const proof=verifyFreshCarD1Snapshot({projectId,
  handoff:{...plan,stateFingerprint:original},audit,checkpoints,sourceSrt,
  freshFingerprint:modified});
 assert.equal(proof.verified,false);
 assert.equal(proof.reason,'accepted_state_changed');
 assert.equal(proof.acceptedJobsUnchanged,false);
});

test('missing state fingerprint and cross-project audit fail closed',async()=>{
 const readiness=inspectScopedCarRecoveryReadiness({audit,checkpoints,sourceSrt});
 const plan=buildScopedCarRecoveryHandoff({projectId,readiness,checkpoints});
 const missing=verifyFreshCarD1Snapshot({projectId,handoff:plan,
  audit,checkpoints,sourceSrt,freshFingerprint:await digest(baseJobs)});
 assert.equal(missing.verified,false);
 assert.equal(missing.reason,'missing_state_fingerprint');
 const fingerprint=await digest(baseJobs);
 const cross=verifyFreshCarD1Snapshot({projectId,
  handoff:{...plan,stateFingerprint:fingerprint},
  audit:{...audit,projectId:'other'},checkpoints,sourceSrt,
  freshFingerprint:fingerprint});
 assert.equal(cross.verified,false);
 assert.equal(cross.reason,'audit_project_mismatch');
});

test('CAR D1 double-read rejects concurrent state changes without enqueue',async()=>{
 let n=0;
 const result=await validateCarStableD1Window({
  readFingerprint:async()=>++n===1?'a'.repeat(64):'b'.repeat(64),
  validateProduction:async()=>({valid:true,productionValidated:true})
 });
 assert.equal(result.validated,false);
 assert.equal(result.reason,'d1_changed_during_validation');
 assert.equal(result.enqueueAllowed,false);
});
test('CAR D1 double-read accepts stable evidence but remains read-only',async()=>{
 const result=await validateCarStableD1Window({
  readFingerprint:async()=> 'a'.repeat(64),
  validateProduction:async()=>({valid:true,productionValidated:true})
 });
 assert.equal(result.validated,true);
 assert.equal(result.enqueueAllowed,false);
 assert.equal(result.resumeTriggered,false);
});
