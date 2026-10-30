/** CinePulse long-form-only video timecode checks.
 * Numeric verification against source and measured narration SRTs.
 * Does not claim scene semantics or video frame analysis.
 */
export const LONGFORM_MODE = 'long_form_only';
export const LONGFORM_MARKER = '[CINEPULSE-LONGFORM-V2]';
export const LONGFORM_MIN_CLIP = 3;
export const LONGFORM_MAX_CLIP = 6;
const EPS = 0.003;
const TRACK_EPS = 0.15;
const stamp = v => Math.round(v * 1000) / 1000;
const number = n => typeof n === 'number' && Number.isFinite(n);
export function srtLastTimestamp(srt) {
  if(typeof srt !== 'string' || srt.length > 2_500_000) throw new Error('A complete SRT is required');
  const pattern = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/g;
  let m,end=0,count=0,oldStart=-1;
  const time = (h,min,s,ms) => Number(h)*3600+Number(min)*60+Number(s)+Number(ms)/1000;
  while((m=pattern.exec(srt)) !== null){
    const a=time(...m.slice(1,5)), b=time(...m.slice(5,9));
    if(!(b > a) || a < 0 || a < oldStart-EPS) throw new Error('SRT has reversed cue ordering');
    end=Math.max(end,b);oldStart=a;count++;
    if(count > 16000) throw new Error('SRT has too many time ranges');
  }
  if(!count || end <= 0) throw new Error('SRT has no valid cues');
  return end;
}
export function isLongFormCreateRequest(body) {
  if(!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid CinePulse project request');
  if(body.outputMode && body.outputMode !== LONGFORM_MODE) throw new Error('Only long_form_only is supported for new movies');
  if(body.modules && (body.modules.shorts === true || body.modules.virals === true))
    throw new Error('Shorts and viral generation are disabled for new CinePulse projects');
  const duration = body.targetMinutes === undefined ? 10 : body.targetMinutes;
  if(!Number.isInteger(duration) || duration < 3 || duration > 60)
    throw new Error('targetMinutes must be an integer between 3 and 60');
  return {outputMode:LONGFORM_MODE,targetMinutes:duration,shorts:false,virals:false,metadata:true};
}
export function normalizePublishingMetadata(result){
  if(!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Metadata stage result must be a JSON object');
  if('viralScenes' in result || 'shorts' in result || 'viralClips' in result)
    throw new Error('Metadata must not generate any viral scenes or Shorts');
  const m=result.metadata ?? result;
  if(!m || typeof m!=='object' || Array.isArray(m) ||
    typeof m.description !== 'string' || m.description.trim().length<20 ||
    !Array.isArray(m.keywords) || !m.keywords.length ||
    !Array.isArray(m.hashtags) || !m.hashtags.length)
    throw new Error('Metadata must include description, keywords and hashtags');
  if(m.keywords.some(x=>typeof x!=='string'||!x.trim())||m.hashtags.some(x=>typeof x!=='string'||!x.trim()))
    throw new Error('Invalid metadata keywords or hashtags');
  return {description:m.description,keywords:m.keywords,hashtags:m.hashtags};
}
export function validateFinalCutPlan(cuts, {sourceSrt,englishSrt,urduSrt,experimentalReview=false}){
  if(!Array.isArray(cuts)||cuts.length===0||cuts.length>4500) throw new Error('Final cut plan must contain one or more cuts');
  const sourceLimit=srtLastTimestamp(sourceSrt);
  const target={english:srtLastTimestamp(englishSrt),urdu:srtLastTimestamp(urduSrt)};
  const totals={};
  for(const language of ['english','urdu']){
    const group=cuts.filter(c=>c?.language===language);
    if(!group.length) throw new Error(language+': final cuts missing');
    let expected=0,total=0;const intervals=[];const reviewWarnings=[];
    for(let i=0;i<group.length;i++){
      const c=group[i];const ss=c.sourceStartSeconds,se=c.sourceEndSeconds;
      const ns=c.narrationStartSeconds,ne=c.narrationEndSeconds;
      if(![ss,se,ns,ne].every(number)) throw new Error(language+': non-numeric timestamp at cut '+(i+1));
      const sd=se-ss,nd=ne-ns;
      if(sd<LONGFORM_MIN_CLIP-EPS||sd>LONGFORM_MAX_CLIP+EPS||
         nd<LONGFORM_MIN_CLIP-EPS||nd>LONGFORM_MAX_CLIP+EPS){
        if(experimentalReview)reviewWarnings.push(language+': cut '+(i+1)+' outside preferred 3–6 seconds');
        else throw new Error(language+': cut '+(i+1)+' outside 3–6 seconds');
      }
      if(sd<=0||nd<=0)throw new Error(language+': cut '+(i+1)+' must have positive duration');
      if(ss<0||se>sourceLimit+EPS) throw new Error(language+': cut '+(i+1)+' outside movie SRT timeline');
      if(Math.abs(sd-nd)>EPS) throw new Error(language+': source and narration clip lengths differ at cut '+(i+1));
      if(Math.abs(ns-expected)>EPS) throw new Error(language+': narration cuts overlap or leave a gap at cut '+(i+1));
      for(const [lo,hi] of intervals){
        if(ss<hi-EPS && se>lo+EPS){
          if(experimentalReview){reviewWarnings.push(language+': source movie footage repeats at cut '+(i+1));break;}
          throw new Error(language+': source movie footage overlaps at cut '+(i+1));
        }
      }
      intervals.push([ss,se]);expected=ne;total+=sd;
    }
    if(Math.abs(expected-target[language])>TRACK_EPS || Math.abs(total-target[language])>TRACK_EPS)
      throw new Error(language+': total final footage does not match measured narration SRT duration');
    totals[language]={cuts:group.length,audioSeconds:stamp(target[language]),videoSeconds:stamp(total),
      firstAudioStart:group[0].narrationStartSeconds,lastAudioEnd:stamp(expected),
      overlapCount:reviewWarnings.filter(w=>w.includes('repeats')).length,
      minCutSeconds:LONGFORM_MIN_CLIP,maxCutSeconds:LONGFORM_MAX_CLIP,
      ...(experimentalReview?{reviewWarnings}:{} )};
  }
  if(cuts.some(c=>c?.language!=='english'&&c?.language!=='urdu'))
    throw new Error('Unexpected cut language, only English and Urdu are supported');
  return totals;
}