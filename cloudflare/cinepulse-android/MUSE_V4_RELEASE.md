# CinePulse V4 — Muse owns all planning and final files

**Owner for NEW movies**: remote Muse worker. **Server**: Cloudflare acts as authenticated queue, verifier, original MP3/file storage, and signed delivery. **Android**: byte-for-byte downloader. **Windows**: local video renderer.

## What every Muse task includes
- Movie title and immutable movie project UUID.
- Full movie-stage instructions (the same production contract on every task).
- Relevant earlier stage outputs in `previousOutputs`.
- The unmodified source SRT through `sourceSrtAsset.path`.
- For audio/SRT stages: `inputAsset.path` for the physical MP3 where applicable.
- `audioManifest` with original filenames, SHA-256 and byte sizes.
- Clear stage ownership: no Shorts, virals, or Cloudflare-generated cuts.

## New-only Muse stage order
Digest → English narration → Urdu narration → publishing metadata →
English MP3 → English MEASURED SRT → Urdu MP3 → Urdu MEASURED SRT →
scene matching → **Muse final cut plan** → **Muse native Windows ProjectState JSON**.

Muse is solely responsible for splitting the English and Urdu explanations into timestamped 3–6-second clips, selecting relevant non-overlapping source-SRT intervals, repairing exhausted scene windows, and matching the complete measured SRT narration durations. Muse authors the final native Windows JSON directly.

Cloudflare DOES NOT use the server cut planner for V4. Cloudflare only rejects output violating numerical invariants, incorrect movie IDs, missing SRT/narration, altered shots, or invalid MP3 manifests. It feeds the failure reason back into the Muse task and keeps it undelivered until corrected. Cloudflare copies the accepted texts and original MP3s to the exact eight signed Windows deliverables; no Android model code runs. The JSON is stored as Muse authored it.

## Compatibility
Older projects remain on their originally selected V2/V3 stage plans (including V3 server-owned cuts), identified by immutable digest-job markers. No D1 or R2 schema migrations, no deleting or restarting running movies.

## What a test cannot establish without real Muse and media
Unit tests, Wrangler dry run, preview health and production deployment confirm structure/security, not that the deployed Muse instance has actually executed a complete new movie. MP3 true playback length is established by remote TTS/STT run by Muse, not independently measured by Cloudflare. Android rechecks file integrity; Windows still must resolve local MP3 files and attach the matching original movie to render.
