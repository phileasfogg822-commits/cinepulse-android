# CinePulse Android — SRT Library (v0.1.6)

The Android home screen now includes **SRT Library • Search & batch import**.

## One-time setup
1. Open SRT Library.
2. Tap **Set / replace SubDL API key**.
3. Create an API key at https://subdl.com/api-doc and enter it in the app. The key is encrypted on this device with Android Keystore, stored separately from CinePulse Cloudflare credentials. It is not included in the app source, committed to GitHub, or uploaded to Cloudflare.
4. Search movie titles, select English/Urdu results, and download selected SRTs. Use the exact release where possible (BluRay/WEB-DL/DVD): timings may differ between releases.

## Bulk use
- Use **Collect random SRTs in bulk (5 / 10 / 20)** for one-at-a-time searches/downloads from built-in movie-title ideas. This is not a continuously refreshed or editorially ranked movie recommendation feed.
- Repeat collection batches to build a larger library (up to 1,000 locally stored SRTs). Provider availability, quotas and connectivity govern what downloads successfully.
- The library validates SRT size and cue timestamps before storing the file. SHA-256 deduplicates exact copies.
- Check up to **10 downloaded SRTs**, choose narration duration, and tap **Queue selected SRTs to Cloudflare / Muse**. Movies become separate Cloudflare projects, assigned round-robin among active workers. Muse workers need to be online and polling.
- Cloudflare backend v0.1.5 or later needs to be **deployed** for target narration minutes to be acknowledged; the app warns when the field is not confirmed.
- Network batches run inside the active Android screen. Keep the app open; the code does **not** create a durable Android WorkManager background queue. Existing Cloudflare projects remain independent of the app's connection.

## Limits
- Search uses the documented official SubDL API v1. It **requires an API key**, and downloading is subject to the service's quotas and provider terms.
- The Android APK never downloads film/video files; it only requests subtitle text.
- Subtitles can be copyrighted. Only download and use them where you have the necessary rights and follow the provider's terms. Use licensed movie footage.
- Search results may be inaccurate, nonmatching releases, translated variants, or hearing-impaired editions. A valid SRT is not a guarantee of scene alignment with your eventual video.
- Do not expect exact 100/100 downloads from a list of movie ideas. There may be no matching English/Urdu subtitles for particular titles.
- No credentials or Cloudflare Worker deployments are required for **local** SRT collection other than your own SubDL API key. Pushing selected SRTs to Muse requires your CinePulse account token and available workers.

## Verification
- Workflow: `.github/workflows/bootstrap-apk.yml` (lintDebug, testDebugUnitTest, assembleDebug).
- Unit tests: `SubtitleProviderTest.java` covers provider path validation and SRT structure bounds.
- Integration with the live SubDL API must be tested on a device with a valid personal key; CI does not contain that key and does not perform remote subtitle downloads.
