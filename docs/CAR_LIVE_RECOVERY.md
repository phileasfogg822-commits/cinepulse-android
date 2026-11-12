# CAR v1.1 controlled live recovery

Production rollout is restricted by CAR_LIVE_PROJECT_ID to Shrek 2
(fed941ad-ff7f-4b0f-8439-25cfda24d187). Older experimental CAR routes remain gated.
This implementation handles verified source-anchor reuse failures. Other failure
classes fail closed; it does not infer failed segments from remaining work.

## Assigned Muse worker procedure

Use the existing worker token and existing movie. Do not restart or upload assets.

1. GET /w/{workerId}/projects/{projectId}/car/audit. Confirm car recovery switches
   and inspect failedJobs for the original failed English job ID.
2. POST /w/{workerId}/projects/{projectId}/car/recover with JSON:

```json
{
  "failedJobId": "the actual failed matching job UUID",
  "targets": [{
    "segmentIndex": 81,
    "rejectedDecision": {
      "segmentIndex": 81,
      "sourceCueIds": [489],
      "evidenceQuote": "the complete exact original cue text",
      "sourceStartSeconds": 0,
      "sourceEndSeconds": 1,
      "museRequestId": "the actual original Muse request reference"
    }
  }]
}
```

The numerical times above are placeholders: supply the actual rejected anchor
interval and original request reference, never invented values. The server checks
the source cue, actual collision with accepted evidence, current unfinished batch,
assigned worker, failed job, exact completed state, pause/stop controls, active
jobs, and lifetime three-target budget. An error message alone cannot pass.

3. Poll the existing worker queue. The recovery task contains the normal unfinished
   five-cue batch (81–85 for this checkpoint) plus explicit recovery instructions.
   Only declared failed targets may use context anchors. All five decisions are
   required because existing durable checkpoints are five-cue batches.
4. Submit through the usual leased task result endpoint, with output.carRecovery
   set to true. Segment 81 must have anchorMethod=context, one real unused cue
   within five cue IDs of the rejected literal cue, the full exact cue quotation,
   and an interval contained in that cue. Normal production evidence, rationale,
   alternatives and confidence validation still applies. Cue 492 is not hardcoded
   or automatically certified; Muse must verify it against current source evidence.
5. The backend atomically accepts this batch and queues the next ordinary task.
   Earlier accepted jobs are never changed. Inspect the audit's liveRecovery and
   result nextJobId, then continue normal English-before-Urdu processing.

Invalid result: repair and retry the SAME lease. Explicit failed recovery task:
POST the same recover route with {"retryJobId":"existing recovery job UUID"}.
This reuses its reservation and preserves the three-target lifetime limit.

## Evidence and limitations

Automated tests exercise real SQLite transactions, rollback on continuation failure,
stale state, lease expiry, pause/stop and ownership guards, cross-language context
cue uniqueness, cap enforcement, idempotent dispatch and same-reservation retries.
They do not prove real-film semantic relevance. That final check belongs to Muse.
No movie is dispatched merely by deploying this code or running an audit.
