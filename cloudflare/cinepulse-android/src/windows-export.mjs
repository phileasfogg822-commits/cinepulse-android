/** Native CinePulse Windows ProjectState, created in Cloudflare — never in Android. */
import {srtLastTimestamp} from './longform-policy.mjs';
const stamp=sec=>{
  const ms=Math.round(sec*1000);
  return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60]
    .map(v=>String(v).padStart(2,'0')).join(':')+'.'+String(ms%1000).padStart(3,'0');
};
const seconds=s=>{
  const m=/(\d\d):(\d\d):(\d\d)[,.](\d{3})/.exec(s);
  return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000:-1;
};
function parseSegments(srt){
  const regex=/(\d\d:\d\d:\d\d[,.]\d{3})\s*-->\s*(\d\d:\d\d:\d\d[,.]\d{3})/g;
  const entries=[];let m;
  while((m=regex.exec(srt)))entries.push({start:seconds(m[1]),end:seconds(m[2]),headerEnd:regex.lastIndex,headerStart:m.index});
  return entries.map((entry,index)=>{
    const limit=index+1<entries.length?entries[index+1].headerStart:srt.length;
    const body=srt.slice(entry.headerEnd,limit).replace(/^\s*\d{1,6}\s*$/gm,'').trim();
    if(!body)throw Error('Narration SRT has empty subtitle segment');
    return {index:index+1,start:entry.start,end:entry.end,text:body};
  });
}
export const WINDOWS_FILE_KINDS=[
  'windows_project_json','source_srt','english_mp3','urdu_mp3',
  'english_srt','urdu_srt','english_narration','urdu_narration'
];
export const WINDOWS_FILE_NAMES={
  windows_project_json:'CinePulse_Project.json',
  source_srt:'CinePulse_Source.srt',
  english_mp3:'CinePulse_English.mp3',urdu_mp3:'CinePulse_Urdu.mp3',
  english_srt:'CinePulse_English.srt',urdu_srt:'CinePulse_Urdu.srt',
  english_narration:'CinePulse_English_Narration.txt',
  urdu_narration:'CinePulse_Urdu_Narration.txt'
};
function makeTrack({language,script,srt,cuts,mp3Name}){
  const segments=parseSegments(srt);
  if(!segments.length||!script?.trim())throw Error(language+': missing narration script or measured SRT');
  const own=cuts.filter(c=>c.language===language);
  if(!own.length)throw Error(language+': no verified cuts');
  return {
    mp3Path:mp3Name, // Filename relative to the JSON's folder; desktop importer should resolve siblings.
    audioDurationSeconds:srtLastTimestamp(srt),
    narrationSrt:srt,segments,
    cuts:own.map(c=>({
      movieFile:'CinePulse_Source.srt',
      movieStart:stamp(c.sourceStartSeconds),movieEnd:stamp(c.sourceEndSeconds),
      audioStart:stamp(c.narrationStartSeconds),audioEnd:stamp(c.narrationEndSeconds),
      narrationExcerpt:segments.find(seg=>(seg.start+seg.end)/2>=c.narrationStartSeconds &&
                                  (seg.start+seg.end)/2<=c.narrationEndSeconds)?.text||'',
      confidence:c.confidence??0.2,
      sourceEvidence:c.sourceEvidence||'subtitle_timestamps'
    })),
    status:'ready',
    message:'Server-validated 3–6s timestamp cuts. MP3 hash/length must be rechecked by the Windows importer.',
    sceneMatch:{
      signature:'cloudflare-server-timeline-v3',
      batchSize:5,totalBatches:Math.ceil(segments.length/5),
      completedBatches:Math.ceil(segments.length/5),
      completedSegments:segments.length,
      rawCuts:[],anchors:[],localResolvedSegments:segments.length,aiResolvedSegments:0,
      status:'complete',lastError:''
    }
  };
}
export function buildWindowsProject({
  project,sourceSrt,digest,narrations,narrationSrts,cuts,metadata,mp3s,metrics
}){
  const english=makeTrack({language:'english',script:narrations.english,
    srt:narrationSrts.english,cuts,mp3Name:WINDOWS_FILE_NAMES.english_mp3});
  const urdu=makeTrack({language:'urdu',script:narrations.urdu,
    srt:narrationSrts.urdu,cuts,mp3Name:WINDOWS_FILE_NAMES.urdu_mp3});
  const title=project.title||'Movie';
  const year=/(?<!\d)((?:19|20)\d{2})(?!\d)/.exec(title)?.[1]||'';
  const metadataEnglish={
    title,description:metadata.description,shortDescription:metadata.description.slice(0,140),
    keywords:metadata.keywords,hashtags:metadata.hashtags,titles:[title],
    thumbnailIdeas:[],pinnedComment:'',categoryTags:[]
  };
  const analysis={
    narrations:{english:narrations.english,hindiUrdu:narrations.urdu},
    metadata:{english:metadataEnglish},
    research:{verifiedSynopsis:digest,characters:[],themes:[],contentWarnings:[],sources:[]},
    storyMap:[],hooks:[],longFormPlan:[],retentionBeats:[],scenePlan:[],audioPlan:[],
    viralMoments:[],shorts:[],viralClips:[],qa:{},clarifyingQuestions:[],agentSuggestions:[]
  };
  return {
    title,releaseYear:year,videoPath:'',researchUrls:[],
    sourceFiles:[{name:WINDOWS_FILE_NAMES.source_srt,text:sourceSrt,cues:[]}],
    config:{
      sourceType:'movie',
      durationMinutes:Math.max(3,Math.min(60,Math.ceil(Math.max(english.audioDurationSeconds,urdu.audioDurationSeconds)/60))),
      contentGoal:'Movie recap',tone:'Cinematic',sceneMatchBatchSize:5,
      maxMovieClipSeconds:6,preferredGapSeconds:0,shortsCount:0,
      includeMusic:false,transformativeCommentary:true
    },
    analysis,answers:{},tracks:{english,hindiUrdu:urdu},
    pipeline:{
      completed:['source-digest','story-core','english-narration','hindi-narration','publishing-metadata'],
      skipped:['publishing-clips','shorts','viral-clips'],
      progress:95,currentStep:'English and Urdu cuts finalized by Cloudflare. Attach movie and verify local media paths to render.',
      sourceDigest:digest,movieBible:digest,digestParts:[digest],
      englishParts:[narrations.english],hindiParts:[narrations.urdu],
      hindiRecovery:{},movieMap:[],canonicalBlocks:[],lastError:''
    },
    shortAudioPaths:{},viralAudioPaths:{},
    cloudImport:{
      schema:'cinepulse.windows-server.v3',
      cloudProjectId:project.id,outputMode:'long_form_only',
      mp3s,finalCutMetrics:metrics,
      sourceVideoFrameInspectionRequired:false,
      importedFilePathsAreRelative:true,
      longVideoCount:2,
      optionalShortsGenerated:false,optionalViralsGenerated:false
    }
  };
}
