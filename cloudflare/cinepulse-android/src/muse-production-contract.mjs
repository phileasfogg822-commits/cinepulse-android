/**
 * CinePulse Muse V4 — Movie-specific, end-to-end creative/editing contract.
 * Cloudflare's role is ONLY authenticated task relay, data integrity, validation
 * and delivery. Muse performs ALL scene selection, edit math and JSON authoring.
 */
import {srtLastTimestamp,validateFinalCutPlan} from './longform-policy.mjs';
import {WINDOWS_FILE_NAMES} from './windows-export.mjs';

export const MUSE_V4_MARKER='[CINEPULSE-LONGFORM-V4-MUSE-OWNS-EDITS]';
export const MUSE_V4_STAGES=[
  'digest','narration_english','narration_urdu','publishing_metadata',
  'mp3_english','srt_english','mp3_urdu','srt_urdu',
  'scene_matching','cut_plan','windows_project'
];
export const MUSE_V4_PROJECT_SCHEMA='cinepulse.windows-muse.v4';
const EPS=.003;
const n=x=>typeof x==='number'&&Number.isFinite(x);
function seconds(v){
  if(n(v))return v;
  if(typeof v!=='string')return NaN;
  const m=/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(v.trim());
  return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000:NaN;
}
export function museStageInstructions(step,{movieTitle,projectId,targetMinutes}){
  const stages={
    digest:'READ the ORIGINAL movie source SRT by using sourceSrtAsset. Produce a detailed, grounded chronological movie digest with identities, story arcs, major events and evidence. Never invent movie scenes or confuse another title. Output only verified digest text.',
    narration_english:'Using this movie digest and source SRT, CREATE the COMPLETE English long-form dramatic explanation, targeting approximately '+targetMinutes+' minutes. No Shorts, virals, or cross-movie facts. Output the full English narration text.',
    narration_urdu:'Using the same movie digest and source SRT, CREATE the COMPLETE idiomatic Urdu (اردو) long-form explanation. Keep all scenes and character names faithful. No English paragraphs and no Shorts or virals. Output the full Urdu narration text.',
    publishing_metadata:'Create publishing metadata ONLY: {"metadata":{"description":"20+ characters","keywords":["..."],"hashtags":["#..."]}}. Do not generate, write about, or schedule Shorts, viral scenes or clip assets.',
    mp3_english:'Use an AUTHORIZED REMOTE text-to-speech service to CREATE and UPLOAD the physical English MP3 for the entire approved English script. Upload to this exact task asset endpoint and complete only after its server receipt; do not fabricate audio.',
    srt_english:'Use authorized REMOTE speech recognition/alignment against the ACTUAL uploaded English MP3. Return a complete, genuinely MEASURED English SRT, accurately aligned to the full audio. Never invent timing from word count or script estimate.',
    mp3_urdu:'Use an AUTHORIZED REMOTE TTS provider to CREATE and UPLOAD the complete Urdu MP3. Wait for server confirmation before completing the stage. No fake MP3.',
    srt_urdu:'Use authorized REMOTE speech recognition/alignment against the ACTUAL uploaded Urdu MP3. Return a complete, genuinely MEASURED Urdu SRT through the final spoken sound. Never synthesize approximate subtitle timing.',
    scene_matching:'MUSE must perform all story-to-source scene reasoning for BOTH full explanatory movies. Read the ORIGINAL movie SRT and BOTH genuinely measured narration SRTs in previousOutputs. Return JSON {"matches":[{"language":"english"|"urdu","sourceStartSeconds":0,"sourceEndSeconds":0,"narrationStartSeconds":0,"narrationEndSeconds":0,"confidence":0.0}]}. Use correct real values, multiple ranges, and narrative evidence. Treat matches as candidates; YOU must next generate all individual final cuts. Shorts and viral concepts are excluded.',
    cut_plan:'MUSE OWNS THE COMPLETE FRAME-TIMECODE EDIT DECISIONS AND ALL CALCULATIONS. Use only this movie source SRT, BOTH measured narration SRTs and your earlier scene_matches. Return ONE JSON ARRAY of ALL FINAL clip entries (NOT 13 broad search windows): {"language":"english"|"urdu","sourceStartSeconds":number,"sourceEndSeconds":number,"narrationStartSeconds":number,"narrationEndSeconds":number,"confidence":number}. BOTH languages MUST have final cuts. For EVERY clip: 3.000 to 6.000 seconds; source and narration durations equal to 1ms precision. Narration clips start at 0 and have NO gaps or overlaps. Their total MUST equal the LAST TIMESTAMP of that language measured narration SRT, to within 0.15s. Within each language NEVER overlap/reuse movie source intervals; the source times stay within original movie SRT duration. If a scene candidate is exhausted, YOU search other unused source-SRT intervals, select contextually appropriate footage, and recompute the ENTIRE plan: Cloudflare will NEVER select replacements. Keep English and Urdu source use independent. Report failure explicitly if facts/timings cannot be substantiated. No frame decoding required. These are edits for ONLY one English long video and one Urdu long video, NOT a collection of Shorts or viral videos.',
    windows_project:'MUSE MUST AUTHOR THE FINAL WINDOWS-IMPORTABLE CinePulse ProjectState JSON. You already completed digest, full English+Urdu narrations, BOTH measured SRTs, metadata, source-SRT scene matches, and ALL FINAL 3–6s cuts. Use the exact values in previousOutputs and sourceSrtAsset; DO NOT revise any cuts while packaging. CRITICAL: at this stage task.analysisReference is the canonical read-only object containing the exact prior Muse strings. Copy analysis.narrations.english = task.analysisReference.narrations.english, analysis.narrations.hindiUrdu = task.analysisReference.narrations.hindiUrdu, analysis.research.verifiedSynopsis = task.analysisReference.research.verifiedSynopsis, WITHOUT paraphrasing, Unicode/whitespace changes, JSON-string-escaping the content twice, or replacing the digest with a summary. analysis.scripts is NOT the accepted property. These three are literal strings and must be identical to those earlier stage results (not a fresh AI rewrite). Return a single JSON OBJECT, NOT markdown, with title, releaseYear, videoPath:"", sourceFiles:[{"name":"CinePulse_Source.srt","text":FULL_SOURCE_SRT,"cues":[]}], analysis.narrations.english/hindiUrdu, analysis.metadata.english, analysis.research.verifiedSynopsis, tracks.english/hindiUrdu including mp3Path, narrationSrt, segments and cuts, pipeline.completed/skipped, cloudImport. Include the entire actual movie source SRT text, English/Urdu scripts and SRTs, no truncation. Exact mp3Path values: CinePulse_English.mp3 and CinePulse_Urdu.mp3. Track cuts are the prior cut_plan converted to movieStart/movieEnd/audioStart/audioEnd HH:MM:SS.mmm; do NOT create, move or lengthen shots. Track status is ready; sceneMatch.status is complete with completedSegments equal to segments.length. Metadata has description/keywords/hashtags and no Shorts or viral output; Shorts/Virals are disabled. cloudImport.schema must be cinepulse.windows-muse.v4 and cloudImport.cloudProjectId MUST equal this projectId. Set cloudImport.outputMode="long_form_only", cloudImport.longVideoCount=2, cloudImport.optionalShortsGenerated=false, cloudImport.optionalViralsGenerated=false, cloudImport.sourceVideoFrameInspectionRequired=false and cloudImport.mp3s.english/urdu to the EXACT server-provided audioManifest hashes, byte sizes and filenames. Set cloudImport.importedFilePathsAreRelative=true. Provide analysis.shorts=[], analysis.viralClips=[], analysis.viralMoments=[]. Include pipeline.completed:["source-digest","story-core","english-narration","hindi-narration","publishing-metadata"] and pipeline.skipped:["publishing-clips","shorts","viral-clips"]. Each track needs numeric audioDurationSeconds equal to that language narration SRT end, a complete segments array derived from the actual narration SRT (each has index,start,end,text), a complete cuts array with one row per prior cut_plan row (movieFile:"CinePulse_Source.srt", movieStart,movieEnd,audioStart,audioEnd as HH:MM:SS.mmm), sceneMatch:{status:"complete",completedSegments:segments.length}, status:"ready". Provide title, releaseYear, videoPath:"", researchUrls:[], config:{maxMovieClipSeconds:6,shortsCount:0}, analysis with scripts/digest/metadata, sourceFiles, tracks, pipeline, shortAudioPaths:{}, viralAudioPaths:{}. Cloudflare will check this JSON rigorously and store the bytes unchanged; only Muse may fix any rejected content.'
  };
  if(!(step in stages))return '';
  return [
    'CINEPULSE PER-MOVIE MUSE EXECUTION CONTRACT / rev4',
    'MOVIE: '+movieTitle,
    'MOVIE PROJECT UUID: '+projectId,
    'INTENDED OUTPUT: ONE English explanatory movie + ONE Urdu explanatory movie.',
    'APPROXIMATE NARRATION TARGET PER LANGUAGE: '+targetMinutes+' minutes, NOT the final timing authority.',
    'AUTHORITY: Muse makes the reasoning, scene choices, 3–6-second shot calculations and Windows ProjectState. Cloudflare only verifies/stores/transmits and never generates fallback cuts. Android ONLY downloads.',
    'TIMING SOURCE: genuine uploaded MP3 speech SRTs; do not claim their text is measured without remote audio alignment.',
    'STRICT: no reused/overlapping source intervals within either language, no narration gaps, durations match audio SRTs, no clips outside 3–6s, no video-frame analysis requirement for numeric checks.',
    'SHOTS: all individual 3–6s shots belong to TWO long videos, NOT short-video jobs. Shorts/virals DISABLED. Publishing metadata remains enabled.',
    'RECOVERY: on server validation rejection, inspect exact error, change YOUR output and retry while the lease is valid. NEVER ask APK or Cloudflare to invent replacement footage.',
    'ACCESS: movieSourceSrt via sourceSrtAsset path; previous successful stage results via previousOutputs. Never mix another project.',
    'CURRENT STEP: '+step,
    'DETAILED WORK ORDER: '+stages[step]
  ].join('\n');
}

/**
 * Complete exact read-only analysis contract. All three source strings were
 * produced and accepted by Muse earlier in THIS movie's isolated task queue.
 * Cloudflare neither rewrites nor repairs them.
 */
export function canonicalMuseAnalysis({narrations,digest}){
  return {
    narrations:{
      english:narrations.english,
      hindiUrdu:narrations.urdu
    },
    research:{verifiedSynopsis:digest}
  };
}
function compareCanonicalText(path,actual,expected){
  if(typeof expected!=='string')
    throw Error(path+': earlier Muse stage result is missing from the authoritative queue');
  if(typeof actual!=='string')
    throw Error(path+': missing or nonstring value; copy the EXACT source field from task.analysisReference');
  if(actual===expected)return;
  let offset=0;
  while(offset<actual.length&&offset<expected.length&&actual[offset]===expected[offset])offset++;
  const codeAt=(str,index)=>index<str.length?
    'U+'+str.codePointAt(index).toString(16).toUpperCase().padStart(4,'0'):'END';
  throw Error(path+': exact previous Muse stage text mismatch at UTF-16 offset '+offset+
    ' (expected '+codeAt(expected,offset)+', received '+codeAt(actual,offset)+
    '; expected length '+expected.length+', received length '+actual.length+
    '). Do not rewrite or retranslate. Copy the exact string verbatim from '+
    'task.analysisReference.'+path.slice('analysis.'.length)+
    ' or task.previousOutputs.'+
    (path==='analysis.narrations.english'?'narration_english':
     path==='analysis.narrations.hindiUrdu'?'narration_urdu':'digest')+
    '. Other fields and cuts should remain unchanged.');
}
export function verifyMuseAnalysis(analysis,{narrations,digest}){
  if(!analysis||typeof analysis!=='object'||Array.isArray(analysis))
    throw Error('analysis: expected an object containing narrations and research');
  const reference=canonicalMuseAnalysis({narrations,digest});
  compareCanonicalText('analysis.narrations.english',
    analysis.narrations?.english,reference.narrations.english);
  compareCanonicalText('analysis.narrations.hindiUrdu',
    analysis.narrations?.hindiUrdu,reference.narrations.hindiUrdu);
  compareCanonicalText('analysis.research.verifiedSynopsis',
    analysis.research?.verifiedSynopsis,reference.research.verifiedSynopsis);
  return true;
}

export function verifyMuseWindowsProject(candidate,{
  projectId,title,sourceSrt,narrations,narrationSrts,
  digest,cutPlan,metadata,mp3Manifest
}){
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))
    throw Error('Muse Windows project must be a native JSON object');
  const c=candidate;
  if(c.title!==title||c.cloudImport?.cloudProjectId!==projectId||
      c.cloudImport?.schema!==MUSE_V4_PROJECT_SCHEMA)
    throw Error('Muse Windows project title/UUID/schema mismatch');
  if(c.videoPath!=='')throw Error('Windows source video path must be blank; it is attached locally');
  const files=c.sourceFiles;
  if(!Array.isArray(files)||files.length!==1||
      files[0]?.name!==WINDOWS_FILE_NAMES.source_srt||files[0]?.text!==sourceSrt)
    throw Error('Muse Windows sourceFiles must include the exact unmodified original movie SRT');
  const analysis=c.analysis;
  verifyMuseAnalysis(analysis,{narrations,digest});
  const md=analysis.metadata?.english;
  if(!md||md.description!==metadata.description ||
      JSON.stringify(md.keywords)!==JSON.stringify(metadata.keywords)||
      JSON.stringify(md.hashtags)!==JSON.stringify(metadata.hashtags))
    throw Error('Muse Windows publishing metadata differs from validated metadata');
  for(const name of ['shorts','viralClips','viralMoments'])
    if(!Array.isArray(analysis[name])||analysis[name].length)
      throw Error('Muse must exclude Shorts and viral generation: '+name);
  if(!c.tracks||typeof c.tracks!=='object')throw Error('Muse Windows tracks missing');
  const reconstructedCuts=[];
  for(const [language,field,mp3,srt,script] of [
    ['english','english',WINDOWS_FILE_NAMES.english_mp3,narrationSrts.english,narrations.english],
    ['urdu','hindiUrdu',WINDOWS_FILE_NAMES.urdu_mp3,narrationSrts.urdu,narrations.urdu]
  ]){
    const lane=c.tracks[field];
    if(!lane||lane.mp3Path!==mp3||lane.narrationSrt!==srt)
      throw Error('Muse Windows '+language+' MP3 path or SRT is not the verified asset');
    const target=srtLastTimestamp(srt);
    if(!n(lane.audioDurationSeconds)||Math.abs(lane.audioDurationSeconds-target)>.15)
      throw Error('Muse Windows '+language+' audio duration not aligned to measured narration SRT');
    if(!Array.isArray(lane.segments)||lane.segments.length<1)
      throw Error('Muse Windows '+language+' measured SRT segments missing');
    const lastSegment=lane.segments[lane.segments.length-1];
    if(!n(lastSegment.end)||Math.abs(lastSegment.end-target)>.15)
      throw Error('Muse Windows '+language+' segments do not cover entire narration SRT');
    if(lane.sceneMatch?.status!=='complete'||
       lane.sceneMatch?.completedSegments!==lane.segments.length)
      throw Error('Muse Windows '+language+' sceneMatch must be complete');
    if(!Array.isArray(lane.cuts))throw Error('Muse Windows '+language+' final cut list missing');
    const sourceCuts=cutPlan.filter(v=>v.language===language);
    if(lane.cuts.length!==sourceCuts.length)
      throw Error('Muse Windows '+language+' final cut count differs from Muse-approved edit decisions');
    const numericCuts=lane.cuts.map((c,i)=>{
      const ref=sourceCuts[i];
      const ss=seconds(c.movieStart),se=seconds(c.movieEnd),as=seconds(c.audioStart),ae=seconds(c.audioEnd);
      if(![ss,se,as,ae].every(Number.isFinite)||[ss,se,as,ae].some((v,k)=>
        Math.abs(v-[ref.sourceStartSeconds,ref.sourceEndSeconds,ref.narrationStartSeconds,ref.narrationEndSeconds][k])>.003))
        throw Error('Muse Windows '+language+' shot '+(i+1)+' differs from its approved final cut plan');
      if(c.movieFile!==WINDOWS_FILE_NAMES.source_srt)
        throw Error('Muse Windows '+language+' cut must link source SRT evidence');
      return {language,sourceStartSeconds:ss,sourceEndSeconds:se,
        narrationStartSeconds:as,narrationEndSeconds:ae};
    });
    reconstructedCuts.push(...numericCuts);
  }
  validateFinalCutPlan(reconstructedCuts,{
    sourceSrt,englishSrt:narrationSrts.english,urduSrt:narrationSrts.urdu
  });
  if(c.cloudImport?.sourceVideoFrameInspectionRequired!==false||
      c.cloudImport?.importedFilePathsAreRelative!==true)
    throw Error('Muse Windows project must use relative paths and timecode-only validation');
  if(c.cloudImport?.outputMode!=='long_form_only'||
      c.cloudImport?.longVideoCount!==2||
      c.cloudImport?.optionalShortsGenerated!==false||
      c.cloudImport?.optionalViralsGenerated!==false)
    throw Error('Muse Windows project must contain only two long-form videos');
  const a=c.cloudImport?.mp3s;
  for(const lang of ['english','urdu']){
    if(!a?.[lang]||a[lang].sha256!==mp3Manifest[lang].sha256||
       a[lang].bytes!==mp3Manifest[lang].bytes)
      throw Error('Muse Windows '+lang+' MP3 manifest hash/size mismatch');
  }
  if(!Array.isArray(c.pipeline?.completed)||
     !c.pipeline.completed.includes('english-narration')||
     !c.pipeline.completed.includes('hindi-narration')||
     !c.pipeline.completed.includes('publishing-metadata'))
    throw Error('Muse Windows completed pipeline does not reflect approved narration/metadata');
  return c;
}
