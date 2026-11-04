#!/usr/bin/env python3
"""Construct an idempotent Deep Muse Scene Lab request using REAL previously
accepted Peter Rabbit assets. Does not regenerate media, narration or cuts.

Usage:
 python3 tools/scene_lab_deep_payload.py \
   --original Peter.zip \
   --shared CinePulse_SceneLab_SharedAssets_PeterRabbit.zip \
   --control CinePulse_Project_Experiment01.json \
   --output SceneLab_Deep_Muse_Request.json

Upload the generated JSON to POST /v1/scene-lab/deep with admin auth.
"""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

PARENT="81febfe9-bcf4-4a96-ab4c-2a9226503ea1"
WORKER="ddd753f6-769c-4c31-9400-667a38a9f185"
def stamp(x):
    if isinstance(x,(int,float)):return float(x)
    m=re.fullmatch(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})",str(x).strip())
    if not m:raise ValueError("Invalid Windows timestamp: "+str(x))
    h,mn,s,ms=map(int,m.groups())
    return h*3600+mn*60+s+ms/1000

def cues_from_srt(raw):
    text=raw.strip()
    if text.startswith("{"):
        data=json.loads(text)
        if data.get("format")!="srt" or not isinstance(data.get("text"),str):
            raise ValueError("Invalid Muse JSON SRT envelope")
        text=data["text"]
    cues=[]
    for block in re.split(r"\n\s*\n",text.replace("\r\n","\n").strip()):
        rows=block.split("\n")
        if rows and rows[0].strip().isdigit():rows.pop(0)
        if len(rows)<2:continue
        match=re.match(r"^(\d\d:\d\d:\d\d[,.]\d{3})\s*-->\s*(\d\d:\d\d:\d\d[,.]\d{3})",rows[0])
        if not match:continue
        a,b=stamp(match.group(1)),stamp(match.group(2))
        if b<=a:raise ValueError("Invalid measured cue")
        cues.append({"startSeconds":a,"endSeconds":b,"text":"\n".join(rows[1:]).strip()})
    if not cues:raise ValueError("No measured narration cues")
    return cues

def entries(z):
    return {Path(name).name:name for name in z.namelist() if not name.endswith("/")}

def get(z,name):
    named=entries(z)
    if name not in named:raise ValueError("Missing required source asset: "+name)
    return z.read(named[name])

def duration(raw):
    with tempfile.NamedTemporaryFile(suffix=".mp3") as tmp:
        tmp.write(raw);tmp.flush()
        result=subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration",
            "-of","default=noprint_wrappers=1:nokey=1",tmp.name],text=True)
    return float(result.strip())

def control_cuts(project):
    if project.get("cloudImport",{}).get("schema")!="cinepulse.windows-muse.v4":
        raise ValueError("Pilot control project is not Muse V4")
    track=project.get("tracks",{}).get("hindiUrdu")
    if not isinstance(track,dict) or len(track.get("cuts",[]))!=6:
        raise ValueError("The rendered Experiment 01 must supply exactly six Urdu control cuts")
    output=[]
    for cut in track["cuts"]:
        output.append({
            "narrationStartSeconds":stamp(cut["audioStart"]),
            "narrationEndSeconds":stamp(cut["audioEnd"]),
            "sourceStartSeconds":stamp(cut["movieStart"]),
            "sourceEndSeconds":stamp(cut["movieEnd"]),
        })
    if abs(output[-1]["narrationEndSeconds"]-29.699)>.26:
        raise ValueError("This is not the known 29.699-second Urdu control")
    return output

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--original",required=True,help="Unmodified original Peter.zip")
    p.add_argument("--shared",required=True,help="Existing extracted Scene Lab shared assets ZIP")
    p.add_argument("--control",required=True,help="Rendered Experiment 01 Muse V4 CinePulse_Project.json")
    p.add_argument("--output",default="SceneLab_Deep_Muse_Request.json")
    p.add_argument("--request-id",default="peter-rabbit-81febfe9-deep-muse-pilot-01")
    args=p.parse_args()
    with zipfile.ZipFile(args.original) as original,zipfile.ZipFile(args.shared) as shared:
        baseline=json.loads(get(original,"CinePulse_Project.json").decode("utf-8-sig"))
        source=get(original,"CinePulse_Source.srt").decode("utf-8-sig")
        other=get(shared,"CinePulse_Source.srt").decode("utf-8-sig")
        if source!=other:raise ValueError("Original/shared source movie SRT mismatch")
        if baseline.get("cloudImport",{}).get("cloudProjectId")!=PARENT:
            raise ValueError("Parent project UUID mismatch")
        if baseline.get("sourceFiles",[{}])[0].get("text")!=source:
            raise ValueError("Original V4 embedded movie SRT does not match source asset")
        en_cues=cues_from_srt(get(original,"CinePulse_English.srt").decode("utf-8-sig"))
        en_mp3=get(shared,"CinePulse_English.mp3")
        ur_mp3=get(shared,"CinePulse_Urdu.mp3")
        ur_srt=get(shared,"CinePulse_Urdu.srt").decode("utf-8-sig")
        ur_cues=cues_from_srt(ur_srt)
        e_dur,u_dur=duration(en_mp3),duration(ur_mp3)
        control=json.loads(Path(args.control).read_text(encoding="utf-8-sig"))
        control_id=control.get("cloudImport",{}).get("sceneLab",{}).get("parentProjectId")
        if control_id!=PARENT:raise ValueError("Control project does not reference original Peter Rabbit movie")
        prep=json.loads(get(shared,"SceneLab_Prep.json").decode("utf-8-sig"))
        excerpts=prep["excerpts"]
        if len(excerpts)!=4:raise ValueError("Expected four previously verified English narration excerpts")
        total=sum(e["endSeconds"]-e["startSeconds"] for e in excerpts)
        if abs(total-298.321)>.25 or abs(total-e_dur)>.25 or abs(u_dur-ur_cues[-1]["endSeconds"])>.25:
            raise ValueError("Shared audio and SRT durations are not the same controlled experiment")
        m={
            "requestId":args.request_id,"workerId":WORKER,"parentProjectId":PARENT,
            "strategy":"classic_reconstruction","excerpts":excerpts,
            "sourceSrt":source,"sourceSrtSha256":hashlib.sha256(source.encode("utf-8")).hexdigest(),
            "baselineProject":baseline,"englishCues":en_cues,"urduSrt":ur_srt,
            "urduCuts":control_cuts(control),
            "narrations":{"english":get(shared,"CinePulse_English_Narration.txt").decode("utf-8-sig"),
                          "urdu":get(shared,"CinePulse_Urdu_Narration.txt").decode("utf-8-sig")},
            "mp3Manifest":{
                "english":{"filename":"CinePulse_English.mp3","bytes":len(en_mp3),
                           "sha256":hashlib.sha256(en_mp3).hexdigest(),"durationSeconds":e_dur},
                "urdu":{"filename":"CinePulse_Urdu.mp3","bytes":len(ur_mp3),
                        "sha256":hashlib.sha256(ur_mp3).hexdigest(),"durationSeconds":u_dur}
            }
        }
    dest=Path(args.output)
    dest.write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"output":str(dest.resolve()),"workerId":WORKER,
        "parentId":PARENT,"englishDuration":e_dur,"urduDuration":u_dur,
        "englishOriginalCues":len(en_cues),"englishExcerpts":excerpts,
        "controlCuts":len(m["urduCuts"]),"sourceSrtSha256":m["sourceSrtSha256"],
        "note":"Only a request payload; Muse must run all 11 semantic matching batches after creation."},indent=2))
if __name__=="__main__":main()
