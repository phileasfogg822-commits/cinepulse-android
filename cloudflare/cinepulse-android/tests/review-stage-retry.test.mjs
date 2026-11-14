import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
 REVIEW_STAGE_RETRY_MARKER,REVIEW_STAGE_INSERT_SQL,REVIEW_STAGE_PROJECT_SQL,
 inspectReviewStageRetry,enqueueReviewStageRetry
} from '../src/review-stage-retry.mjs';
const pid='822bd90b-ad93-40be-bf0e-eae0fb4ca52c';
const wid='e36f4e31-83a7-42cc-b13c-2525b863f5ab';
const old='e543691a-f5f1-44ac-a752-88b351c7d72a';
const fresh='979655b1-138a-4740-86e3-3fd5aa4e9a31';
const now=1794660000;
const stages=['digest','grounded_evidence','narration_english','narration_urdu','grounded_preflight','publishing_metadata'];
const project={id:pid,worker_id:wid,status:'needs_review',expires_at:null,control_paused:0,control_stopped:0};
const worker={id:wid,enabled:1,paused:0};
const policy={stages,grounded:true,experiment:false};
const accepted=stages.slice(0,4).map((step,i)=>({
 id:'done-'+i,project_id:pid,worker_id:wid,step_id:step,status:'done',
 prompt:step==='digest'?'[CINEPULSE-V5G-GROUNDED-SRT-ONLY]':'',created_at:i+1,
 output:'preserved:'+step
}));
const failure={id:old,project_id:pid,worker_id:wid,step_id:'grounded_preflight',
 status:'error',prompt:'preflight prompt',created_at:10,error:'text mismatch'};
const marker=REVIEW_STAGE_RETRY_MARKER+old+']';
function fixture(change=()=>{}){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,worker_id TEXT,status TEXT,expires_at INTEGER,updated_at INTEGER);
 CREATE TABLE workers(id TEXT PRIMARY KEY,enabled INTEGER,paused INTEGER);
 CREATE TABLE cinepulse_movie_controls(project_id TEXT PRIMARY KEY,paused INTEGER,stopped INTEGER);
 CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,worker_id TEXT,step_id TEXT,
 status TEXT,prompt TEXT,created_at INTEGER,error TEXT,output TEXT);`);
 db.prepare("INSERT INTO projects VALUES(?,?,?,?,?)").run(pid,wid,'needs_review',null,1);
 db.prepare("INSERT INTO workers VALUES(?,?,?)").run(wid,1,0);
 db.prepare("INSERT INTO cinepulse_movie_controls VALUES(?,?,?)").run(pid,0,0);
 const stmt=db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)");
 for(const j of [...accepted,failure])stmt.run(j.id,j.project_id,j.worker_id,j.step_id,j.status,j.prompt,j.created_at,j.error??null,j.output??null);
 change(db);
 const env={DB:{
  prepare(sql){return{bind(...params){const statement=db.prepare(sql);return {
   first:async()=>statement.get(...params)||null,
   run:async()=>({meta:{changes:Number(statement.run(...params).changes)}}),
   all:async()=>({results:statement.all(...params)})
  }} }},
  async batch(statements){db.exec('BEGIN');try{const a=[];for(const q of statements)a.push(await q.run());db.exec('COMMIT');return a;}
   catch(e){db.exec('ROLLBACK');throw e;}}
 }};
 return {db,env,close:()=>db.close()};
}
function sqlArgs(overrides={}){return {
 projectId:pid,workerId:wid,failedJobId:old,stage:'grounded_preflight',
 newJobId:fresh,prompt:'V5-G PRE-TTS HARD GATE. '+marker,now,...overrides
};}
test('review can retry an error job even though project is not processing',()=>{
 const result=inspectReviewStageRetry({project,worker,policy,jobs:[...accepted,failure],now});
 assert.equal(result.eligible,true);
 assert.equal(result.step,'grounded_preflight');
 assert.equal(result.failedJobId,old);
 assert.deepEqual(result.reasons,[]);
});
test('atomic retry adds only one new task and switches project to processing; done outputs unchanged',async()=>{
 const f=fixture();
 try{
  const before=f.db.prepare("SELECT id,output FROM jobs WHERE status='done' ORDER BY created_at").all();
  const created=await enqueueReviewStageRetry(f.env,sqlArgs());
  assert.equal(created.enqueued,true);
  assert.equal(created.step,'grounded_preflight');
  assert.equal(f.db.prepare("SELECT status FROM projects WHERE id=?").get(pid).status,'processing');
  assert.equal(f.db.prepare("SELECT status FROM jobs WHERE id=?").get(fresh).status,'queued');
  assert.deepEqual(f.db.prepare("SELECT id,output FROM jobs WHERE status='done' ORDER BY created_at").all(),before);
  assert.equal(f.db.prepare("SELECT status FROM jobs WHERE id=?").get(old).status,'error');
  const duplicate=await enqueueReviewStageRetry(f.env,sqlArgs({newJobId:'45d854cc-a32f-49d7-9360-c5617daaa5a1'}));
  assert.equal(duplicate.idempotent,true);
  assert.equal(duplicate.jobId,fresh);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE step_id='grounded_preflight'").get().n,2);
 }finally{f.close();}
});
test('atomic retry refuses mismatch, intervening task, duplicate done stage, paused/stopped movie and expired project',async()=>{
 const changes=[
  ['wrong_failed_job',db=>db.exec("UPDATE jobs SET status='cancelled' WHERE id='"+old+"'")],
  ['project_not_review',db=>db.exec("UPDATE projects SET status='processing'")],
  ['worker_paused',db=>db.exec("UPDATE workers SET paused=1")],
  ['movie_paused',db=>db.exec("UPDATE cinepulse_movie_controls SET paused=1")],
  ['movie_stopped',db=>db.exec("UPDATE cinepulse_movie_controls SET stopped=1")],
  ['expired',db=>db.exec("UPDATE projects SET expires_at=10")],
  ['active_lease',db=>db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)").run('other',pid,wid,'publishing_metadata','working','',20,null,null)],
  ['already_done',db=>db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)").run('new-done',pid,wid,'grounded_preflight','done','',20,null,'accepted')]
 ];
 for(const [label,change] of changes){
  const f=fixture(change);try{
   const r=await enqueueReviewStageRetry(f.env,sqlArgs());
   assert.equal(r.enqueued,false,label);
   assert.equal(f.db.prepare("SELECT id FROM jobs WHERE id=?").get(fresh),undefined,label);
  }finally{f.close();}
 }
});
test('read-only review inspection blocks accepted later stages, wrong latest job and advanced matching',()=>{
 assert.ok(inspectReviewStageRetry({project,worker,policy,
  jobs:[...accepted,failure,{id:'later',step_id:'publishing_metadata',status:'done'}],now
 }).reasons.includes('latest_job_not_failed'));
 const advanced={...failure,id:'last-matching',step_id:'deep_match_english'};
 const state=inspectReviewStageRetry({project,worker,policy:{...policy,stages:[...stages,'deep_match_english']},
  jobs:[...accepted,{...failure,status:'done'},advanced],now});
 assert.ok(state.reasons.includes('stage_requires_specialized_recovery'));
});
test('review SQL and BFG hotfix use instr, never LIKE/GLOB pattern checks',()=>{
 const src=readFileSync(new URL('../src/v5g-preflight-requeue.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bLIKE\b|\bGLOB\b/i);
 assert.doesNotMatch(REVIEW_STAGE_INSERT_SQL,/\bLIKE\b|\bGLOB\b/i);
 assert.doesNotMatch(REVIEW_STAGE_PROJECT_SQL,/\bLIKE\b|\bGLOB\b/i);
 assert.match(src,/instr\(COALESCE\(f\.error,''\)/);
 assert.match(src,/instr\(COALESCE\(digest\.prompt,''\)/);
});
test('existing Android recovery UI is backed by authenticated review route and supports V5-G',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 const api=readFileSync(new URL('../../../app/src/main/java/com/cinepulse/mobile/CloudApi.java',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../../../app/src/main/java/com/cinepulse/mobile/MainActivity.java',import.meta.url),'utf8');
 assert.match(src,/action==='recovery'&&method==='GET'/);
 assert.match(src,/action==='recovery'&&method==='POST'/);
 assert.match(src,/action==='review\/retry'&&method==='POST'/);
 assert.ok(src.indexOf('await administrator(request,env)')<src.indexOf("action==='recovery'&&method==='POST'"));
 assert.match(api,/grounded_preflight/);
 assert.match(api,/\/recovery/);
 assert.match(ui,/Inspect and retry failed stage/);
});
