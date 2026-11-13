import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const backend=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const android=readFileSync(new URL('../../../app/src/main/java/com/cinepulse/mobile/MainActivity.java',import.meta.url),'utf8');
test('standard movie creation uses V5 marker while historical project prompts keep V4/V3 policy',()=>{
 assert.match(backend,/const permanentDeep=prompt\.startsWith\(PERMANENT_DEEP_MARKER\)/);
 assert.match(backend,/stages:grounded\?V5G_STEPS:permanentDeep\?PERMANENT_DEEP_STEPS/);
 assert.match(backend,/const grounded=permanentDeep&&prompt\.includes\(V5G_MARKER\)/);
 assert.match(backend,/experiment\?EXPERIMENT_JOB_MARKER:PERMANENT_DEEP_MARKER/);
 assert.match(backend,/PERMANENT_DEEP_MATCH_EN/);
 assert.match(backend,/PERMANENT_DEEP_MATCH_UR/);
});
test('every newly created standard movie exposes the permanent matching contract',()=>{
 assert.match(backend,/sceneMatchingMethod:'muse_semantic_batches'/);
 assert.match(backend,/permanentDeepMuseDefault:true/);
 assert.match(backend,/productionDeepMuseBuild:PERMANENT_DEEP_BUILD/);
 assert.match(backend,/productionDeepMuseBatchSize:5/);
});
test('validated bilingual Deep Muse cut plan feeds the pre-existing byte-stable Windows V4 finalizer',()=>{
 assert.match(backend,/async function acceptPermanentDeepStage/);
 assert.match(backend,/combineProductionDeepCuts\(output\.englishCuts,output\.urduCuts/);
 assert.match(backend,/validateFinalCutPlan\(checked\.cuts/);
 assert.match(backend,/outputs\.cut_plan=JSON\.stringify\(result\.cuts\)/);
 assert.match(backend,/outputs\.scene_matching=JSON\.stringify\(\{matches:/);
 assert.match(backend,/verifyMuseWindowsProject\(produced/);
});
test('historical experiments retain read/download routes but their creation is retired',()=>{
 assert.match(backend,/if\(method==='POST'&&url\.pathname==='\/v1\/scene-lab'\)\{\s+fail\(410/);
 assert.match(backend,/if\(method==='POST'&&url\.pathname==='\/v1\/scene-lab\/deep'\)\{\s+fail\(410/);
 assert.match(backend,/if\(experiment\)fail\(410/);
 assert.match(backend,/if\(method==='GET'&&url\.pathname==='\/v1\/scene-lab'/);
 assert.match(backend,/sceneLabRow\(env,pid\)/);
});
test('new Android submission uses a single standard mode and never sets the retired experiment bit',()=>{
 assert.match(android,/api\.createProject\(title,worker,srt,48,target\)/);
 assert.match(android,/MODE: AUTOMATIC — V5-G GROUNDED \/ V5 LEGACY/);
 assert.doesNotMatch(android,/api\.createExperimentalProject\(title,worker,srt,48,target\)/);
 assert.doesNotMatch(android,/Experimental mode is required in this Preview app/);
 assert.match(android,/sceneMatchingMethod/);
});
test('admins can view deep Muse progress and resume incomplete independent batches',()=>{
 assert.match(backend,/action==='deep-muse'&&method==='GET'/);
 assert.match(backend,/action==='deep-muse\/resume'&&method==='POST'/);
 assert.match(backend,/status IN \('queued','working'\)/);
 assert.match(backend,/No duplicate queued|no duplicate queued/);
});

test('APK worker selector uses backend routing receipt, not hardcoded STANDARD label',()=>{
 assert.match(android,/newMovieProductionMode/);
 assert.match(android,/v5_grounded_srt_only/);
 assert.match(android,/routeConfirmed/);
 assert.match(android,/expectedMode\.equals\(returnedMode\)/);
 assert.match(android,/renderPipelineStagePlan\(document\)/);
});

test('Android shows real V5-G mode and all persisted production stages including source SRT intake',()=>{
 assert.match(android,/V5-G · SOURCE-GROUNDED PIPELINE/);
 assert.match(android,/CONFIRMED.*V5-G GROUNDED/);
 assert.match(android,/Original source SRT intake/);
 assert.match(android,/NOT STARTED/);
 assert.match(android,/ACTIVE QUEUE:/);
 assert.match(android,/Current \/ latest:/);
 assert.match(android,/Assigned worker:/);
 assert.match(android,/MODE: AUTOMATIC — V5-G GROUNDED \/ V5 LEGACY/);
});
