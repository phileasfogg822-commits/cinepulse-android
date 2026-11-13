# The BFG (2016) — V5-G source-SRT-only pilot on INT

**Status:** original 1,239-cue SRT verified and 83 source-linked **draft** digest beats prepared offline. Prototype validators and CI tests are isolated. No new live project has been created, no existing INT movie was changed, and no production feature was enabled.

## Inputs
- Original source file: `The BFG (2016)-ad0628bf.srt` (80,157 bytes).
- SHA-256: `c8ba15b4dd98e7d5c50266f2d01fcb689c0d5fb15fd63b240802f91bf91c9268`.
- Numbered source cues: 1,239. First cue 00:01:21.596; last ends 01:49:30.540.
- **No movie MP4, frames, thumbnails, extracted video index, vision model, source-video hash, or visual review. No need to upload movie footage.**

## Source-grounded workflow
1. Intake and verify original source SRT, exact cue IDs/quotes and the pinned file hash.
2. Write digest story beats supported by specific SRT cue IDs/quotes and timestamps. Paraphrase dialogue naturally; never invent scenes or assert what uncaptioned frames show.
3. Prepare an **SRT-source-anchor blueprint** linking digest beat ID → source cue(s) → source time window. This is an evidence plan, **not a verified video scene map**.
4. Write English and Urdu narration units linked to beat IDs. Validate full source→beat→narration traceability **before MP3**.
5. Generate English and Urdu MP3 via permitted remote TTS; produce measured SRTs from audio, preserving truthful timecodes. Treat a short sentence as one semantic matching unit even if STT made multiple subtitle cues.
6. Global dry run: rank SRT evidence semantically for both languages, resolve source-cue/time allocation conflicts, preserve 9/10 **subtitle-grounded semantic relevance** quality and independent source-quote verification.
7. Apply only safe five-cue checkpoints in order. Preserve all accepted work. CAR only after proven failure and independent correction; do not assign arbitrary free cues.
8. Validate full bilingual measured SRT coverage, non-overlap and final cut plan; prepare Windows project. Actual video would be attached locally for rendering only, not a processing or matching input.

## Uncaptioned intervals and sound captions
The SRT has 195 intervals of at least five seconds with no subtitle captions. Such a gap **does not prove silence, dinosaurs, fighting, movement, or any other visual action**. The pipeline records gaps for optional timing/context only and never blocks on footage inspection. If the source SRT itself contains a sound/action caption, such as `(CLOCK TOWER CHIMING)`, its exact cue text and time may ground a story beat.

## Pilot evidence and boundaries
The offline package includes the complete 1,239-cue source inventory and 83 source-linked provisional digest beats. These must pass story and narration quality review before applying them. There is no 9/10 **visual** verification; the 9/10 standard is limited to SRT-grounded semantic matching.

This code does **not** create a new live BFG movie on Worker INT and does not enable the new pipeline in the production Cloudflare backend. The existing INT BFG project `796b9f28-9f31-484f-91e2-e40a385950c6` and accepted English/Urdu decisions remain unchanged.

## Context-aware uncaptioned intervals (no movie footage)
Uncaptioned SRT intervals are **not thrown away**. `src/srt-interval-context.mjs` records their exact duration, up to three original dialogue/caption cues **before** and **after**, and literal bracketed sound/action captions nearby with original cue numbers/times. Nearby captions are labelled outside the gap; their presence does **not** assert what was visible during the gap.

During the digest, Muse should examine every contextual interval, prioritize those with supported sound/action cues (e.g. footsteps, growls, sighs, chirping, explosions, fighting explicitly named by a caption) and story continuity on both sides. A suggested beat must cite the exact surrounding SRT cues. Where context is ambiguous, record it as an unverified transition rather than invent a physical action. A bracketed cue can support the event stated in its text, not an arbitrary creature, character or scene beyond that text.

This improves the source-backed synopsis and future scene-choice candidates without introducing visual/video inspection, relaxing the 9/10 semantic standard, or enabling writes to the original BFG project.

### Digest citation for important silent / uncaptioned context
The BFG offline audit now includes a timecoded record for all 195 long SRT gaps, with the three neighboring cues before/after and bracketed captions. The digest validator supports an explicit `srt_context` beat for transitions linked to two real adjacent cues; a stronger `caption_supported_context` citation must quote a real nearby bracketed caption. Every such beat still requires semantic review and is never automatically visually verified.
