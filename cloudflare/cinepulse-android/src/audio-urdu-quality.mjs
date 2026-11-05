/**
 * New-project-only CinePulse V5.4 gates: QA before voice generation and before
 * any timed SRT can enter immutable semantic matching. Checks are objective,
 * bounded, and never rewrite accepted content or manufacture audio timestamps.
 *
 * A declared ur-PK voice is attestation, not acoustic proof. It must be backed
 * by listening/independent audio tests when certifying a release.
 */
export const AUDIO_QA_MARKER='[CINEPULSE-V54-PAKISTANI-URDU-AUDIO-QA]';
export const AUDIO_QA_BUILD='cinepulse-v5.4-audio-urdu-qa';
const WORDS=/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const stamp=x=>{let ms=Math.round(x*1000);return String(Math.floor(ms/60000)).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');};
const normalized=x=>String(x).normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u06d6-\u06ed]/g,'').replace(/ي/g,'ی').replace(/ك/g,'ک');
const words=x=>(normalized(x).match(WORDS)||[]);
function phraseLoop(records,length,minRepeats=3,window=100){
 const found=new Map();
 for(let i=0;i+length<=records.length;i++){
  const key=records.slice(i,i+length).map(x=>x.word).join(' ');
  const last=found.get(key)||[];
  for(let j=last.length-1;j>=0;j--){
   if(i-last[j].position>window){last.splice(0,j+1);break;}
  }
  if(last.every(x=>i-x.position>=length)){
   last.push({position:i,time:records[i].time,cue:records[i].cue});
  }
  found.set(key,last);
  if(last.length>=minRepeats){
   const actual=last.slice(-minRepeats);
   if(actual[0].cue!==null && new Set(actual.map(x=>x.cue)).size<2)continue;
   return {phrase:key,first:actual[0].time,last:actual.at(-1).time,
     repeats:last.length,firstCue:actual[0].cue,lastCue:actual.at(-1).cue};
  }
 }
 return null;
}
const scriptRecords=x=>words(x).map(word=>({word,time:null,cue:null}));
function foreignLetters(text){
 return [...String(text).matchAll(/\p{L}/gu)].filter(x=>!(/[\p{Script=Arabic}\p{Script=Latin}]/u.test(x[0])))
   .map(x=>({letter:x[0],offset:x.index}));
}
function scriptStats(text){
 const arabic=(text.match(/\p{Script=Arabic}/gu)||[]).length;
 const latin=(text.match(/\p{Script=Latin}/gu)||[]).length;
 return {arabic,latin};
}
export function validateNarrationContent(text,language){
 if(!['english','urdu'].includes(language)||typeof text!=='string'||text.length>1_000_000)
  throw Error('Narration QA requires bounded English or Urdu script text');
 const tokens=words(text);
 if(tokens.length<25)throw Error('Narration QA requires complete original script text');
 const illegal=foreignLetters(text);
 if(language==='urdu'){
  if(illegal.length)throw Error('Urdu narration contains a non-Urdu/non-Latin script character at offset '+illegal[0].offset+
    '; output Pakistani Urdu in the Arabic-derived Urdu script, not Devanagari or mixed foreign scripts');
  const stat=scriptStats(text);
  if(stat.arabic<100||stat.arabic/(stat.arabic+stat.latin||1)<.82)
   throw Error('Urdu narration is not predominantly written in Urdu script. Do not submit Hindi or Devanagari.');
 }else{
  const stat=scriptStats(text);
  if(stat.arabic>Math.max(12,stat.latin*.15))
   throw Error('English script contains too much other-language text');
 }
 const loop=phraseLoop(scriptRecords(text),language==='urdu'?6:8,3,130);
 if(loop)throw Error('Repeated narration phrase before TTS: "'+loop.phrase.slice(0,120)+'" (at least 3 times). Rewrite without unnecessary repetitions.');
 return {language,words:tokens.length,unnecessaryPhraseRepeats:0,script:language==='urdu'?'Urdu-Arabic':'English-Latin'};
}
function originalSrt(value){
 if(typeof value!=='string'||value.length>2_500_000)throw Error('Measured SRT must be a bounded string');
 const trimmed=value.trim();
 if(trimmed.startsWith('{')){
  let v;try{v=JSON.parse(trimmed);}catch{throw Error('Malformed measured SRT envelope');}
  if(!v||Array.isArray(v)||v.format!=='srt'||typeof v.text!=='string')throw Error('Measured SRT JSON envelope missing real timed text');
  return v.text;
 }
 return value;
}
function parsedCues(value){
 const raw=originalSrt(value);
 const pattern=/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})[^\n]*\n/g;
 let match,lastEnd=0;const cues=[];
 const time=a=>Number(a[0])*3600+Number(a[1])*60+Number(a[2])+Number(a[3])/1000;
 while((match=pattern.exec(raw))){
  if(cues.length){
   const prev=cues.at(-1);
   prev.text=raw.slice(lastEnd,match.index).replace(/^\s*\d{1,6}\s*$/gm,'').trim();
  }
  const start=time(match.slice(1,5)),end=time(match.slice(5,9));
  if(end<=start||start<0||start>(1e6)||end>(1e6))throw Error('Measured SRT has invalid cue timestamps');
  cues.push({index:cues.length+1,start,end,text:''});lastEnd=pattern.lastIndex;
 }
 if(cues.length)cues.at(-1).text=raw.slice(lastEnd).trim();
 if(!cues.length)throw Error('Measured SRT has no timed narration cues');
 if(cues.some(c=>!c.text))throw Error('Measured SRT has empty narration cue');
 return cues;
}
function rollingAlignment(cues,narration,language){
 // No large edit distance matrix: bounded local n-gram overlap finds long
 // stretches of fabricated STT output without penalizing isolated ASR errors.
 const n=language==='urdu'?2:3;
 const w=words(narration),known=new Set();
 for(let i=0;i+n<=w.length;i++)known.add(w.slice(i,i+n).join(' '));
 let bad=0,first=null,clean=0;
 for(const cue of cues){
  const cw=words(cue.text);
  if(cw.length<n+3){bad=0;continue;}
  let matching=0;for(let i=0;i+n<=cw.length;i++)matching+=known.has(cw.slice(i,i+n).join(' '))?1:0;
  if(matching===0){
   if(!bad)first=cue;bad++;
   if(bad>=6)throw Error('Speech recognition diverged from approved '+language+
     ' narration for '+bad+' consecutive cues starting '+stamp(first.start)+
     '. Verify actual MP3 chunks and rerun accurate '+(language==='urdu'?'ur-PK':'en')+' speech-to-text alignment; do not invent SRT.');
  }else{clean++;bad=0;}
 }
 return {alignedCues:clean};
}
export function validateMeasuredSubtitleQuality(srt,language,approvedScript){
 if(!['english','urdu'].includes(language))throw Error('Unknown audio QA language');
 validateNarrationContent(approvedScript,language);
 const cues=parsedCues(srt),stream=[];
 for(const cue of cues){
  if(language==='urdu'){
   const foreign=foreignLetters(cue.text);
   if(foreign.length)throw Error('Urdu measured SRT contains foreign-script transcription garbage at cue '+
     cue.index+' ('+stamp(cue.start)+'), character "'+foreign[0].letter+'". Rerun Urdu STT; do not synthesize captions.');
   const {arabic,latin}=scriptStats(cue.text);
   if(latin>18&&latin/(arabic+latin||1)>.25)
    throw Error('Urdu measured SRT has extensive non-Urdu Latin output at cue '+cue.index+
      ' ('+stamp(cue.start)+'). Use language-locked Urdu speech recognition.');
  }
  for(const word of words(cue.text))stream.push({word,cue:cue.index,time:cue.start});
 }
 const loop=phraseLoop(stream,language==='urdu'?5:8,3,160);
 if(loop)throw Error('Repeated '+language+' speech-to-text phrase '+loop.repeats+' times between cues '+
   loop.firstCue+'–'+loop.lastCue+' ('+stamp(loop.first)+'–'+stamp(loop.last)+
   '): "'+loop.phrase.slice(0,110)+'". Compare TTS chunk joins to audio before retry.');
 const alignment=rollingAlignment(cues,approvedScript,language);
 return {language,cues:cues.length,endSeconds:cues.at(-1).end,
   redundantPhraseRepeats:0,foreignScriptCount:0,...alignment};
}
export function validateUrduVoiceReceipt(value){
 let payload;
 try{payload=typeof value==='string'?JSON.parse(value):value;}catch{throw Error('Urdu TTS stage must supply voice provenance JSON');}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  throw Error('Urdu TTS stage must return JSON voice attestation');
 const p=payload;
 const locale=p.voiceLocale||p.locale;
 if(locale!=='ur-PK'||p.inputScript!=='Urdu'||p.transliterated!==false||
    p.hindiFallback!==false||typeof p.voiceName!=='string'||p.voiceName.trim().length<3||
    typeof p.provider!=='string'||p.provider.trim().length<2)
  throw Error('Pakistani Urdu TTS required: ur-PK voice/provider, original Urdu-script input, transliterated=false and hindiFallback=false. No Hindi/hi-IN or Devanagari substitution; fail if unavailable.');
 return {locale:'ur-PK',provider:p.provider,voiceName:p.voiceName,urduNative:true,attestedOnly:true};
}
