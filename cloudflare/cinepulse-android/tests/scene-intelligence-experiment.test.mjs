import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOriginalSrt, buildSceneEvidenceIndex, retrieveSceneCandidates,
  validateExperimentPackage, EXPERIMENT_MODE
} from '../src/scene-intelligence-experiment.mjs';

const originalSrt = [
  '1\n00:00:01,000 --> 00:00:02,200\nPeter goes into the garden.',
  '2\n00:00:02,250 --> 00:00:03,900\nMcGregor watches the vegetables.',
  '3\n00:00:04,000 --> 00:00:05,000\nBirds sing at the fence.',
  '4\n00:00:05,200 --> 00:00:06,500\nPeter hears McGregor.',
].join('\n\n');
const id='peter-rabbit-experiment-2026';
const h='a'.repeat(64);
function manifest(){
  const kinds=[
    'windows_project_json','source_srt','english_mp3','urdu_mp3',
    'english_srt','urdu_srt','english_narration','urdu_narration',
    'scene_index_sqlite','english_final_cuts','urdu_final_cuts'
  ];
  return {schema:'cinepulse.experimental-package.v1', mode:EXPERIMENT_MODE,
    projectId:id,sourceSrtSha256:h,
    assets:kinds.map(kind=>({kind,key:'experiments/'+id+'/package/'+kind+'.bin',sha256:h,bytes:123}))};
}

test('original subtitle parser keeps true source timecodes', ()=>{
 const cues=parseOriginalSrt(originalSrt);
 assert.equal(cues.length,4);
 assert.equal(cues[0].startMs,1000);
 assert.equal(cues[1].endMs,3900);
 assert.match(cues[3].text,/Peter/);
});
test('digest-time evidence index is isolated and explicitly not visually verified',async()=>{
 const index=await buildSceneEvidenceIndex({projectId:id,title:'Peter Rabbit (2018)',sourceSrt:originalSrt,maxCues:2,stride:1});
 assert.equal(index.sourceCueCount,4);
 assert.equal(index.windows.length,4);
 assert.match(index.sourceSrtSha256,/^[a-f0-9]{64}$/);
 assert.equal(index.windows[0].sourceStartMs,1000);
 assert.equal(index.windows[0].visualVerified,false);
 assert.equal(index.visualVerified,false);
});
test('candidate retrieval finds relevant evidence but never approves scene cuts',async()=>{
 const idx=await buildSceneEvidenceIndex({projectId:id,title:'Peter Rabbit',sourceSrt:originalSrt,maxCues:1,stride:1});
 const results=retrieveSceneCandidates(idx,'Peter goes to garden',2);
 assert.equal(results[0].windowId,'srt-00001');
 assert.equal(results[0].visualVerified,false);
 assert.ok(!('cuts' in results[0]));
});
test('rejects malformed source SRT rather than guessing timestamps',()=>{
 assert.throws(()=>parseOriginalSrt('1\n00:00:03,000 --> 00:00:02,000\nNo'),/invalid chronological/);
 assert.throws(()=>parseOriginalSrt('1\nwrong\nNo'),/without timecodes/);
});
test('download manifest accepts only complete isolated experiment assets',()=>{
 assert.equal(validateExperimentPackage(manifest()),true);
 const wrong=manifest();wrong.assets[0].key='experiments/other-project/private.bin';
 assert.throws(()=>validateExperimentPackage(wrong),/Unsafe asset/);
 const missing=manifest();missing.assets.pop();
 assert.throws(()=>validateExperimentPackage(missing),/Missing urdu_final_cuts/);
 const dup=manifest();dup.assets.push({...dup.assets[0]});
 assert.throws(()=>validateExperimentPackage(dup),/duplicate/);
});
test('stable pipeline cannot be mistaken for experimental mode',()=>{
 const stable=manifest();stable.mode='stable';
 assert.throws(()=>validateExperimentPackage(stable),/Not a valid experimental/);
});
