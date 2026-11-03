/**
 * CinePulse Scene Lab — deterministic offline package builder.
 * Creates complete native Windows projects from externally verified, already-extracted audio.
 * Media extraction is performed by the Muse worker / FFmpeg, not by Cloudflare Workers.
 */
import {buildWindowsProject,WINDOWS_FILE_NAMES} from './windows-export.mjs';
import {STRATEGIES,validateExperimentManifest,validateCompleteCutPlan,rebaseCues} from './scene-lab.mjs';
const stamp=n=>{const ms=Math.round(n*1000);return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(x=>String(x).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0')};
/** Existing Muse v4 files may be JSON envelopes; project tracks contain plain SRT. */
export function unwrapMeasuredSrt(value){
 if(typeof value!=='string')throw Error('SRT payload must be text');
 const trimmed=value.trim();
 if(!trimmed.startsWith('{'))return value;
 let parsed;try{parsed=JSON.parse(trimmed)}catch{throw Error('Invalid SRT JSON envelope')}
 if(parsed?.format!=='srt'||typeof parsed.text!=='string'||!parsed.text.includes('-->'))throw Error('SRT envelope missing measured text');
 return parsed.text;
}
export function parseMeasuredCues(value){
 const raw=unwrapMeasuredSrt(value).replace(/\r\n?/g,'\n');
 const seconds=x=>{const m=/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(x);if(!m)throw Error('Invalid SRT timestamp');return +m[1]*3600 + +m[2]*60 + +m[3] + +m[4]/1000};
 const cues=[];
 for(const block of raw.trim().split(/\n\s*\n/)){
  const lines=block.trim().split('\n');
  if(/^\d+$/.test(lines[0]?.trim()))lines.shift();
  const match=/^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/.exec(lines.shift()?.trim()||'');
  if(!match)continue;
  const text=lines.join('\n').trim();
  if(!text)throw Error('Empty measured subtitle cue');
  const startSeconds=seconds(match[1]),endSeconds=seconds(match[2]);
  if(endSeconds<=startSeconds)throw Error('Invalid measured subtitle duration');
  cues.push({startSeconds,endSeconds,text});
 }
 if(!cues.length)throw Error('No measured subtitle cues found');
 return cues;
}
export function renderMeasuredSrt(cues){
 if(!Array.isArray(cues)||!cues.length)throw Error('Measured cue array required');
 return cues.map((cue,i)=>{if(!Number.isFinite(cue.startSeconds)||!Number.isFinite(cue.endSeconds)||cue.endSeconds<=cue.startSeconds||!String(cue.text||'').trim())throw Error('Invalid measured narration cue');return String(i+1)+'\n'+stamp(cue.startSeconds)+' --> '+stamp(cue.endSeconds)+'\n'+cue.text.trim()+'\n'}).join('\n');
}
export function planAudioExtraction(excerpts){let offset=0;return excerpts.map((e,index)=>{const duration=e.endSeconds-e.startSeconds;if(!Number.isFinite(duration)||duration<=0)throw Error('Invalid audio extraction interval');const value={index,startSeconds:e.startSeconds,endSeconds:e.endSeconds,outputStartSeconds:offset,outputEndSeconds:offset+duration};offset+=duration;return value;});}
function validateLanguageAssets(audio,srt,cuts,duration){
 if(!audio||!(audio.bytes>0)||!Number.isFinite(audio.durationSeconds)||Math.abs(audio.durationSeconds-duration)>.25)throw Error('Missing or incorrect measured MP3 duration');
 if(!srt||typeof srt!=='string')throw Error('Missing measured SRT');
 validateCompleteCutPlan(cuts,duration);
}
export function buildSceneLabPackage({manifest,sourceSrt,digest,narrations,englishCues,englishAudio,urduSrt,urduAudio,englishCuts,urduCuts,metadata,mp3s}){
 const validated=validateExperimentManifest(manifest);
 const total=validated.totalSeconds;
 const rebasedEnglish=rebaseCues(englishCues,manifest.excerpts);
 const englishSrt=renderMeasuredSrt(rebasedEnglish);
 const urduDuration=urduAudio?.durationSeconds;
 if(!(urduDuration>=29.5&&urduDuration<=30.5))throw Error('Urdu control track must be approximately 30 seconds');
 validateLanguageAssets(englishAudio,englishSrt,englishCuts,total);
 urduSrt=unwrapMeasuredSrt(urduSrt);
 validateLanguageAssets(urduAudio,urduSrt,urduCuts,urduDuration);
 if(typeof sourceSrt!=='string'||!sourceSrt.includes('-->'))throw Error('Original source SRT is required');
 if(!narrations||!String(narrations.english||'').trim()||!String(narrations.urdu||'').trim())throw Error('Both narration texts required');
 if(!rebasedEnglish.length||Math.abs(rebasedEnglish.at(-1).endSeconds-total)>.25)throw Error('English measured SRT does not reach experiment end');
 const id=validated.experimentId;
 const combinedCuts=[...englishCuts.map(c=>({...c,language:'english'})),...urduCuts.map(c=>({...c,language:'urdu'}))];
 const result=buildWindowsProject({
  project:{id,title:'Peter Rabbit (2018) — Scene Lab — '+manifest.strategy},
  sourceSrt,digest,narrations:{english:narrations.english,urdu:narrations.urdu},
  narrationSrts:{english:englishSrt,urdu:urduSrt},cuts:combinedCuts,
  metadata:metadata||{description:'Scene Lab controlled comparison for Peter Rabbit (2018).',keywords:['scene matching'],hashtags:['#CinePulse']},
  mp3s,metrics:{experiment:true,strategy:manifest.strategy,englishSeconds:total,urduSeconds:urduDuration}
 });
 result.cloudImport.sceneLab={parentProjectId:manifest.parentProjectId,strategy:manifest.strategy,excerpts:manifest.excerpts,experimental:true};
 return {
  experimentId:id,project:result,
  files:{
   [WINDOWS_FILE_NAMES.windows_project_json]:JSON.stringify(result,null,2),
   [WINDOWS_FILE_NAMES.source_srt]:sourceSrt,
   [WINDOWS_FILE_NAMES.english_srt]:englishSrt,
   [WINDOWS_FILE_NAMES.urdu_srt]:urduSrt,
   [WINDOWS_FILE_NAMES.english_narration]:narrations.english,
   [WINDOWS_FILE_NAMES.urdu_narration]:narrations.urdu
  },
  requiredMp3Files:[WINDOWS_FILE_NAMES.english_mp3,WINDOWS_FILE_NAMES.urdu_mp3],
  audioExtractionPlan:planAudioExtraction(manifest.excerpts),
  renderedOutputs:{english:'SceneLab_'+manifest.strategy+'_English.mp4',urdu:'SceneLab_'+manifest.strategy+'_Urdu_Control.mp4'}
 };
}
export function experimentPlan(parentProjectId,excerpts){
 return STRATEGIES.map(strategy=>({mode:'scene_matching_lab',language:'english',parentProjectId,strategy,excerpts}));
}

/**
 * V4 preservation path: clone the user's accepted Muse ProjectState instead of
 * introducing a V3 schema. This is the ONLY exporter used by live Scene Lab.
 */
export function buildSceneLabV4Package({manifest,baselineProject,sourceSrt,narrations,englishCues,urduSrt,englishAudio,urduAudio,englishCuts,urduCuts,mp3s,projectId,workerId}){
 const {totalSeconds,experimentId}=validateExperimentManifest(manifest);
 if(!baselineProject||baselineProject.cloudImport?.schema!=='cinepulse.windows-muse.v4')throw Error('Original Muse V4 ProjectState is required');
 if(baselineProject.cloudImport?.cloudProjectId!==manifest.parentProjectId)throw Error('Original project ID mismatch');
 if(!Array.isArray(baselineProject.sourceFiles)||baselineProject.sourceFiles[0]?.text!==sourceSrt)throw Error('Original movie source SRT mismatch');
 if(!Array.isArray(englishCues)||!englishCues.length)throw Error('Original measured English cues required');
 if(!narrations||!String(narrations.english||'').trim()||!String(narrations.urdu||'').trim())throw Error('Both excerpt narration texts required');
 const rebasedEnglish=rebaseCues(englishCues,manifest.excerpts);
 if(!rebasedEnglish.length||Math.abs(rebasedEnglish.at(-1).endSeconds-totalSeconds)>.25)throw Error('English SRT does not reach excerpted audio end');
 const englishSrt=renderMeasuredSrt(rebasedEnglish),plainUrduSrt=unwrapMeasuredSrt(urduSrt);
 const urduCues=parseMeasuredCues(plainUrduSrt);
 if(!(urduAudio?.durationSeconds>=29.5&&urduAudio?.durationSeconds<=30.5))throw Error('Urdu control MP3 duration outside 29.5–30.5 seconds');
 if(Math.abs(urduCues.at(-1).endSeconds-urduAudio.durationSeconds)>.25)throw Error('Urdu SRT duration disagrees with MP3');
 validateLanguageAssets(englishAudio,englishSrt,englishCuts,totalSeconds);
 const urduCutDuration=urduCues.at(-1).endSeconds;
 validateLanguageAssets(urduAudio,plainUrduSrt,urduCuts,urduCutDuration);
 for(const [lang,asset] of [['english',englishAudio],['urdu',urduAudio]]){
  const receipt=mp3s?.[lang];
  if(!receipt||receipt.bytes!==asset.bytes||!(/^[a-f0-9]{64}$/i.test(receipt.sha256||'')))throw Error(lang+' physical MP3 upload receipt mismatch');
 }
 const clone=JSON.parse(JSON.stringify(baselineProject));
 clone.id=projectId;
 clone.projectId=projectId;
 clone.workerId=workerId;
 clone.title=(baselineProject.title||'Peter Rabbit (2018)')+' — Scene Lab — '+manifest.strategy;
 clone.movieTitle=clone.title;
 clone.mode='scene_matching_lab';
 clone.productionMode='scene_matching_lab';
 clone.config={...clone.config,maxMovieClipSeconds:6,shortsCount:0};
 clone.analysis.narrations={...clone.analysis.narrations,english:narrations.english,hindiUrdu:narrations.urdu};
 clone.analysis.shorts=[];clone.analysis.viralClips=[];clone.analysis.viralMoments=[];
 clone.pipeline={...clone.pipeline,progress:100,currentStep:'Scene Lab experimental cuts ready for unchanged Windows Offline Editor'};
 clone.cloudImport={...clone.cloudImport,schema:'cinepulse.windows-muse.v4',cloudProjectId:projectId,outputMode:'long_form_only',
  mp3s,sceneLab:{parentProjectId:manifest.parentProjectId,experimentId,strategy:manifest.strategy,excerpts:manifest.excerpts,
   englishDurationSeconds:totalSeconds,urduDurationSeconds:urduCutDuration,
   evidenceType:'original_source_srt_only',visualVerified:false},
  longVideoCount:2,optionalShortsGenerated:false,optionalViralsGenerated:false,importedFilePathsAreRelative:true};
 function updateTrack(name,lang,cues,srt,cuts,duration){
  const old=clone.tracks?.[name];if(!old)throw Error('Original V4 '+name+' track missing');
  old.narrationSrt=srt;old.audioDurationSeconds=duration;
  old.mp3Bytes=mp3s[lang].bytes;old.mp3Sha256=mp3s[lang].sha256;
  old.mp3Path=lang==='english'?'CinePulse_English.mp3':'CinePulse_Urdu.mp3';
  old.segments=cues.map((cue,i)=>({index:i+1,start:cue.startSeconds,end:cue.endSeconds,text:cue.text}));
  old.cuts=cuts.map(c=>({
   movieFile:'CinePulse_Source.srt',movieStart:stamp(c.sourceStartSeconds).replace(',', '.'),
   movieEnd:stamp(c.sourceEndSeconds).replace(',', '.'),
   audioStart:stamp(c.narrationStartSeconds).replace(',', '.'),
   audioEnd:stamp(c.narrationEndSeconds).replace(',', '.'),
   language:lang,confidence:c.confidence??0.2,
   sourceEvidence:c.sourceEvidence||'original_srt_cues'
  }));
  old.sceneMatch={...(old.sceneMatch||{}),status:'complete',completedSegments:cues.length,
   signature:'cinepulse-scene-lab-v1-'+manifest.strategy,visualVerified:false};
  old.status='ready';
 }
 updateTrack('english','english',rebasedEnglish,englishSrt,englishCuts,totalSeconds);
 updateTrack('hindiUrdu','urdu',urduCues,plainUrduSrt,urduCuts,urduCutDuration);
 clone.cutPlans={english:englishCuts.map(c=>({...c,language:'english'})),urdu:urduCuts.map(c=>({...c,language:'urdu'}))};
 clone.qualityWarnings=[...(clone.qualityWarnings||[]),
  'Scene Lab: experimental source-SRT-only match, not visually verified',
  'Identical English narration excerpt audio across ten strategies; Urdu fixed 30-second control'];
 return {
  experimentId,project:clone,requiredMp3Files:['CinePulse_English.mp3','CinePulse_Urdu.mp3'],
  renderedOutputs:{english:'SceneLab_'+manifest.strategy+'_English.mp4',urdu:'SceneLab_'+manifest.strategy+'_Urdu_Control.mp4'},
  files:{
   CinePulse_Project:JSON.stringify(clone),
   'CinePulse_Project.json':JSON.stringify(clone,null,2),
   'CinePulse_Source.srt':sourceSrt,
   'CinePulse_English.srt':englishSrt,
   'CinePulse_Urdu.srt':plainUrduSrt,
   'CinePulse_English_Narration.txt':narrations.english,
   'CinePulse_Urdu_Narration.txt':narrations.urdu
  }
 };
}
