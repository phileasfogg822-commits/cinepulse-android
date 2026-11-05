import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 URDU_DEVANAGARI_POLICY_MARKER,URDU_DEVANAGARI_RESCUE_MARKER,URDU_DEVANAGARI_BUILD,
 URDU_DEVANAGARI_METHOD,validateDevanagariPronunciationText,
 validateDevanagariUrduVoiceReceipt,urduDevanagariInstructions,urduDevanagariSrtInstructions
} from '../src/urdu-devanagari-voice.mjs';
const urdu=[
'یہ کہانی جنگ کے مشکل دنوں میں لوگوں کے حوصلے اور ان کی جدوجہد سے شروع ہوتی ہے۔',
'وزیر اعظم کو اپنے ملک کے مستقبل کے بارے میں ایک بہت بڑا فیصلہ کرنا پڑتا ہے۔',
'اس کے ساتھی پریشان ہیں مگر وہ یقین رکھتے ہیں کہ عوام بہادری کا مظاہرہ کریں گے۔',
'تقریر کے دوران وہ اپنے ساتھیوں کو یقین دلاتے ہیں کہ آزادی کی حفاظت ضروری ہے۔',
'آخر میں سب کو معلوم ہوتا ہے کہ مشکل وقت میں ایک مضبوط ارادہ کتنا اہم ہوتا ہے۔'
].join(' ');
const dev=[
'यह कहानी जंग के मुश्किल दिनों में लोगों के हौसले और उनकी जद्दोजहद से शुरू होती है।',
'वज़ीर ए आज़म को अपने मुल्क के मुस्तक़बिल के बारे में एक बहुत बड़ा फ़ैसला करना पड़ता है।',
'उस के साथी परेशान हैं मगर वह यक़ीन रखते हैं कि अवाम बहादुरी का मुज़ाहिरा करेंगे।',
'तक़रीर के दौरान वह अपने साथियों को यक़ीन दिलाते हैं कि आज़ादी की हिफ़ाज़त ज़रूरी है।',
'आख़िर में सब को मालूम होता है कि मुश्किल वक़्त में एक मज़बूत इरादा कितना अहम होता है।'
].join(' ');
const SHA='c'.repeat(64);
const receipt={method:URDU_DEVANAGARI_METHOD,voiceLocale:'hi-IN',provider:'Helio TTS',voiceName:'Aria Hindi',
 inputScript:'Devanagari',spokenLanguage:'Urdu',translationPerformed:false,sourceUrduPreserved:true,
 uncontrolledHindiFallback:false,approvedUrduSha256:SHA,ttsInputDevanagari:dev};
test('approved Urdu stays canonical while only Devanagari is delivered to Hindi-reader TTS',()=>{
 const q=validateDevanagariPronunciationText(dev,urdu);
 assert.equal(q.script,'Devanagari');assert.equal(q.translationAllowed,false);
 assert.ok(q.approvedUrduWords>30);assert.ok(q.inputWords>30);
 assert.equal(validateDevanagariUrduVoiceReceipt(JSON.stringify(receipt),urdu,SHA).spokenLanguage,'Urdu');
});
test('reject Hindi translation disguised as transliteration through word count extremes',()=>{
 assert.throws(()=>validateDevanagariPronunciationText('यह है एक कहानी और बस यही सब कुछ है।',urdu),/comparable-length/);
});
test('reject scripts other than Devanagari including Urdu/Arabic, Latin, Greek, Korean or Chinese',()=>{
 for(const word of ['اردو','Persian','Ελληνικά','한국어','中文','русский']){
  assert.throws(()=>validateDevanagariPronunciationText(dev+' '+word,urdu),/ONLY Devanagari-script letters/);
 }
});
test('reject repeated TTS chunks, no silent looping',()=>{
 const repeated='हम कभी नहीं हारेंगे और लड़ते रहेंगे';
 assert.throws(()=>validateDevanagariPronunciationText(dev+' '+repeated+' '+repeated+' '+repeated,urdu),/repeats a long passage/);
});
test('do not allow undocumented Hindi fallback or unbound voice input',()=>{
 for(const bad of [
  {...receipt,voiceLocale:'ur-PK'}, {...receipt,inputScript:'Urdu'},
  {...receipt,spokenLanguage:'Hindi'}, {...receipt,translationPerformed:true},
  {...receipt,sourceUrduPreserved:false},{...receipt,uncontrolledHindiFallback:true},
  {...receipt,provider:''}
 ])assert.throws(()=>validateDevanagariUrduVoiceReceipt(bad,urdu,SHA),/Only authorized Urdu/);
 assert.throws(()=>validateDevanagariUrduVoiceReceipt({...receipt,approvedUrduSha256:'d'.repeat(64)},urdu,SHA),/checksum/);
});
test('English and original Urdu jobs are untouched by voice-stage recovery and no fake media is accepted',()=>{
 const backend=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.ok(backend.includes('const urduDevanagariVoice=permanentDeep&&prompt.includes(URDU_DEVANAGARI_POLICY_MARKER)'));
 assert.ok(backend.includes('audio/urdu-devanagari/resume'));
 assert.ok(backend.includes("if(method==='POST'&&urduVoiceRescue)"));
 assert.ok(backend.includes("latest.status!=='error'"));
 assert.ok(backend.includes("NOT EXISTS (SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','working'))"));
 assert.ok(backend.includes('if(!english)fail(409'));
 assert.ok(backend.includes('if(mp3)fail(409'));
 assert.ok(backend.includes('validateDevanagariUrduVoiceReceipt(output,source,digest)'));
});
test('task explicitly instructs no Hindi vocabulary substitution, no English regen, and Urdu SRT final',()=>{
 const t=urduDevanagariInstructions({rescue:true});
 assert.match(t,/RESUMING THE SAME FAILED URDU MP3 STAGE/);
 assert.match(t,/NOT Hindi translation/);
 assert.match(t,/NO Urdu\/Arabic, Persian, Roman\/Latin, Greek, Korean, Chinese, Cyrillic/);
 assert.match(t,/No 26-byte empty MP3/);
 assert.match(urduDevanagariSrtInstructions,/ORIGINAL approved Urdu-script narration/);
 assert.equal(URDU_DEVANAGARI_BUILD,'cinepulse-v5.5-urdu-pronunciation');
 assert.ok(URDU_DEVANAGARI_POLICY_MARKER.includes('DEVANAGARI'));
 assert.ok(URDU_DEVANAGARI_RESCUE_MARKER.includes('EXISTING'));
});
