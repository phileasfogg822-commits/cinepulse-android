import test from 'node:test';
import assert from 'node:assert/strict';
import {LEGACY_KINDS,WINDOWS_EXTRA_KINDS,WINDOWS_ASSETS_SCHEMA,
  assetTableFor,ensureWindowsAssets,registerAsset,assetRow,
  allAssetMetadata,allAssetKeys,storageTotals} from '../src/asset-registry.mjs';

class MemoryD1 {
  constructor(){
    this.primary=new Map();this.windows=new Map();
    this.schemaCreated=false;this.sqlLog=[];
  }
  prepare(sql){
    this.sqlLog.push(sql);
    const engine=this;
    const api={args:[],bind(...args){this.args=args;return this;},
      async run(){
        if(sql.startsWith('CREATE TABLE IF NOT EXISTS windows_assets')){
          engine.schemaCreated=true;return {success:true};
        }
        if(sql.includes('INSERT INTO')){
          const table=sql.includes('INSERT INTO windows_assets')?'windows_assets':'assets';
          if(table==='assets'&&!LEGACY_KINDS.includes(this.args[1]))
            throw Error('CHECK constraint failed: kind must be one of source_srt,english_mp3,urdu_mp3,export_json');
          if(table==='windows_assets'&&!engine.schemaCreated)throw Error('no such table');
          const entry={project_id:this.args[0],kind:this.args[1],r2_key:this.args[2],bytes:this.args[3],sha256:this.args[4],created_at:this.args[5]};
          (table==='assets'?engine.primary:engine.windows).set(entry.project_id+':'+entry.kind,entry);
          return {success:true};
        }
        throw Error('Unexpected mock SQL '+sql);
      },
      async first(){
        if(sql.startsWith('SELECT * FROM')){
          const table=sql.includes('FROM windows_assets')?engine.windows:engine.primary;
          return table.get(this.args[0]+':'+this.args[1])||null;
        }
        if(sql.startsWith('SELECT COUNT(*)')){
          const table=sql.includes('FROM windows_assets')?engine.windows:engine.primary;
          const entries=[...table.values()];
          return {objects:entries.length,total_bytes:entries.reduce((a,x)=>a+x.bytes,0)};
        }
        throw Error('Unexpected mock SQL '+sql);
      },
      async all(){
        const table=sql.includes('FROM windows_assets')?engine.windows:engine.primary;
        const rows=[...table.values()].filter(x=>x.project_id===this.args[0]);
        if(sql.startsWith('SELECT r2_key'))return {results:rows.map(x=>({r2_key:x.r2_key}))};
        if(sql.startsWith('SELECT kind,bytes,sha256'))return {results:rows.map(x=>({kind:x.kind,bytes:x.bytes,sha256:x.sha256}))};
        throw Error('Unexpected mock SQL '+sql);
      }
    };
    return api;
  }
}
const fixture=()=>({DB:new MemoryD1()});
test('legacy four-kind D1 CHECK remains untouched; exactly five additional Windows kinds have their own table',()=>{
  assert.deepEqual(LEGACY_KINDS,['source_srt','english_mp3','urdu_mp3','export_json']);
  assert.equal(WINDOWS_EXTRA_KINDS.length,5);
  for(const kind of WINDOWS_EXTRA_KINDS)assert.equal(assetTableFor(kind),'windows_assets');
  for(const kind of LEGACY_KINDS)assert.equal(assetTableFor(kind),'assets');
  assert.throws(()=>assetTableFor('viral_mp4'));
  assert.match(WINDOWS_ASSETS_SCHEMA,/CREATE TABLE IF NOT EXISTS windows_assets/);
  assert.doesNotMatch(WINDOWS_ASSETS_SCHEMA,/DROP TABLE|ALTER TABLE/);
});
test('Peter Rabbit four original assets survive while five extra signed Windows records register without legacy CHECK failure',async()=>{
  const env=fixture(),id='df5e65e3-bb54-4908-b973-04c4dd89234e';
  const kinds=['source_srt','english_mp3','urdu_mp3','export_json',...WINDOWS_EXTRA_KINDS];
  for(let i=0;i<kinds.length;i++)await registerAsset(env,{
    projectId:id,kind:kinds[i],key:'projects/'+id+'/'+kinds[i],bytes:128669+i,
    hash:'a'.repeat(64),time:12345
  });
  assert.equal(env.DB.primary.size,4);
  assert.equal(env.DB.windows.size,5);
  for(const kind of kinds)assert.equal((await assetRow(env,id,kind)).kind,kind);
  const metadata=await allAssetMetadata(env,id);
  assert.equal(metadata.length,9);
  assert.equal(new Set(metadata.map(x=>x.kind)).size,9);
  assert.equal((await allAssetKeys(env,id)).length,9);
  const totals=await storageTotals(env);
  assert.equal(totals.objects,9);
  assert.ok(totals.total_bytes>0);
  assert.equal([...env.DB.sqlLog].filter(x=>x.startsWith('CREATE TABLE')).length,1);
});
test('repeated retry is idempotent and reuses original type table without duplicate metadata rows',async()=>{
  const env=fixture(),id='same-project',kind='windows_project_json';
  await registerAsset(env,{projectId:id,kind,key:'projects/'+id+'/'+kind,bytes:414505,hash:'b'.repeat(64),time:1});
  await registerAsset(env,{projectId:id,kind,key:'projects/'+id+'/'+kind,bytes:414505,hash:'b'.repeat(64),time:2});
  assert.equal(env.DB.windows.size,1);
  assert.equal((await assetRow(env,id,kind)).created_at,2);
  await ensureWindowsAssets(env);
  assert.equal(env.DB.primary.size,0);
});
