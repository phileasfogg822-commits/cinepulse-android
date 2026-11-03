import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneLabV4Package,parseMeasuredCues} from '../src/scene-lab-package.mjs';
const parent='81febfe9-bcf4-4a96-ab4c-2a9226503ea1',child='7d424950-e2e1-4533-954c-e97cfe64a921',worker='a4350f48-2f4d-4c76-bb9e-e554e1ac00eb';
const sourceSrt='1\n00:00:00,000 --> 01:00:00,000\nPeter and his sisters in the garden\n';
const base={id:parent,projectId:parent,title:'Peter Rabbit (2018)',sourceFiles:[{name:'CinePulse_Source.srt',text:sourceSrt,cues:[]}],
 analysis:{narrations:{english:'Original full narration',hindiUrdu:'Original Urdu narration'},viralClips:[1],shorts:[1],viralMoments:[1]},
 tracks:{english:{status:'ready'},hindiUrdu:{status:'ready'}},pipeline:{},qualityWarnings:[],
 cloudImport:{schema:'cinepulse.windows-muse.v4',cloudProjectId:parent,longVideoCount:2}};
const manifest={mode:'scene_matching_lab',language:'english',parentProjectId:parent,strategy:'classic_reconstruction',
 excerpts:[0,1,2,3].map(i=>({startSeconds:i*90,endSeconds:i*90+75}))};
const englishCues=manifest.excerpts.map((e,i)=>({startSeconds:e.startSeconds,endSeconds:e.endSeconds,text:'Peter '+i}));
const cuts=(n,step=5)=>Array.from({length:n},(_,i)=>({narrationStartSeconds:i*step,narrationEndSeconds:(i+1)*step,sourceStartSeconds:100+i*10,sourceEndSeconds:105+i*10,confidence:0.83,sourceEvidence:'original cue '+(i+1)}));
const urduSrt=Array.from({length:6},(_,i)=>`${i+1}\n00:00:${String(i*5).padStart(2,'0')},000 --> 00:00:${String((i+1)*5).padStart(2,'0')},000\nUrdu ${i}\n`).join('\n');
const mp3s={english:{bytes:600001,sha256:'a'.repeat(64),filename:'CinePulse_English.mp3'},urdu:{bytes:60001,sha256:'b'.repeat(64),filename:'CinePulse_Urdu.mp3'}};
const args={manifest,baselineProject:base,sourceSrt,projectId:child,workerId:worker,
 narrations:{english:'Peter excerpt narration',urdu:'Urdu excerpt narration'},
 englishCues,englishCuts:cuts(60),urduCuts:cuts(6),urduSrt,
 englishAudio:{bytes:600001,durationSeconds:300},urduAudio:{bytes:60001,durationSeconds:30},mp3s};
test('V4 Scene Lab export preserves parent and correct independent durations',()=>{
 const pkg=buildSceneLabV4Package(args);
 assert.equal(pkg.project.cloudImport.schema,'cinepulse.windows-muse.v4');
 assert.equal(pkg.project.cloudImport.cloudProjectId,child);
 assert.equal(pkg.project.cloudImport.sceneLab.parentProjectId,parent);
 assert.equal(pkg.project.tracks.english.audioDurationSeconds,300);
 assert.equal(pkg.project.tracks.hindiUrdu.audioDurationSeconds,30);
 assert.equal(pkg.project.tracks.english.cuts.length,60);
 assert.equal(pkg.project.tracks.hindiUrdu.cuts.length,6);
 assert.equal(pkg.project.analysis.shorts.length,0);
 assert.equal(base.cloudImport.cloudProjectId,parent); // the original cannot be mutated
 assert.equal(parseMeasuredCues(pkg.files['CinePulse_English.srt']).length,4);
 assert.equal(parseMeasuredCues(pkg.files['CinePulse_Urdu.srt']).length,6);
 assert.ok(pkg.files['CinePulse_Project.json'].includes('cinepulse.windows-muse.v4'));
});
test('V4 exporter refuses incorrect physical upload receipts',()=>{
 assert.throws(()=>buildSceneLabV4Package({...args,englishAudio:{bytes:1,durationSeconds:300}}),/upload receipt mismatch/);
});
test('V4 exporter refuses altered original source and wrong baseline parent',()=>{
 assert.throws(()=>buildSceneLabV4Package({...args,sourceSrt:'other'}),/source SRT mismatch/);
 assert.throws(()=>buildSceneLabV4Package({...args,baselineProject:{...base,cloudImport:{...base.cloudImport,cloudProjectId:child}}}),/Original project ID mismatch/);
});
test('V4 exporter refuses unverified incomplete or overlapping cuts',()=>{
 assert.throws(()=>buildSceneLabV4Package({...args,englishCuts:cuts(59)}),/Narration not fully covered/);
 const bad=cuts(60);bad[5].sourceStartSeconds=bad[4].sourceStartSeconds;
 assert.throws(()=>buildSceneLabV4Package({...args,englishCuts:bad}),/Reused or overlapping source footage/);
});
