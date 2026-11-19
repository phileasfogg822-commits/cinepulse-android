import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
 DUNKIRK_REPAIR_BUILD,DUNKIRK_REPAIR_MARKER,DUNKIRK_REPAIR_PROJECT,
 DUNKIRK_REPAIR_WORKER,DUNKIRK_REPAIR_FAILED,DUNKIRK_REPAIR_SOURCE_SHA,
 DUNKIRK_START_SQL,DUNKIRK_URDU_SQL,DUNKIRK_PREFLIGHT_SQL,DUNKIRK_REVIEW_SQL,
 DUNKIRK_REPAIR_PROMPTS,isDunkirkNarrationRepairJob,
 validateDunkirkRepairNarrationText,inspectDunkirkNarrationRepair,
 queueDunkirkRepairStage,markDunkirkNarrationsReady
} from '../src/dunkirk-narration-repair.mjs';
const now=1795110000;
const id=DUNKIRK_REPAIR_PROJECT,wid=DUNKIRK_REPAIR_WORKER,failed=DUNKIRK_REPAIR_FAILED;
const enOld='original English narration without B22',urOld='اصل پرانی اردو کہانی';
const english='Spitfires pass over the Moonstone. Dawson calls the Spitfire the greatest plane ever built. The shell-shocked soldier is locked below deck, begging to be let out.';
const urdu='کالے میں فوج کیوں نہیں چڑھتی، پوچھتا ہے کولنز۔ سورج سے دشمن نکلے گا۔ مون اسٹون کے اوپر اسپٹ فائر آتی ہے۔ ڈاسن اسے بہترین طیارہ کہتا ہے، اور ایک سپاہی نیچے بند ہے۔ ڈچ ملاح واپس آکر کشتی کی مدد کرتا ہے۔ ووکنگ پہنچ کر فوجی اخبار پڑھنے سے ڈرتا ہے۔';
const beats=Array.from({length:48},(_,i)=>({id:'B'+String(i+1).padStart(2,'0')}));
const baseJobs=[
 ['digest','done','base-digest',1,'[CINEPULSE-V5G-GROUNDED-SRT-ONLY]','digest'],
 ['grounded_evidence','done','base-evidence',2,'','evidence'],
 ['narration_english','done','base-en',3,'',enOld],
 ['narration_urdu','done','base-ur',4,'',urOld],
 ['grounded_preflight','error',failed,5,'preflight','']
];
function fixture(update=()=>{}){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,worker_id TEXT,status TEXT,expires_at INTEGER,updated_at INTEGER);
 CREATE TABLE workers(id TEXT PRIMARY KEY,enabled INTEGER,paused INTEGER);
 CREATE TABLE cinepulse_movie_controls(project_id TEXT PRIMARY KEY,paused INTEGER,stopped INTEGER);
 CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,worker_id TEXT,
 step_id TEXT,status TEXT,prompt TEXT,created_at INTEGER,output TEXT);`);
 db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(id,wid,'needs_review',null,1);
 db.prepare('INSERT INTO workers VALUES(?,?,?)').run(wid,1,0);
 db.prepare('INSERT INTO cinepulse_movie_controls VALUES(?,?,?)').run(id,0,0);
 const job=db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)');
 for(const [stage,status,jid,created,prompt,output] of baseJobs)
  job.run(jid,id,wid,stage,status,prompt,created,output);
 update(db);
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
 const project=()=>({...db.prepare('SELECT * FROM projects').get(),
   control_paused:db.prepare('SELECT paused FROM cinepulse_movie_controls').get().paused,
   control_stopped:db.prepare('SELECT stopped FROM cinepulse_movie_controls').get().stopped});
 const worker=()=>db.prepare('SELECT * FROM workers').get();
 const inspect=()=>inspectDunkirkNarrationRepair({project:project(),worker:worker(),
  policy:{grounded:true,experiment:false},jobs:jobs(),sourceSha:DUNKIRK_REPAIR_SOURCE_SHA,
  groundedBeats:beats,hasAudio:false,now});
 return {db,env,jobs,inspect,close:()=>db.close()};
}
const uid={
 english:'cfd89fc9-b8e5-4c4f-a28c-d77a7d729d11',
 urdu:'3bd19a32-9f36-47c9-a767-4d5b01bfe672',
 preflight:'5c43290e-6240-4fd3-a95e-a65a6b4d7eca'
};
test('Dunkirk repaired narration preserves all requested scenes and strict word/language caps',()=>{
 assert.equal(validateDunkirkRepairNarrationText(english,'english',enOld).language,'english');
 assert.equal(validateDunkirkRepairNarrationText(urdu,'urdu',urOld).language,'urdu');
 assert.throws(()=>validateDunkirkRepairNarrationText(enOld,'english',enOld),/unchanged/);
 assert.throws(()=>validateDunkirkRepairNarrationText('Spitfires near Moonstone.','english',enOld),/Dawson greatest plane/);
 assert.throws(()=>validateDunkirkRepairNarrationText('صرف اردو میں ویسا ہی متن۔','urdu',urOld),/B07 Calais/);
 assert.throws(()=>validateDunkirkRepairNarrationText(urdu+' Woking','urdu',urOld),/Urdu script only/);
 assert.throws(()=>validateDunkirkRepairNarrationText((english+' ').repeat(80),'english',enOld),/1500/);
});
test('repair begins ONLY after exact failed preflight and accepted digest/evidence/narrations',async()=>{
 const f=fixture();try{
  assert.equal(f.inspect().canStart,true);
  const before=f.db.prepare("SELECT id,status,output FROM jobs WHERE status='done' ORDER BY rowid").all();
  const result=await queueDunkirkRepairStage(f.env,{
   stage:'narration_english',newJobId:uid.english,now});
  assert.equal(result.enqueued,true);
  assert.equal(f.db.prepare('SELECT status FROM projects').get().status,'processing');
  assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(uid.english).status,'queued');
  assert.deepEqual(f.db.prepare("SELECT id,status,output FROM jobs WHERE status='done' ORDER BY rowid").all(),before);
  assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(failed).status,'error');
  const duplicate=await queueDunkirkRepairStage(f.env,{
   stage:'narration_english',newJobId:'52f27a16-0395-4cc0-8f14-5d6c0e287a18',now});
  assert.equal(duplicate.idempotent,true);
  assert.equal(f.inspect().canStart,false);
 }finally{f.close()}
});
test('repair moves English -> Urdu -> needs_review -> explicit grounded preflight, no redundant jobs',async()=>{
 const f=fixture();try{
  const start=await queueDunkirkRepairStage(f.env,{stage:'narration_english',newJobId:uid.english,now});
  assert.equal(start.enqueued,true);
  let premature=await queueDunkirkRepairStage(f.env,{stage:'grounded_preflight',newJobId:uid.preflight,now:now+1});
  assert.equal(premature.enqueued,false);
  f.db.prepare("UPDATE jobs SET status='done',output=? WHERE id=?").run(english,uid.english);
  assert.equal(f.inspect().canQueueUrdu,true);
  const next=await queueDunkirkRepairStage(f.env,{stage:'narration_urdu',newJobId:uid.urdu,now:now+2});
  assert.equal(next.enqueued,true);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE step_id='grounded_preflight'").get().n,1);
  f.db.prepare("UPDATE jobs SET status='done',output=? WHERE id=?").run(urdu,uid.urdu);
  const ready=await markDunkirkNarrationsReady(f.env,now+3);
  assert.equal(ready.ready,true);
  assert.equal(f.inspect().canRetryPreflight,true);
  assert.equal(f.db.prepare('SELECT status FROM projects').get().status,'needs_review');
  const resume=await queueDunkirkRepairStage(f.env,{stage:'grounded_preflight',newJobId:uid.preflight,now:now+4});
  assert.equal(resume.enqueued,true);
  assert.equal(f.db.prepare('SELECT status FROM projects').get().status,'processing');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE step_id='grounded_preflight'").get().n,2);
  assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(failed).status,'error');
  assert.equal(f.db.prepare("SELECT output FROM jobs WHERE id='base-en'").get().output,enOld);
  assert.equal(f.db.prepare("SELECT output FROM jobs WHERE id='base-ur'").get().output,urOld);
  const latest=f.db.prepare("SELECT step_id,output FROM jobs WHERE status='done' ORDER BY created_at ASC,rowid ASC").all();
  assert.equal(Object.fromEntries(latest.map(x=>[x.step_id,x.output])).narration_english,english);
  assert.equal(Object.fromEntries(latest.map(x=>[x.step_id,x.output])).narration_urdu,urdu);
  const dupe=await queueDunkirkRepairStage(f.env,{stage:'grounded_preflight',
   newJobId:'a3292346-23f1-4f6f-b094-461dd51c4000',now:now+5});
  assert.equal(dupe.idempotent,true);
 }finally{f.close()}
});
test('all writes fail closed when current project is altered, worker paused, other job active or evidence invalid',async()=>{
 const conditions=[
  ['wrong_status',db=>db.exec("UPDATE projects SET status='ready'")],
  ['worker_paused',db=>db.exec("UPDATE workers SET paused=1")],
  ['movie_paused',db=>db.exec("UPDATE cinepulse_movie_controls SET paused=1")],
  ['movie_stopped',db=>db.exec("UPDATE cinepulse_movie_controls SET stopped=1")],
  ['expired',db=>db.exec("UPDATE projects SET expires_at=10")],
  ['not_failed',db=>db.exec("UPDATE jobs SET status='done' WHERE id='"+failed+"'")],
  ['intervening_lease',db=>db.exec("INSERT INTO jobs VALUES('other','"+id+"','"+wid+"','mp3_english','working','',200,'')")],
  ['already_audio',db=>db.exec("INSERT INTO jobs VALUES('audio','"+id+"','"+wid+"','mp3_english','done','',200,'audio')")],
  ['previous_repair',db=>db.exec("INSERT INTO jobs VALUES('repair','"+id+"','"+wid+"','narration_english','error','"+DUNKIRK_REPAIR_MARKER+"',200,'')")]
 ];
 for(const [name,update] of conditions){
  const f=fixture(update);try{
   const result=await queueDunkirkRepairStage(f.env,{stage:'narration_english',newJobId:uid.english,now});
   assert.equal(result.enqueued,false,name);
  }finally{f.close()}
 }
 const f=fixture();try{
  const bad=inspectDunkirkNarrationRepair({project:{...f.db.prepare('SELECT * FROM projects').get(),
   control_paused:0,control_stopped:0},worker:{id:wid,enabled:1,paused:0},
   policy:{grounded:true,experiment:false},jobs:f.jobs(),
   groundedBeats:beats.slice(0,-1),sourceSha:'bad',hasAudio:true,now});
  assert.equal(bad.canStart,false);assert.ok(bad.reasons.includes('source_srt_hash_mismatch'));
 }finally{f.close()}
});
test('dispatcher and V5-G hard gate are retained, latest narration outputs override old immutable records',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/action==='narration-coverage-repair'&&method==='POST'/);
 assert.match(src,/isDunkirkNarrationRepairJob\(job\)/);
 assert.match(src,/queueDunkirkRepairStage\(env,/);
 assert.match(src,/action==='recovery'&&method==='POST'/);
 assert.match(src,/validateV5gPreTts\(/);
 assert.match(src,/extractV5gNarrationText\(outputs\.narration_english,'english'\)/);
 assert.match(src,/DUNKIRK_REPAIR_BUILD/);
 assert.match(DUNKIRK_REPAIR_PROMPTS.narration_urdu,/B07/);
 assert.match(DUNKIRK_REPAIR_PROMPTS.narration_urdu,/B32/);
 assert.match(DUNKIRK_REPAIR_PROMPTS.narration_urdu,/B45/);
 for(const sql of [DUNKIRK_START_SQL,DUNKIRK_URDU_SQL,DUNKIRK_PREFLIGHT_SQL,DUNKIRK_REVIEW_SQL])
  assert.doesNotMatch(sql,/\bLIKE\b|\bGLOB\b/i);
});


// Exercise the real Worker handler so the deploy health marker is not only
// static-source tested. This request never reads or mutates D1/R2.
test('live Worker fetch /health exposes the exact Dunkirk repair build marker',async()=>{
 const worker=(await import('../src/index.mjs')).default;
 const env={DB:{},FILES:{},ADMIN_TOKEN:'a'.repeat(40),
  DOWNLOAD_SIGNING_KEY:'0'.repeat(64)};
 const response=await worker.fetch(new Request('https://example.org/health'),env,{});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.status,'online');
 assert.equal(body.policy.dunkirkNarrationRepairBuild,DUNKIRK_REPAIR_BUILD);
});
