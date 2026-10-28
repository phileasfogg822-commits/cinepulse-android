/**
 * CinePulse D1 backwards-compatible asset registry.
 *
 * Production assets.kind has a CHECK constraint permitting ONLY:
 * source_srt, english_mp3, urdu_mp3, export_json.
 * Never ALTER or rebuild that table (which contains production MP3 references).
 * The additional five Windows deliverables live in a separate new table.
 * Muse remains the author of all scripts, final cuts and Windows ProjectState.
 */
export const LEGACY_KINDS=Object.freeze([
  'source_srt','english_mp3','urdu_mp3','export_json'
]);
export const WINDOWS_EXTRA_KINDS=Object.freeze([
  'windows_project_json','english_srt','urdu_srt',
  'english_narration','urdu_narration'
]);
const legacy=new Set(LEGACY_KINDS),windows=new Set(WINDOWS_EXTRA_KINDS);
let lastDatabase=null;
export function assetTableFor(kind){
  if(legacy.has(kind))return 'assets';
  if(windows.has(kind))return 'windows_assets';
  throw new Error('Unrecognized CinePulse asset kind: '+String(kind));
}
export const WINDOWS_ASSETS_SCHEMA=`CREATE TABLE IF NOT EXISTS windows_assets (
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'windows_project_json','english_srt','urdu_srt',
    'english_narration','urdu_narration'
  )),
  r2_key TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, kind)
)`;
export async function ensureWindowsAssets(env){
  // Schema creation is safe to run again, even on a fresh Worker isolate.
  if(lastDatabase===env.DB)return;
  await env.DB.prepare(WINDOWS_ASSETS_SCHEMA).run();
  lastDatabase=env.DB;
}
export async function assetRow(env,projectId,kind){
  const table=assetTableFor(kind);
  if(table==='windows_assets')await ensureWindowsAssets(env);
  return env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=? AND kind=?`)
    .bind(projectId,kind).first();
}
export async function registerAsset(env,{projectId,kind,key,bytes,hash,time}){
  const table=assetTableFor(kind);
  if(table==='windows_assets')await ensureWindowsAssets(env);
  return env.DB.prepare(
    `INSERT INTO ${table}(project_id,kind,r2_key,bytes,sha256,created_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(project_id,kind) DO UPDATE SET
      r2_key=excluded.r2_key, bytes=excluded.bytes,
      sha256=excluded.sha256, created_at=excluded.created_at`
  ).bind(projectId,kind,key,bytes,hash,time).run();
}
export async function allAssetMetadata(env,projectId){
  await ensureWindowsAssets(env);
  const [base,other]=await Promise.all([
    env.DB.prepare('SELECT kind,bytes,sha256 FROM assets WHERE project_id=?').bind(projectId).all(),
    env.DB.prepare('SELECT kind,bytes,sha256 FROM windows_assets WHERE project_id=?').bind(projectId).all()
  ]);
  return [...(base.results||[]),...(other.results||[])];
}
export async function allAssetKeys(env,projectId){
  await ensureWindowsAssets(env);
  const [base,other]=await Promise.all([
    env.DB.prepare('SELECT r2_key FROM assets WHERE project_id=?').bind(projectId).all(),
    env.DB.prepare('SELECT r2_key FROM windows_assets WHERE project_id=?').bind(projectId).all()
  ]);
  return [...(base.results||[]),...(other.results||[])];
}
export async function storageTotals(env){
  await ensureWindowsAssets(env);
  const [base,other]=await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS objects,COALESCE(SUM(bytes),0) AS total_bytes FROM assets').first(),
    env.DB.prepare('SELECT COUNT(*) AS objects,COALESCE(SUM(bytes),0) AS total_bytes FROM windows_assets').first()
  ]);
  return {objects:Number(base?.objects||0)+Number(other?.objects||0),
    total_bytes:Number(base?.total_bytes||0)+Number(other?.total_bytes||0)};
}
