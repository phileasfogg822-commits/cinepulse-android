import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {hashWorkerToken} from '../src/helpers.mjs';

const workerId='66666666-6666-4666-8666-666666666666';
const projectId='77777777-7777-4777-8777-777777777777';
const token='test-worker-token-car-audit';
const endpoint='https://cinepulse.test/w/'+workerId+'/projects/'+projectId+'/car/audit';
const measuredSrt='1\n00:00:00,000 --> 00:00:02,000\nOne short narration cue\n';
const sourceSrt='1\n00:00:00,000 --> 00:00:02,000\nOne source movie cue\n';

async function fixture({owner=true,v5=true,sourceAvailable=true,enabled=true}={}){
 const queries=[],r2=[];
 const workerHash=await hashWorkerToken(token);
 const env={
  ADMIN_TOKEN:'a'.repeat(48),DOWNLOAD_SIGNING_KEY:'b'.repeat(64),
  FILES:{get:async key=>{r2.push(key);return sourceAvailable?{text:async()=>sourceSrt}:null;}},
  DB:{prepare(sql){
   queries.push(sql);
   if(sql.includes('CREATE TABLE IF NOT EXISTS cinepulse_movie_controls'))
    return {run:async()=>({meta:{changes:0}})};
   if(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i.test(sql))
    throw Error('CAR worker audit attempted to mutate D1');
   return {bind(...args){
    const first=async()=>{
     if(sql.includes('SELECT * FROM workers'))
      return {id:workerId,enabled:enabled?1:0,paused:0,token_hash:workerHash};
     if(sql.includes('FROM projects p'))
      return {id:projectId,worker_id:owner?workerId:'other-worker',status:'needs_review',
       control_paused:0,control_stopped:0,source_srt_key:'projects/'+projectId+'/source_srt'};
     if(sql.includes("step_id='digest'"))
      return {prompt:v5?'[CINEPULSE-V5-PERMANENT-DEEP-MUSE] activated':'legacy digest'};
     throw Error('Unexpected first query: '+sql);
    };
    const all=async()=>{
     if(sql.includes('SELECT step_id,output FROM jobs WHERE project_id=?'))
      return {results:[{step_id:'srt_english',output:measuredSrt},
       {step_id:'srt_urdu',output:measuredSrt}]};
     if(sql.includes('SELECT output FROM jobs WHERE project_id=?'))
      return {results:[]};
     if(sql.includes('SELECT id,step_id,status,error,created_at FROM jobs'))
      return {results:[]};
     if(sql.includes('SELECT id,step_id,status,output,created_at FROM jobs'))
      return {results:[]};
     throw Error('Unexpected all query: '+sql);
    };
    return {first,all};
   }};}}
 };
 return {env,queries,r2};
}

async function get(env,bearer=token){
 const headers=bearer?{Authorization:'Bearer '+bearer}:{};
 const response=await worker.fetch(new Request(endpoint,{headers}),env,{});
 return {status:response.status,body:await response.json()};
}

test('CAR worker audit is denied without a valid worker token',async()=>{
 const {env,r2}=await fixture();
 assert.equal((await get(env,null)).status,401);
 assert.equal((await get(env,'invalid')).status,401);
 assert.deepEqual(r2,[]);
});

test('CAR worker audit never exposes movies belonging to other workers',async()=>{
 const {env,r2}=await fixture({owner:false});
 assert.equal((await get(env)).status,403);
 assert.deepEqual(r2,[]);
});

test('CAR worker audit is restricted to V5 projects and requires original R2 evidence',async()=>{
 const other=await fixture({v5:false});
 assert.equal((await get(other.env)).status,403);
 const missing=await fixture({sourceAvailable:false});
 assert.equal((await get(missing.env)).status,409);
});

test('CAR worker audit reads D1/R2 using existing Worker bindings with no recovery job mutation',async()=>{
 const {env,queries,r2}=await fixture();
 const {status,body}=await get(env);
 assert.equal(status,200,JSON.stringify(body));
 assert.equal(body.projectId,projectId);
 assert.equal(body.workerId,workerId);
 assert.equal(body.readOnly,true);
 assert.equal(body.recoveryDispatchEnabled,false);
 assert.equal(body.recoveryResultAcceptanceEnabled,false);
 assert.equal(body.resumeTriggered,false);
 assert.equal(body.acceptedJobsUnchanged,true);
 assert.equal(body.sourceSrtAvailable,true);
 assert.equal(body.englishSegments,1);
 assert.equal(body.urduSegments,1);
 assert.equal(body.unknownCount,2);
 assert.equal(body.candidateReady,false);
 assert.deepEqual(r2,['projects/'+projectId+'/source_srt']);
 assert.ok(queries.every(sql=>!/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i.test(sql)));
 assert.ok(!JSON.stringify(body).includes('One source movie cue'));
});
