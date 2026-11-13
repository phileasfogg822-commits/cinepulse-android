# CinePulse Worker 1 = V5-G, INT = prior production pipeline

## Operator decision (November 13, 2026)
- **Worker 1**: source-SRT-only new V5-G pipeline for new movies: original source SRT intake, digest, validated source-grounded evidence+anchor blueprint, English & Urdu narration, pre-TTS checkpoint, metadata, MP3 and actual narration SRTs, global bilingual evidence/matching plan, 5-cue deep matching, cut planning, Windows export.
- **INT**: retain original permanent V5 Muse workflow for **new** submissions, and all its existing movie history/accepted checkpoints.
- Historical projects always select stages by their original saved digest job prompt marker. A worker's later routing change must **not** migrate previously created project jobs.
- Safe emergency disable: `CINEPULSE_V5G_DISABLED=true` routes new Worker 1 projects to old V5; already created grounded projects keep their immutable V5-G marker.
- For now the **exact normalized backend Worker label** must be `Worker 1` (case/spacing/underscore/hyphen tolerated). Unknown labels fail closed into previous workflow. Verify backend `GET /v1/workers` on the authorized account before assuming Worker 1 matches this route. Do **not** configure a client-side Worker 1 ID from memory.
- Do not route INT into V5-G, even if a client asks for it.
- Android APK continues to upload only the original movie SRT, with existing worker selection. The worker creates all derived artifacts from backend tasks.

## BFG handoff and preservation
The current BFG V5-G pilot was processed offline by Muse through Stages 1–12; it is **not** a live job. Its original INT project `796b9f28-9f31-484f-91e2-e40a385950c6` must never be overwritten. A NEW project on **Worker 1** needs a fresh project ID and its original 1,239-cue source SRT. Muse can reuse approved offline data **only if** every stage is submitted to the correct new Worker 1 lease and passes exact checksum, output schema and backend gate. Never copy old D1 job IDs, old lease tokens or accepted checkpoint rows.

The user says Muse preserved a 64-file BFG ZIP package, but that package is **not available as a mounted attachment in this chat as of this engineering update**; its contents, check codes and audio have not been independently verified here. Do not claim that it was imported or that the new Worker 1 queue is processing it. Gate B must finish with CI, dry-run, staging and safe guarded production deploy before Muse can claim new jobs.
