#!/usr/bin/env python3
"""Build / verify portable CinePulse subtitle evidence SQLite snapshots.
No AI inference, image analysis, cloud storage, or paid services involved.
Run by authorized Muse worker in initial digest, or as a build-time tool.
"""
import argparse
import hashlib
import json
import os
import sqlite3
import sys
from pathlib import Path

SCHEMA = "cinepulse.scene-intelligence.v1"
MODE = "scene_intelligence_experiment"
DB_SCHEMA = """
CREATE TABLE manifest (
  schema TEXT NOT NULL, mode TEXT NOT NULL, project_id TEXT NOT NULL,
  title TEXT NOT NULL, source_srt_sha256 TEXT NOT NULL,
  source_cue_count INTEGER NOT NULL, visual_verified INTEGER NOT NULL CHECK(visual_verified=0),
  created_by TEXT NOT NULL
);
CREATE TABLE source_windows (
  window_id TEXT PRIMARY KEY, cue_start INTEGER NOT NULL,
  cue_end INTEGER NOT NULL, source_start_ms INTEGER NOT NULL,
  source_end_ms INTEGER NOT NULL, subtitle_text TEXT NOT NULL,
  evidence_type TEXT NOT NULL, visual_verified INTEGER NOT NULL CHECK(visual_verified=0)
);
CREATE INDEX idx_source_start ON source_windows(source_start_ms,source_end_ms);
CREATE VIRTUAL TABLE windows_fts USING fts5(window_id UNINDEXED, subtitle_text);
CREATE TABLE character_event_evidence (
  evidence_id INTEGER PRIMARY KEY,
  window_id TEXT NOT NULL REFERENCES source_windows(window_id),
  entity TEXT NOT NULL, relationship TEXT NOT NULL, source_type TEXT NOT NULL,
  FOREIGN KEY(window_id) REFERENCES source_windows(window_id)
);
"""

def check_index(index):
    if not isinstance(index,dict) or index.get("schema")!=SCHEMA or index.get("mode")!=MODE:
        raise ValueError("Expected source-SRT scene-intelligence experiment index")
    if not isinstance(index.get("projectId"),str) or not index["projectId"]:
        raise ValueError("Missing project identity")
    h=index.get("sourceSrtSha256")
    if not isinstance(h,str) or len(h)!=64 or any(c not in "0123456789abcdef" for c in h):
        raise ValueError("Original SRT SHA-256 is required")
    windows=index.get("windows")
    if not isinstance(windows,list) or not windows:
        raise ValueError("No source evidence windows")
    if index.get("visualVerified") is not False:
        raise ValueError("Cannot turn subtitle evidence into visual proof")
    seen=set()
    for w in windows:
        if not isinstance(w,dict) or not isinstance(w.get("id"),str) or w["id"] in seen:
            raise ValueError("Missing or duplicated window ID")
        seen.add(w["id"])
        if any(not isinstance(w.get(k),int) for k in ("cueStart","cueEnd","sourceStartMs","sourceEndMs")):
            raise ValueError("Non-integer scene evidence timecodes")
        if not (1<=w["cueStart"]<=w["cueEnd"]<=index["sourceCueCount"]):
            raise ValueError("Source cue IDs out of bounds")
        if not (0<=w["sourceStartMs"]<w["sourceEndMs"]):
            raise ValueError("Source timestamps out of bounds")
        if not isinstance(w.get("text"),str) or not w["text"].strip():
            raise ValueError("Missing subtitle evidence text")
        if w.get("visualVerified") is not False:
            raise ValueError("Subtitle window incorrectly claims frame verification")
    return windows

def create_database(index, path):
    windows=check_index(index)
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite existing scene index: {path}")
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(str(path))
    try:
        db.executescript(DB_SCHEMA)
        db.execute("INSERT INTO manifest VALUES(?,?,?,?,?,?,?,?)",(
            SCHEMA, MODE, index["projectId"],index.get("title","Movie"),
            index["sourceSrtSha256"],index["sourceCueCount"],0,"CinePulse subtitle evidence builder"
        ))
        for w in windows:
            db.execute("INSERT INTO source_windows VALUES(?,?,?,?,?,?,?,0)",(
                w["id"],w["cueStart"],w["cueEnd"],w["sourceStartMs"],
                w["sourceEndMs"],w["text"],w.get("evidenceType","subtitle_dialogue")
            ))
            db.execute("INSERT INTO windows_fts VALUES(?,?)",(w["id"],w["text"]))
        db.commit()
    except Exception:
        db.close()
        path.unlink(missing_ok=True)
        raise
    db.close()
    return verify_database(path)

def verify_database(path):
    uri="file:"+str(path.resolve())+"?mode=ro"
    db=sqlite3.connect(uri,uri=True)
    try:
        ok=db.execute("PRAGMA integrity_check").fetchone()[0]
        if ok!="ok": raise ValueError("SQLite integrity check failed")
        row=db.execute("SELECT schema,mode,project_id,source_srt_sha256,source_cue_count,visual_verified FROM manifest").fetchone()
        if row is None or row[0]!=SCHEMA or row[1]!=MODE or row[5]!=0:
            raise ValueError("SQLite scene-index manifest is incompatible")
        count=db.execute("SELECT COUNT(*) FROM source_windows").fetchone()[0]
        if not count: raise ValueError("SQLite scene-index contains no evidence")
        fts=db.execute("SELECT COUNT(*) FROM windows_fts").fetchone()[0]
        if fts!=count: raise ValueError("Subtitle-search index is incomplete")
    finally:
        db.close()
    data=path.read_bytes()
    return {
        "schema":SCHEMA,"projectId":row[2],"sourceSrtSha256":row[3],
        "sourceCueCount":row[4],"indexedWindows":count,
        "sqliteFilename":path.name,"bytes":len(data),
        "sha256":hashlib.sha256(data).hexdigest(),"visualVerified":False
    }

def main(argv=None):
    parser=argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--index",type=Path,help="Scene evidence index JSON produced during digest")
    mode.add_argument("--verify",type=Path,help="Existing portable SQLite file")
    parser.add_argument("--output",type=Path,help="Destination for new SQLite file")
    args=parser.parse_args(argv)
    if args.index and not args.output: parser.error("--output is mandatory with --index")
    if args.verify and args.output: parser.error("--output is not used for --verify")
    if args.index:
        index=json.loads(args.index.read_text(encoding="utf-8"))
        result=create_database(index,args.output)
    else: result=verify_database(args.verify)
    print(json.dumps(result,separators=(",",":"),sort_keys=True))

if __name__=="__main__": main()
