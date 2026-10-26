# CinePulse Android v0.3.2: two long-form videos only

**Authoritative mobile request**: Cloudflare receives `outputMode:
"long_form_only"` and `modules` with `shorts:false`, `virals:false`,
`metadata:true`, two languages, digest, measured SRT and final scene cuts
enabled. The backend must independently acknowledge/enforce this request;
older Cloudflare deployments may ignore unknown fields and continue optional
jobs. This Android repository does not contain or deploy the Cloudflare Worker
or the Windows Tauri application.

## Actual scene data
`sceneMatches` (e.g. 13 references for A Minecraft Movie) and the
per-language `cutPlan` entries are *long-form scene search references*, **not**
individual Shorts or viral video tasks. `viralScenes` are explicitly
separate optional ideas and are ignored by the Android Windows exporter.

## Strict export rules
The Android exporter verifies the original signed Cloudflare JSON, both MP3s
and the source SRT by declared SHA-256 + exact byte count. It checks:

- Original source SRT: at least 75 subtitle cues and >=55-minute timestamps.
- Both script narrations, narration SRTs, digest and metadata present.
- Measured English and Urdu MP3 length vs the last narration SRT timestamp
  <=max(3 seconds,1.5% of the MP3 duration).
- Narration-SRT lexical overlap for English >=70%, Urdu >=45% where measurable.
- Source scene anchors found for all narration windows.
- One uninterrupted cut timeline per language, zero timeline gaps or overlaps,
  each clip <=6 seconds, and the total cut duration equals the measured MP3.
- No overlapping movie-source clips **within the same language**. English and
  Urdu can independently use the same film footage.
- No fabricated source frames: a plan is rejected if subtitle evidence is
  missing or cannot supply enough distinct frames.

The cut plan may be *subtitle-grounded*, but without access to the original
video the APK cannot validate actual frames, scene accuracy, or whether the
Windows video uses the exact same cut of the movie. The exported
`cloudImport.sourceVideoFrameVerified` remains false.

**Important:** An import with final subtitle-based cuts is not equivalent to
a rendered-and-frame-validated finished video. Video and its duration must be
verified by the Windows render process.

## Eight requested output files
`CinePulse_Project.json` — **native Windows ProjectState**, not Cloudflare JSON
`CinePulse_Source.srt` — movie's original source subtitles
`CinePulse_English.mp3` and `CinePulse_Urdu.mp3` — measured voices
`CinePulse_English.srt` and `CinePulse_Urdu.srt` — narration timing
`CinePulse_English_Narration.txt` and `CinePulse_Urdu_Narration.txt` — scripts.

All eight are included in one share ZIP or Android Downloads/CinePulse folder.
No viral/Short clips, ancillary manifest JSON, helper BAT, or social clips.

## Windows integration requirement
Windows *Import team project* can parse `CinePulse_Project.json` as a
ProjectState. Its existing import may **not** automatically resolve relative
`tracks.<language>.mp3Path` sibling MP3 paths. A desktop importer update
must resolve paths relative to the selected JSON file, reverify each MP3's
SHA-256 against `cloudImport.audio`, probe durations and mark them verified.
The Windows application still needs the user's actual local source video path.
In the Windows rendering package, the two long-form jobs must be independent
of Shorts/Viral jobs; `metadata` should not trigger optional video production.
See the separately supplied Windows source-only optional-clip patch. Do not
claim a fully render-only Windows workflow until these Windows-side changes
are deployed and tested.

## Test policy
The Android GitHub Actions job runs security checks, lint, unit tests,
standard and preview APK assembly. Unit tests assert 8-file count, two final
cut timelines, no overlaps, exact MP3 coverage, no short/viral data, and
appropriate refusals of incomplete source/audio.
