import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AUDIO_QA_MARKER,AUDIO_QA_BUILD,validateNarrationContent,validateMeasuredSubtitleQuality,validateUrduVoiceReceipt} from '../src/audio-urdu-quality.mjs';
const enParts=[
'At the isolated beach Cathy discovers strange animals among the trees.',
'John Hammond reveals the hidden breeding site and explains its history.',
'Ian Malcolm refuses to risk another expedition without proper precautions.',
'Sarah Harding travels ahead to examine how dinosaurs protect their young.',
'The boat captain warns everyone about fishermen who never returned.',
'Kelly secretly hides inside the trailer against her father’s instructions.',
'Nick photographs the animals while Eddie tests the expedition equipment.',
'The rival InGen team arrives with cages and powerful hunting vehicles.',
'Roland follows enormous footprints and searches for the tyrannosaur nest.',
'Ludlow intends to transport the wild creatures directly to San Diego.',
'The injured baby dinosaur needs immediate care from the researchers.',
'Two adult predators defend their offspring and attack the fragile trailers.',
'Eddie sacrifices his life while the other survivors climb toward safety.',
'The remaining people reach the old building and radio for urgent rescue.',
'Malcolm ultimately understands why the island must remain protected.'
];
const urParts=[
'ساحل پر چھوٹی بچی کیتھی نے عجیب جانور دیکھے اور گھبرا کر اپنے والدین کو بلایا۔',
'جان ہیمنڈ نے دوسرے جزیرے کی پوشیدہ حقیقت بیان کی اور پچھلے تجربات یاد دلائے۔',
'ایان میلکم نے دوبارہ خطرناک سفر کرنے سے پہلے مناسب حفاظتی اقدامات کا مطالبہ کیا۔',
'سارہ ہارڈنگ ڈائنوسار کے بچوں کی دیکھ بھال اور ان کے رویوں کا مشاہدہ کر رہی تھیں۔',
'کشتی کے کپتان نے لاپتہ ماہی گیروں کے واقعات سنا کر سب کو خبردار کیا۔',
'کیلی اپنے والد کی مرضی کے خلاف چپکے سے ٹریلر کے اندر جا کر چھپ گئی۔',
'نک نے جانوروں کی تصویریں بنائیں جبکہ ایڈی ضروری آلات کی جانچ کر رہا تھا۔',
'انجن کی دوسری ٹیم بڑے پنجروں اور طاقتور گاڑیوں کے ساتھ شکار کرنے پہنچ گئی۔',
'رولینڈ نے دیوہیکل قدموں کے نشان دیکھے اور ٹائرانوسارس کا گھونسلا تلاش کیا۔',
'پیٹر لڈلو ان جانوروں کو سمندر پار سین ڈیاگو منتقل کرنے کا منصوبہ بنا رہا تھا۔',
'زخمی چھوٹے ڈائنوسار کو محققین کی فوری مدد اور مرہم پٹی کی ضرورت تھی۔',
'دو بڑے شکاری اپنے بچے کی حفاظت کے لیے ٹریلر پر اچانک حملہ کرتے ہیں۔',
'ایڈی نے اپنے ساتھیوں کی جان بچاتے ہوئے اپنی زندگی قربان کر دی۔',
'بچ جانے والے لوگ پرانی عمارت تک پہنچ کر ریڈیو کے ذریعے امداد مانگتے ہیں۔',
'میلکم آخر میں سمجھ جاتا ہے کہ جزیرے کو انسانی مداخلت سے محفوظ رکھنا ضروری ہے۔'
];
const english=enParts.join(' '), urdu=urParts.join(' ');
const clock=n=>{const ms=Math.round(n*1000),pad=x=>String(x).padStart(2,'0');return pad(Math.floor(ms/3600000))+':'+pad(Math.floor(ms/60000)%60)+':'+pad(Math.floor(ms/1000)%60)+','+String(ms%1000).padStart(3,'0');};
const srt=parts=>parts.map((text,i)=>(i+1)+'\n'+clock(i*4)+' --> '+clock((i+1)*4)+'\n'+text+'\n').join('\n');
const receipt={provider:'ApprovedRemoteVoiceVendor',voiceName:'PakistaniUrduVoice',voiceLocale:'ur-PK',inputScript:'Urdu',transliterated:false,hindiFallback:false};
const reject=(fn,match)=>assert.throws(fn,match);
test('marked policy is opt-in only for newly created movie digests, preserving existing movies',()=>{
 const index=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(index,/audioLanguageQa=permanentDeep&&prompt\.includes\(AUDIO_QA_MARKER\)/);
 assert.match(index,/AUDIO_QA_MARKER\} targetMinutes/);
 assert.match(index,/if\(pp\.audioLanguageQa\)/);
 assert.match(index,/audioLanguageQualityForNewProjects:true/);
 assert.match(index,/urduTtsLocaleRequired:'ur-PK'/);
 assert.equal(AUDIO_QA_BUILD,'cinepulse-v5.4-audio-urdu-qa');
 assert.ok(AUDIO_QA_MARKER.includes('PAKISTANI-URDU'));
});
test('unique approved long-form scripts pass without cosmetic rewrites',()=>{
 assert.equal(validateNarrationContent(english,'english').unnecessaryPhraseRepeats,0);
 assert.equal(validateNarrationContent(urdu,'urdu').script,'Urdu-Arabic');
});
test('narration writing stage catches repeated English phrases before TTS',()=>{
 const phrase='A completely invented sentence about a red spaceship that does not belong.';
 reject(()=>validateNarrationContent(english+' '+phrase+' '+phrase+' '+phrase,'english'),/Repeated narration phrase/);
});
test('narration writing stage refuses Hindi Devanagari/mixed-script substitutions',()=>{
 reject(()=>validateNarrationContent(urdu+' परिवार हमारा घर','urdu'),/non-Urdu\/non-Latin script/);
});
test('Pakistani Urdu script rejects high-confidence Hindi-register vocabulary, with Urdu substitute',()=>{
 for(const word of ['پریاس','سمپرک','آوشیک','پریوار','وشواس']){
  reject(()=>validateNarrationContent(urdu+' '+word+' کی جگہ اردو بولنی چاہیے۔','urdu'),/Unnatural Hindi-register vocabulary/);
 }
});
test('clean measured English and Urdu SRT cues align with the approved texts',()=>{
 assert.equal(validateMeasuredSubtitleQuality(srt(enParts),'english',english).cues,15);
 assert.equal(validateMeasuredSubtitleQuality(JSON.stringify({format:'srt',text:srt(urParts)}),'urdu',urdu).cues,15);
});
test('English multi-cue loop similar to repeated 14-minute narration is rejected',()=>{
 const repeated='with roland on a jet as a tour period the tour period must run faster';
 const damaged=[...enParts];damaged.splice(4,0,repeated,repeated,repeated);
 reject(()=>validateMeasuredSubtitleQuality(srt(damaged),'english',english),/Repeated english speech-to-text phrase/);
});
test('Urdu repeated phrase loop is rejected even without foreign script',()=>{
 const repeated='بھرتی کے پاندانوں کے ساتھ لوگ چلتے ہیں';
 const damaged=[...urParts];damaged.splice(3,0,repeated,repeated,repeated);
 reject(()=>validateMeasuredSubtitleQuality(srt(damaged),'urdu',urdu),/Repeated urdu speech-to-text phrase/);
});
test('Urdu transcript mixed with Chinese, Cyrillic, Korean or Devanagari is rejected',()=>{
 for(const token of ['测试','тест','한국어','यह']){
  const damaged=[...urParts];damaged[6]=urParts[6]+' '+token;
  reject(()=>validateMeasuredSubtitleQuality(srt(damaged),'urdu',urdu),/foreign-script transcription garbage/);
 }
});
test('six consecutive unapproved SRT story cues cannot pass by timing alone',()=>{
 const gibberish=Array.from({length:7},(_,i)=>'Alpha'+i+' cruiser'+i+' nebula'+i+' color'+i+' velocity'+i+' narrow'+i+' purple'+i+' meadow'+i+' sequence'+i);
 const damaged=[...enParts];damaged.splice(4,7,...gibberish);
 reject(()=>validateMeasuredSubtitleQuality(srt(damaged),'english',english),/Speech recognition diverged/);
});
test('only declared native Pakistani Urdu TTS is allowed, Hindi fallback refused',()=>{
 assert.equal(validateUrduVoiceReceipt(JSON.stringify(receipt)).locale,'ur-PK');
 for(const wrong of [
  {...receipt,voiceLocale:'hi-IN'},{...receipt,transliterated:true},
  {...receipt,hindiFallback:true},{...receipt,inputScript:'Devanagari'},{...receipt,voiceName:''}
 ])reject(()=>validateUrduVoiceReceipt(JSON.stringify(wrong)),/Pakistani Urdu TTS required/);
 reject(()=>validateUrduVoiceReceipt('TTS complete'),/voice provenance JSON/);
});
