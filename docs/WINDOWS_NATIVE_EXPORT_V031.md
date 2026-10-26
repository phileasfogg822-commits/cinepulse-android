# CinePulse Android 0.3.1 → Windows native import

The APK fetches and verifies four Cloudflare assets before publishing any files:
original `export_json`, English MP3, Urdu MP3 and original movie SRT. Signed
download URL host/path/expiry validation and each asset's declared byte count
and SHA-256 checks are unchanged.

**Compatibility contract:** `CinePulse_Project.json` remains the unmodified
`cinepulse.render-project.v1` Cloudflare export for legacy Windows *Import cloud
package*. `CinePulse_Windows_Project.json` is a separate Windows-native
`ProjectState`, using `title`, `sourceFiles`, `analysis`, `tracks.english`,
`tracks.hindiUrdu` and `pipeline` keys from the Windows *Import team project*
flow. It includes verified narration SRT segments, text, metadata, and paused
raw scene-match checkpoints, but deliberately **does not** certify or produce
finished video cuts without checking the local video.

## Complete transfer

1. On Android choose **Download 4 files** (now exports the full 10-file
   interoperability bundle), or download the verified share ZIP.
2. Copy/extract **the complete movie folder** into a Windows folder; keep the
   MP3 filenames unchanged and keep all files together.
3. Double-click `Prepare_For_Windows.bat` in that folder. It requires the
   user's installed Node.js, performs **no network requests**, and checks both
   MP3 byte counts and SHA-256 hashes against the attached export manifest.
4. After successful verification it writes `CinePulse_Windows_Ready.json`,
   with **absolute Windows paths** to both verified MP3 files.
5. In the Windows CinePulse application, use **Import team project** and
   select `CinePulse_Windows_Ready.json`. The Windows application must
   independently probe MP3 duration and validate each measured narration SRT
   before scene matching or rendering.
6. Attach the actual local movie video and finalize English and Urdu scene
   matching against it. Only then render. Never use the cloud's broad
   `cutPlan` ranges as finalized short clips.

## Files created

- `CinePulse_Project.json` — original, signed-manifest-verified Cloudflare JSON.
- `CinePulse_Windows_Project.json` — native, portable project skeleton.
- `CinePulse_English.mp3`, `CinePulse_Urdu.mp3` — verified MP3 media.
- `CinePulse_Source.srt` — original source subtitle.
- `CinePulse_English.srt`, `CinePulse_Urdu.srt` — narration SRTs.
- `Prepare_For_Windows.bat`, `CinePulse_Prepare_Windows.js` — offline MP3 relinker.
- `CinePulse_Quality_Report.txt` — audit and review blockers.

The unmodified Cloudflare JSON and its scene evidence are retained; the
Windows-native project never fabricates source footage or falsely marks its
raw scene matches as completed. If the imported narration, MP3s and subtitle
text disagree, or source subtitle coverage is incomplete, correct those inputs
before rendering. Movie video cannot be packaged from Android because no
video is uploaded to Cloudflare.

Windows application compatibility is tested at the serialized ProjectState
structure level; final Tauri/FFmpeg playback still requires end-to-end
testing with actual media on Windows.
