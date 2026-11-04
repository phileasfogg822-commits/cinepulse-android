# Muse INT / CinePulse V5.1 — Current Urdu cut-plan recovery

**Scope: existing in-progress movie ONLY.** This is not a new movie and not a new experiment. Preserve the exact parent project UUID, worker, and all accepted bilingual Muse semantic checkpoints.

The report states that Urdu measured narration is approximately **24 minutes**, whereas the user selected **10 minutes**. Treat those as a report until the D1 read-only audit shows exact English and Urdu measured SRT end timestamps and the saved target. Do not invent an English duration.

## After Cloudflare V5.1 promotion

Check `GET /health` flags:
- `policy.urduAnchorWindowSeconds=25`
- `policy.englishAnchorWindowSeconds=12`
- `policy.narrationDurationPolicy=v5.1-strict-for-new-projects`

The current movie predates the hard-duration marker and keeps its **existing** accepted narration, MP3, SRT, 52+ Cue Muse decisions, and approved English cuts. **Never truncate the current Urdu audio to 10 minutes**; neither TTS regeneration nor a video-speed hack is authorized. The strict target will apply only to new projects started AFTER promotion.

## Existing `deep_cut_plan` repair

1. Recheck the currently active job and its lease with the existing worker token. A 422 result requires correcting the same active task while leased; do not submit a duplicate project.
2. Preserve the approved **English** plan exactly. Do not regenerate or rematch English.
3. Recalculate Urdu clips **71, 78, 79, 80** and nearby Urdu narration decisions **88–94**, as needed, based on the **original movie source SRT**. All 3–6 second cuts must be supported by their existing `matchSegmentIndices` and source cue evidence. Do not allow two source clips to overlap within Urdu.
4. Urdu may now choose film footage up to **25 seconds** outside its accepted Muse anchor, compared with 12 seconds for English. This is a *maximum source anchor selection distance*, never a longer clip, and never permission to invent or copy unrelated footage. Continue to prefer the closest genuinely relevant action/character match.
5. The reported 55 seconds of Urdu narration cannot fit into the previous 38-second source corridor (shortfall **17 seconds**, not five). The expanded maximum theoretical corridor from ~14 seconds of anchoring material is ~64 seconds; feasible **only if free movie source windows exist**, no other clips reserve them, and all source evidence remains relevant. If no valid placement exists within 25 seconds, report the exact failing clip and genuinely rematch the implicated narration segments; don't increase the limit again silently.
6. Resubmit the complete *already authored* English+Urdu `deep_cut_plan` object under its active task lease, not a new one. Existing validator requires all measured narration time covered, equal audio/movie clip durations, each 3–6 seconds, all source clips unique within each language.
7. Once validated, the ordinary `windows_project` V4 task must export eight signed Windows assets. Verify the physical MP3/SRT hashes remain unchanged.
8. If the task is explicitly in an error status and no active working/queued task remains, use the existing authenticated `POST /v1/projects/{projectId}/deep-muse/resume`; never restart accepted English/Urdu matching or regenerate audio.

## Mandatory report

- Project ID, target minutes saved, exact English/Urdu measured SRT end seconds/minutes.
- Cut count each language, resolved clip 71/78/79/80 source offsets, number of Urdu cuts using 12–25s relaxation, maximum accepted gap.
- All checkpointed Muse decisions retained and source SRT citations verified.
- Cut job HTTP result and Windows export status.
- Honest unresolved list if quality cannot be preserved. Never claim imagery was visually verified by the backend.

The 10-minute target overrun is a **separate narration-generation issue**. The existing movie can finish with its real 24-minute audio if the user wants; new movies will enforce selected maximum through script budget and measured SRT gate.
