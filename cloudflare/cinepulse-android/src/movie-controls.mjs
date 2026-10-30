/**
 * One-movie controls. Lives in a separate D1 table so old project schema,
 * tasks, output and encrypted worker credentials are preserved.
 * STOP revokes server leases; an already-running external Muse invocation
 * cannot be killed remotely, but its uploads/results are rejected.
 */
let schemaPromise;
export function ensureMovieControls(env) {
  if(!schemaPromise) {
    schemaPromise=env.DB.prepare(`CREATE TABLE IF NOT EXISTS cinepulse_movie_controls (
      project_id TEXT PRIMARY KEY,
      paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
      stopped INTEGER NOT NULL DEFAULT 0 CHECK (stopped IN (0,1)),
      updated_at INTEGER NOT NULL
    )`).run().catch(error=>{schemaPromise=null;throw error;});
  }
  return schemaPromise;
}
export const MOVIE_CONTROL_JOIN='LEFT JOIN cinepulse_movie_controls c ON c.project_id=p.id';
export const MOVIE_CONTROL_FIELDS='COALESCE(c.paused,0) AS control_paused, COALESCE(c.stopped,0) AS control_stopped';
export const ELIGIBLE_MOVIE_CONTROL="COALESCE(c.paused,0)=0 AND COALESCE(c.stopped,0)=0";
export function publicMovieState(p) {
  const stopped=Number(p.control_stopped||0)===1;
  return {status:stopped?'stopped':p.status,paused:!stopped&&Number(p.control_paused||0)===1,stopped};
}
export function controlIsStopped(p){return Number(p?.control_stopped||0)===1;}
