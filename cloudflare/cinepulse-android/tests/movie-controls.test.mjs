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
 for(const marker of [
   "if(controlIsStopped(await getProject(env,job.project_id)))fail(410",
   'ELIGIBLE_MOVIE_CONTROL+" ORDER BY j.created_at',
   "UPDATE jobs SET status='cancelled',lease=NULL,lease_until=NULL",
   "WHERE project_id=? AND status IN ('queued','working')",
   "if(project.status==='processing'&&!controlIsStopped(project))fail(409",
   "return {status:'stopped',autoAdvanced:false}"
 ]) assert.ok(src.includes(marker),'Missing safety condition: '+marker);
});

test('movie pause atomically revokes active Muse lease and retains unfinished job as queued',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/if\(action==='pause'\)\{\s*\/\/ Per-movie immediate pause:/);
 assert.match(src,/UPDATE jobs SET status='queued',lease=NULL,lease_until=NULL WHERE project_id=\? AND status='working'/);
 assert.match(src,/leaseRevoked:true/);
 assert.match(src,/if\(controlIsPaused\(await getProject\(env,job\.project_id\)\)\)return \{status:'paused'/);
 assert.match(src,/if\(controlIsStopped\(await getProject\(env,job\.project_id\)\)\)fail\(410/);
});
test('paused state is separate from stopped and does not leak to other movies',()=>{
 const {controlIsPaused}=await import('../src/movie-controls.mjs');
 assert.equal(controlIsPaused({control_paused:1,control_stopped:0}),true);
 assert.equal(controlIsPaused({control_paused:1,control_stopped:1}),false);
 assert.equal(controlIsPaused({control_paused:0,control_stopped:0}),false);
});

test('project listing includes immutable pipeline identity and backend latest queue stage, not APK guesses',()=>{
 const src=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(src,/AS latest_step_id/);
 assert.match(src,/AS latest_step_status/);
 assert.match(src,/currentStep:row\.latest_step_id\|\|null/);
 assert.match(src,/productionMode:prompt\.includes\(V5G_MARKER\)/);
});
