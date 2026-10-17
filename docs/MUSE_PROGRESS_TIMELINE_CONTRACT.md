# Fine-grained Muse progress & duration contract

## Current v0.1.2 Android behavior
The private Cloudflare Worker currently returns:
- `project.createdAt` — project submission timestamp, epoch seconds
- `project.readyAt` — final package availability, epoch seconds
- `job.createdAt` — a stage entered the queue
- `job.finishedAt` — stage completion/failure
- `job.status` and `job.stepId`
- `job.error` on failures

The Android UI now displays these real values on active **and completed** projects. It calls queue-to-finish **queue + execution**, never pretends that it is Muse's processing-only duration. Project duration is submission-to-ready. The app remains a view into server data; no local background processing or fake timestamps.

### What the Worker/Muse bridge must add for smaller digest stages
A single `digest` task is opaque today. Create **durable**, project- and worker-scoped telemetry **before** claiming individual digest chunks are visible. Record each update on the server. Recommended data:

```json
{
  "id": "existing-job-uuid",
  "stepId": "digest",
  "status": "working",
  "createdAt": 1760710000,
  "startedAt": 1760710050,
  "attemptCount": 2,
  "progress": {
    "label": "Chronology and scene continuity",
    "message": "Reviewing subtitle segment batch 8 of 23",
    "completedChunks": 8,
    "totalChunks": 23,
    "updatedAt": 1760710181
  },
  "substeps": [
    {
      "name": "Subtitle normalization",
      "status": "done",
      "startedAt": 1760710050,
      "finishedAt": 1760710063,
      "attempt": 2
    },
    {
      "name": "Scene chronology · batch 8/23",
      "status": "working",
      "startedAt": 1760710181
    }
  ],
  "attemptHistory": [
    {
      "startedAt": 1760710050,
      "finishedAt": 1760710101,
      "status": "lease_expired"
    }
  ]
}
```

This is a **schema example only**, not a claim that Muse already sends this data. The Android v0.1.2 UI supports optional `progress`, `substeps` / `milestones` / `segments` and `attemptHistory` once the backend supplies them.

### Suggested digest microstages (only report them when actually performed)
1. Input SRT validation / normalized timeline
2. Sentence/chunk segmentation with actual `completedChunks / totalChunks`
3. Character/entity extraction, actual chunk batch indices
4. Timeline and scene chronology linking
5. Character motivations and causal continuity
6. Major turning points / twists
7. Story bible consolidation
8. Cross-chunk continuity verification
9. Digest quality audit / final result stored

Muse should emit heartbeat updates **during** these subtasks, not just after the whole digest. Persist each checkpoint server-side with UTC timestamps and project/worker/job IDs. Do not log SRT text, passwords, prompts, worker secrets, bearer tokens, or movie dialogue. Never return raw model completions inside telemetry.

### Timing accuracy and attempts
- On queue insertion set `queued_at`; do not confuse it with processing start.
- On a successful atomic lease claim set `started_at` for that attempt and increment an integer `attempt_count`.
- Persist attempt begin/end and terminal reason; leave a running attempt's `finishedAt` null.
- Each `heartbeat` may accept a bounded `progress` object with a lease token validated server-side, and persist `updated_at`.
- Use monotonic elapsed duration within a worker if possible, but server UTC timestamps for cross-device display.
- Permit retries without overwriting previous attempt history, and never count Android Refresh as a Muse attempt.
- Distinguish `queued`, `working`, `done`, `error`, `waiting-for-worker`.
- Return checkpoint count and paginated records; limit messages and arrays so Android 8 devices stay responsive.
- Retain a sanitized telemetry summary for completed projects for as long as the project's history must be visible. The current project data can expire; do not promise indefinite historical timing.

### Security
Every checkpoint is bound to an authenticated dedicated worker and an active job lease. Protect GET with the same project admin authorization and worker isolation as existing job access. Redact secrets; rate-limit heartbeats; cap arrays and message lengths; never allow a worker to update a different project's progress.

### Deployment boundary
This repository contains Android sources and APK CI, **not the deployed Cloudflare Worker source or its D1 migrations**. Backend heartbeat/event changes must be implemented and deployed separately from your local Cloudflare Worker project, followed by CI API security tests. No Cloudflare credential should be committed here.
