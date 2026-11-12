import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/index.mjs';

const projectId='11111111-1111-4111-8111-111111111111';
const adminToken='a'.repeat(48);
const path='/v1/projects/'+projectId+'/car/dispatch-readiness';

function fixture({enabledFlag=true,workerEnabled=1,workerPaused=0,
  projectStatus='needs_review',v5=true,activeJobs=0}={}){
 const queries=[];
 const DB={prepare(sql){
  queries.push(sql);
  if(/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(sql))
   throw Error('Readiness route attempted a database write');
  return {bind(...args){return {async first(){
   if(sql.includes('SELECT p.id,p.worker_id,p.status FROM projects p'))
    return {id:projectId,worker_id:'worker-1',status:projectStatus};
   if(sql.includes('FROM projects p'))
    return {id:projectId,worker_id:'worker-1',status:projectStatus};
   if(sql.includes("step_id='digest'"))
    return {prompt:v5?'[CINEPULSE-V5-PERMANENT-DEEP-MUSE] enabled':'legacy digest'};
   if(sql.includes('FROM jobs'))return {n:activeJobs};
   if(sql.includes('FROM workers'))return {enabled:workerEnabled,paused:workerPaused};
   throw Error('Unrecognised query: '+sql);
  }};}};}};
 const env={DB,FILES:{},ADMIN_TOKEN:adminToken,DOWNLOAD_SIGNING_KEY:'b'.repeat(64),
  ALLOWED_ORIGINS:'',CAR_V1_1_ENABLED:enabledFlag?'true':'false'};
 return {env,queries};
}

async function request(env,{auth=true}={}){
 const headers=auth?{Authorization:'Bearer '+adminToken}:{};
 const response=await worker.fetch(new Request('https://cinepulse.example'+path,{headers}),env,{});
 return {status:response.status,body:await response.json()};
}

test('backend integrity: one module export and one CAR dispatch-readiness route',()=>{
 const s=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.equal((s.match(/^export default \{/gm)||[]).length,1);
 assert.equal((s.match(/const carDispatchReadinessRoute=/g)||[]).length,1);
 assert.equal((s.match(/\/\/ CAR v1\.1 administrator-only dispatch readiness inspection\./g)||[]).length,1);
});

test('CAR readiness requires administrator authentication and does not touch D1 without it',async()=>{
 const {env,queries}=fixture();
 const r=await request(env,{auth:false});
 assert.equal(r.status,401);
 assert.deepEqual(queries,[]);
});

test('CAR readiness stays disabled until explicit feature enablement',async()=>{
 const {env,queries}=fixture({enabledFlag:false});
 const r=await request(env);
 assert.equal(r.status,403);
 assert.deepEqual(queries,[]);
});

test('CAR readiness reports eligible V5 movie without enqueuing anything',async()=>{
 const {env,queries}=fixture();
 const r=await request(env);
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.ready,true);
 assert.equal(r.body.readOnly,true);
 assert.equal(r.body.enqueueAllowed,false);
 assert.equal(r.body.resumeTriggered,false);
 assert.equal(r.body.projectStatus,'needs_review');
 assert.ok(queries.some(sql=>sql.includes('FROM workers')));
});

test('CAR readiness denies legacy projects and paused workers without writes',async()=>{
 const legacy=fixture({v5:false});
 assert.equal((await request(legacy.env)).status,403);
 const paused=fixture({workerPaused:1});
 const response=await request(paused.env);
 assert.equal(response.status,200);
 assert.equal(response.body.ready,false);
 assert.equal(response.body.reason,'worker_unavailable_or_paused');
 assert.equal(response.body.enqueueAllowed,false);
});

test('CAR readiness denies in-progress and stopped movies and active jobs',async()=>{
 for(const options of [{projectStatus:'processing'},{projectStatus:'stopped'},{activeJobs:2}]){
  const {env}=fixture(options);
  const response=await request(env);
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.equal(response.body.ready,false);
  assert.equal(response.body.enqueueAllowed,false);
 }
});
