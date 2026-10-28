#!/usr/bin/env python3
"""Real SQLite regression against the existing production 4-kind CHECK.

No Cloudflare credentials or production data are accessed. Read the exact
CREATE TABLE statement used by the Worker, not a hand-written alternate.
"""
import pathlib
import re
import sqlite3

root=pathlib.Path(__file__).resolve().parents[1]
source=(root/'src'/'asset-registry.mjs').read_text()
match=re.search(r'export const WINDOWS_ASSETS_SCHEMA=`(.*?)`;',source,re.S)
assert match, 'Worker Windows schema missing'
window_sql=match.group(1)
db=sqlite3.connect(':memory:')
db.execute('CREATE TABLE projects(id TEXT PRIMARY KEY)')
db.execute("""CREATE TABLE assets (
 project_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN
 ('source_srt','english_mp3','urdu_mp3','export_json')),
 r2_key TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(project_id,kind)
)""")
pid='df5e65e3-bb54-4908-b973-04c4dd89234e'
db.execute('INSERT INTO projects(id) VALUES(?)',(pid,))
for kind in ('source_srt','english_mp3','urdu_mp3','export_json'):
 db.execute('INSERT INTO assets VALUES(?,?,?,?,?,?)',
  (pid,kind,'projects/'+pid+'/'+kind,500000,'a'*64,100))
try:
 db.execute('INSERT INTO assets VALUES(?,?,?,?,?,?)',
  (pid,'windows_project_json','wrong',414505,'b'*64,100))
 assert False,'Original four-kind CHECK unexpectedly allowed windows_project_json'
except sqlite3.IntegrityError: pass
db.execute(window_sql)
db.execute(window_sql)
for kind in ('windows_project_json','english_srt','urdu_srt',
             'english_narration','urdu_narration'):
 db.execute('INSERT INTO windows_assets VALUES(?,?,?,?,?,?)',
            (pid,kind,'projects/'+pid+'/'+kind,414505,'b'*64,200))
assert db.execute('SELECT COUNT(*) FROM assets').fetchone()[0]==4
assert db.execute('SELECT COUNT(*) FROM windows_assets').fetchone()[0]==5
assert db.execute('SELECT COUNT(DISTINCT kind) FROM (SELECT kind FROM assets UNION ALL SELECT kind FROM windows_assets)').fetchone()[0]==9
assert all(x in db.execute('SELECT sql FROM sqlite_master WHERE name=?',('assets',)).fetchone()[0]
           for x in ('source_srt','english_mp3','urdu_mp3','export_json'))
db.execute('INSERT INTO windows_assets VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,kind) DO UPDATE SET bytes=excluded.bytes',
           (pid,'windows_project_json','projects/'+pid+'/windows_project_json',414505,'b'*64,201))
assert db.execute('SELECT COUNT(*) FROM windows_assets').fetchone()[0]==5
print('PASS: production legacy constraint untouched; five supplemental Windows kinds and replays accepted.')
