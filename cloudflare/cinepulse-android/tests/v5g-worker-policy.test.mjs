import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectV5gWorkflow,classifyV5gWorker,V5G_STEPS,V5G_MARKER,V5G_DUAL_WORKER_ROUTING_BUILD} from '../src/v5g-production-gate.mjs';
const backend=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
test('Worker 1 routes exclusively to new source-grounded V5-G pipeline',()=>{
 for(const label of ['Worker 1','worker1','WORKER-1','Worker_1','News Worker 1','Muse Worker #1','CinePulse Worker One','Cinepulse Android Views 1','CinePulse Android Muse 1','CinePulse Android News 1','CinePulse Android Muse 01','CinePulse Android Muse One'])
  assert.equal(selectV5gWorkflow(label),true,label);
 assert.ok(V5G_STEPS.includes('grounded_evidence'));
 assert.ok(V5G_MARKER);
});
test('INT and Worker 1 both route new movies to the exact same grounded 15-stage pipeline',()=>{
 for(const label of ['INT','int','CinePulse Android INT','CinePulse INT','INT Worker']){
  assert.equal(selectV5gWorkflow(label),true,label);
  assert.deepEqual(classifyV5gWorker(label),{
   kind:'grounded_int',productionMode:'v5_grounded_srt_only',recognized:true
  },label);
 }
 assert.equal(V5G_STEPS.length,15);
 assert.ok(V5G_STEPS.includes('grounded_evidence'));
 assert.ok(V5G_STEPS.includes('grounded_preflight'));
 assert.ok(V5G_STEPS.includes('grounded_match_plan'));
 assert.equal(V5G_DUAL_WORKER_ROUTING_BUILD,'v5g-worker1-int-grounded-parity-20261123');
 for(const label of ['Worker 2','legacy',null,'','International Worker','INT Worker 1'])
  assert.equal(selectV5gWorkflow(label),false,String(label));
});
test('emergency disable blocks both worker roles with NO downgrade into legacy V5',()=>{
 for(const label of ['Worker 1','CinePulse Android Muse 1','INT','CinePulse Android INT']){
  assert.equal(selectV5gWorkflow(label,{disabled:true}),false);
  assert.deepEqual(classifyV5gWorker(label,{disabled:true}),{
   kind:'v5g_disabled',productionMode:'unavailable',recognized:true
  });
 }
 assert.match(backend,/No old-pipeline fallback/);
});
test('worker routing is based on database worker.label after worker auth, not user query switch',()=>{
 assert.match(backend,/SELECT \* FROM workers WHERE id=\? AND enabled=1/);
 assert.match(backend,/selectV5gWorkflow\(worker\.label,\{disabled:env\.CINEPULSE_V5G_DISABLED==='true'\}\)/);
 assert.match(backend,/body\.v5Grounded!==undefined && body\.v5Grounded!==grounded/);
 assert.match(backend,/stages:grounded\?V5G_STEPS:permanentDeep\?PERMANENT_DEEP_STEPS/);
});

test('health reports both-worker V5-G routing while preserving already-created INT movies',()=>{
 assert.match(backend,/v5gWorker1Only:false,v5gIntGroundedEnabled:true,v5gLegacyIntProjectsPreserved:true,v5gDualWorkerRoutingBuild:V5G_DUAL_WORKER_ROUTING_BUILD/);
 assert.match(backend,/v5gAcceptingNewProjects:env\.CINEPULSE_V5G_DISABLED!=='true'/);
});

test('guarded production deploy validates V5-G parity marker for BOTH Worker 1 and INT',()=>{
 const workflow=readFileSync(new URL('../../../.github/workflows/cinepulse-v3828-production-gated-promotion.yml',import.meta.url),'utf8');
 assert.match(workflow,/\.policy\.v5gWorker1Only==false and \.policy\.v5gIntGroundedEnabled==true/);
 assert.match(workflow,/\.policy\.v5gLegacyIntProjectsPreserved==true/);
 assert.match(workflow,/v5g-worker1-int-grounded-parity-20261123/);
 assert.match(workflow,/\.policy\.v5gLiveStageCount==15/);
});

test('no silent downgrade of Worker 1 into INT legacy if routing is disabled or label is unknown',()=>{
 assert.equal(classifyV5gWorker('News Worker 1').productionMode,'v5_grounded_srt_only');
 assert.equal(classifyV5gWorker('INT').productionMode,'v5_grounded_srt_only');
 assert.equal(classifyV5gWorker('News Worker 1',{disabled:true}).kind,'v5g_disabled');
 assert.equal(classifyV5gWorker('INT',{disabled:true}).kind,'v5g_disabled');
 assert.equal(classifyV5gWorker('Unconfigured Remote').kind,'unrecognized');
 assert.equal(classifyV5gWorker('INT Worker 1').kind,'unrecognized');
 assert.match(backend,/No new movie was created/);
 assert.match(backend,/No old-pipeline fallback/);
});
test('worker listing shows authoritative next movie mode and project detail exposes persisted stage plan',()=>{
 assert.match(backend,/newMovieProductionMode:route\.productionMode/);
 assert.match(backend,/pipelineStages:policy\.stages/);
 assert.match(backend,/policy\.grounded\?'v5_grounded_srt_only'/);
 assert.match(backend,/v5gAcceptingNewProjects:env\.CINEPULSE_V5G_DISABLED!=='true'/);
});

test('Muse/Views 1 and INT have separate role identities but identical grounded stages',()=>{
 for(const label of ['Cinepulse Android Views 1','CinePulse Android Muse 1','CinePulse Android News 1']){
   assert.deepEqual(classifyV5gWorker(label),{
     kind:'grounded_worker1',productionMode:'v5_grounded_srt_only',recognized:true
   });
   assert.equal(classifyV5gWorker(label,{disabled:true}).kind,'v5g_disabled');
 }
 for(const label of ['INT','CinePulse Android INT']){
  assert.deepEqual(classifyV5gWorker(label),{
   kind:'grounded_int',productionMode:'v5_grounded_srt_only',recognized:true
  });
 }
 for(const label of ['CinePulse Android Views 2','CinePulse Android Muse 2','CinePulse Android Views',
   'CinePulse Android Muse INT 1','INT Muse 1','Other CinePulse Android Views 1','INT Worker 1',
   'International Worker','Worker INT 1']){
   assert.equal(classifyV5gWorker(label).kind,'unrecognized',label);
 }
 assert.match(backend,/classifyV5gWorker\(worker\.label/);
 assert.match(backend,/newMovieProductionMode:route\.productionMode/);
});
test('historical INT project policies are immutably pinned to their ORIGINAL digest job',()=>{
 // Changing routing must NEVER rewrite a 2026-11 legacy INT movie.
 assert.match(backend,/const grounded=permanentDeep&&prompt\.includes\(V5G_MARKER\)/);
 assert.match(backend,/stages:grounded\?V5G_STEPS:permanentDeep\?PERMANENT_DEEP_STEPS/);
 assert.match(backend,/const policyPrompt=\x60\$\{experiment\?EXPERIMENT_JOB_MARKER:PERMANENT_DEEP_MARKER\}/);
 assert.match(backend,/grounded\?' '\+V5G_MARKER:''/);
 assert.match(backend,/worker_id=\? AND status='working'/);
 assert.match(backend,/Cross-worker task access forbidden/);
 assert.match(backend,/This movie belongs to a different worker/);
});
test('Android new-movie selector explains INT parity instead of obsolete legacy instructions',()=>{
 const app=readFileSync(new URL('../../../app/src/main/java/com/cinepulse/mobile/MainActivity.java',import.meta.url),'utf8');
 assert.match(app,/Both configured workers, Muse Worker 1 and INT, use the same V5-G grounded 15-stage pipeline/);
 assert.doesNotMatch(app,/INT for the earlier V5 workflow/);
 assert.match(app,/expectedMode\.equals\(returnedMode\)/);
 assert.match(app,/isGrounded\?15:12/);
});
