import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location(
    "scene_builder",Path(__file__).resolve().parents[1]/"tools"/"build_scene_sqlite.py")
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

def sample():
    return {
       "schema":"cinepulse.scene-intelligence.v1",
       "mode":"scene_intelligence_experiment",
       "projectId":"peter-rabbit-experiment",
       "title":"Peter Rabbit (2018)",
       "sourceSrtSha256":"a"*64,"sourceCueCount":3,
       "visualVerified":False,
       "windows":[
         {"id":"srt-00001","cueStart":1,"cueEnd":2,
          "sourceStartMs":1000,"sourceEndMs":3200,
          "text":"Peter entered the vegetable garden","evidenceType":"subtitle_dialogue",
          "visualVerified":False},
         {"id":"srt-00002","cueStart":2,"cueEnd":3,
          "sourceStartMs":2600,"sourceEndMs":5400,
          "text":"The old man watched the birds","evidenceType":"subtitle_dialogue",
          "visualVerified":False}
       ]
    }

class SceneSQLiteTest(unittest.TestCase):
 def test_sqlite_has_reusable_fts_evidence_and_manifest(self):
    with tempfile.TemporaryDirectory() as folder:
      p=Path(folder)/"Scene_Intelligence.sqlite"
      result=builder.create_database(sample(),p)
      self.assertEqual(result["indexedWindows"],2)
      self.assertEqual(result["sourceCueCount"],3)
      self.assertFalse(result["visualVerified"])
      self.assertEqual(builder.verify_database(p)["sha256"],result["sha256"])
      db=sqlite3.connect(str(p))
      try:
        matches=db.execute(
          "SELECT window_id FROM windows_fts WHERE windows_fts MATCH 'garden'").fetchall()
        self.assertEqual(matches,[("srt-00001",)])
        row=db.execute("SELECT source_srt_sha256 FROM manifest").fetchone()
        self.assertEqual(row,("a"*64,))
      finally: db.close()

 def test_no_overwrite_and_no_claim_of_visual_verification(self):
    with tempfile.TemporaryDirectory() as folder:
      p=Path(folder)/"Scene_Intelligence.sqlite"
      builder.create_database(sample(),p)
      with self.assertRaises(FileExistsError): builder.create_database(sample(),p)
    bad=sample()
    bad["visualVerified"]=True
    with self.assertRaises(ValueError): builder.check_index(bad)
    bad=sample()
    bad["windows"][0]["visualVerified"]=True
    with self.assertRaises(ValueError): builder.check_index(bad)

 def test_rejects_forged_source_timelines(self):
    bad=sample()
    bad["windows"][1]["sourceEndMs"]=-2
    with self.assertRaises(ValueError): builder.check_index(bad)

if __name__=="__main__": unittest.main()
