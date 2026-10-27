import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSE_V4_MARKER,MUSE_V4_STAGES,MUSE_V4_PROJECT_SCHEMA,museStageInstructions,verifyMuseWindowsProject } from '../src/muse-production-contract.mjs';
import { buildWindowsProject } from '../src/windows-export.mjs';
import { validateFinalCutPlan } from '../src/longform-policy.mjs';

const fmt=x=>{
  const ms=Math.round(x*1000);
  return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(n=>String(n).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');
};
const srt=(dur,items)=>Array.from({length:items},(_,i)=>(i+1)+'\n'+fmt(i*dur/items)+' --> '+fmt((i+1)*dur/items)+'\nReal measured speech '+i+'\n').join('\n');
const stamp=x=>fmt(x).replace(',','.');
const fixture=()=>{
  const projectId='123e4567-e89b-42d3-a456-426614174001';
  const title='A Minecraft Movie (2025)';
  const sourceSrt=srt(3800,760),enSrt=srt(60,12),urSrt=srt(65,13);
  const cutPlan=['english','urdu'].flatMap((language)=>{
    const size=language==='english'?12:13;
    return Array.from({length:size},(_,i)=>({
      language,sourceStartSeconds:language==='english'?125+i*8:125+i*8,
      sourceEndSeconds:language==='english'?130+i*8:130+i*8,
      narrationStartSeconds:i*5,narrationEndSeconds:(i+1)*5,
      confidence:0.9
    }));
  });
  const digest='An original, grounded and complete film plot digest.';
  const narrations={english:'English narration of the entire movie scene.',
    urdu:'یہ فلم کی مکمل اردو وضاحت اور کہانی ہے۔'};
  const metadata={description:'A well-developed cinematic movie recap about the characters and events.',
    keywords:['cinema','movie recap'],hashtags:['#CinePulse']};
  const mp3Manifest={
    english:{filename:'CinePulse_English.mp3',sha256:'a'.repeat(64),bytes:300000},
    urdu:{filename:'CinePulse_Urdu.mp3',sha256:'b'.repeat(64),bytes:400000}
  };
  const project={id:projectId,title};
  const narrationSrts={english:enSrt,urdu:urSrt};
  const metrics=validateFinalCutPlan(cutPlan,{sourceSrt,englishSrt:enSrt,urduSrt:urSrt});
  // This fixture imitates a valid response that Muse could author. The legacy
  // builder is used HERE IN TESTS to ensure compatibility, NOT in V4 production.
  const mockMuseResponse=buildWindowsProject({
    project,sourceSrt,digest,narrations,narrationSrts,cuts:cutPlan,
    metadata,mp3s:mp3Manifest,metrics
  });
  mockMuseResponse.cloudImport.schema=MUSE_V4_PROJECT_SCHEMA;
  return {projectId,title,sourceSrt,digest,narrations,narrationSrts,
    cutPlan,metadata,mp3Manifest,mockMuseResponse};
};
function approved(f){
  const {projectId,title,sourceSrt,digest,narrations,narrationSrts,cutPlan,metadata,mp3Manifest}=f;
  return {projectId,title,sourceSrt,digest,narrations,narrationSrts,cutPlan,metadata,mp3Manifest};
}
test('every movie stage gives Muse movie title, UUID, full rules and never authorizes Shorts',()=>{
  assert.equal(MUSE_V4_STAGES.at(-2),'cut_plan');
  assert.equal(MUSE_V4_STAGES.at(-1),'windows_project');
  for(const step of MUSE_V4_STAGES){
    const p=museStageInstructions(step,{movieTitle:'Minecraft Movie (2025)',
      projectId:'123e4567-e89b-42d3-a456-426614174001',targetMinutes:9});
    assert.match(p,/Minecraft Movie \(2025\)/);
    assert.match(p,/123e4567-e89b-42d3-a456-426614174001/);
    assert.match(p,/3–6|3.000 to 6.000/);
    assert.match(p,/Muse makes the reasoning/);
    assert.match(p,/Shorts\/virals DISABLED/);
    assert.match(p,/CURRENT STEP:/);
  }
  assert.match(museStageInstructions('cut_plan',{movieTitle:'Film',projectId:'uuid',targetMinutes:9}),/YOU search other unused source-SRT intervals/);
  assert.match(museStageInstructions('windows_project',{movieTitle:'Film',projectId:'uuid',targetMinutes:9}),/MUSE MUST AUTHOR/);
  assert.ok(MUSE_V4_MARKER.includes('MUSE-OWNS-EDITS'));
});
test('Muse-authored complete Windows ProjectState passes strict read-only validation',()=>{
  const f=fixture();
  assert.strictEqual(verifyMuseWindowsProject(f.mockMuseResponse,approved(f)),f.mockMuseResponse);
  assert.equal(f.mockMuseResponse.tracks.english.cuts.length,12);
  assert.equal(f.mockMuseResponse.tracks.hindiUrdu.cuts.length,13);
});
test('rejects Muse project that reuses or silently shifts one movie interval',()=>{
  const f=fixture();
  f.mockMuseResponse.tracks.hindiUrdu.cuts[11].movieStart=stamp(999);
  assert.throws(()=>verifyMuseWindowsProject(f.mockMuseResponse,approved(f)),/shot .* differs/);
});
test('rejects Muse JSON for wrong movie or incomplete source subtitles',()=>{
  let f=fixture();
  f.mockMuseResponse.cloudImport.cloudProjectId='other-project-uuid';
  assert.throws(()=>verifyMuseWindowsProject(f.mockMuseResponse,approved(f)),/UUID/);
  f=fixture();
  f.mockMuseResponse.sourceFiles[0].text=f.sourceSrt.slice(0,-20);
  assert.throws(()=>verifyMuseWindowsProject(f.mockMuseResponse,approved(f)),/unmodified original/);
});
test('rejects viral output and MP3 manifest substitution',()=>{
  let f=fixture();
  f.mockMuseResponse.analysis.viralClips.push({title:'short'});
  assert.throws(()=>verifyMuseWindowsProject(f.mockMuseResponse,approved(f)),/exclude Shorts/);
  f=fixture();
  f.mockMuseResponse.cloudImport.mp3s.urdu.bytes=1;
  assert.throws(()=>verifyMuseWindowsProject(f.mockMuseResponse,approved(f)),/hash\/size mismatch/);
});
test('rejects incomplete Muse SRT timeline and changed English narration',()=>{
  let f=fixture();
  f.mockMuseResponse.tracks.english.segments.pop();
  assert.throws(()=>verifyMuseWindowsProject(f.mockMuseResponse,approved(f)),/segments do not cover/);
  f=fixture();
  f.mockMuseResponse.analysis.narrations.english='Changed';
  assert.throws(()=>verifyMuseWindowsProject(f.mockMuseResponse,approved(f)),/scripts\/digest/);
});
