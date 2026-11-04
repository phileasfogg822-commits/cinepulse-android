import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const backend=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
const android=readFileSync(new URL('../../../app/src/main/java/com/cinepulse/mobile/MainActivity.java',import.meta.url),'utf8');
test('standard movie creation uses V5 marker while historical project prompts keep V4/V3 policy',()=>{
 assert.match(backend,/const permanentDeep=prompt\.startsWith\(PERMANENT_DEEP_MARKER\)/);
 assert.match(backend,/stages:permanentDeep\?PERMANENT_DEEP_STEPS/);
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
 assert.match(android,/MODE: STANDARD — MUSE DEEP SCENE MATCHING/);
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
