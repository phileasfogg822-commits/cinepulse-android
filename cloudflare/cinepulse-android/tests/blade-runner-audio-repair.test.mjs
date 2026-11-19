import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {
 BR_PROJECT,BR_WORKER,BR_FAILED_SRT,BR_ORIGINAL_SHA,BR_ORIGINAL_BYTES,
 BR_AUDIO_REPAIR_BUILD,BR_REPAIR_MARKER,BR_RETRY_SRT_MARKER,
 BR_REPAIR_PROMPT,BR_NEW_SRT_PROMPT,
 BR_ENQUEUE_SQL,BR_PROJECT_RESUME_SQL,BR_PROMOTE_ASSET_SQL,BR_ACCEPT_JOB_SQL,BR_ENQUEUE_SRT_SQL,
 inspectBladeRunnerAudioRepair,isBladeRunnerAudioRepairJob,
 validateBladeRunnerAudioReceipt,queueBladeRunnerAudioRepair,
 promoteBladeRunnerAudioRepair,stagedBladeRunnerAudioKey
} from '../src/blade-runner-audio-repair.mjs';
const now=1795140000;
const origKey=`projects/${BR_PROJECT}/english_mp3`;
const repairId='ae06c072-1152-46d8-aa58-6670d0ae0bb1';
const srtId='c782218f-a68e-4c0f-8bad-c2c4a5bff7e8';
const receiptHash='a'.repeat(64), approvedHash='b'.repeat(64), lease='repair-lease-opaque';
const transcript='In Las Vegas, K encounters Deckard, whose dog has stayed with him through the ruins. Sometimes, to love someone, you gotta be a stranger. He also hears Deckard explain the difference between a name and a serial number. The full passage now follows the approved story and leads naturally into the next scene.';
function receipt(){
 return {kind:'english_audio_region_repair',
  originalSha256:BR_ORIGINAL_SHA,repairedSha256:receiptHash,repairedBytes:4850000,
  approvedTextSha256:approvedHash,region:{startSeconds:353,endSeconds:441},
  qa:{changedTtsChunking:true,fullFileScriptAligned:true,joinsAudiblyClean:true,
   outsideSpeechPreserved:true,missingLineRestored:true,alienLoopAbsent:true,
   independentStt:[
    {model:'tiny.en',transcript,requestId:'first-stt-ref-001'},
    {model:'base',transcript,requestId:'second-stt-ref-002'}
   ]}};
}
const initial=[
 ['digest','done','job-digest',1,'[CINEPULSE-V5G-GROUNDED-SRT-ONLY]','approved-digest'],
 ['grounded_evidence','done','job-evidence',2,'','accepted-48-source-beats'],
 ['narration_english','done','job-en',3,'','approved-english-script'],
 ['narration_urdu','done','job-ur',4,'','approved-urdu-script'],
 ['grounded_preflight','done','job-preflight',5,'','reviewed-narration-units'],
 ['publishing_metadata','done','job-metadata',6,'','accepted-metadata'],
 ['mp3_english','done','job-old-mp3',7,'','original-tts-output'],
 ['srt_english','error',BR_FAILED_SRT,8,'V5.4 AUDIO QA FAIL','']
];
function fixture(change=()=>{}){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,worker_id TEXT,status TEXT,expires_at INTEGER,updated_at INTEGER);
 CREATE TABLE workers(id TEXT PRIMARY KEY,enabled INTEGER,paused INTEGER);
 CREATE TABLE cinepulse_movie_controls(project_id TEXT PRIMARY KEY,paused INTEGER,stopped INTEGER);
 CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,worker_id TEXT,step_id TEXT,status TEXT,
 prompt TEXT,created_at INTEGER,output TEXT,lease TEXT,lease_until INTEGER,finished_at INTEGER);
 CREATE TABLE assets(project_id TEXT NOT NULL,kind TEXT NOT NULL,r2_key TEXT NOT NULL,
 bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,kind));`);
 db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(BR_PROJECT,BR_WORKER,'needs_review',null,1);
 db.prepare('INSERT INTO workers VALUES(?,?,?)').run(BR_WORKER,1,0);
 db.prepare('INSERT INTO cinepulse_movie_controls VALUES(?,?,?)').run(BR_PROJECT,0,0);
 const q=db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 for(const [step,status,id,created,prompt,output] of initial)
  q.run(id,BR_PROJECT,BR_WORKER,step,status,prompt,created,output,null,null,null);
 db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?)').run(
  BR_PROJECT,'english_mp3',origKey,BR_ORIGINAL_BYTES,BR_ORIGINAL_SHA,7);
 change(db);
 const env={DB:{
  prepare(sql){return{bind(...args){const p=db.prepare(sql);return {
   first:async()=>p.get(...args)||null,
   all:async()=>({results:p.all(...args)}),
   run:async()=>({meta:{changes:p.run(...args).changes}})
  }}}},
  async batch(statements){db.exec('BEGIN');try{const result=[];
   for(const s of statements)result.push(await s.run());
   db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error}}
 }};
 const jobs=()=>db.prepare('SELECT rowid,* FROM jobs ORDER BY created_at ASC,rowid ASC').all();
 const inspect=()=>inspectBladeRunnerAudioRepair({
  project:{...db.prepare('SELECT * FROM projects').get(),
   control_paused:db.prepare('SELECT paused FROM cinepulse_movie_controls').get().paused,
   control_stopped:db.prepare('SELECT stopped FROM cinepulse_movie_controls').get().stopped},
  worker:db.prepare('SELECT * FROM workers').get(),
  policy:{grounded:true,experiment:false},jobs:jobs(),
  audio:db.prepare("SELECT * FROM assets WHERE kind='english_mp3'").get(),now
 });
 return {db,env,jobs,inspect,close:()=>db.close()};
}
test('Blade Runner repair is narrowly scoped to a verified, failed V5-G English SRT and unmodified original MP3',()=>{
 const f=fixture();try{
  assert.equal(f.inspect().canStart,true);
  assert.deepEqual(f.inspect().reasons,[]);
  assert.equal(stagedBladeRunnerAudioKey(repairId),
   `projects/${BR_PROJECT}/repairs/english_mp3/${repairId}.mp3`);
  assert.equal(isBladeRunnerAudioRepairJob({project_id:BR_PROJECT,step_id:'mp3_english',
   prompt:BR_REPAIR_PROMPT}),true);
  assert.equal(isBladeRunnerAudioRepairJob({project_id:BR_PROJECT,step_id:'mp3_urdu',
   prompt:BR_REPAIR_PROMPT}),false);
 }finally{f.close()}
});
test('only one English MP3 repair is queued; original accepted jobs and defective R2 pointer are untouched',async()=>{
 const f=fixture();try{
  const accepted=f.db.prepare("SELECT id,output FROM jobs WHERE status='done' ORDER BY rowid").all();
  const audio=f.db.prepare('SELECT * FROM assets').get();
  const r=await queueBladeRunnerAudioRepair(f.env,{jobId:repairId,now});
  assert.equal(r.enqueued,true);
  assert.equal(r.step,'mp3_english');
  assert.equal(f.db.prepare('SELECT status FROM projects').get().status,'processing');
  assert.deepEqual(f.db.prepare("SELECT id,output FROM jobs WHERE status='done' ORDER BY rowid").all(),accepted);
  assert.deepEqual(f.db.prepare('SELECT * FROM assets').get(),audio);
  const repeat=await queueBladeRunnerAudioRepair(f.env,{
   jobId:'7c54c5d3-b41b-4ced-b9d6-bd5f2616a5b8',now:now+1});
  assert.equal(repeat.idempotent,true);
  assert.equal(repeat.jobId,repairId);
 }finally{f.close()}
});
test('atomic repair promotion switches only the English MP3 pointer and queues fresh SRT, preserves all earlier job outputs',async()=>{
 const f=fixture();try{
  await queueBladeRunnerAudioRepair(f.env,{jobId:repairId,now});
  f.db.prepare('UPDATE jobs SET status=?,lease=?,lease_until=? WHERE id=?')
   .run('working',lease,now+600,repairId);
  const before=f.db.prepare("SELECT id,output FROM jobs WHERE id NOT IN (?,?) ORDER BY rowid")
   .all(repairId,srtId);
  const output=receipt();
  const r=await promoteBladeRunnerAudioRepair(f.env,{
   job:{id:repairId,project_id:BR_PROJECT,worker_id:BR_WORKER,
    step_id:'mp3_english',prompt:BR_REPAIR_PROMPT,status:'working',
    lease,lease_until:now+600},
   lease,output,stagedHash:receiptHash,stagedBytes:4850000,
   approvedTextHash:approvedHash,originalNarration:'Canonical approved English narration',
   now:now+2,newSrtJobId:srtId
  });
  assert.equal(r.nextStep,'srt_english');
  assert.equal(r.originalMp3StillInR2,true);
  assert.deepEqual(f.db.prepare("SELECT id,output FROM jobs WHERE id NOT IN (?,?) ORDER BY rowid")
   .all(repairId,srtId),before);
  const a=f.db.prepare("SELECT * FROM assets WHERE kind='english_mp3'").get();
  assert.equal(a.sha256,receiptHash);
  assert.equal(a.r2_key,stagedBladeRunnerAudioKey(repairId));
  assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(repairId).status,'done');
  assert.equal(f.db.prepare('SELECT step_id,status,prompt FROM jobs WHERE id=?').get(srtId).status,'queued');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE step_id='srt_english'").get().n,2);
  assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(BR_FAILED_SRT).status,'error');
 }finally{f.close()}
});
test('receipt rejects unchanged original, incorrect hash, absent required line, alien loop, fake/duplicate model references and absent full QA',()=>{
 const valid=receipt();
 assert.equal(validateBladeRunnerAudioReceipt(valid,{
  stagedHash:receiptHash,stagedBytes:4850000,approvedTextHash:approvedHash}).verified,true);
 const cases=[
  o=>{o.repairedSha256=BR_ORIGINAL_SHA},
  o=>{o.repairedBytes++},
  o=>{o.qa.independentStt[0].transcript='A repaired passage without the required quote '.repeat(4)},
  o=>{o.qa.independentStt[1].transcript+=
   ' It was about driving and building his own plan. And it proved the treasure does not matter.'},
  o=>{o.qa.independentStt[1].requestId=o.qa.independentStt[0].requestId},
  o=>{o.qa.changedTtsChunking=false},
  o=>{o.qa.fullFileScriptAligned=false},
  o=>{o.qa.outsideSpeechPreserved=false},
  o=>{o.region.startSeconds=400}
 ];
 for(const mutate of cases){const bad=structuredClone(valid);mutate(bad);
  assert.throws(()=>validateBladeRunnerAudioReceipt(bad,{
    stagedHash:receiptHash,stagedBytes:4850000,approvedTextHash:approvedHash}));
 }
 assert.throws(()=>validateBladeRunnerAudioReceipt(valid,{
  stagedHash:BR_ORIGINAL_SHA,stagedBytes:4850000,approvedTextHash:approvedHash}),/mismatch/);
});
test('D1 requeue refuses changed/expired MP3, unrelated active job, wrong status, stale failed SRT, paused worker or completed Urdu work',async()=>{
 const scenarios=[
  ['wrong_status',db=>db.exec("UPDATE projects SET status='ready'")],
  ['worker_paused',db=>db.exec("UPDATE workers SET paused=1")],
  ['movie_paused',db=>db.exec("UPDATE cinepulse_movie_controls SET paused=1")],
  ['movie_stopped',db=>db.exec("UPDATE cinepulse_movie_controls SET stopped=1")],
  ['expired',db=>db.exec("UPDATE projects SET expires_at=10")],
  ['wrong_MP3',db=>db.exec("UPDATE assets SET sha256='other' WHERE kind='english_mp3'")],
  ['missing_bad_job',db=>db.prepare('UPDATE jobs SET status=? WHERE id=?').run('done',BR_FAILED_SRT)],
  ['active_lease',db=>db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    'other',BR_PROJECT,BR_WORKER,'other','working','',9,'',null,null,null)],
  ['urdu_started',db=>db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    'other',BR_PROJECT,BR_WORKER,'mp3_urdu','done','',9,'',null,null,null)]
 ];
 for(const [label,mutation] of scenarios){
  const f=fixture(mutation);try{
   const r=await queueBladeRunnerAudioRepair(f.env,{jobId:repairId,now});
   assert.equal(r.enqueued,false,label);
   assert.equal(f.db.prepare('SELECT id FROM jobs WHERE id=?').get(repairId),undefined,label);
  }finally{f.close()}
 }
});
test('repair promotion rejects stale lease without changing pointer or starting SRT',async()=>{
 const f=fixture();try{
  await queueBladeRunnerAudioRepair(f.env,{jobId:repairId,now});
  f.db.prepare('UPDATE jobs SET status=?,lease=?,lease_until=? WHERE id=?')
   .run('working','DIFFERENT',now+100,repairId);
  await assert.rejects(()=>promoteBladeRunnerAudioRepair(f.env,{
   job:{id:repairId,project_id:BR_PROJECT,worker_id:BR_WORKER,
    step_id:'mp3_english',prompt:BR_REPAIR_PROMPT,status:'working',
    lease,lease_until:now+100},
   lease,output:receipt(),stagedHash:receiptHash,stagedBytes:4850000,
   approvedTextHash:approvedHash,originalNarration:'Approved',
   now,newSrtJobId:srtId
  }));
  assert.equal(f.db.prepare("SELECT sha256 FROM assets WHERE kind='english_mp3'").get().sha256,
   BR_ORIGINAL_SHA);
  assert.equal(f.db.prepare('SELECT id FROM jobs WHERE id=?').get(srtId),undefined);
 }finally{f.close()}
});
test('backend routes and health advertise scoped MP3 repair; previous audio checks, original STT QA and admin auth stay intact',async()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/action==='audio\/english-loop-repair'&&method==='POST'/);
 assert.match(src,/stageBladeRunnerAudioUpload\(/);
 assert.match(src,/acceptBladeRunnerAudioResult\(/);
 assert.match(src,/promoteBladeRunnerAudioRepair\(/);
 assert.match(src,/validateMeasuredSubtitleQuality\(/);
 assert.match(src,/validateNarrationScriptCap\(/);
 assert.match(src,/BR_AUDIO_REPAIR_BUILD/);
 assert.match(src,/includes\(BR_RETRY_SRT_MARKER\)/);
 assert.match(src,/audio\?\.sha256===BR_ORIGINAL_SHA&&state\.step==='srt_english'/);
 assert.match(BR_NEW_SRT_PROMPT,/V5\.4/);

 assert.ok(src.indexOf('await administrator(request,env)')<
  src.indexOf("action==='audio/english-loop-repair'&&method==='POST'"));
 for(const sql of [BR_ENQUEUE_SQL,BR_PROJECT_RESUME_SQL,
  BR_PROMOTE_ASSET_SQL,BR_ACCEPT_JOB_SQL,BR_ENQUEUE_SRT_SQL])
  assert.doesNotMatch(sql,/\bLIKE\b|\bGLOB\b/i);
 const worker=(await import('../src/index.mjs')).default;
 const env={DB:{},FILES:{},ADMIN_TOKEN:'a'.repeat(40),
  DOWNLOAD_SIGNING_KEY:'0'.repeat(64)};
 const response=await worker.fetch(new Request('https://example.org/health'),env,{});
 assert.equal(response.status,200);
 const json=await response.json();
 assert.equal(json.policy.bladeRunnerAudioRepairBuild,BR_AUDIO_REPAIR_BUILD);
});
