/**
 * Opt-in Scene Lab jobs. Uses the established authenticated Muse worker queue;
 * the parent movie is referenced, never modified. Each experiment owns a NEW
 * project/asset namespace and is not part of normal movie stage progression.
 */
import {STRATEGIES,validateExperimentManifest} from './scene-lab.mjs';
export const SCENE_LAB_STAGE='scene_lab_v1';
export const SCENE_LAB_BUILD='cinepulse-scene-lab-v1';
const CHECK=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const sceneLabSchema=`CREATE TABLE IF NOT EXISTS cinepulse_scene_lab (
 project_id TEXT PRIMARY KEY,
 parent_project_id TEXT NOT NULL,
 worker_id TEXT NOT NULL,
 strategy TEXT NOT NULL,
 manifest_json TEXT NOT NULL,
 job_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'queued',
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
)`;
export async function ensureSceneLab(env){await env.DB.prepare(sceneLabSchema).run();}
export async function sceneLabRow(env,projectId){
 await ensureSceneLab(env);
 return env.DB.prepare('SELECT * FROM cinepulse_scene_lab WHERE project_id=?').bind(projectId).first();
}
export function normalizeSceneLabCreate(body){
 if(!body||!CHECK.test(body.workerId||'')||!CHECK.test(body.parentProjectId||''))throw Error('Valid workerId and original parentProjectId UUIDs required');
 if(!STRATEGIES.includes(body.strategy))throw Error('Unsupported scene-matching profile');
 const manifest=validateExperimentManifest({
  mode:'scene_matching_lab',language:'english',strategy:body.strategy,
  parentProjectId:body.parentProjectId,excerpts:body.excerpts
 });
 const sourceSrt=body.sourceSrt;
 if(typeof sourceSrt!=='string'||sourceSrt.length<100||!sourceSrt.includes('-->')||sourceSrt.length>2_000_000)throw Error('Complete original sourceSrt required');
 return {manifest:{mode:'scene_matching_lab',language:'english',strategy:body.strategy,parentProjectId:body.parentProjectId,excerpts:body.excerpts},sourceSrt,totalSeconds:manifest.totalSeconds};
}
export const SCENE_LAB_STRATEGY_DIRECTIONS=Object.freeze({
 classic_reconstruction:'Reconstruct the strongest previous CinePulse source-grounded approach: first choose canonical whole-movie event timing, then nearby character/dialogue evidence, and preserve chronological coherence. Document why each cut is more defensible than the alternative.',
 character_first:'Identify exact named characters and family relationships FIRST; reject shots that show/describe the wrong rabbit, person or relationship. Use dialogue and event only after character identity is established.',
 dialogue_first:'Anchor narration beats to direct source-SRT spoken lines and speaker turns FIRST. Distinguish narration paraphrases from the dialogue scene itself; use character and event as tie breakers.',
 event_first:'Identify the physical event/action FIRST (garden entry, confrontation, chase, gathering), verify cause-and-effect sequence, then validate participants and dialogue.',
 character_dialogue_event:'Apply strict priority CHARACTER > DIALOGUE > EVENT for each candidate. Record all three scored signals and which criterion decided selection.',
 dialogue_event_character:'Apply strict priority DIALOGUE > EVENT > CHARACTER. Seek original spoken evidence before narrative paraphrase; record scored signals.',
 event_character_dialogue:'Apply strict priority EVENT > CHARACTER > DIALOGUE; avoid famous-character footage when the event is wrong.',
 chronological_graph:'Build an ordered scene graph of original SRT cues and event dependencies. Select windows in plausible movie chronology without forcing narration segments into unrelated source regions.',
 context_window:'Retrieve whole-source candidate windows, then expand surrounding cues to ±4 dialogue exchanges. Compare lead-in, action, aftermath and reference resolution before choosing clip.',
 evidence_ensemble:'Independently rank character, dialogue, event, chronology, and context evidence. Reject contradictory candidates; choose only matches supported by multiple independent clues, report unresolved rather than inventing footage.'
});
export function sceneLabInstructions(row){
 const manifest=JSON.parse(row.manifest_json);
 return `CINEPULSE SCENE LAB PILOT — ISOLATED TASK. Strategy: ${manifest.strategy}.
MATCHING PROFILE DIRECTIVE: ${SCENE_LAB_STRATEGY_DIRECTIONS[manifest.strategy]}\nOriginal project ${manifest.parentProjectId} is immutable. This job has its own project ${row.project_id}; NEVER resubmit or modify the original movie.
Use the supplied Peter.zip (original English/Urdu MP3 and JSON-enveloped measured SRTs) and the full source movie SRT from sourceSrtAsset.
Extract/re-encode FOUR exact cue-aligned English MP3 excerpts using FFmpeg, concatenate into one ~${Math.round(manifest.excerpts.reduce((a,e)=>a+e.endSeconds-e.startSeconds,0))}s MP3; generate rebased measured English SRT, no new TTS/STT. 
Extract a 29.5–30.5s cue-aligned Urdu MP3 and its measured SRT; reuse unchanged for all ten strategies.
Use source evidence index and all original source SRT cues to independently match English narration. Evaluate characters, dialogue, events, temporal context; reject contradictory footage. Generate 3–6s continuous cuts, disjoint source windows, without invented source matches. Urdu control plan is fixed across experiments.
Upload BOTH new physical MP3s using the authenticated task asset upload paths /tasks/{taskId}/asset/english_mp3 and /tasks/{taskId}/asset/urdu_mp3 with current lease and SHA256 headers. Acknowledge actual receipts.
Return task output as JSON object:
{ "baselineProject": COMPLETE ORIGINAL cinepulse.windows-muse.v4 ProjectState object,
"narrations":{"english":"EXCERPT TRANSCRIPT","urdu":"30-SECOND CONTROL TRANSCRIPT"},
"englishCues":[{"startSeconds":0,"endSeconds":4.639,"text":"..."}] (ORIGINAL measured English cues with their ORIGINAL offsets),
"englishCuts":[{"narrationStartSeconds":0,"narrationEndSeconds":5,"sourceStartSeconds":100,"sourceEndSeconds":105,"confidence":0.8,"sourceEvidence":"cue 100..."}],
"urduCuts":[...same keys...],
"urduSrt":"PLAIN SRT (rebased 30s)",
"englishAudio":{"durationSeconds":300,"bytes":EXACT UPLOADED ENGLISH MP3 BYTES},
"urduAudio":{"durationSeconds":30,"bytes":EXACT UPLOADED URDU MP3 BYTES},
"evidence":{"strategy":"${manifest.strategy}","notes":"..."} }.
Cue lengths and audio measured durations MUST agree. The backend will independently validate MP3 receipts, excerpt boundaries, cut continuity, source overlap and copy original v4 structure without inventing scenes. No Shorts, no virals, no frame-verification claim. Do NOT mark task done if any file is missing. Source movie file must be attached later by Windows user.\nMANIFEST: ${JSON.stringify(manifest)}`;
}
export function sceneLabTaskMetadata(row,job){
 const manifest=JSON.parse(row.manifest_json);
 return {mode:'scene_matching_lab',strategy:row.strategy,originalProjectId:row.parent_project_id,
 experimentProjectId:row.project_id,manifest,
 sourceSrtAsset:{path:'/tasks/'+job.id+'/asset/source_srt',name:'CinePulse_Source.srt',mime:'application/x-subrip'},
 uploadMp3Endpoints:{
  english:'/tasks/'+job.id+'/asset/english_mp3',urdu:'/tasks/'+job.id+'/asset/urdu_mp3'
 },stage:SCENE_LAB_STAGE,requiresExistingMuseZip:true};
}
