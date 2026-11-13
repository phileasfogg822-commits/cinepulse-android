# CinePulse V5 — source-grounded story blueprint (isolated prototype)

**Status:** Read-only independent validation module. NOT wired into live digest, narration, MP3, SRT, queue, CAR, or rendering. No production deployment.

## Required movie pipeline
1. Intake the original movie SRT and, where available to an authorized worker, the video and its content hash.
2. Build chronological digest story beats, each citing original movie cue ID and exact evidence quote, or a separately verified visual event.
3. Build a scene blueprint for each digest beat. Repeated dialogue such as “Morning, Sophie” is tied to its distinct actual source timestamp, not a global phrase search.
4. Write English/Urdu narration units grounded in digest beat IDs. Narration may paraphrase the movie, but cannot invent events.
5. **Preflight before TTS:** check every narration unit has real digest/source lineage and identify competing source moments.
6. Generate real MP3 and measured narration SRT. Keep original subtitle timestamps. Align multiple measured subtitle cues to one semantic narration unit if the original sentence was split by STT. Do not create phantom one-second cuts.
7. Whole-film dry run and multilingual precision matching, with a genuinely independent quality review preserving the requested 9/10 goal.
8. Commit verified batches in existing order and allocate final 3–6s source footage without overlap within each language. Source dialogue evidence may support multiple semantic narration units but does not authorize duplicate final film footage.
9. Use CAR only for independently verified, truly unresolved exceptions; never a merely unused but irrelevant source cue.

## Visual-only/silent scenes
Movie SRT caption gaps are *candidates for video inspection*, not evidence of an actual silent event. Important reactions, dinosaur movement, fighting, discovery and mood shots must not be discarded merely because no one speaks. Confirm from the real video or reviewed frames, retain exact time range, media hash, observed event and verification reference. A worker assertion alone cannot prove that the pixels show the scene; actual video review is still required.

## Prototype
The pure function inspectStoryEvidenceBlueprint accepts sourceSrt, sourceMediaSha256, beats, narrationUnits and measuredCues. It fails closed on missing references, invalid quote evidence, unverified visual metadata, and missing/misordered real SRT cues. It outputs matching groups without rewriting subtitles or any accepted V5 checkpoint. findUncaptionedIntervals returns only unverified visual-inspection suggestions.

**Still to implement:** secure video ingestion/inspection, actual narration-to-voice alignment, source-grounded digest/narration formats, multilingual semantic scorer, global source-interval allocator, independent 9/10 quality rubric, and queue/apply integration. These require staged live-media validation and separate approvals. Preserve PR #25 and its three-target recovery cap; no BFG, Shrek 2 or other movie may resume from this prototype.
