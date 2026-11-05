# CinePulse V5.4: Pakistani Urdu voice and narration QA

## Why this exists

Audit of a completed historical film found:
- Approved narration text did **not** contain the repeated hallucinated wording heard in the processed English SRT around 13:41–14:13.
- The Urdu SRT contained duplicated fragments and non-Urdu scripts in multiple regions, especially at the beginning.
- Historical Urdu MP3 relied on a possible Hindi/Devanagari fallback; the text files alone cannot establish an acoustic root cause.
- Historical requested duration was 10 minutes while measured English/Urdu audio was approximately 17:15/24:29. The V5.1 duration rule covers future projects.

## New movies only

An immutable movie-specific digest marker `[CINEPULSE-V54-PAKISTANI-URDU-AUDIO-QA]` opts NEW permanent Muse V5 movies into these additional acceptance gates. Existing movies, accepted MP3s, SRTs, Deep Muse decisions, and Windows packages are not retroactively rewritten or requeued.

1. **Narration stage:** Require complete approved English narration and native Urdu-script Pakistani Urdu narration. Reject looping repeated long passages (3 repetitions of 8 English or 6 Urdu words in a short range), Devanagari/mixed scripts, and high-confidence unnatural Hindi-register terms with suggested Urdu equivalents. Muse must rewrite script BEFORE TTS rather than synthesizing a flawed script.
2. **Urdu MP3 stage:** Only accept the accompanying worker declaration of an actual `ur-PK` voice, provider, and voice ID; require native Urdu input script, `transliterated=false`, `hindiFallback=false`. The actual audio asset is still physically required by the existing backend. If no suitable Urdu voice exists, Muse must report unresolved instead of silently switching to Hindi.
3. **Measured English/Urdu SRT stage:** Require real timed cues in plain SRT or existing approved JSON-envelope format. Reject three nearby repeats of long phrases, foreign script garbage in Urdu, excessive Latin intrusion, and stretches of six consecutive captions that share no n-gram with the approved original narration. Preserve audio, return 422, and correct the affected stage before Deep matching.
4. **Next stages:** Deep matching is allowed only after bilingual SRT results are accepted by existing timing AND these new integrity checks.

## What these checks cannot establish

An LLM worker's voice-locale declaration is **not independent acoustic verification**. Actual linguistic naturalness and accent still require a native Pakistani Urdu listener or independently verified audio analysis. A transcript discrepancy can arise from bad TTS chunk stitching OR STT hallucination. Listen to the suspect MP3 span and compare it to the approved script before deciding which module to rerun. Never change final cuts to hide a voice defect, and never fabricate subtitle timing.

## Privacy and scope

No movie SRT, project transcript, worker token, audio, or user-specific data is committed to the repository. Tests use synthetic text. Existing projects keep their durable policy and jobs, and the correction adds no new Cloudflare storage bucket or database migration.
