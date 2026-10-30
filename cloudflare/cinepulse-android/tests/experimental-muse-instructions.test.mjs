import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPERIMENT_STAGES,sceneIntelligenceMuseInstruction} from '../src/experimental-muse-instructions.mjs';

const context={projectId:'peter-rabbit-experiment-2026',sourceSrtSha256:'a'.repeat(64)};
test('experimental steps are separate from existing Muse V4 steps',()=>{
 assert.ok(EXPERIMENT_STAGES.includes('scene_intelligence'));
 assert.ok(EXPERIMENT_STAGES.includes('scene_matching_urdu'));
});
test('every experiment Muse instruction is fingerprinted to its own source project',()=>{
 for(const stage of ['scene_intelligence','scene_matching_english','scene_matching_urdu','cut_plan','windows_project']){
   const prompt=sceneIntelligenceMuseInstruction(stage,context);
   assert.match(prompt,/peter-rabbit-experiment-2026/);
   assert.match(prompt,/original source SRT SHA-256/);
 }
});
test('matching requires measured narration and independent language-specific decisions',()=>{
 assert.match(sceneIntelligenceMuseInstruction('scene_matching_english',context),/EVERY English narration beat/);
 assert.match(sceneIntelligenceMuseInstruction('scene_matching_urdu',context),/Do NOT inherit English cuts/);
});
test('final cuts cannot claim frame verification or use unrelated fallback',()=>{
 const result=sceneIntelligenceMuseInstruction('cut_plan',context);
 assert.match(result,/unrelated footage/);
 assert.match(result,/visual correctness/);
});
test('unknown experiment stage or missing fingerprint fails closed',()=>{
 assert.throws(()=>sceneIntelligenceMuseInstruction('fake',context),/Unsupported/);
 assert.throws(()=>sceneIntelligenceMuseInstruction('cut_plan',{projectId:context.projectId}),/fingerprint/);
});
