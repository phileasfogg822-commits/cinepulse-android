/**
 * CinePulse V5.1 duration controls. New submissions are strict; already
 * processing V5.0 movies remain untouched (their MP3/SRT/cuts are immutable).
 * A word budget is an early safety filter, NOT a substitute for timing the
 * real TTS MP3 via measured STT/SRT.
 */
import {srtLastTimestamp} from './longform-policy.mjs';
export const STRICT_DURATION_MARKER='hardNarrationCap=v5.1';
export const NARRATION_WORDS_PER_MINUTE_LIMIT=Object.freeze({english:165,urdu:140});
export const DURATION_EPSILON_SECONDS=0.5;
export function countNarrationWords(text){
 if(typeof text!=='string')throw Error('Narration text must be a string');
 return (text.match(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu)||[]).length;
}
export function validateNarrationScriptCap(text,language,targetMinutes){
 const words=countNarrationWords(text);
 const max=Math.floor(targetMinutes*NARRATION_WORDS_PER_MINUTE_LIMIT[language]);
 if(!max||words>max)throw Error(
  language+' narration exceeds the '+targetMinutes+'-minute selected target script budget: '+words+
  ' words > '+max+' maximum. Muse must shorten THIS language before TTS; do not create a 24-minute voiceover.');
 return {language,words,maxWords:max,targetMinutes,advisoryOnly:false};
}
export function validateMeasuredDurationCap(srt,language,targetMinutes){
 const seconds=srtLastTimestamp(srt,language+'_srt');
 const max=targetMinutes*60;
 if(seconds>max+DURATION_EPSILON_SECONDS)
  throw Error(language+' MP3-backed SRT duration exceeds the selected '+targetMinutes+
   '-minute maximum: '+seconds.toFixed(3)+'s > '+max.toFixed(3)+
   's. This is real audio overrun; shorten approved script and regenerate just this language TTS/SRT before matching.');
 return {language,measuredSeconds:seconds,targetSeconds:max,hardLimit:true};
}
