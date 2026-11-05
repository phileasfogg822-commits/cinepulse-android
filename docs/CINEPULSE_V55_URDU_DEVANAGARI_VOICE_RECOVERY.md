# CinePulse V5.5 — Urdu words through Devanagari-speaking TTS

**Permanent policy for newly submitted movies:** approved Urdu narration remains in Urdu script, with natural Pakistani Urdu vocabulary and grammar. A separate pronunciation-only copy, in pure Devanagari, is provided to a declared Hindi/hi-IN speech engine. That TTS copy is **not** a Hindi translation. English narration, original Urdu text, final Urdu SRT, source SRT, scene matches, and Windows project are kept in their original languages.

**Why this is needed:** Darkest Hour failed seven TTS attempts with two voices while Arabic-script input returned 26-byte empty audio. The original V5.4 rule correctly prevented a silent Hindi fallback, but a explicitly approved Urdu-pronunciation method is now available.

## New project flow

The new project's digest receives `[CINEPULSE-V55-URDU-IN-DEVANAGARI-TTS]`. The complete Urdu narration is first accepted in Urdu script with the existing V5.4 content and V5.1 duration safeguards. When Muse claims `mp3_urdu`, task details include a canonical SHA-256 of the approved Urdu and a new TTS instruction contract.

The worker MUST:
1. Keep the accepted original Urdu narration EXACTLY unchanged; do not generate Hindi replacement text.
2. Transliterate the same Urdu sentences into a private Devanagari pronunciation copy. Preserve Pakistani Urdu vocabulary, names, grammar and ordering; any accented Devanagari marks must still be part of Devanagari Unicode.
3. Reject any non-Devanagari-script letters in that TTS input. Punctuation, spacing, and numerical digits are allowed. This restriction applies **only** to the TTS input: native Urdu script and legitimate Persian/Arabic-derived Urdu vocabulary remain appropriate in the final Urdu transcript.
4. Synthesize a **real, nonempty** MP3 with a hi-IN-capable voice (prefer pronunciation and delivery appropriate for Urdu). Do not loop, splice duplicated chunks, stretch audio, or use a 26-byte empty file. Fail clearly if the selected voice is inappropriate.
5. Submit the MP3 plus a JSON receipt of the exact TTS text, real provider, voice ID, source checksum, declared pronunciation-only method, Urdu preservation, and no uncontrolled Hindi-language fallback.
6. Align the **actual MP3** to the **original Urdu-script narration** and submit a measured Urdu SRT. A Hindi-script STT intermediate may be used for word timing only; it must never replace final Urdu text.
7. Only then continue independent Urdu Deep Muse matching and Windows export.

V5.5 validators reject wrong script, no source checksum, gross word-count changes, repeated text loops, false provider/voice mode declaration, and known V5.4 Urdu SRT corruption. This is not automatic proof of a perfect Urdu accent; inspect a short actual audio sample.

## Resume one already failed V5.4 movie (no reset)

An authorized admin can call:

`POST /v1/projects/{projectId}/audio/urdu-devanagari/resume`

Or its assigned, authenticated Muse worker can call:

`POST /w/{workerId}/projects/{projectId}/audio/urdu-devanagari/resume`

Both calls need an appropriate bearer token. No request body is required. The route is idempotent for a queued/working project and guards against concurrent duplicate tasks.

Only an uncompleted permanent V5.4+ project parked at `needs_review` after a real failed `mp3_urdu` task is eligible. It checks that original English MP3/SRT and both narration scripts are already completed, and refuses to silently overwrite any existing Urdu MP3 object. The existing English and Urdu text checkpoints remain unchanged. The successful response gives a new job ID; claim it through the original worker queue.

Upon valid Urdu MP3 submission the normal pipeline advances to `srt_urdu`, `deep_match_english` / `deep_match_urdu`, `deep_cut_plan` and `windows_project`. Completed English matching checkpoint, if any, remains preserved.

## Important limitations

The backend only validates the worker's declared TTS voice and Devanagari text; it does **not** itself operate a real TTS service or independently listen to the audio. A hi-IN model may retain a Hindi accent or pronounce Urdu loanwords poorly. Do not claim native Pakistani-accent audio without acoustic listening verification.

Restoring missing famous English closing lines from Darkest Hour would be a **separate** English narration-stage revision involving English TTS/SRT and dependent cuts. This Urdu-only recovery does not silently change the approved English script.
