/**
 * CinePulse server-owned final cut allocator.
 * Muse supplies chronological scene anchors; this module assigns non-reused footage.
 * Numeric timestamp verification requires no movie frames.
 */
import {srtLastTimestamp,validateFinalCutPlan} from './longform-policy.mjs';
const EPS=0.003;
const round=x=>Math.round(x*1000)/1000;
const clipMin=3,clipMax=6;
function time(str){
  if(typeof str==='number'&&Number.isFinite(str))return str;
  if(typeof str!=='string')return -1;
  const m=/^(\d\d):(\d\d):(\d\d)[.,](\d{3})$/.exec(str.trim());
  return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000:-1;
}
export function movieSubtitleCues(srt){
  const rx=/(\d\d:\d\d:\d\d[.,]\d{3})\s*-->\s*(\d\d:\d\d:\d\d[.,]\d{3})/g;
  const cues=[];let m,previous=-1;
  while((m=rx.exec(srt))!==null){
    const start=time(m[1]),end=time(m[2]);
    if(!(end>start)||start<previous-EPS)throw Error('Source SRT has reversed cue times');
    cues.push({start,end});
    previous=start;
    if(cues.length>16000)throw Error('Source subtitles exceed safe cue limit');
  }
  if(cues.length<30)throw Error('Not enough movie subtitle evidence for long-form video');
  return cues;
}
const numeric=(obj,keys)=>{
  for(const key of keys){
    const value=time(obj?.[key]);
    if(value>=0)return value;
  }
  return -1;
};
function sceneAnchors(matches,proposals,language,movieEnd){
  const results=[];
  function add(item,isProposal){
    if(!item||item.insufficientEvidence===true||item.subtitleEvidenceInsufficient===true||item.matched===false)return;
    const ss=numeric(item,['sourceStartSeconds','movieStartSeconds','sourceStart','movieStart']);
    const se=numeric(item,['sourceEndSeconds','movieEndSeconds','sourceEnd','movieEnd']);
    const as=numeric(item,language==='english'?
      ['narrationStartSeconds','narrationEnglishStartSeconds','narrationStartEn','narrationStart','audioStart']:
      ['narrationStartSeconds','narrationUrduStartSeconds','narrationUrduStart','narrationStartUr','narrationStart','audioStart']);
    const ae=numeric(item,language==='english'?
      ['narrationEndSeconds','narrationEnglishEndSeconds','narrationEndEn','narrationEnd','audioEnd']:
      ['narrationEndSeconds','narrationUrduEndSeconds','narrationUrduEnd','narrationEndUr','narrationEnd','audioEnd']);
    if(ss<0||se<=ss||se>movieEnd+90||as<0||ae<=as)return;
    let confidence=typeof item.confidence==='number'?item.confidence:
      ({high:0.9,medium:0.65,low:0.4}[String(item.confidence||'').toLowerCase()]??0.65);
    if(confidence<0.3)return;
    if(se-ss>Math.max(180,(ae-as)*12))confidence=Math.min(confidence,0.55);
    if(se-ss>movieEnd*.9)return;
    results.push({ss,se:Math.min(se,movieEnd),as,ae,confidence:Math.min(1,confidence),from:isProposal?'muse_cut_candidate':'muse_scene_anchor'});
  }
  for(const item of Array.isArray(matches)?matches:[]){
    if(!item?.language || item.language===language)add(item,false);
    if(Array.isArray(item?.languages)&&item.languages.includes(language))add(item,false);
  }
  for(const item of Array.isArray(proposals)?proposals:[]){
    if(item?.language===language)add(item,true);
  }
  return results;
}
const overlaps=(used,start,end)=>used.some(([lo,hi])=>start<hi-EPS&&end>lo+EPS);
function allocateFromCues(cues,used,target,clip,limit,region){
  // Search all source-subtitle timestamps starting close to the desired position.
  // Different candidate offsets fit subtitles whose cues are farther apart than 5s.
  const positions=[];
  for(const cue of cues){
    const around=[cue.start,round(cue.start-clip*.5),round(cue.start-clip)];
    for(const pos of around){
      if(pos<0||pos+clip>limit+EPS)continue;
      if(region&&(pos<region[0]-12||pos+clip>region[1]+12))continue;
      positions.push({start:pos,distance:Math.abs(pos-target)});
    }
  }
  positions.sort((a,b)=>a.distance-b.distance);
  for(const {start} of positions)if(!overlaps(used,start,start+clip))return start;
  return -1;
}
function trackCuts({sourceSrt,cues,movieEnd,narrationSrt,sceneMatches,proposedCuts,language}){
  const target=srtLastTimestamp(narrationSrt);
  if(target<clipMin||target>3600*2)throw Error(language+': invalid narration SRT duration');
  if(movieEnd<target)throw Error(language+': movie SRT is shorter than the narration');
  const count=Math.ceil(target/5);
  const anchors=sceneAnchors(sceneMatches,proposedCuts,language,movieEnd);
  const used=[],cuts=[];let fallbackCuts=0,anchoredCuts=0;
  for(let index=0;index<count;index++){
    const audioStart=round(index*target/count);
    const audioEnd=index===count-1?round(target):round((index+1)*target/count);
    const clip=round(audioEnd-audioStart),mid=(audioStart+audioEnd)/2;
    if(clip<clipMin-EPS||clip>clipMax+EPS)throw Error(language+': invalid final clip length');
    const ordered=anchors.map(x=>({...x,distance:Math.max(0,x.as-mid,mid-x.ae)}))
      .sort((a,b)=>a.distance-b.distance || b.confidence-a.confidence);
    let sourceStart=-1,match=null,mode='movie_source_srt_fallback';
    // Prefer Muse's nearest scene reference, then other references with subtitle cues.
    for(const anchor of ordered.slice(0,6)){
      if(anchor.distance>Math.max(40,target*.12))continue;
      const ratio=Math.max(0,Math.min(1,(mid-anchor.as)/(anchor.ae-anchor.as)));
      const targetStart=anchor.ss+ratio*Math.max(0,anchor.se-anchor.ss-clip);
      const found=allocateFromCues(cues,used,targetStart,clip,movieEnd,[anchor.ss,anchor.se]);
      if(found>=0){sourceStart=found;match=anchor;mode=anchor.from;break;}
    }
    if(sourceStart<0){
      // Global fallback remains in Cloudflare, never in the APK. Every interval
      // must still start near an actual source-SRT cue and remain non-overlapping.
      const desired=ordered.length?ordered[0].ss+(mid-ordered[0].as)/
        (ordered[0].ae-ordered[0].as)*(ordered[0].se-ordered[0].ss):mid/movieEnd*movieEnd;
      const targetStart=Math.max(0,Math.min(movieEnd-clip,desired));
      sourceStart=allocateFromCues(cues,used,targetStart,clip,movieEnd,null);
    }
    if(sourceStart<0)throw Error(language+': no unused source subtitle interval near narration '+mid.toFixed(3)+'s; Muse must improve source matching');
    sourceStart=round(sourceStart);
    const sourceEnd=round(sourceStart+clip);
    cuts.push({language,sourceStartSeconds:sourceStart,sourceEndSeconds:sourceEnd,
      narrationStartSeconds:audioStart,narrationEndSeconds:audioEnd,
      sourceEvidence:mode,confidence:match?match.confidence:0.2});
    used.push([sourceStart,sourceEnd]);
    if(match)anchoredCuts++;else fallbackCuts++;
  }
  return {cuts,metrics:{anchors:anchors.length,anchoredCuts,fallbackCuts,audioSeconds:target,videoSeconds:round(cuts.reduce((a,c)=>a+c.sourceEndSeconds-c.sourceStartSeconds,0))}};
}
export function allocateFinalLongFormCuts({sourceSrt,englishSrt,urduSrt,sceneMatches=[],proposedCuts=[]}){
  const movieEnd=srtLastTimestamp(sourceSrt),cues=movieSubtitleCues(sourceSrt);
  const en=trackCuts({sourceSrt,cues,movieEnd,narrationSrt:englishSrt,sceneMatches,proposedCuts,language:'english'});
  const ur=trackCuts({sourceSrt,cues,movieEnd,narrationSrt:urduSrt,sceneMatches,proposedCuts,language:'urdu'});
  const cuts=[...en.cuts,...ur.cuts];
  const validated=validateFinalCutPlan(cuts,{sourceSrt,englishSrt,urduSrt});
  return {cuts,metrics:{english:{...en.metrics,...validated.english},urdu:{...ur.metrics,...validated.urdu},method:'server_subtitle_timestamps',frameInspectionRequired:false}};
}
