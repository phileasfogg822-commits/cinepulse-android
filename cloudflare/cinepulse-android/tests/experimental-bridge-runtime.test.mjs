import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperimentIndex,storeExperimentAsset,validateSceneIntelligenceOutput,experimentR2Key,EXPERIMENT_ASSET_NAMES} from '../src/experimental-bridge-runtime.mjs';
import {EXPERIMENT_JOB_MARKER,EXPERIMENT_JOB_STAGES,experimentalQueuePrompt} from '../src/experimental-muse-instructions.mjs';
import {readFileSync} from 'node:fs';
const id='8f316f25-b0e1-4387-a771-e507cc1b14bb';
const hash='a'.repeat(64);
const srt='1\n00:00:01,000 --> 00:00:02,300\nPeter goes into the garden.\n\n2\n00:00:02,500 --> 00:00:03,800\nMcGregor watches the garden.';

test('experiment is explicitly opt-in and retains one existing Muse worker lifecycle',()=>{
 assert.ok(EXPERIMENT_JOB_MARKER.startsWith('[CINEPULSE-EXPERIMENTAL'));
 assert.deepEqual(EXPERIMENT_JOB_STAGES.slice(0,3),['digest','scene_intelligence','narration_english']);
 assert.deepEqual(EXPERIMENT_JOB_STAGES.slice(-3),['scene_matching','cut_plan','windows_project']);
 assert.ok(EXPERIMENT_JOB_STAGES.indexOf('scene_matching')>EXPERIMENT_JOB_STAGES.indexOf('srt_urdu'));
 assert.equal(EXPERIMENT_JOB_STAGES.filter(x=>x==='scene_matching').length,1);
});
test('experimental Muse stage uses original SRT and independently reasons about both narration languages',()=>{
 const args={projectId:id,sourceSrtSha256:hash};
 const prompt=experimentalQueuePrompt('scene_matching',args);
 assert.match(prompt,/EVERY English narration beat/);
 assert.match(prompt,/Do NOT inherit English cuts/);
 assert.match(prompt,/saved experiment scene index/);
 assert.match(experimentalQueuePrompt('scene_intelligence',args),/upload the actual binary/);
});
test('scene evidence stage rejects source events without grounded original cue IDs',()=>{
 assert.deepEqual(validateSceneIntelligenceOutput(JSON.stringify({events:[{cueStart:1,cueEnd:2,event:'Peter enters garden',evidence:'Cue 1: Peter goes into the garden'}]})).events.length,1);
 assert.throws(()=>validateSceneIntelligenceOutput({events:[{cueStart:0,cueEnd:2,event:'claim',evidence:'x'}]}),/evidence/);
 assert.throws(()=>validateSceneIntelligenceOutput({events:[]}),/nonempty/);
});
test('source SRT evidence uses project-scoped R2 prefix and isolated D1 table names',async()=>{
 const keys=[],sqls=[];
 const env={FILES:{async put(key,bytes){keys.push(key);assert.ok(bytes.byteLength>0);}},
  DB:{
   prepare(sql){sqls.push(sql);return {bind(){return this;},async run(){return {success:true};},async first(){return null;}};},
   async batch(stmts){return stmts.map(()=>({success:true}));}
  }};
 const result=await createExperimentIndex(env,{projectId:id,title:'Peter Rabbit (2018)',sourceSrt:srt});
 assert.equal(result.sourceCueCount,2);
 assert.ok(result.indexedWindows>0);
 assert.equal(keys[0],experimentR2Key(id,'scene-evidence-v1.json'));
 assert.ok(sqls.some(s=>s.includes('experimental_scene_windows')));
 assert.ok(sqls.some(s=>s.includes('experimental_scene_indexes')));
 assert.ok(sqls.every(s=>!/^\s*(?:DELETE|UPDATE|ALTER|DROP)\s+(?:TABLE\s+)?(?:projects|assets|jobs)\b/i.test(s)));
});
test('SQLite upload rejects forged header before any R2 write',async()=>{
 const env={DB:{prepare(){return {async run(){return {}},bind(){return this;},async first(){return null;}};}},FILES:{async put(){throw Error('should not store invalid SQLite')}}};
 await assert.rejects(()=>storeExperimentAsset(env,{projectId:id,kind:'scene_index_sqlite',bytes:new TextEncoder().encode('not a database')}),/SQLite/);
});
test('11-file policy keeps the 8 stable kinds and adds only three experimental files',()=>{
 assert.deepEqual(Object.keys(EXPERIMENT_ASSET_NAMES).sort(),
  ['scene_index_sqlite','english_final_cuts','urdu_final_cuts'].sort());
 const app=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(app,/productionMode==='scene_intelligence_experiment'/);
 assert.match(app,/policy\.experiment\?EXPERIMENT_JOB_STAGES/);
 assert.match(app,/format==='windows_experiment'/);
 assert.match(app,/windowsAssets:experiment\?11:8/);
 assert.match(app,/createExperimentIndex\(env/);
 assert.match(app,/if\(kind==='scene_index_sqlite'\)/);
 assert.match(app,/if\(policy\.experiment\)/);
});
