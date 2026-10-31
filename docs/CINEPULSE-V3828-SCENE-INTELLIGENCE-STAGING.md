# CinePulse v3.8.28 — parallel Scene Intelligence experiment (NOT DEPLOYED)

## Isolation and current status
- Base branch: `ops/cloudflare-deploy-bridge`; working branch: `feature/scene-intelligence-v3828-staging`.
- The proven Peter Rabbit stable project and stable Muse V4 instructions remain unchanged.
- **No live Cloudflare upload, D1 migration, Worker promotion, or APK release is performed by this branch.**
- The two production modes MUST use different immutable project IDs, R2 prefixes, D1 records, checkpoints, and local folders.
- The new code provides testable candidate indexing, stage instruction templates, portable-package validation and a D1 staging migration. **The experimental routes, Worker stages, SQLite snapshot export, APK UI and desktop importer are NOT wired yet.** Do not claim end-to-end readiness.

## Data flow
1. Android creates a **new** project with opt-in mode `scene_intelligence_experiment` and an independent ID.
2. During digest, Muse describes only source-SRT-grounded characters/events; the controller builds a deterministic subtitle window index. Neither claims movie frames were inspected.
3. Cloudflare D1 stores searchable window metadata and job state; a private R2 prefix `experiments/<project-id>/` stores the source data and a **portable `Scene_Intelligence.sqlite`** snapshot. D1 is not a blob store.
4. Muse completes English/Urdu narrations, actual MP3s and measured narration SRTs.
5. In that original production job, Muse performs semantic matching for each language independently using the preserved whole-movie SRT retrieval method and the saved index. Final clips stay 3–6 seconds (with valid silent continuity), scene source usage is checked, and quality warnings are retained.
6. Only after both plans and all assets are complete does the Worker publish the package manifest. SHA-256 and bytes are validated for *each* downloaded asset.
7. Windows Offline Editor imports package locally and renders with FFmpeg; **no network call or Muse re-analysis on import**. Semantic uncertainty and non-overlap warnings are reviewable; physically missing or undecodable media must still be stopped.

## Reuse for more languages
- The index is keyed by the exact original source SRT SHA-256, index schema and movie edition.
- Additional narration languages reuse source-scene evidence; new language-specific measured SRTs and final cuts are still mandatory.
- Do not assume source timecodes from another edition/release.
- Retrieval candidates are **not** verified visuals or final Muse-selected cuts.

## Asset contract (experiment only)
Required kinds:
`windows_project_json`, `source_srt`, `english_mp3`, `urdu_mp3`, `english_srt`, `urdu_srt`, `english_narration`, `urdu_narration`, `scene_index_sqlite`, `english_final_cuts`, `urdu_final_cuts`.

Each asset must have a project-scoped key `experiments/<projectId>/...`, SHA-256 and byte count. Manifest: `schema=cinepulse.experimental-package.v1`, `mode=scene_intelligence_experiment`, `projectId`, `sourceSrtSha256`, `assets`. The only change to the old eight-file delivery is additive. Old Android and desktop clients must continue receiving their stable format.

## Staged D1 migration
File: `cloudflare/cinepulse-android/migrations/experimental/0001_scene_intelligence.sql`.

**Apply only to an authorized staging D1 database** after backups, with a reviewed Wrangler binding. This repository deliberately does not carry a command to mutate the live `cinepulse-android-db`.

The migration stores source window metadata and FTS5 lookup records; the authoritative downloadable SQLite snapshot remains in R2. Data retention, source permissions and cleanup must be implemented before production.

## Next implementation tickets
1. Audit currently deployed Worker version, D1 schema, R2 layout, existing job envelope and asset upload limits using *read-only* inspection.
2. Introduce experiment-only creation and immutable mode authorization; add worker task kinds and R2 snapshot persistence.
3. Implement verified SQLite snapshot export, D1 search, safe resume checkpoints and request/response size limits.
4. Wire experimental Muse instruction templates to the active worker protocol, retaining original stable behavior by default.
5. Add Android mode selector and full manifest-based download (not just legacy 8 assets); add distinct project card and no double processing.
6. Add Windows Offline Editor importer for database and final cuts; local-only render readiness and warning-vs-blocker states.
7. Run original Peter Rabbit stable/experiment side by side, verify real output, score semantic relevance before any default rollout.

## Authentication — no secrets in chat
The GitHub source can be edited by its authorized connector. Cloudflare configuration is available to GitHub Actions **only if** the repository secrets already exist and have appropriate permissions. Refer to:
- [GitHub Actions repository secrets](https://github.com/phileasfogg822-commits/cinepulse-android/settings/secrets/actions)
- [Cloudflare API tokens](https://dash.cloudflare.com/profile/api-tokens)
- [Cloudflare token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [Official Cloudflare/GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Read-only inspection workflow](../../.github/workflows/cloudflare-readonly-inspect.yml)

Existing workflow secret names: `CINEPULSE_CF_API_TOKEN` and `CINEPULSE_CF_ACCOUNT_ID`. Do not rename existing secrets without updating the workflows; their existence cannot be proved by reading YAML. For **staging** deployment, use an account-limited token with Workers Scripts Edit, D1 Edit, and Workers R2 Storage Edit, only as required. Workers Routes Write is only necessary when updating routes. Prefer a dedicated staging resource/credential over production-wide privileges. Store tokens only as GitHub encrypted secrets or a comparable protected CI credential store. Never send an API key, Muse password or Worker secret in chat.

A workflow should require manual approval for any staging deploy, and production promotion must be a separate explicit action after testing. No automated deployment from this experimental branch.
