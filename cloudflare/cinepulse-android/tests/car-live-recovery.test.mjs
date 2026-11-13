import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {verifyFailedCarTargets,requireCarCurrentBatchInventory,validateCarRecoveryBatch,ensureCarLiveTable,completedCarSnapshot,dispatchCarLiveBatch,acceptCarLiveBatch,carLiveRecord,retryCarLiveBatch,readCarLiveAudit} from '../src/car-live-recovery.mjs';
const pid='11111111-1111-4111-8111-111111111111',wid='22222222-2222-4222-8222-222222222222';
const cue=(i)=>({segmentIndex:i,sourceStartSeconds:i*10,sourceEndSeconds:i*10+2,sourceCueIds:[i],evidenceQuote:'Original source line '+i,reason:'Specific character event and story rationale.',alternatives:[{cueId:20,reason:'Different event elsewhere'}],confidence:.8,museRequestId:'muse-actual-'+i});
const sourceSrt=Array.from({length:30},(_,i)=>`${i+1}\n00:${String(Math.floor((i+1)*10/60)).padStart(2,'0')}:${String((i+1)*10%60).padStart(2,'0')},000 --> 00:${String(Math.floor(((i+1)*10+2)/60)).padStart(2,'0')}:${String(((i+1)*10+2)%60).padStart(2,'0')},000\nOriginal source line ${i+1}`).join('\n\n');
const cues=Array.from({length:12},(_,i)=>({startSeconds:i*3,endSeconds:i*3+3,text:'Measured narration '+(i+1)}));
const accepted=[{decisions:[1,2,3,4,5].map(cue)}];
const failed={id:'33333333-3333-4333-8333-333333333333',project_id:pid,worker_id:wid,step_id:'deep_match_english',status:'error',error:'Source anchor reused at segment 6'};
const targets=[{segmentIndex:6,rejectedDecision:{...cue(5),segmentIndex:6}}];
failed.output=JSON.stringify({carFailureEvidence:{failedJobId:failed.id,stepId:failed.step_id,rejectedDecisions:[targets[0].rejectedDecision]}});
const verifiedTargets=()=>verifyFailedCarTargets({failed,language:'english',cues,accepted,sourceSrt,targets});
const payload=()=>({carRecovery:true,decisions:[6,7,8,9,10].map(i=>({...cue(i),...(i===6?{anchorMethod:'context'}:{})}))});
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,worker_id TEXT,status TEXT,updated_at INTEGER);
 CREATE TABLE workers(id TEXT PRIMARY KEY,enabled INTEGER,paused INTEGER);
 CREATE TABLE cinepulse_movie_controls(project_id TEXT PRIMARY KEY,paused INTEGER,stopped INTEGER);
 CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,worker_id TEXT,step_id TEXT,status TEXT,prompt TEXT,output TEXT,error TEXT,created_at INTEGER,finished_at INTEGER,lease TEXT,lease_until INTEGER);
 INSERT INTO workers VALUES('22222222-2222-4222-8222-222222222222',1,0); INSERT INTO projects VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','needs_review',1);
 INSERT INTO cinepulse_movie_controls VALUES('11111111-1111-4111-8111-111111111111',0,0);`);
 db.prepare("INSERT INTO jobs(id,project_id,worker_id,step_id,status,output,created_at) VALUES('accepted','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','deep_match_english','done',?,1)").run(JSON.stringify(accepted[0]));
 db.prepare("INSERT INTO jobs(id,project_id,worker_id,step_id,status,error,output,created_at) VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','deep_match_english','error',?,?,2)").run(failed.error,failed.output);
 const wrap=(sql,args=[])=>({bind(...a){return wrap(sql,a)},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}}});
 const env={CAR_LIVE_PROJECT_ID:pid,CAR_LIVE_EXECUTOR_ENABLED:'true',DB:{prepare:sql=>wrap(sql),async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}}};
 return {db,env};
}
async function dispatch(f,extra={}){return dispatchCarLiveBatch(f.env,{projectId:pid,workerId:wid,failed,targets:verifiedTargets(),snapshot:await completedCarSnapshot(f.env,pid),sourceSrt,jobId:'recovery',nextJobId:'next',now:10,...extra});}
async function prepareResult(f){
 await dispatch(f);
 f.db.exec("UPDATE jobs SET status='working',lease='lease',lease_until=100 WHERE id='recovery'");
 const record=await carLiveRecord(f.env,'recovery');
 const verified=validateCarRecoveryBatch({record,language:'english',cues,sourceSrt,accepted,otherAccepted:[],payload:payload()});
 return {record,job:{id:'recovery',project_id:pid,worker_id:wid,step_id:'deep_match_english',lease:'lease'},verified,nextStep:'deep_match_english',sourceSrt,now:20};
}
test('CAR deployment is inert unless an explicit executor activation flag is true',async()=>{
 const f=fixture();
 delete f.env.CAR_LIVE_EXECUTOR_ENABLED;
 await assert.rejects(dispatch(f),/not enabled/);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='car_live_batches'").get().n,0);
 f.env.CAR_LIVE_EXECUTOR_ENABLED='false';
 await assert.rejects(dispatch(f),/not enabled/);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM jobs WHERE status='queued'").get().n,0);
 f.env.CAR_LIVE_EXECUTOR_ENABLED='true';
 assert.equal((await dispatch(f)).status,'queued');
});

test('unprocessed segments do not count as failed; only current failed batch targets accepted',()=>{
 assert.equal(verifiedTargets().length,1);
 for(const bad of [[{...targets[0],segmentIndex:5}],[...targets,...targets],[],Array(4).fill(targets[0])])
 assert.throws(()=>verifyFailedCarTargets({failed,language:'english',cues,accepted,sourceSrt,targets:bad}));
 assert.throws(()=>verifyFailedCarTargets({failed:{...failed,status:'done'},language:'english',cues,accepted,sourceSrt,targets}));
 assert.throws(()=>verifyFailedCarTargets({failed,language:'english',cues,accepted,sourceSrt,targets:[{segmentIndex:6,rejectedDecision:cue(6)}]}),/durable|reuse/);
});
test('future unprocessed segments do not count against the CAR cap',()=>{
 const unknown=['english:6',...Array.from({length:100},(_,i)=>'english:'+(i+7)),...Array.from({length:148},(_,i)=>'urdu:'+(i+41))];
 const audit={evidenceStatus:'verified',inventory:{unknownSegmentIds:unknown,acceptedSegmentIds:['english:1','english:2','english:3','english:4','english:5']},verifiedSegmentIds:[]};
 assert.equal(requireCarCurrentBatchInventory(audit,['english:6']),true);
 assert.equal(audit.inventory.unknownSegmentIds.length,249);
 assert.equal(audit.verifiedSegmentIds.length,0); // audit must not classify future work as failure
 assert.throws(()=>requireCarCurrentBatchInventory(audit,['english:5']),/not an unprocessed/);
 assert.throws(()=>requireCarCurrentBatchInventory(audit,['english:300']),/not an unprocessed/);
 assert.throws(()=>requireCarCurrentBatchInventory(audit,['english:6','english:6']),/incomplete/);
 assert.throws(()=>requireCarCurrentBatchInventory({...audit,evidenceStatus:'not_verified'},['english:6']),/unverified/);
 assert.throws(()=>requireCarCurrentBatchInventory({...audit,inventory:{...audit.inventory,acceptedSegmentIds:['english:6']}},['english:6']),/inconsistent/);
 assert.throws(()=>requireCarCurrentBatchInventory({...audit,verifiedSegmentIds:['urdu:999']},['english:6']),/conflicts/);
});
test('BFG-sized Urdu inventory permits only independently proven current-batch targets',()=>{
 const unknown=Array.from({length:148},(_,i)=>'urdu:'+(i+41));
 const audit={evidenceStatus:'verified',inventory:{acceptedSegmentIds:Array.from({length:40},(_,i)=>'urdu:'+(i+1)),unknownSegmentIds:unknown},verifiedSegmentIds:[]};
 assert.equal(requireCarCurrentBatchInventory(audit,['urdu:41']),true);
 assert.throws(()=>requireCarCurrentBatchInventory(audit,['urdu:41','urdu:76','urdu:81','urdu:180']),/incomplete/);
 assert.throws(()=>verifyFailedCarTargets({failed:{...failed,output:null},language:'english',cues,accepted,sourceSrt,targets}),/Durable/);
});
test('CAR rejects fabricated or changed failed-job decisions, including commit-time D1 tampering',async()=>{
 assert.throws(()=>verifyFailedCarTargets({failed:{...failed,output:null},language:'english',cues,accepted,sourceSrt,targets}),/Durable/);
 const altered={...targets[0].rejectedDecision,museRequestId:'another-muse-request'};
 assert.throws(()=>verifyFailedCarTargets({failed,language:'english',cues,accepted,sourceSrt,targets:[{segmentIndex:6,rejectedDecision:altered}]}),/differs/);
 const f=fixture();
 f.db.prepare("UPDATE jobs SET output='{}' WHERE id=?").run(failed.id);
 await assert.rejects(dispatch(f),/Dispatch rejected/);
 assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE id='recovery'").get().n,0);
});
test('context recovery uses production validator, exact nearby source and cross-language uniqueness',()=>{
 const record={targets_json:JSON.stringify(verifiedTargets()),failed_job_id:'33333333-3333-4333-8333-333333333333'};
 const args={record,language:'english',cues,sourceSrt,accepted,otherAccepted:[]};
 assert.equal(validateCarRecoveryBatch({...args,payload:payload()}).decisions.length,5);
 const bad=payload();bad.decisions[0].evidenceQuote='Original source';assert.throws(()=>validateCarRecoveryBatch({...args,payload:bad}));
 const undeclared=payload();undeclared.decisions[1].anchorMethod='context';assert.throws(()=>validateCarRecoveryBatch({...args,payload:undeclared}),/Undeclared/);
 assert.throws(()=>validateCarRecoveryBatch({...args,otherAccepted:[{decisions:[cue(6)]}],payload:payload()}),/unused/);
 const missing=payload();missing.decisions.pop();assert.throws(()=>validateCarRecoveryBatch({...args,payload:missing}),/One Muse/);
});
test('dispatch is idempotent and completion atomically accepts batch and queues continuation',async()=>{
 const f=fixture(),before=f.db.prepare("SELECT output FROM jobs WHERE id='accepted'").get().output;
 const args=await prepareResult(f);
 assert.equal((await dispatch(f)).alreadyDispatched,true);
 const result=await acceptCarLiveBatch(f.env,args);assert.equal(result.nextJobId,'next');
 assert.equal(f.db.prepare("SELECT status FROM jobs WHERE id='recovery'").get().status,'done');
 assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE id='next'").get().n,1);
 assert.equal(f.db.prepare("SELECT output FROM jobs WHERE id='accepted'").get().output,before);
 await assert.rejects(acceptCarLiveBatch(f.env,args),/stale/);
 assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE id='next'").get().n,1);
});
test('stale accepted output, paused worker/movie, stopped movie and expired lease deny result and continuation',async()=>{
 for(const sql of ["UPDATE jobs SET output='changed' WHERE id='accepted'","UPDATE workers SET paused=1","UPDATE cinepulse_movie_controls SET paused=1","UPDATE cinepulse_movie_controls SET stopped=1","UPDATE jobs SET lease_until=19 WHERE id='recovery'"]){
  const f=fixture(),args=await prepareResult(f);f.db.exec(sql);
  await assert.rejects(acceptCarLiveBatch(f.env,args));
  assert.equal(f.db.prepare("SELECT status FROM jobs WHERE id='recovery'").get().status,'working');
  assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE id='next'").get().n,0);
 }
});
test('continuation insert failure rolls back accepted result',async()=>{
 const f=fixture(),args=await prepareResult(f);
 f.db.exec("CREATE TRIGGER fail_next BEFORE INSERT ON jobs WHEN NEW.id='next' BEGIN SELECT RAISE(ABORT,'simulated failure'); END");
 await assert.rejects(acceptCarLiveBatch(f.env,args),/simulated failure/);
 assert.equal(f.db.prepare("SELECT status FROM jobs WHERE id='recovery'").get().status,'working');
});
test('dispatch enforces stale state, ownership, controls and three targets across both languages',async()=>{
 for(const sql of ["UPDATE workers SET enabled=0","UPDATE cinepulse_movie_controls SET stopped=1","UPDATE projects SET worker_id='other'","UPDATE jobs SET status='working' WHERE id='33333333-3333-4333-8333-333333333333'"]){
  const f=fixture();f.db.exec(sql);await assert.rejects(dispatch(f));
  assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE id='recovery'").get().n,0);
 }
 const f=fixture();await ensureCarLiveTable(f.env);
 f.db.prepare("INSERT INTO car_live_batches VALUES('old','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','older','deep_match_urdu',?,'[]','hash','old-next',0)").run(JSON.stringify([{segmentIndex:1},{segmentIndex:2},{segmentIndex:3}]));
 await assert.rejects(dispatch(f),/lifetime/);
});
test('source change and rollout disabled block acceptance',async()=>{
 const f=fixture(),args=await prepareResult(f);
 await assert.rejects(acceptCarLiveBatch(f.env,{...args,sourceSrt:sourceSrt+'changed'}),/source changed/);
 f.env.CAR_LIVE_PROJECT_ID='other';await assert.rejects(acceptCarLiveBatch(f.env,args),/flag/);
});

test('failed recovery retries the same reservation and audit distinguishes reserved and recovered',async()=>{
 const f=fixture(),args=await prepareResult(f);
 f.db.exec("UPDATE jobs SET status='error',lease=NULL WHERE id='recovery'; UPDATE projects SET status='needs_review'");
 const retry=await retryCarLiveBatch(f.env,{record:args.record,sourceSrt,now:30});
 assert.equal(retry.jobId,'recovery');
 const audit=await readCarLiveAudit(f.env,pid);
 assert.equal(audit.reservedCount,1);assert.equal(audit.recoveredCount,0);assert.deepEqual(audit.pendingTargets,['english:6']);
 f.db.exec("UPDATE jobs SET status='working',lease='lease',lease_until=100 WHERE id='recovery'");
 await acceptCarLiveBatch(f.env,{...args,now:40});
 assert.equal((await readCarLiveAudit(f.env,pid)).recoveredCount,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM car_live_batches').get().n,1);
});

test('authenticated HTTP recovery dispatches proven target while preserving 19 unprocessed segments',async()=>{
 const {default:worker}=await import('../src/index.mjs');
 const {hashWorkerToken}=await import('../src/helpers.mjs');
 const f=fixture(),token='real-test-worker-token';
 f.db.exec('ALTER TABLE workers ADD COLUMN token_hash TEXT; ALTER TABLE projects ADD COLUMN source_srt_key TEXT');
 f.db.prepare('UPDATE workers SET token_hash=?').run(await hashWorkerToken(token));
 f.db.exec("UPDATE projects SET source_srt_key='source'");
 const measured=cues.map((c,i)=>`${i+1}\n00:00:${String(c.startSeconds).padStart(2,'0')},000 --> 00:00:${String(c.endSeconds).padStart(2,'0')},000\n${c.text}`).join('\n\n');
 for(const [id,step,output,prompt] of [['digest','digest','real digest','[CINEPULSE-V5-PERMANENT-DEEP-MUSE]'],['en','srt_english',measured,''],['ur','srt_urdu',measured,'']])
  f.db.prepare("INSERT INTO jobs(id,project_id,worker_id,step_id,status,output,prompt,created_at) VALUES(?,?,?,?,'done',?,?,0)").run(id,pid,wid,step,output,prompt);
 Object.assign(f.env,{ADMIN_TOKEN:'a'.repeat(48),DOWNLOAD_SIGNING_KEY:'b'.repeat(64),FILES:{get:async()=>({text:async()=>sourceSrt})}});
 const post=async(path,body)=>{
  const r=await worker.fetch(new Request('https://test/w/'+wid+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),f.env,{});
  return {status:r.status,body:await r.json()};
 };
 const before=f.db.prepare("SELECT output FROM jobs WHERE id='accepted'").get().output;
 const start=await post('/projects/'+pid+'/car/recover',{failedJobId:failed.id,targets});
 assert.equal(start.status,201,JSON.stringify(start.body));
 assert.equal(start.body.status,'queued');
 assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE status='queued'").get().n,1);
 assert.equal(f.db.prepare("SELECT output FROM jobs WHERE id='accepted'").get().output,before);
 const audit=await worker.fetch(new Request('https://test/w/'+wid+'/projects/'+pid+'/car/audit',{headers:{Authorization:'Bearer '+token}}),f.env,{});
 assert.equal(audit.status,200);const report=await audit.json();
 assert.equal(report.liveRecovery.reservedCount,1);
 assert.deepEqual(report.liveRecovery.pendingTargets,['english:6']);assert.equal(report.acceptedCount,5);
 assert.equal(report.recoveryDispatchEnabled,true);assert.equal(report.unknownCount,19);
 assert.equal(report.candidateReady,true);
 assert.equal(report.unprocessedOrUnverifiedCount,18);
});

test('an older failed job cannot authorize recovery after a newer matching attempt',async()=>{
 const f=fixture();f.db.exec("INSERT INTO jobs(id,project_id,worker_id,step_id,status,error,created_at) SELECT 'newer',project_id,worker_id,step_id,'error','different failure',3 FROM jobs WHERE id='33333333-3333-4333-8333-333333333333'");
 await assert.rejects(dispatch(f),/Dispatch rejected/);
 assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE id='recovery'").get().n,0);
});

test('tampering with original failed-job provenance blocks acceptance without touching accepted V5 checkpoints',async()=>{
 for(const mutation of [
  "UPDATE jobs SET output='{}' WHERE id='33333333-3333-4333-8333-333333333333'",
  "UPDATE jobs SET error=NULL WHERE id='33333333-3333-4333-8333-333333333333'",
  "UPDATE jobs SET status='queued' WHERE id='33333333-3333-4333-8333-333333333333'"
 ]){
  const f=fixture(),args=await prepareResult(f);
  const acceptedBefore=f.db.prepare("SELECT output FROM jobs WHERE id='accepted'").get().output;
  f.db.exec(mutation);
  await assert.rejects(acceptCarLiveBatch(f.env,args),/stale snapshot/);
  assert.equal(f.db.prepare("SELECT status FROM jobs WHERE id='recovery'").get().status,'working');
  assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE id='next'").get().n,0);
  assert.equal(f.db.prepare("SELECT output FROM jobs WHERE id='accepted'").get().output,acceptedBefore);
 }
});
test('retry fails closed if the original failed-job evidence was changed after reservation',async()=>{
 const f=fixture(),args=await prepareResult(f);
 f.db.exec("UPDATE jobs SET status='error',lease=NULL WHERE id='recovery'; UPDATE projects SET status='needs_review'; UPDATE jobs SET output='{}' WHERE id='33333333-3333-4333-8333-333333333333'");
 await assert.rejects(retryCarLiveBatch(f.env,{record:args.record,sourceSrt,now:30}),/retry denied/);
 assert.equal(f.db.prepare("SELECT status FROM jobs WHERE id='recovery'").get().status,'error');
 assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE status='queued'").get().n,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE id='next'").get().n,0);
});
