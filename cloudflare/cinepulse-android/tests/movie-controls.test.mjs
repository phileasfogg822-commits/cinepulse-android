import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ensureMovieControls,ELIGIBLE_MOVIE_CONTROL,MOVIE_CONTROL_FIELDS,publicMovieState,controlIsStopped} from '../src/movie-controls.mjs';
test('movie control flags preserve original project state when not opted in',()=>{
 assert.deepEqual(publicMovieState({status:'processing'}),{status:'processing',paused:false,stopped:false});
 assert.deepEqual(publicMovieState({status:'processing',control_paused:1}),{status:'processing',paused:true,stopped:false});
 assert.deepEqual(publicMovieState({status:'needs_review',control_stopped:1,control_paused:1}),{status:'stopped',paused:false,stopped:true});
 assert.equal(controlIsStopped({control_stopped:1}),true);
 assert.match(ELIGIBLE_MOVIE_CONTROL,/c\.paused/);
 assert.match(MOVIE_CONTROL_FIELDS,/control_stopped/);
});
test('independent D1 table does not change existing projects, jobs or auth schema', async()=>{
 const sqls=[];
 await ensureMovieControls({DB:{prepare(sql){sqls.push(sql);return {run:async()=>({success:true})}}}});
 assert.equal(sqls.length,1);
 assert.match(sqls[0],/CREATE TABLE IF NOT EXISTS cinepulse_movie_controls/);
 assert.match(sqls[0],/project_id TEXT PRIMARY KEY/);
 assert.doesNotMatch(sqls[0],/ALTER TABLE/);
});
test('server rejects stopped leases and excludes paused/ stopped movie IDs from new task claims',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/controlIsStopped\(await getProject\(env,job\.project_id\)\)fail\(410/);
 assert.match(src,/ELIGIBLE_MOVIE_CONTROL\+["'] ORDER BY j\.created_at/);
 assert.match(src,/UPDATE jobs SET status='cancelled',lease=NULL,lease_until=NULL/);
 assert.match(src,/WHERE project_id=\? AND status IN \('queued','working'\)/);
 assert.match(src,/if\(project\.status==='processing'&&!controlIsStopped\(project\)\)fail\(409/);
 assert.match(src,/if\(controlIsStopped\(await getProject\(env,job\.project_id\)\)\)return \{status:'stopped'/);
});
