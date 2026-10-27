# CinePulse Android v0.3.4 — Eight-file Windows export and Urdu 07:21 recovery

**Cloudflare is designed to expose only four downloadable verified source assets:** original Cloudflare JSON, English MP3, Urdu MP3, and original movie SRT. On a new app export, Android verifies these four assets with manifest byte-count and SHA-256, then generates the four additional Windows assets: a Windows-native JSON, both narration SRT files and both narration text files (8 total: note that the Windows JSON replaces Cloudflare's JSON in the output). This is not a backend failure or evidence that Cloudflare lacks eight assets.

Previously `prepareBundle()` performed strict final-cut allocation **before** creating the Downloads folder. Failure from exhausted localized Urdu source windows (e.g. `00:07:21`) aborted package creation, deleted private staging files, and appeared to users as zero saved files.

Now the allocator uses ordered steps:
1. Closest supported Cloudflare language-specific source windows, with unused subtitle timestamps.
2. Nearby alternative language-specific windows that overlap narration time.
3. **Unallocated source-SRT cue timestamps anywhere in the movie timebase**, prioritizing proximity to the expected scene location. This third method is labeled `source_srt_timeline_fallback` and deliberately receives lower confidence. It does not claim visual correctness or scene semantics.

All three paths enforce exactly contiguous audio coverage, 3–6 seconds per clip, and zero source interval reuse *within each language*. MP3 duration is measured on Android and narration SRT is independently checked. English and Urdu movies may legitimately reuse the same source film positions because they render separately.

### Successful Windows export — exactly eight files
`CinePulse_Project.json` (Windows-native, finalized cut plan),
`CinePulse_Source.srt`, `CinePulse_English.mp3`, `CinePulse_Urdu.mp3`,
`CinePulse_English.srt`, `CinePulse_Urdu.srt`,
`CinePulse_English_Narration.txt`, `CinePulse_Urdu_Narration.txt`.

### Rare remaining conversion errors — data-preserving recovery
If the four verified downloads are complete but conversion still cannot succeed (e.g. missing source SRT or audio/SRT timing mismatch), the APK writes a clearly labeled `-REVIEW-NOT-RENDER-READY` Downloads folder with nine files: the four verified Cloudflare originals, split narration SRT and text outputs, and `EXPORT_REVIEW_REQUIRED.txt`. The original JSON is named `CinePulse_Original_Cloud_Project.json` specifically to prevent accidental Windows import as a finished project. The Share ZIP command follows the same recovery naming.

No Cloudflare Worker/D1/R2 changes are required for this Android allocator recovery. The backend continues to deliver the four signed assets.
