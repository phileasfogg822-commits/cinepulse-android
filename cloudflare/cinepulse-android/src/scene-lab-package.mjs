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
 const raw=unwrapMeasuredSrt(value);
 const re=/(?:^|\\n)\\s*(?:\\d+\\s*\\n)?(\\d{2}:\\d{2}:\\d{2}[,.]\\d{3})\\s*-->\\s*(\\d{2}:\\d{2}:\\d{2}[,.]\\d{3})\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\n|$)/g;
 const seconds=x=>{const m=/^(\\d{2}):(\\d{2}):(\\d{2})[,.](\\d{3})$/.exec(x);return +m[1]*3600 + +m[2]*60 + +m[3] + +m[4]/1000};
 const cues=[];let m;while((m=re.exec(raw.replace(/\\r/g,'')))){const text=m[3].trim();if(text)cues.push({startSeconds:seconds(m[1]),endSeconds:seconds(m[2]),text});}
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
