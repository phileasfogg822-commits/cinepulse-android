/**
 * V5.5 controlled Urdu voice pronunciation bridge.
 *
 * The approved canonical narration and SRT remain native Urdu. ONLY the input
 * sent to an explicitly selected Hindi-script TTS reader is transliterated
 * into Devanagari. This is NOT a Hindi translation or an Urdu MP3 waiver.
 */
export const URDU_DEVANAGARI_POLICY_MARKER='[CINEPULSE-V55-URDU-IN-DEVANAGARI-TTS]';
export const URDU_DEVANAGARI_RESCUE_MARKER='[CINEPULSE-V55-EXISTING-URDU-VOICE-RESCUE]';
export const URDU_DEVANAGARI_BUILD='cinepulse-v5.5-urdu-pronunciation';
export const URDU_DEVANAGARI_METHOD='urdu-devanagari-hindi-reader-v1';

const normal=x=>String(x??'').normalize('NFKC').replace(/\s+/gu,' ').trim();
const words=x=>normal(x).split(/\s+/u).filter(Boolean);
const devaLetters=x=>(x.match(/\p{Script=Devanagari}/gu)||[]).length;
const urduLetters=x=>(x.match(/\p{Script=Arabic}/gu)||[]).length;
const violations=x=>[...x.matchAll(/\p{L}/gu)].filter(m=>!/\p{Script=Devanagari}/u.test(m[0]));
function consecutiveRepeat(text){
 const t=words(text);if(t.length<20)return null;
 const norm=t.map(w=>w.replace(/[\p{P}\p{S}]+/gu,''));
 for(let k=7;k<=16;k++){
  for(let i=0;i+3*k<=norm.length;i++){
   const a=norm.slice(i,i+k).join(' ');
   if(a===norm.slice(i+k,i+2*k).join(' ') && a===norm.slice(i+2*k,i+3*k).join(' '))
    return a;
  }
 }
 return null;
}
export function validateDevanagariPronunciationText(text,sourceUrdu){
 if(typeof text!=='string'||text.length<30||text.length>250000)
  throw Error('A complete, bounded Devanagari pronunciation copy of approved Urdu narration is required');
 if(typeof sourceUrdu!=='string'||sourceUrdu.length<30||urduLetters(sourceUrdu)<25)
  throw Error('Original canonical Urdu narration is missing or is not Urdu-script text');
 const bad=violations(text);
 if(bad.length)throw Error('TTS pronunciation text must contain ONLY Devanagari-script letters; other script at offset '+bad[0].index+' ("'+bad[0][0]+'"). Do not mix Urdu, Arabic, Persian, Latin, Greek, Korean or Cyrillic scripts.');
 if(devaLetters(text)<50)throw Error('TTS pronunciation must be written in genuine Devanagari, not Roman Urdu or numbers');
 const inputCount=words(text).length, sourceCount=words(sourceUrdu).length;
 if(inputCount<sourceCount*.72||inputCount>sourceCount*1.28)
  throw Error('TTS input is not a comparable-length transliteration of the approved Urdu narration: '+inputCount+' vs '+sourceCount+' words; do not summarize, translate, omit, pad or duplicate scenes.');
 const loop=consecutiveRepeat(text);
 if(loop)throw Error('The Devanagari TTS pronunciation text repeats a long passage: "'+loop.slice(0,95)+'"');
 return {inputWords:inputCount,approvedUrduWords:sourceCount,script:'Devanagari',translationAllowed:false};
}
export function validateDevanagariUrduVoiceReceipt(value,approvedUrdu,expectedSourceSha256){
 let r;
 try{r=typeof value==='string'?JSON.parse(value):value;}catch{throw Error('Urdu Devanagari voice receipt must be JSON, not generic TTS completed text');}
 if(!r||typeof r!=='object'||Array.isArray(r))throw Error('Missing explicit Urdu/Devanagari pronunciation receipt');
 if(r.method!==URDU_DEVANAGARI_METHOD || r.voiceLocale!=='hi-IN'||
    r.inputScript!=='Devanagari'||r.spokenLanguage!=='Urdu'||
    r.translationPerformed!==false||r.sourceUrduPreserved!==true||
    r.uncontrolledHindiFallback!==false||
    typeof r.provider!=='string'||r.provider.trim().length<2||
    typeof r.voiceName!=='string'||r.voiceName.trim().length<2)
  throw Error('Only authorized Urdu words in Devanagari with an explicit hi-IN TTS reader are permitted. Preserve canonical Pakistani Urdu text, never translate to Hindi.');
 if(typeof expectedSourceSha256!=='string'||!(/^[a-f0-9]{64}$/i.test(expectedSourceSha256))||
    r.approvedUrduSha256!==expectedSourceSha256)
  throw Error('The original approved Urdu narration checksum does not match; no script replacement or stale input allowed.');
 const quality=validateDevanagariPronunciationText(r.ttsInputDevanagari,approvedUrdu);
 return {method:r.method,voiceLocale:r.voiceLocale,provider:r.provider,voiceName:r.voiceName,
   sourceUrduPreserved:true,ttsInputScript:'Devanagari',spokenLanguage:'Urdu',
   textQuality:quality,acousticAccentVerified:false};
}
export function urduDevanagariInstructions({rescue=false}={}){
 return 'CINEPULSE V5.5 CONTROLLED URDU PRONUNCIATION. '+(rescue?'RESUMING THE SAME FAILED URDU MP3 STAGE. Preserve ALL previous successful English and Urdu text jobs. ':'')+
  'The approved canonical narration is previousOutputs.narration_urdu in URDU SCRIPT. It MUST NEVER be overwritten. '+
  'Make a separate PRIVATE pronunciation copy by TRANSLITERATING each word to Devanagari, preserving EXACT Pakistani Urdu vocabulary, grammar, events, ordering, names and word-for-word meaning. This is a character-script conversion, NOT Hindi translation. '+
  'Use ONE Hindi/hi-IN-capable voice to read ONLY the Devanagari copy. The TTS input may contain Devanagari-script letters and punctuation/digits only; NO Urdu/Arabic, Persian, Roman/Latin, Greek, Korean, Chinese, Cyrillic, or mixed-script characters. Keep common Urdu-origin words rather than replacing them with Hindi/Sanskrit synonyms. '+
  'Keep a verbatim original Urdu checksum and check chunk word ranges, first and last words, silence and joins. No duplicate chunk, repeated line, altered Urdu wording or synthetic silence. '+
  'UPLOAD real measured nonempty Urdu-speaking MP3 with correct duration before completing the stage. No 26-byte empty MP3, no synthetic or fake receipts. '+
  'The TTS stage output MUST be JSON {"method":"'+URDU_DEVANAGARI_METHOD+'","provider":"actual provider","voiceName":"actual hi-IN voice name","voiceLocale":"hi-IN","inputScript":"Devanagari","spokenLanguage":"Urdu","translationPerformed":false,"sourceUrduPreserved":true,"uncontrolledHindiFallback":false,"approvedUrduSha256":"sha256 of EXACT previousOutputs.narration_urdu UTF-8 text","ttsInputDevanagari":"FULL actual Devanagari text sent to TTS"}. '+
  'If pronunciation is unnatural or the engine returns empty output, report an unresolved error without making up audio. Hindi accent is NOT claimed to be native Pakistani Urdu.';
}
export const urduDevanagariSrtInstructions=
 'URDU V5.5 TIMED SRT: Use the ACTUAL stored Urdu MP3 produced by the controlled Devanagari pronunciation route. Transcription/forced alignment must map the spoken words back to the ORIGINAL approved Urdu-script narration, not translate or preserve Devanagari output. Final srt_urdu MUST be fully timed, only in Urdu script, with real measured timestamps; never synthesize captions from duration or release Hindi/Devanagari final subtitles. Preserve original narration text. Reject repeats, hallucinations and multilingual garbage.';
