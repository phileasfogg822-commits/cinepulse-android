import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

TOOLS=Path(__file__).resolve().parents[1]/"tools"/"scene_lab_extract.py"
PARENT="81febfe9-bcf4-4a96-ab4c-2a9226503ea1"

def timestamp(seconds):
    ms=int(seconds*1000)
    return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}"

def srt(interval,total):
    return "\n\n".join(f"{i+1}\n{timestamp(i*interval)} --> {timestamp((i+1)*interval)}\nPeter Rabbit and friends {i}" for i in range(int(total/interval)))+"\n"


class SceneLabExtractorIntegration(unittest.TestCase):
    def test_actual_ffmpeg_audio_and_zip_preparation(self):
        self.assertTrue(shutil.which('ffmpeg'), 'FFmpeg must be installed in CI')
        self.assertTrue(shutil.which('ffprobe'), 'FFprobe must be installed in CI')
        with tempfile.TemporaryDirectory() as work:
            root=Path(work)
            audio=root/"original.mp3"
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
                "-f","lavfi","-i","anullsrc=r=22050:cl=mono","-t","400",
                "-codec:a","libmp3lame","-q:a","9",str(audio)],check=True)
            src="1\n00:00:00,000 --> 01:28:00,000\nPeter Rabbit\n"
            base={"cloudImport":{"schema":"cinepulse.windows-muse.v4","cloudProjectId":PARENT},
                  "sourceFiles":[{"name":"CinePulse_Source.srt","text":src}]}
            archive=root/"Peter.zip"
            with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:
                z.writestr("CinePulse_Project.json",json.dumps(base))
                z.writestr("CinePulse_Source.srt",src)
                z.writestr("CinePulse_English.srt",json.dumps({"format":"srt","text":srt(5,400)}))
                z.writestr("CinePulse_Urdu.srt",json.dumps({"format":"srt","text":srt(5,400)}))
                z.writestr("Scene_Intelligence.sqlite",b"SQLite format 3\\x00"+b"0"*512)
                z.write(audio,"CinePulse_English.mp3")
                z.write(audio,"CinePulse_Urdu.mp3")
            dest=root/"SceneLab_SharedAssets"
            subprocess.run([sys.executable,str(TOOLS),str(archive),"--output",str(dest)],check=True,capture_output=True,text=True)
            prep=json.loads((dest/"SceneLab_Prep.json").read_text(encoding="utf8"))
            self.assertEqual(len(prep["excerpts"]),4)
            self.assertAlmostEqual(sum(e["endSeconds"]-e["startSeconds"] for e in prep["excerpts"]),300,delta=.25)
            self.assertGreater(prep["englishAudio"]["bytes"],10000)
            self.assertGreater(prep["urduAudio"]["bytes"],1000)
            self.assertAlmostEqual(prep["englishAudio"]["durationSeconds"],300,delta=.25)
            self.assertAlmostEqual(prep["urduAudio"]["durationSeconds"],30,delta=.25)
            self.assertTrue((dest/"CinePulse_Project.json").exists())
            self.assertEqual(len(prep["englishCues"]),80)
            self.assertTrue((dest/"CinePulse_English.srt").read_text().startswith("1\n00:00:00,000"))

if __name__=="__main__":unittest.main()
