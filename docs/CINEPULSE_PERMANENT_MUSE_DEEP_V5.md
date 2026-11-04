# CinePulse — Permanent Muse Deep Matching V5

**Selected production method:** the evidence-linked Deep Muse workflow that rendered Peter Rabbit's controlled test at a user-rated 9/10. The rating is one test outcome, not a universal quality guarantee.

## One standard production pipeline

**For newly submitted standard movies**:

1. Original movie source SRT → verified digest
2. English and Urdu narration → real MP3s → remote measured SRTs
3. `deep_match_english`: Muse semantic analysis of **every measured English cue**, no more than 5 cues per task
4. `deep_match_urdu`: separate Muse semantic analysis of **every measured Urdu cue**, no copying English matches, no more than 5 cues per task
5. `deep_cut_plan`: independently authored continuous 3–6-second cuts for both languages, each linked to one or more verified Muse source decisions
6. `windows_project`: Muse exports original-source V4 Windows ProjectState. All source movie SRT, narration, MP3 manifests, subtitles, cuts and both language tracks must pass the existing strict validator.

No new Android or Windows rendering workflow needs to synthesize source footage. Windows attaches the user's original movie locally.

## Backend enforced requirements

Each matching batch contains at most 5 narration cues, ranked evidence from the **entire source SRT** within a 22K-character candidate budget, and all previously accepted decisions in that language. Muse chooses source anchors independently of local scoring. Evidence per cue includes:

```json
{
  "segmentIndex": 1,
  "sourceStartSeconds": 100.0,
  "sourceEndSeconds": 103.0,
  "sourceCueIds": [40],
  "evidenceQuote": "exact original movie subtitle excerpt",
  "reason": "character/action/context-based reason, including limitations",
  "alternatives": [{"cueId": 42, "reason": "why this candidate was rejected"}],
  "confidence": 0.8,
  "museRequestId": "actual-provider-reference"
}
```

Only numbered cues backed by actual original SRT text and source intervals can be accepted. Every accepted batch is stored as a separate Muse job output; a batch with missing, overlapping or unsupported decisions cannot advance.

Once all English and Urdu cues pass, Muse submits:

```json
{
  "englishCuts": [{
    "narrationStartSeconds": 0,
    "narrationEndSeconds": 5,
    "sourceStartSeconds": 100,
    "sourceEndSeconds": 105,
    "matchSegmentIndices": [1]
  }],
  "urduCuts": [ /* same schema, separately matched Urdu cues */ ]
}
```

Cloudflare verifies coverage, time equality, 3–6 seconds, source bounds, uniqueness within each language, and every cut's provenance. No fallback footage or automatic cutting substitutions.

## Operate and recover

- New standard movie: `POST /v1/projects`, `productionMode: "stable"`.
- Worker uses its **existing** `/w/{workerId}/agent/next` claim, heartbeat, active lease, and `/tasks/{jobId}/result` protocol. New stage names: `deep_match_english`, `deep_match_urdu`, `deep_cut_plan`.
- Read-only review: `GET /v1/projects/{projectId}/deep-muse`, authorized administrator.
- Safe queue repair: `POST /v1/projects/{projectId}/deep-muse/resume`, authorized administrator, only when there is no queued/working task and measured SRTs are present.
- Existing project pause/stop controls and leases still apply.

All requested movies have unique project IDs, worker ownership and storage namespaces. Audio has to be real; MP3 upload and measured SRT stages remain unchanged. No new TTS/STT for existing projects.

## Retirement policy

- New `scene_intelligence_experiment` movie submissions: retired, HTTP 410.
- New fast-scoring Scene Lab creations: retired, HTTP 410.
- New experimental Deep Scene Lab pilot creations: retired, HTTP 410.
- The old full-movie one-shot `scene_matching` → `cut_plan` sequence is **not used for new standard movies**.
- Historical V3/V4, source projects and Scene Lab experiments are **not deleted**. Read/download/recovery and old job behavior remain available so the migration does not destroy previously completed or paused projects. Delete old stored movies only as a separate explicit, confirmed retention operation after backups.

## Release criteria

1. Source unit/integration tests and Android security/lint/APK checks pass.
2. Guarded Cloudflare deployment shows `permanentDeepMuseDefault=true` and `productionDeepMuseBuild=cinepulse-production-muse-deep-v5.0`.
3. A fresh *new movie* with genuine narration, TTS, STT and both full Muse deep languages moves through every stage, produces V4 Windows files and renders.
4. Only then label the permanent workflow **end-to-end verified**.

Quality remains human-assessed without frame-level inspection; a valid SRT citation cannot establish that the chosen video image actually shows the narrated event.
