# CinePulse Cloudflare Worker: existing deployment and long-form-only policy

**Status (2026-10-26): not deployed from this repository.** Android calls
`https://cinepulse-android-bridge.maryumblog.workers.dev`. Only CinePulse
Android is in this GitHub repository: do not treat GitHub Actions building
an APK as evidence that the Cloudflare Worker has changed.

Historical Windows backend source folder:
`C:\\Users\\Grafixers\\Downloads\\CinePulse_Android_Cloudflare_Backend_Starter_v0_1_0\\CinePulse_Android_Cloudflare_Backend_Starter`

Older `src/index.mjs` used the stage IDs:
`digest,narration_english,narration_urdu,viral_metadata,mp3_english,
srt_english,mp3_urdu,srt_urdu,scene_matching,cut_plan`.

## Inspect **who** deployed live version

Cloudflare dashboard > Workers & Pages > `cinepulse-android-bridge` >
**Deployments**. The deployment history reports version, timestamp, and
initiating identity. **Settings > Builds** indicates whether a GitHub repository
is connected. The dashboard **Edit code** view shows the live Worker source.

In Windows PowerShell, authenticate to the right account and run:

```powershell
npx wrangler whoami
npx wrangler deployments list --name cinepulse-android-bridge
npx wrangler versions list --name cinepulse-android-bridge
```

No current Cloudflare account connector is connected in this ChatGPT
conversation, so the live deployed code/creator was not authenticated.

## Changes required in actual Worker (not just Android)

- Persist an enforced per-project `outputMode=long_form_only` and independent
  stage toggles. Android already sends those as request fields; older Workers
  may ignore them.
- Split metadata from optional video work. Do not send Muse a request for
  viral scenes, shorts, Short narration, viral scripts or clip assets.
  Metadata still produces long-form title, description, keywords, hashtags.
- For NEW projects, change metadata stage from the combined `viral_metadata`
  to `publishing_metadata`, then update D1 stage validation, queues, prompts,
  stage completion, export assembly and recovery allowlists. Preserve old
  jobs and old stage IDs for projects already processing.
- Cloudflare `cut_plan` must contain *final* 3–6s clip ranges for BOTH languages
  that match measured narration MP3 durations and the source SRT timebase.
  Reject short cuts, long cuts, narration gaps and overlaps, repeated source
  intervals within a language, out-of-bounds movie positions, and aggregate
  duration mismatches. No visual frame decoding is required to validate
  numeric timestamps.
- The 13 Minecraft `sceneMatches` are possible long-form scene windows,
  **not** 13 viral-video jobs. The 10 Minecraft `viralScenes` are optional,
  and should not be produced for long-form-only projects.
- Only the two long-form videos are rendered later by Windows; do not put any
  viral or Short assets into the Windows export.
- Add read-only backend `/v1/config` response showing the server's effective
  policy, without any secrets, so Android can verify flags were honored.

## Safe deployment sequence

Back up the current source and D1 schema. Preserve Wrangler project name,
`DB` binding, `FILES` R2 binding, secrets, routes and cron triggers.
Use `npx wrangler deploy --dry-run` after integrating the code and tests.
Test a preview deployment and new synthetic movie. Only then run
`npx wrangler deploy` from the correct **updated** backend source folder.
Do not use `wrangler deploy` to *inspect* a Worker: it actually publishes code.
Rollback: Cloudflare Deployments > Roll back or `npx wrangler rollback`.
Avoid breaking old D1 jobs during stage migration.

Cloudflare docs:
- https://developers.cloudflare.com/workers/versions-and-deployments/
- https://developers.cloudflare.com/workers/wrangler/commands/workers/
- https://developers.cloudflare.com/workers/wrangler/configuration/

The separately generated tested policy ZIP includes a pure
`long-form-policy.mjs` validator plus an inspection PowerShell script.
Its integration in the actual backend source and live deployment are still
required; it does not deploy itself.
