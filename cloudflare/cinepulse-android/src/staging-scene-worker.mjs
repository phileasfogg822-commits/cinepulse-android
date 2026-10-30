import {buildSceneEvidenceIndex, EXPERIMENT_MODE} from './scene-intelligence-experiment.mjs';
import {probeExperimentBindings} from './scene-binding-diagnostics.mjs';

const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});
const err=(status,msg)=>json({error:msg},status);
function authorized(req,env){
  const a=req.headers.get('authorization')||'';
  const received=/^Bearer (.+)$/.exec(a)?.[1]||'';
  const expected=env.STAGING_ACCESS_TOKEN||'';
  if(!expected || received.length!==expected.length || received.length<32)return false;
  let diff=0;for(let i=0;i<received.length;i++)diff|=received.charCodeAt(i)^expected.charCodeAt(i);
  return diff===0;
}
async function hash(data){
  const digest=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,127}$/.test(v);
async function readBody(request,limit){
  const len=Number(request.headers.get('content-length'));
  if(Number.isFinite(len)&&len>limit)throw Error('Request exceeds size limit');
  const data=await request.arrayBuffer();
  if(data.byteLength>limit)throw Error('Request exceeds size limit');
  return data;
}
export default {
 async fetch(request,env) {
  try{
   const url=new URL(request.url);
   if(request.method==='GET'&&url.pathname==='/health')
     return json({status:'online',name:'cinepulse-v3828-staging',mode:EXPERIMENT_MODE,
       note:'Private experimental scene evidence service, not connected to stable Muse or Android'});
   if(!authorized(request,env))return err(401,'Staging bearer token required');
   if(!env.SCENE_DB||!env.SCENE_FILES)return err(503,'Staging bindings missing');
   if(request.method==='GET'&&url.pathname==='/v1/experimental/diagnostics/bindings')
     return json(await probeExperimentBindings(env));
   if(request.method==='POST'&&url.pathname==='/v1/experimental/projects'){
     // D1 Worker binding uses ONLY experiment-prefixed tables.
     // No D1 control-plane API call and no stable table alteration.
     await env.SCENE_DB.prepare(`CREATE TABLE IF NOT EXISTS experimental_scene_indexes(
       project_id TEXT NOT NULL,source_srt_sha256 TEXT NOT NULL,
       version INTEGER NOT NULL,r2_snapshot_key TEXT NOT NULL,
       snapshot_sha256 TEXT NOT NULL,status TEXT NOT NULL,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY(project_id,source_srt_sha256,version))`).run();
     await env.SCENE_DB.prepare(`CREATE TABLE IF NOT EXISTS experimental_scene_windows(
       project_id TEXT NOT NULL,source_srt_sha256 TEXT NOT NULL,
       version INTEGER NOT NULL,window_id TEXT NOT NULL,
       source_start_ms INTEGER NOT NULL,source_end_ms INTEGER NOT NULL,
       cue_start INTEGER NOT NULL,cue_end INTEGER NOT NULL,
       subtitle_text TEXT NOT NULL,character_events_json TEXT DEFAULT '{}',
       visual_verified INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY(project_id,source_srt_sha256,version,window_id))`).run();
     const body=JSON.parse(new TextDecoder().decode(await readBody(request,2200000)));
     const index=await buildSceneEvidenceIndex({
       projectId:body.projectId,title:body.title,sourceSrt:body.sourceSrt
     });
     const key='experiments/'+index.projectId+'/scene-evidence-v1.json';
     const present=await env.SCENE_DB.prepare(
       'SELECT source_srt_sha256 FROM experimental_scene_indexes WHERE project_id=? LIMIT 1'
     ).bind(index.projectId).first();
     if(present && present.source_srt_sha256!==index.sourceSrtSha256)
       return err(409,'Project ID already belongs to a different original SRT');
     const bytes=new TextEncoder().encode(JSON.stringify(index));
     await env.SCENE_FILES.put(key,bytes,{httpMetadata:{contentType:'application/json'}});
     await env.SCENE_DB.prepare(
       "INSERT OR IGNORE INTO experimental_scene_indexes(project_id,source_srt_sha256,version,r2_snapshot_key,snapshot_sha256,status) VALUES(?,?,?,?,?,'building')"
     ).bind(index.projectId,index.sourceSrtSha256,1,key,'0'.repeat(64)).run();
     // Indexed source-cue windows are a cache, not Muse-approved cut decisions.
     for(let offset=0;offset<index.windows.length;offset+=50){
       const sql=index.windows.slice(offset,offset+50).map(window=>env.SCENE_DB.prepare(
         'INSERT OR REPLACE INTO experimental_scene_windows(project_id,source_srt_sha256,version,window_id,source_start_ms,source_end_ms,cue_start,cue_end,subtitle_text) VALUES(?,?,1,?,?,?,?,?,?)'
       ).bind(index.projectId,index.sourceSrtSha256,window.id,window.sourceStartMs,
         window.sourceEndMs,window.cueStart,window.cueEnd,window.text));
       await env.SCENE_DB.batch(sql);
     }
     return json({projectId:index.projectId,mode:EXPERIMENT_MODE,
       sourceSrtSha256:index.sourceSrtSha256,sourceCueCount:index.sourceCueCount,
       indexedWindows:index.windows.length,evidenceSha256:await hash(bytes),indexReady:true,
       museReviewComplete:false,visualVerified:false},201);
   }
   const match=/^\/v1\/experimental\/projects\/([a-zA-Z0-9][a-zA-Z0-9_-]{5,127})\/(index|sqlite|manifest)$/.exec(url.pathname);
   if(!match)return err(404,'Experimental route not found');
   const id=match[1],action=match[2];
   const record=await env.SCENE_DB.prepare(
     'SELECT * FROM experimental_scene_indexes WHERE project_id=? ORDER BY version DESC LIMIT 1'
   ).bind(id).first();
   if(!record)return err(404,'Experimental project not found');
   if(request.method==='GET'&&action==='index'){
     const obj=await env.SCENE_FILES.get('experiments/'+id+'/scene-evidence-v1.json');
     return obj?new Response(obj.body,{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}):err(404,'Index missing');
   }
   if(request.method==='POST'&&action==='sqlite'){
     const bytes=await readBody(request,12000000);
     const header=new TextDecoder().decode(bytes.slice(0,16));
     if(header!=='SQLite format 3\u0000')return err(422,'Not a SQLite database header');
     if(bytes.byteLength<100)return err(422,'SQLite database is incomplete');
     const digest=await hash(bytes);
     const key='experiments/'+id+'/Scene_Intelligence.sqlite';
     await env.SCENE_FILES.put(key,bytes,{httpMetadata:{contentType:'application/vnd.sqlite3'}});
     await env.SCENE_DB.prepare(
       "UPDATE experimental_scene_indexes SET r2_snapshot_key=?,snapshot_sha256=?,status='ready' WHERE project_id=? AND version=1"
     ).bind(key,digest,id).run();
     return json({projectId:id,sqliteSha256:digest,bytes:bytes.byteLength,
       status:'stored_unverified_schema',visualVerified:false},201);
   }
   if(request.method==='GET'&&action==='sqlite'){
     if(record.status!=='ready')return err(409,'SQLite snapshot not uploaded');
     const obj=await env.SCENE_FILES.get(record.r2_snapshot_key);
     return obj?new Response(obj.body,{headers:{'Content-Type':'application/vnd.sqlite3',
       'Cache-Control':'private, no-store','Content-Disposition':'attachment; filename="Scene_Intelligence.sqlite"'}}):err(404,'Snapshot missing');
   }
   if(request.method==='GET'&&action==='manifest'){
     return json({schema:'cinepulse.scene-index-staging.v1',mode:EXPERIMENT_MODE,
       projectId:id,sourceSrtSha256:record.source_srt_sha256,status:record.status,
       sqlite:record.status==='ready'?{sha256:record.snapshot_sha256,
         path:'/v1/experimental/projects/'+id+'/sqlite'}:null,
       note:'Not a completed film project, no approved cuts, no Windows import contract yet'});
   }
   return err(405,'Method not allowed');
  }catch(error){
   return err(/size limit/i.test(String(error.message))?413:422,
     String(error.message).slice(0,240));
  }
 }
};
