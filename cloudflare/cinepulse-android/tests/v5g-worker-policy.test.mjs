import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectV5gWorkflow,classifyV5gWorker,V5G_STEPS,V5G_MARKER} from '../src/v5g-production-gate.mjs';
const backend=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
test('Worker 1 routes exclusively to new source-grounded V5-G pipeline',()=>{
 for(const label of ['Worker 1','worker1','WORKER-1','Worker_1','News Worker 1','Muse Worker #1','CinePulse Worker One'])
  assert.equal(selectV5gWorkflow(label),true,label);
 assert.ok(V5G_STEPS.includes('grounded_evidence'));
 assert.ok(V5G_MARKER);
});
test('INT, unknown workers and existing labels stay on the original production pipeline',()=>{
 for(const label of ['INT','int','Worker 2','legacy',null,''])
  assert.equal(selectV5gWorkflow(label),false,String(label));
});
test('emergency safe-disable restores original V5 pipeline for Worker 1',()=>{
 assert.equal(selectV5gWorkflow('Worker 1',{disabled:true}),false);
 assert.equal(selectV5gWorkflow('INT',{disabled:true}),false);
});
test('worker routing is based on database worker.label after worker auth, not user query switch',()=>{
 assert.match(backend,/SELECT \* FROM workers WHERE id=\? AND enabled=1/);
 assert.match(backend,/selectV5gWorkflow\(worker\.label,\{disabled:env\.CINEPULSE_V5G_DISABLED==='true'\}\)/);
 assert.match(backend,/body\.v5Grounded!==undefined && body\.v5Grounded!==grounded/);
 assert.match(backend,/stages:grounded\?V5G_STEPS:permanentDeep\?PERMANENT_DEEP_STEPS/);
});

test('health advertises Worker 1-only V5-G and unchanged INT, never misleads about default worker routes',()=>{
 assert.match(backend,/v5gWorker1Only:true,v5gLegacyIntPreserved:true,v5gAcceptingNewProjects:env\.CINEPULSE_V5G_DISABLED!=='true',v5gLiveStageCount:V5G_STEPS\.length/);
});

test('guarded production smoke checks Worker 1/INT V5-G markers in a single valid jq expression',()=>{
 const workflow=readFileSync(new URL('../../../.github/workflows/cinepulse-v3828-production-gated-promotion.yml',import.meta.url),'utf8');
 assert.match(workflow,/\.policy\.v5gWorker1Only==true and \.policy\.v5gLegacyIntPreserved==true and \.policy\.v5gLiveStageCount==15' \/tmp\/cp-after-health\.json/);
});

test('no silent downgrade of Worker 1 into INT legacy if routing is disabled or label is unknown',()=>{
 assert.equal(classifyV5gWorker('News Worker 1').productionMode,'v5_grounded_srt_only');
 assert.equal(classifyV5gWorker('INT').productionMode,'stable');
 assert.equal(classifyV5gWorker('News Worker 1',{disabled:true}).kind,'v5g_disabled');
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
