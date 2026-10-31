import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const local = p => JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));

test('experimental binding deployment targets a distinct Worker, never production',()=>{
 const stable=local('../wrangler.json');
 const exp=local('../wrangler.scene-binding.staging.json');
 assert.notEqual(exp.name,stable.name);
 assert.equal(exp.name,'cinepulse-v3828-binding-stage');
 assert.match(exp.main,/staging-scene-worker/);
 assert.ok(!JSON.stringify(exp).includes('src/index.mjs'));
 assert.equal(exp.workers_dev,true);
});

test('staging preserves SAME D1 and R2 resources while changing only the access path',()=>{
 const stable=local('../wrangler.json');
 const exp=local('../wrangler.scene-binding.staging.json');
 assert.equal(exp.d1_databases[0].database_id,stable.d1_databases[0].database_id);
 assert.equal(exp.r2_buckets[0].bucket_name,stable.r2_buckets[0].bucket_name);
 assert.equal(exp.d1_databases[0].binding,'SCENE_DB');
 assert.equal(exp.r2_buckets[0].binding,'SCENE_FILES');
});
