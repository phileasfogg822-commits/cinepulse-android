/** Opt-in experiment persistence reusing the bound D1/R2 storage, never stable tables. */
import {buildSceneEvidenceIndex} from './scene-intelligence-experiment.mjs';
const kindNames=new Set(['scene_index_sqlite','english_final_cuts','urdu_final_cuts']);
const encoder=new TextEncoder();
export const EXPERIMENT_ASSET_NAMES=Object.freeze({
 scene_index_sqlite:'Scene_Intelligence.sqlite',
 english_final_cuts:'English_Final_Cuts.json',
 urdu_final_cuts:'Urdu_Final_Cuts.json'
});
export const experimentR2Key=(id,name)=>`experiments/${id}/${name}`;
export const isExperimentAssetKind=kind=>kindNames.has(kind);
const ensureId=id=>{if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw Error('Invalid experiment project UUID');};
async function digest(bytes){
 const d=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function ensureExperimentTables(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS experimental_scene_indexes(
 project_id TEXT NOT NULL,source_srt_sha256 TEXT NOT NULL,
 version INTEGER NOT NULL,r2_snapshot_key TEXT NOT NULL,
 snapshot_sha256 TEXT NOT NULL,status TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(project_id,source_srt_sha256,version))`).run();
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS experimental_scene_windows(
 project_id TEXT NOT NULL,source_srt_sha256 TEXT NOT NULL,
 version INTEGER NOT NULL,window_id TEXT NOT NULL,
 source_start_ms INTEGER NOT NULL,source_end_ms INTEGER NOT NULL,
 cue_start INTEGER NOT NULL,cue_end INTEGER NOT NULL,
 subtitle_text TEXT NOT NULL,visual_verified INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(project_id,source_srt_sha256,version,window_id))`).run();
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS experimental_package_assets(
 project_id TEXT NOT NULL,asset_kind TEXT NOT NULL,r2_key TEXT NOT NULL,
 sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,
 source_srt_sha256 TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(project_id,asset_kind))`).run();
}
export async function createExperimentIndex(env,{projectId,title,sourceSrt}){
 ensureId(projectId);
 const index=await buildSceneEvidenceIndex({projectId,title,sourceSrt});
 await ensureExperimentTables(env);
 const existing=await env.DB.prepare('SELECT source_srt_sha256 FROM experimental_scene_indexes WHERE project_id=? LIMIT 1').bind(projectId).first();
 if(existing&&existing.source_srt_sha256!==index.sourceSrtSha256)
   throw Error('Experimental source fingerprint collision');
 const key=experimentR2Key(projectId,'scene-evidence-v1.json');
 const bytes=encoder.encode(JSON.stringify(index));
 await env.FILES.put(key,bytes,{httpMetadata:{contentType:'application/json'}});
 await env.DB.prepare(`INSERT OR IGNORE INTO experimental_scene_indexes(
 project_id,source_srt_sha256,version,r2_snapshot_key,snapshot_sha256,status)
 VALUES(?,?,1,? ,?,'building')`).bind(projectId,index.sourceSrtSha256,key,'0'.repeat(64)).run();
 for(let at=0;at<index.windows.length;at+=35){
  const statements=index.windows.slice(at,at+35).map(w=>env.DB.prepare(
   `INSERT OR REPLACE INTO experimental_scene_windows(
   project_id,source_srt_sha256,version,window_id,source_start_ms,source_end_ms,
   cue_start,cue_end,subtitle_text,visual_verified) VALUES(?,?,1,?,?,?,?,?,?,0)`
  ).bind(projectId,index.sourceSrtSha256,w.id,w.sourceStartMs,w.sourceEndMs,w.cueStart,w.cueEnd,w.text));
  await env.DB.batch(statements);
 }
 return {projectId,sourceSrtSha256:index.sourceSrtSha256,sourceCueCount:index.sourceCueCount,
 indexedWindows:index.windows.length,objectKey:key};
}
export async function experimentalSourceInfo(env,projectId){
 ensureId(projectId);await ensureExperimentTables(env);
 const row=await env.DB.prepare('SELECT * FROM experimental_scene_indexes WHERE project_id=? AND version=1').bind(projectId).first();
 if(!row)throw Error('Experimental source evidence missing');
 return {projectId,sourceSrtSha256:row.source_srt_sha256,
 evidenceKey:experimentR2Key(projectId,'scene-evidence-v1.json'),status:row.status};
}
export function validateSceneIntelligenceOutput(raw,maxCue=50000){
 const value=typeof raw==='string'?JSON.parse(raw):raw;
 if(!Array.isArray(value?.events)||value.events.length<1||value.events.length>50000)
  throw Error('Muse scene intelligence requires nonempty structured events');
 for(const event of value.events){
  if(!Number.isInteger(event?.cueStart)||!Number.isInteger(event?.cueEnd)||
    event.cueStart<1||event.cueEnd<event.cueStart||event.cueEnd>maxCue||
    !String(event.event||'').trim()||!String(event.evidence||'').trim())
   throw Error('Scene intelligence event missing valid source cue evidence');
 }
 return value;
}
export async function storeExperimentAsset(env,{projectId,kind,bytes}){
 ensureId(projectId);
 if(!isExperimentAssetKind(kind))throw Error('Unsupported experiment asset');
 const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 if(data.byteLength<1||data.byteLength>12*1024*1024)throw Error('Invalid experiment asset size');
 if(kind==='scene_index_sqlite'){
   if(data.byteLength<512||new TextDecoder().decode(data.slice(0,16))!=='SQLite format 3\u0000')
    throw Error('Scene index must be an actual nonempty SQLite file');
 } else JSON.parse(new TextDecoder().decode(data));
 const source=await experimentalSourceInfo(env,projectId);
 const key=experimentR2Key(projectId,EXPERIMENT_ASSET_NAMES[kind]),sha=await digest(data);
 await env.FILES.put(key,data,{httpMetadata:{contentType:kind==='scene_index_sqlite'?'application/vnd.sqlite3':'application/json'}});
 await env.DB.prepare(`INSERT INTO experimental_package_assets(project_id,asset_kind,r2_key,sha256,bytes,source_srt_sha256)
 VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,asset_kind) DO UPDATE SET
 r2_key=excluded.r2_key,sha256=excluded.sha256,bytes=excluded.bytes,
 source_srt_sha256=excluded.source_srt_sha256`).bind(projectId,kind,key,sha,data.byteLength,source.sourceSrtSha256).run();
 if(kind==='scene_index_sqlite')await env.DB.prepare(
  `UPDATE experimental_scene_indexes SET r2_snapshot_key=?,snapshot_sha256=?,status='ready'
   WHERE project_id=? AND source_srt_sha256=? AND version=1`
 ).bind(key,sha,projectId,source.sourceSrtSha256).run();
 return {kind,sha256:sha,bytes:data.byteLength,key};
}
export async function experimentalAssetRow(env,projectId,kind){
 ensureId(projectId);
 if(!isExperimentAssetKind(kind))throw Error('Unknown experiment asset');
 await ensureExperimentTables(env);
 const row=await env.DB.prepare(
 'SELECT r2_key,sha256,bytes FROM experimental_package_assets WHERE project_id=? AND asset_kind=?'
 ).bind(projectId,kind).first();
 return row?{r2_key:row.r2_key,sha256:row.sha256,bytes:Number(row.bytes)}:null;
}
