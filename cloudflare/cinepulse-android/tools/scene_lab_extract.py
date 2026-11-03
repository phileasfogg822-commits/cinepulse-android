#!/usr/bin/env python3
"""CinePulse Scene Lab: deterministic lossless-source, decoded/re-encoded MP3 excerpt preparation.
Run INSIDE the Muse worker environment with the supplied original Peter.zip.
No TTS/STT, no modification of original files or cloud projects.
Requires ffmpeg and ffprobe on PATH.
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

STAMP = re.compile(r"^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})")
def sec(parts):
    h,m,s,ms=map(int,parts)
    return h*3600+m*60+s+ms/1000
def stamp(x):
    ms=round(x*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"
def unwrap(text):
    if text.lstrip().startswith("{"):
        obj=json.loads(text)
        if obj.get("format")!="srt" or not isinstance(obj.get("text"),str):raise ValueError("Invalid Muse SRT JSON envelope")
        return obj["text"]
    return text
def parse(text):
    cues=[]
    for block in re.split(r"\n\s*\n",unwrap(text).replace("\r\n","\n").strip()):
        lines=block.split("\n")
        if lines[0].strip().isdigit(): lines=lines[1:]
        if not lines:continue
        match=STAMP.match(lines[0])
        if not match:continue
        a,b=sec(match.groups()[:4]),sec(match.groups()[4:])
        if b<=a:raise ValueError("Invalid measured subtitle cue")
        cues.append({"startSeconds":a,"endSeconds":b,"text":"\n".join(lines[1:]).strip()})
    if not cues:raise ValueError("No measured subtitles")
    return cues
def choose(cues):
    starts=[0,90,185,290]
    spans=[];last=0
    for start in starts:
        candidates=[c["startSeconds"] for c in cues if c["startSeconds"]>=last and abs(c["startSeconds"]-start)<18]
        if not candidates:raise ValueError("No safe cue start near requested region")
        a=min(candidates,key=lambda x:abs(x-start))
        endings=[c["endSeconds"] for c in cues if 60<=round(c["endSeconds"]-a,3)<=90 and c["endSeconds"]<=cues[-1]["endSeconds"]]
        if not endings:raise ValueError("No cue end 60–90s from start")
        b=min(endings,key=lambda x:abs((x-a)-75))
        if spans and a<spans[-1]["endSeconds"]:raise ValueError("Excerpts overlap")
        spans.append({"startSeconds":round(a,3),"endSeconds":round(b,3)})
        last=b
    return spans
def rebase(cues,spans):
    result=[];offset=0
    for span in spans:
        a,b=span["startSeconds"],span["endSeconds"]
        for c in cues:
            if c["startSeconds"]>=a-0.0001 and c["endSeconds"]<=b+0.0001:
                result.append({"startSeconds":round(offset+c["startSeconds"]-a,3),
                               "endSeconds":round(offset+c["endSeconds"]-a,3),"text":c["text"]})
            elif c["startSeconds"]<b-0.0001 and c["endSeconds"]>a+0.0001:
                raise ValueError("Excerpt boundary splits measured cue")
        offset+=b-a
    return result
def srt(cues):
    return "\n\n".join(f'{i}\n{stamp(c["startSeconds"])} --> {stamp(c["endSeconds"])}\n{c["text"]}' for i,c in enumerate(cues,1))+"\n"
def ffprobe(file):
    x=subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",str(file)],text=True)
    return float(x.strip())
def hashfile(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
    return h.hexdigest()
def audio(infile,outfile,spans):
    filters=[]
    for i,span in enumerate(spans):
        filters.append(f'[0:a]atrim=start={span["startSeconds"]:.3f}:end={span["endSeconds"]:.3f},asetpts=PTS-STARTPTS[a{i}]')
    filters.append("".join(f"[a{i}]" for i in range(len(spans)))+f"concat=n={len(spans)}:v=0:a=1[out]")
    command=["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y","-i",str(infile),
             "-filter_complex",";".join(filters),"-map","[out]","-c:a","libmp3lame","-q:a","3",str(outfile)]
    subprocess.run(command,check=True)
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("zip",help="Original Peter.zip from Muse / user")
    ap.add_argument("--output",default="SceneLab_SharedAssets")
    ap.add_argument("--parent",default="81febfe9-bcf4-4a96-ab4c-2a9226503ea1")
    opt=ap.parse_args()
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):raise SystemExit("FFmpeg and FFprobe required")
    out=Path(opt.output).resolve();out.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as temp,zipfile.ZipFile(opt.zip) as archive:
        names={Path(n).name:n for n in archive.namelist() if not n.endswith("/")}
        needed=["CinePulse_Project.json","CinePulse_Source.srt","CinePulse_English.mp3",
                "CinePulse_Urdu.mp3","CinePulse_English.srt","CinePulse_Urdu.srt",
                "Scene_Intelligence.sqlite"]
        if any(n not in names for n in needed):raise ValueError("Original ZIP is incomplete")
        for n in needed:
            (Path(temp)/n).write_bytes(archive.read(names[n]))
        base=json.loads((Path(temp)/"CinePulse_Project.json").read_text(encoding="utf-8"))
        if base.get("cloudImport",{}).get("cloudProjectId")!=opt.parent:raise ValueError("Parent project mismatch")
        en=parse((Path(temp)/"CinePulse_English.srt").read_text(encoding="utf-8"))
        ur=parse((Path(temp)/"CinePulse_Urdu.srt").read_text(encoding="utf-8"))
        ex=choose(en);rebased_en=rebase(en,ex)
        ends=[c["endSeconds"] for c in ur if 29.5<=c["endSeconds"]<=30.5]
        if not ends:raise ValueError("No measured Urdu cue ending between 29.5 and 30.5s")
        ue=min(ends,key=lambda x:abs(x-30));us=[{"startSeconds":0.0,"endSeconds":round(ue,3)}]
        rebased_ur=rebase(ur,us)
        english_duration=sum(e["endSeconds"]-e["startSeconds"] for e in ex)
        audio(Path(temp)/"CinePulse_English.mp3",out/"CinePulse_English.mp3",ex)
        audio(Path(temp)/"CinePulse_Urdu.mp3",out/"CinePulse_Urdu.mp3",us)
        measured={"english":ffprobe(out/"CinePulse_English.mp3"),"urdu":ffprobe(out/"CinePulse_Urdu.mp3")}
        if abs(measured["english"]-english_duration)>.25 or abs(measured["urdu"]-ue)>.25:raise ValueError("Extracted MP3 timing does not agree with cues")
        (out/"CinePulse_English.srt").write_text(srt(rebased_en),encoding="utf-8")
        (out/"CinePulse_Urdu.srt").write_text(srt(rebased_ur),encoding="utf-8")
        (out/"CinePulse_English_Narration.txt").write_text(" ".join(c["text"] for c in rebased_en),encoding="utf-8")
        (out/"CinePulse_Urdu_Narration.txt").write_text(" ".join(c["text"] for c in rebased_ur),encoding="utf-8")
        for name in ["CinePulse_Source.srt","CinePulse_Project.json","Scene_Intelligence.sqlite"]:
            shutil.copyfile(Path(temp)/name,out/name)
        manifest={"mode":"scene_matching_lab","language":"english","parentProjectId":opt.parent,
                  "excerpts":ex,"urduControl":{"startSeconds":0,"endSeconds":round(ue,3)},
                  "englishAudio":{"durationSeconds":measured["english"],"bytes":(out/"CinePulse_English.mp3").stat().st_size},
                  "urduAudio":{"durationSeconds":measured["urdu"],"bytes":(out/"CinePulse_Urdu.mp3").stat().st_size},
                  "englishCues":en,
                  "sha256":{p.name:hashfile(p) for p in out.iterdir() if p.is_file()},
                  "note":"Shared media only. NOT a completed renderable project until Muse supplies validated strategy-specific cuts."}
        (out/"SceneLab_Prep.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
        print(json.dumps({"output":str(out),"excerpts":ex,"englishSeconds":measured["english"],"urduSeconds":measured["urdu"],"audio":"verified","next":"Muse scene matching and V4 cut-plan package"},indent=2))
if __name__=="__main__":main()
