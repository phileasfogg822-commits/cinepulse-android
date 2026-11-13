# CinePulse V5-G — Source-SRT-only grounded matching (isolated prototype)

**Authoritative input:** original movie SRT; no movie video file, frame inspection, visual index, media hash, or verified footage gate.

## Stage order
1. Source SRT intake and exact cue ID/timestamp/quote validation.
2. Digest story beats citing exact source cues. Important sound effects/action captions are usable only when the SRT explicitly states them.
3. Source anchor blueprint: beat ID, one or more original cue IDs, quote and source time window. This is a subtitle evidence map, not a claim about on-screen visuals.
4. English and Urdu narration units must reference their source-backed digest beats. Run all-document pre-TTS coverage review to find unsupported claims.
5. Generate MP3 and authentic measured narration SRT. One short sentence stays **one semantic matching group** even if STT splits its words into multiple SRT cues; do not forge or change actual timestamps.
6. Whole-movie bilingual **SRT-semantic** dry-run and precision rematching. Score source relevance against narration at the agreed 9/10 target, demand independently checked original cue quotes, and reject ambiguous or unsupported lines. A declared 0.90 confidence alone is not proof of quality.
7. Apply verified five-segment checkpoints in order; later final 3–6-second cut planning uses matched source *time intervals* without same-language overlap, and Windows renders with the movie file locally.
8. CAR as a last resort for proven failures, never an arbitrary unoccupied cue.

## Silent intervals without video
Missing subtitle captions for a period are only **uncaptioned time intervals**. They do not prove the film is silent, what people are doing, or the presence of a dinosaur/action/character. We keep these markers for optional story-position context but **never infer visual events from them**. Actual dialogue or sound/action captions in the SRT remain available as factual evidence.

## Quality and scope
The established 9/10 goal now refers to **semantic relevance established from the movie SRT**. Without actual movie footage, the system must not claim nine-out-of-ten *visual matching*. This stage works from source SRT → digest → narration → real MP3/SRT → subtitle-grounded matching → cut plan.

**Status:** read-only prototype validators in Draft PR #26; no production deployment, no change to the existing BFG/other movies, no CAR modification, and no claim that the full automatic queue is implemented. Further implementation is needed to integrate source-backed output schemas and proof into the production intake/digest/narration/worker queue and finish a real pilot.

## Contextual silence / uncaptioned segments (required SRT-only review)
The system must consider uncaptioned intervals instead of skipping them. For each gap, preserve its start/end/duration, several original dialogue cues immediately before and after, and nearby *literal* bracketed audio/action captions such as `(FOOTSTEPS APPROACHING)`, `(GASPS)`, `[BIRDS CHIRPING]` with exact cue/time. Rank caption-supported or strongly connected transitions for digest review before choosing supported source anchors. Do **not** treat an uncaptioned period as confirmed audio silence, claim a dinosaur was on screen, or manufacture a visual event. No video is required; any unsupported action remains explicitly an inference, not a verified movie fact.
