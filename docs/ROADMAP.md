# CinePulse Android staged delivery

1. **Native MVP and reproducible builds**: basic secure session, worker/project UI, SRT import, project status, cryptographically verified three-file export; Android 8+ and Galaxy S9+ resource limits.
2. **Cloudflare least privilege**: add device registration, per-device short-lived revocable session tokens, server-side project/workspace scoping, worker metadata without worker secret exposure, endpoint-specific rate limits and auditing; rotate existing admin token after transition.
3. **Queue UX and resilience**: persistent non-sensitive project list, foreground-only refresh, explicit task stages, safe retries with idempotency keys, multi-project submission scheduling, R2 lifecycle and offline-aware interface.
4. **Rendering handoff**: package manifest with SRT timings, MP3 SHA-256/bytes/duration, visual coverage status, source movie requirements and Windows importer contract version; Windows import verified end-to-end.
5. **Automated verification**: Android lint, unit tests, UI tests on emulator API 26/29/35, dependency review, APK size and cold startup checks, malware/permissions inspection, backend authorization and tenant separation tests.
6. **Release**: secure release signing on GitHub Environments (never in source), staged pilot on physical Samsung S9+, measured battery/data usage, backup/restore tests, signed APK and Play internal distribution when ready.

Never claim phase 1 is verified until Gradle / GitHub Actions finishes successfully. Never claim production safety until phase 2 authorization is deployed and tested.
