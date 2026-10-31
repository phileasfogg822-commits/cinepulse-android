import test from 'node:test';
import assert from 'node:assert/strict';
import {probeExperimentBindings} from '../src/scene-binding-diagnostics.mjs';

test('a bound Worker can verify D1 and R2 without management REST APIs', async () => {
 const called=[];
 const env={
  SCENE_DB:{prepare(sql){
    called.push('d1:'+sql);
    return {async first(){return {probe_ok:1};}};
  }},
  SCENE_FILES:{async head(key){called.push('r2:'+key);return null;}}
 };
 const answer=await probeExperimentBindings(env);
 assert.equal(answer.d1Binding,'reachable');
 assert.equal(answer.r2Binding,'reachable');
 assert.equal(answer.directManagementApisTested,false);
 assert.equal(answer.mutationsMade,false);
 assert.deepEqual(called,['d1:SELECT 1 AS probe_ok','r2:experiments/__binding_probe__/nonexistent']);
 assert.ok(!('accountId' in answer));
});
test('fails closed when bindings do not exist',async()=>{
 await assert.rejects(()=>probeExperimentBindings({}),/unavailable/);
});
test('does not report success when runtime binding rejects access',async()=>{
 const env={
  SCENE_DB:{prepare(){return {async first(){return {probe_ok:1};}};}},
  SCENE_FILES:{async head(){throw new Error('Forbidden')}}
 };
 await assert.rejects(()=>probeExperimentBindings(env),/Forbidden/);
});
