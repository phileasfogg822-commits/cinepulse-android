import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
 BFG_PREFLIGHT_PROJECT_ID as pid,BFG_PREFLIGHT_WORKER_ID as wid,
 BFG_PREFLIGHT_FAILED_JOB_ID as fid,V5G_PREFLIGHT_REQUEUE_MARKER as marker,
 V5G_PREFLIGHT_RECOVERY_INSERT_SQL,V5G_PREFLIGHT_RECOVERY_PROJECT_SQL,
 requeueFailedV5gPreflight,inspectV5gPreflightRecoveryGuards
} from '../src/v5g-preflight-requeue.mjs';
const original='V5-G PRE-TTS HARD GATE. Copy previously accepted narration units.';
const prompt=original+'\n'+marker+' Approved one-time retry.';
const now=1794661200;
const jid='e05af157-2a42-4895-8f42-e1b828cc5c55';
const pidOther='155a5195-86fa-4ad9-a795-8ac91e32dcc7';
function fixture(modify=()=>{}){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,worker_id TEXT,status TEXT,expires_at INTEGER,updated_at INTEGER);
 CREATE TABLE workers(id TEXT PRIMARY KEY,enabled INTEGER,paused INTEGER);
 CREATE TABLE cinepulse_movie_controls(project_id TEXT PRIMARY KEY,paused INTEGER,stopped INTEGER);
 CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,worker_id TEXT,step_id TEXT,
 status TEXT,prompt TEXT,created_at INTEGER,error TEXT,output TEXT);
 INSERT INTO workers VALUES('${wid}',1,0);
 INSERT INTO projects VALUES('${pid}','${wid}','needs_review',NULL,1);
 INSERT INTO cinepulse_movie_controls VALUES('${pid}',0,0);`);
 const insertJob=db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)');
 const stage=['digest','grounded_evidence','narration_english','narration_urdu'];
 stage.forEach((s,i)=>insertJob.run('done-'+i,pid,wid,s,'done',
  s==='digest'?'[PERMANENT-DEEP-MUSE] [CINEPULSE-V5G-GROUNDED-SRT-ONLY]':'',
  1+i,null,'accepted-output-'+s));
 insertJob.run(fid,pid,wid,'grounded_preflight','error','',5,
  'V5-G grounded_preflight checkpoint rejected (HTTP 422): V5-G: english narration text does not exactly correspond to source-linked units',null);
 modify(db);
 const DB={
  prepare(sql){
   const stmt=db.prepare(sql);
   return {bind(...args){return {
    first:async()=>stmt.get(...args)||null,
    all:async()=>({results:stmt.all(...args)}),
    run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}})
   };}};
  },
  async batch(statements){
   db.exec('BEGIN');
   try{const results=[];for(const stmt of statements)results.push(await stmt.run());
    db.exec('COMMIT');return results;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
 };
 return {db,env:{DB},close:()=>db.close()};
}
const input=(overrides={})=>({projectId:pid,workerId:wid,
 failedJobId:fid,newJobId:jid,prompt,now,...overrides});
test('BFG one-shot recovery inserts one queued preflight atomically and preserves four accepted outputs',async()=>{
 const f=fixture();try{
  const before=f.db.prepare("SELECT step_id,output FROM jobs WHERE status='done' ORDER BY created_at").all();
  const first=await requeueFailedV5gPreflight(f.env,input());
  assert.equal(first.enqueued,true);
  assert.equal(first.jobId,jid);
  assert.equal(f.db.prepare('SELECT status FROM projects WHERE id=?').get(pid).status,'processing');
  const queued=f.db.prepare('SELECT status,step_id,worker_id,prompt FROM jobs WHERE id=?').get(jid);
  assert.equal(queued.status,'queued');
  assert.equal(queued.step_id,'grounded_preflight');
  assert.equal(queued.worker_id,wid);
  assert.match(queued.prompt,/V5-G PRE-TTS HARD GATE/);
  assert.deepEqual(f.db.prepare("SELECT step_id,output FROM jobs WHERE status='done' ORDER BY created_at").all(),before);
  assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(fid).status,'error');
  const retry=await requeueFailedV5gPreflight(f.env,input({newJobId:'c4bf94e9-9f8e-4484-ae75-57db8a860c61'}));
  assert.equal(retry.idempotent,true);
  assert.equal(retry.jobId,jid);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM jobs WHERE step_id='grounded_preflight'").get().n,2);
 }finally{f.close();}
});
test('real SQLite guarded recovery fails closed for stale state, wrong worker, missing checkpoints and stopped movies',async()=>{
 const cases=[
  ['wrong worker',db=>db.exec("UPDATE projects SET worker_id='"+pidOther+"'")],
  ['not needs_review',db=>db.exec("UPDATE projects SET status='processing'")],
  ['worker paused',db=>db.exec('UPDATE workers SET paused=1')],
  ['movie paused',db=>db.exec('UPDATE cinepulse_movie_controls SET paused=1')],
  ['movie stopped',db=>db.exec('UPDATE cinepulse_movie_controls SET stopped=1')],
  ['missing checkpoint',db=>db.exec("DELETE FROM jobs WHERE step_id='narration_urdu'")],
  ['unverified digest pipeline',db=>db.exec("UPDATE jobs SET prompt='legacy' WHERE step_id='digest'")],
  ['error differs',db=>db.exec("UPDATE jobs SET error='a different error' WHERE status='error'")],
  ['expired project',db=>db.exec("UPDATE projects SET expires_at=10")],
  ['future stage already accepted',db=>db.exec("INSERT INTO jobs VALUES('accepted-next','"+pid+"','"+wid+"','mp3_english','done','',9,NULL,'immutable')")],
  ['queued stage already exists',db=>db.exec("INSERT INTO jobs VALUES('existing','"+pid+"','"+wid+"','publishing_metadata','queued','',9,NULL,NULL)")],
  ['a different newer failed job exists',db=>db.exec("INSERT INTO jobs VALUES('new-fail','"+pid+"','"+wid+"','grounded_preflight','error','',10,'same error',NULL)")],
  ['recovery already requested',db=>db.exec("INSERT INTO jobs VALUES('old-requeue','"+pid+"','"+wid+"','grounded_preflight','error','"+marker+"',10,'same error',NULL)")]
 ];
 for(const [name,change] of cases){
  const f=fixture(change);try{
   const done=f.db.prepare("SELECT step_id,output FROM jobs WHERE status='done' ORDER BY created_at").all();
   const result=await requeueFailedV5gPreflight(f.env,input());
   assert.equal(result.enqueued,false,name);
   assert.equal(f.db.prepare('SELECT status FROM projects').get().status,
    name==='not needs_review'?'processing':'needs_review',name);
   assert.equal(f.db.prepare('SELECT id FROM jobs WHERE id=?').get(jid),undefined,name);
   assert.deepEqual(f.db.prepare("SELECT step_id,output FROM jobs WHERE status='done' ORDER BY created_at").all(),done,name);
  }finally{f.close();}
 }
});
test('malformed body cannot enqueue or touch production tables',async()=>{
 const f=fixture();try{
  const bad=await requeueFailedV5gPreflight(f.env,input({newJobId:'not-a-uuid'}));
  assert.deepEqual(bad,{enqueued:false,reason:'invalid_recovery_request'});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,5);
 }finally{f.close();}
});
test('backend worker recovery is explicitly BFG-only; admin path is separately authenticated',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/wid===BFG_PREFLIGHT_WORKER_ID/);
 assert.match(src,/BFG_PREFLIGHT_PROJECT_ID,wid/);
 assert.match(src,/BFG_PREFLIGHT_FAILED_JOB_ID/);
 assert.match(src,/action==='grounded-preflight\/requeue'&&method==='POST'/);
 assert.ok(src.indexOf('await administrator(request,env)')<src.indexOf("action==='grounded-preflight/requeue'"));
 assert.match(src,/v5gPreflightRequeueBuild:V5G_PREFLIGHT_REQUEUE_BUILD/);
 assert.match(V5G_PREFLIGHT_RECOVERY_INSERT_SQL,/NOT EXISTS/);
 assert.match(V5G_PREFLIGHT_RECOVERY_PROJECT_SQL,/status='processing'/);
});

test('read-only authenticated diagnostic reports eligible BFG without mutation',async()=>{
 const f=fixture();try{
  const before=f.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
  const r=await inspectV5gPreflightRecoveryGuards(f.env,{
   projectId:pid,workerId:wid,failedJobId:fid,now});
  assert.equal(r.eligible,true);
  assert.deepEqual(r.blockingReasons,[]);
  assert.equal(r.projectStatus,'needs_review');
  assert.equal(r.failedJobStatus,'error');
  assert.equal(r.latestPreflightJobId,fid);
  assert.equal(r.acceptedPrerequisiteCounts.narration_english,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,before);
 }finally{f.close();}
});
test('diagnostics identify exactly why a previously blocked recovery did not enqueue',async()=>{
 const cases=[
  ['worker_paused',db=>db.exec('UPDATE workers SET paused=1')],
  ['movie_stopped',db=>db.exec('UPDATE cinepulse_movie_controls SET stopped=1')],
  ['failed_job_not_error',db=>db.exec("UPDATE jobs SET status='cancelled' WHERE id='"+fid+"'")],
  ['accepted_prerequisites_not_exactly_once',db=>db.exec("DELETE FROM jobs WHERE step_id='narration_english'")],
  ['not_v5g_digest_checkpoint',db=>db.exec("UPDATE jobs SET prompt='old V5' WHERE step_id='digest'")],
  ['failed_error_not_envelope_mismatch',db=>db.exec("UPDATE jobs SET error='another issue' WHERE id='"+fid+"'")],
  ['active_or_queued_task_exists',db=>db.exec("INSERT INTO jobs VALUES('another','"+pid+"','"+wid+"','publishing_metadata','queued','',10,NULL,NULL)")],
  ['different_latest_preflight',db=>db.exec("INSERT INTO jobs VALUES('new-failure','"+pid+"','"+wid+"','grounded_preflight','error','',10,'another issue',NULL)")]
 ];
 for(const [reason,change] of cases){
  const f=fixture(change);
  try{
   const before=f.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
   const r=await inspectV5gPreflightRecoveryGuards(f.env,{
    projectId:pid,workerId:wid,failedJobId:fid,now});
   assert.equal(r.eligible,false,reason);
   assert.ok(r.blockingReasons.includes(reason),JSON.stringify({reason,actual:r.blockingReasons}));
   assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,before);
  }finally{f.close();}
 }
});
test('Worker 1 queue and next return bounded recovery outcome; readonly diagnosis cannot accept results',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/let bfgRecovery=null/);
 assert.match(src,/bfgRecovery=await resumeFailedGroundedPreflight/);
 assert.match(src,/inspectV5gPreflightRecoveryGuards/);
 assert.match(src,/queuedCount:waiting\?\.n\|\|0[\s\S]*?\.\.\.\(bfgRecovery\?\{bfgRecovery\}:\{\}\)/);
 assert.match(src,/\['\/agent\/next','\/agent\/current'\]\.includes\(tail\)/);
 assert.match(src,/grounded-preflight\/recovery-diagnostic/);
 assert.match(src,/wid===BFG_PREFLIGHT_WORKER_ID/);
});
