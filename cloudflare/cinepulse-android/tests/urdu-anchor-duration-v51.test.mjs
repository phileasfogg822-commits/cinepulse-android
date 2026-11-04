import test from 'node:test';
import assert from 'node:assert/strict';
import {
 ENGLISH_SOURCE_ANCHOR_WINDOW_SECONDS,URDU_SOURCE_ANCHOR_WINDOW_SECONDS,
 validateProductionDeepCuts
} from '../src/permanent-deep-muse.mjs';
import {
 STRICT_DURATION_MARKER,countNarrationWords,
 validateNarrationScriptCap,validateMeasuredDurationCap
} from '../src/narration-duration-policy.mjs';
const stamp=t=>{
 const x=Math.round(t*1000),p=n=>String(n).padStart(2,'0');
 return p(Math.floor(x/3600000))+':'+p(Math.floor(x/60000)%60)+':'+p(Math.floor(x/1000)%60)+','+String(x%1000).padStart(3,'0');
};
const cues=Array.from({length:6},(_,i)=>({startSeconds:i*5,endSeconds:(i+1)*5,text:'Narration about one original scene.'}));
const decisions=Array.from({length:6},(_,i)=>({
 segmentIndex:i+1,narrationStartSeconds:i*5,narrationEndSeconds:(i+1)*5,
 sourceStartSeconds:100+i*20,sourceEndSeconds:105+i*20,
 sourceCueIds:[11+2*i],evidenceQuote:'Movie evidence line '+(11+2*i),
 confidence:.9,museRequestId:'valid-muse-'+i
}));
const accepted=[{decisions:decisions.slice(0,5)},{decisions:decisions.slice(5)}];
const cuts=()=>decisions.map((d,i)=>({narrationStartSeconds:i*5,narrationEndSeconds:(i+1)*5,
 sourceStartSeconds:d.sourceStartSeconds,sourceEndSeconds:d.sourceEndSeconds,matchSegmentIndices:[i+1]}));
test('bounded Urdu-only source anchor relaxation remains distinct from shot duration',()=>{
 assert.equal(ENGLISH_SOURCE_ANCHOR_WINDOW_SECONDS,12);
 assert.equal(URDU_SOURCE_ANCHOR_WINDOW_SECONDS,25);
 const relaxed=cuts();relaxed[5].sourceStartSeconds=222;relaxed[5].sourceEndSeconds=227;
 const ur=validateProductionDeepCuts('urdu',cues,relaxed,accepted);
 assert.equal(ur.relaxedCuts,1);assert.equal(ur.sourceAnchorWindowSeconds,25);
 assert.equal(ur.maxAcceptedGapSeconds,22);
 assert.equal(ur.cuts[5].anchorWindowRelaxedSeconds,22);
 assert.equal(ur.cuts[5].sourceEndSeconds-ur.cuts[5].sourceStartSeconds,5);
 assert.equal(ur.cuts[5].sourceEvidence.includes('cue 21'),true);
 assert.throws(()=>validateProductionDeepCuts('english',cues,relaxed,accepted),/within 12s: minRequiredWindowSeconds=22.000/);
});
test('outside even 25s must be rematched, never silently padded with unrelated footage',()=>{
 const out=cuts();out[5].sourceStartSeconds=231;out[5].sourceEndSeconds=236;
 assert.throws(()=>validateProductionDeepCuts('urdu',cues,out,accepted),/within 25s.*minRequiredWindowSeconds=31/);
});
test('English remains strict while ordinary Urdu cuts remain strict when no relaxation required',()=>{
 const en=validateProductionDeepCuts('english',cues,cuts(),accepted);
 const ur=validateProductionDeepCuts('urdu',cues,cuts(),accepted);
 assert.equal(en.relaxedCuts,0);assert.equal(ur.relaxedCuts,0);
 assert.equal(en.sourceAnchorWindowSeconds,12);
});
test('preserve source no-overlap and narration 3–6s, 100% coverage even with relaxation',()=>{
 let bad=cuts();bad[5].sourceStartSeconds=180;bad[5].sourceEndSeconds=185;
 assert.throws(()=>validateProductionDeepCuts('urdu',cues,bad,accepted),/overlap|reus/i);
 bad=cuts();bad[0].narrationEndSeconds=9;bad[0].sourceEndSeconds=109;
 assert.throws(()=>validateProductionDeepCuts('urdu',cues,bad,accepted),/3|6|duration|overlap/i);
});
test('target duration strict marker applies only to new movie prompts; current V5.0 grandfathered',()=>{
 assert.equal(STRICT_DURATION_MARKER,'hardNarrationCap=v5.1');
 assert.equal(countNarrationWords('Peter jumps and runs.'),4);
 assert.equal(countNarrationWords('پیٹر خرگوش باغ میں جاتا ہے'),6);
 assert.equal(validateNarrationScriptCap('Peter runs away', 'english',10).maxWords,1650);
 assert.equal(validateNarrationScriptCap('وہ خرگوش ہے','urdu',10).maxWords,1400);
 assert.throws(()=>validateNarrationScriptCap('خرگوش '.repeat(1401),'urdu',10),/exceeds the 10-minute/);
});
test('measured MP3-backed narration SRT must end at or before chosen maximum',()=>{
 const srt=t=>'1\n00:00:00,000 --> '+stamp(t)+'\nActual measured words\n';
 assert.equal(validateMeasuredDurationCap(srt(599.9),'english',10).measuredSeconds,599.9);
 assert.throws(()=>validateMeasuredDurationCap(srt(1440),'urdu',10),/1440.000s > 600.000s/);
 assert.throws(()=>validateMeasuredDurationCap(JSON.stringify({format:'srt',text:srt(601)}),'urdu',10),/measured audio duration/i);
});
test('55 seconds cannot fit in a 14 second anchor footprint plus 12-second shoulders',()=>{
 const required=55,original=14,oldWindow=original+2*12,newWindow=original+2*25;
 assert.equal(oldWindow,38);
 assert.equal(required-oldWindow,17);
 assert.equal(newWindow,64);
 assert.ok(newWindow>=required);
});
