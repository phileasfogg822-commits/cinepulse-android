# CinePulse Classic Scene Matching Recovery — 2026-11-02

Status: investigation branch; NOT production deployed.

## Verified desktop source
User-supplied CinePulse Desktop v3.8.28 source archive contains `src/lib/classic-scene-match.ts`.
- `classicSrtCandidates` uses whole-movie ranked subtitle evidence per small narration batch.
- `validateMuseSrtMatch` rejects source intervals absent from candidate evidence and requires >=90% narration coverage per segment.
- Default desktop matching batch size: 5 segments (verify call site before porting).

## Existing backend
`cloudflare/cinepulse-android/src/server-cut-planner.mjs` includes `allocateFromCues` and `allocateFinalLongFormCuts`.
Its global `movie_source_srt_fallback` is NOT semantic evidence and MUST NOT be auto-accepted as a relevant cut.
`muse-production-contract.mjs` currently delegates all final cut authoring to Muse.

## Required implementation gates
1. Recover actual desktop online matcher prompts, call sites, batch checkpointing and candidate ranking.
2. Port small-batch matching and evidence validation to cloud worker protocol; maintain per-language clocks and project isolation.
3. Reuse deterministic JavaScript allocator only for evidence-backed anchors; unresolved clips must request targeted Muse retries, not global arbitrary fallback.
4. Preserve prior Peter Rabbit project a4350f48-2f4d-4c76-bb9e-e554e1ac00eb, MP3/SRT, 219-clip baseline and ProjectState; create a versioned revision.
5. Inspect Windows offline import and FFmpeg command generation; assert source timestamps survive import and render unmodified.
6. Add regression tests for batching, coverage, evidence, retries, fallback refusal, exact FFmpeg intervals, and both language tracks.
7. Build Windows installer with Windows GitHub Actions runner, test artifacts, deploy staging Cloudflare only after green tests, then promote production explicitly.
8. Never claim visual relevance proven by timestamp tests. Compare sample outputs with prior 1/10 baseline.

No movie upload or regeneration of TTS/STT is required for this investigation.
