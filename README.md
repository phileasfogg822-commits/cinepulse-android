# CinePulse Android Companion — initial native Android source

**Status:** Android source project created; APK compilation and device behaviour have NOT yet been verified. Do not label this release production-ready.

## Architecture

This is a lightweight, native Android Views application (no WebView, no Tailwind runtime) that reuses the Cloudflare/Muse service and interoperates with the verified CinePulse Windows cloud importer. The UI borrows Tailwind-style spacing, cards and colours while avoiding a heavy JavaScript engine on the Galaxy S9+.

- **Device:** minSdk 26 (Android 8.0), Galaxy S9+ (Android 8–10), 6 GB RAM compatible.
- **Android roles:** connect, list workers and movie projects, submit SRT, check job status, pause/resume workers, download Windows-native packages.
- **Windows roles:** attach original movie, validate/rework full visual coverage, render video and Shorts.
- **Muse roles:** remotely generate narration, TTS, SRT, scene matching and metadata.
- **Cloudflare roles:** authenticated D1 queue, R2 files, signed expiring downloads and server-side project isolation.

## Build debug APK using GitHub Actions (recommended)

1. Extract the ZIP to a local folder. Install **Git for Windows** and **GitHub CLI** if necessary; sign in using `gh auth login` without sending your credentials to anyone.
2. In PowerShell inside the source folder, run publish the source to your existing private repository `phileasfogg822-commits/cinepulse-android`. GitHub Actions builds automatically on push.
3. Alternatively, manually create a private GitHub repository and commit the files at its root. Never commit bearer tokens, `.jks` files or signing passwords.
4. Open **Actions → CinePulse Android APK** and run the workflow, or use the workflow automatically triggered by the push.
5. Download the workflow artifact named `CinePulse-Android-Galaxy-S9Plus-debug`. The ZIP contains `app-debug.apk`, a debug-signed test APK.

To build locally with JDK 17, Android SDK platform 35 / build-tools 35 and Gradle 8.7:

```bash
gradle --no-daemon clean lintDebug testDebugUnitTest assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## First use

1. In CinePulse Android, paste the **existing Cloudflare administrator bearer token**; it is encrypted by Android Keystore.
2. Refresh existing workers, or create one and securely transfer its single-use worker token to its Muse setup.
3. Select a movie SRT through Android's system document picker and assign an active worker.
4. Watch the project pipeline in **Projects**; refresh manually when you want updated progress.
5. After a project is `ready`, choose **Download Windows project + 2 MP3s** and choose a folder with Android's system folder picker.
6. Transfer the newly created project folder to Windows (e.g., USB cable), then import `CinePulse_Project.json` via **Import team project**. Windows Patch v3 auto-links the two MP3s by verified hashes.

### Limitations and security decisions

- **Important:** The current Cloudflare API `/v1/` requires a **full administrator token**; it has create, cancel, pause, and delete capabilities. Android Keystore protects at-rest storage, but this is not a least-privilege mobile authorization scheme. **Before public distribution, add per-device, revocable, scoped mobile tokens to the Cloudflare Worker.** Do not publish the admin token into your APK or a repository. A lost or compromised phone can still pose a credential risk.
- API URLs are hardcoded to the existing `cinepulse-android-bridge.maryumblog.workers.dev` HTTPS endpoint. The signed `/dl` URLs are restricted to the same hostname and exact project/kind paths.
- Screenshots of the app are blocked with `FLAG_SECURE` to reduce accidental credential exposure. No network traffic outside user-triggered actions; no notification, location, camera, contacts, microphone, file-wide storage or background-service permissions.
- Downloads use private temporary cache, stream 32-KiB chunks, verify authoritative D1 asset SHA-256 **and exact byte count**, then save into an Android SAF movie folder, deleting temporary files afterward.
- This app does **not** bundle FFmpeg, ship an AI model, render full videos locally, or upload full movie video to R2. These remain Windows responsibilities.
- Source SRT size limit: 2 MiB; each MP3 download: 40 MiB; project JSON: 10 MiB.
- Android 13–15: newer API requirements may need a later UI/compatibility release. The current target SDK is 35; Galaxy S9+ is the primary reference target.
- Signing: workflow emits a **debug APK**, not a production Play Store release; production APK signing and real device testing are separate gates.
- No physical Galaxy S9+ device testing has been completed.

## Why there is no Tailwind runtime

Tailwind CSS targets web layouts. CinePulse Android instead implements a responsive native UI with matching spacing/colour conventions to keep startup time, battery consumption and APK size lower on the S9+.

## Current backend contract

`GET /v1/projects`, `GET /v1/projects/:id`, `GET /v1/workers`, `POST /v1/workers`, `POST /v1/projects`, `POST /v1/workers/:id/pause`, `POST /v1/workers/:id/resume`, `GET /v1/projects/:id/downloads`. The signed links serve `export_json`, `english_mp3` and `urdu_mp3`.
