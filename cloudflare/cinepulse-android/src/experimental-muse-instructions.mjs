/**
 * EXPERIMENT ONLY: staged Muse instruction templates. No production registration.
 * The Worker must opt in using mode=scene_intelligence_experiment.
 * Existing museStageInstructions() for stable projects is not changed.
 */
export const EXPERIMENT_STAGES = Object.freeze([
 'digest','scene_intelligence','narration_english','narration_urdu',
 'mp3_english','srt_english','mp3_urdu','srt_urdu',
 'scene_matching_english','scene_matching_urdu','cut_plan','windows_project'
]);
// Production-compatible experimental queue: existing Muse worker protocol is reused;
// no second Muse account or desktop scene-matching session is required.
export const EXPERIMENT_JOB_MARKER='[CINEPULSE-EXPERIMENTAL-SCENE-INTELLIGENCE-V3828]';
export const EXPERIMENT_JOB_STAGES=Object.freeze([
 'digest','scene_intelligence','narration_english','narration_urdu',
 'publishing_metadata','mp3_english','srt_english','mp3_urdu','srt_urdu',
 'scene_matching','cut_plan','windows_project'
]);
export function experimentalQueuePrompt(step,context) {
 if(step==='scene_matching') {
  return sceneIntelligenceMuseInstruction('scene_matching_english',context)+'\n'+
   sceneIntelligenceMuseInstruction('scene_matching_urdu',context)+
   '\nReturn a single JSON object {"matches":[{"language":"english"|"urdu","sourceStartSeconds":number,"sourceEndSeconds":number,"narrationStartSeconds":number,"narrationEndSeconds":number,"confidence":number}]}. Match all narration beats using ORIGINAL SOURCE SRT and saved source-SRT evidence, whole-movie context, correct characters/actions. This stage is an independent Muse semantic decision for each language, NOT a local lexical match. Save no Shorts or virals.';
 }
 if(step==='scene_intelligence') return sceneIntelligenceMuseInstruction(step,context)+
  '\nRead sourceSrtAsset and sceneIndexAsset of your own task; add grounded character/event relations with exact cue evidence. Output JSON {"events":[{"cueStart":1,"cueEnd":2,"character":"...","event":"...","evidence":"..."}]}. Produce a real portable SQLite scene index from this evidence using available local SQLite tools and upload the actual binary to task scene-index asset before completing. Do not report success unless the upload receipt is returned.';
 if(step==='cut_plan'||step==='windows_project') return sceneIntelligenceMuseInstruction(step,context);
 return '';
}
export function sceneIntelligenceMuseInstruction(stage,{projectId,sourceSrtSha256,indexVersion=1}={}){
 if(typeof projectId!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,127}$/.test(projectId))
   throw new Error('Experiment requires isolated project identity');
 if(!/^[a-f0-9]{64}$/.test(sourceSrtSha256??''))throw new Error('Source fingerprint required');
 const context='EXPERIMENT ONLY. Project '+projectId+', original source SRT SHA-256 '+sourceSrtSha256+
   ', scene index revision '+indexVersion+'. Never access another project or revise the stable baseline. ';
 const tasks={
 scene_intelligence:'During digest, analyze ONLY the provided ORIGINAL movie SRT. Use real subtitle cue timestamps to describe characters, relationships, events and story chronology. Return structured evidence with exact cue IDs and source timecodes. Do NOT assert visual observation, manufacture unspoken actions, or finalize cuts before measured narration SRTs exist. The controller will store this evidence beside a deterministic SRT window index in experimental R2/D1 assets.',
 scene_matching_english:'After verified English MP3 and actually measured English narration SRT exist: retrieve whole-movie subtitle candidates from the saved experiment scene index, check characters, events, dialogue and chronology. EVERY English narration beat must receive a Muse semantic decision, not an auto-approved local keyword match. Return source-timestamp anchors and supporting cue IDs. Do NOT copy Urdu decisions or mark scenes visually verified.',
 scene_matching_urdu:'After verified Urdu MP3 and actually measured Urdu narration SRT exist: independently retrieve and rank subtitle evidence using the same versioned source database. EVERY Urdu narration beat must receive a Muse semantic decision. Do NOT inherit English cuts, invent source timestamps or mark visual QA passed.',
 cut_plan:'Using both verified sets of Muse-selected anchors, generate separate complete 3–6 second English and Urdu plans. Keep narration coverage complete, avoid overlapping/repeated source ranges within each language, and use only evidence-supported source locations. For short silent gaps, extend unused nearby frames from the adjacent supported shot without exceeding six seconds. If an anchor is exhausted, request a targeted replacement; never insert unrelated footage. Preserve draft/error evidence. Do not claim that matching SRT text proves visual correctness.',
 windows_project:'Produce a new experimental Windows project package with the source SRT, narration text, both MP3/SRT asset references, final cuts, metadata, Scene_Intelligence.sqlite snapshot reference, source SRT fingerprint and every asset hash/byte length. Keep the existing eight-file naming, add the index and two separate cut-plan assets, and set mode=scene_intelligence_experiment. The Windows Offline Editor must not request Muse again. Quality warnings must be preserved, not silently discarded.'
 };
 if(!tasks[stage])throw new Error('Unsupported experimental Muse stage');
 return context+tasks[stage];
}
