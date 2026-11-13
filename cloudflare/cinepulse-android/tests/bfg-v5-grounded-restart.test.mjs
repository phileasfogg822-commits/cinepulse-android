import test from 'node:test';
import assert from 'node:assert/strict';
import {BFG_PILOT,inspectSourceIntake,inspectBeforeVoice,inspectAfterVoice,inspectGlobalSceneDryRun} from '../src/bfg-v5-grounded-restart.mjs';
import {analyzeSrtUncaptionedIntervals,extractBracketedSrtCaptions,verifySrtContextBridge} from '../src/srt-interval-context.mjs';
const sourceSrt=[
'1\n00:00:01,000 --> 00:00:02,000\nMorning, Sophie.',
'2\n00:00:12,000 --> 00:00:13,000\nWhere are you?',
'3\n00:00:25,000 --> 00:00:26,000\nMorning, Sophie.'
].join('\n\n');
const data=()=>({sourceSrt,
 blueprint:[
  {beatId:'greeting-first',startSeconds:.8,endSeconds:2.5},
  {beatId:'greeting-second',startSeconds:24.8,endSeconds:26},
  {beatId:'question',startSeconds:11.5,endSeconds:13.5}
 ],
 beats:[
  {id:'greeting-first',summary:'First greeting',evidence:[{kind:'subtitle',cueId:1,exactQuote:'Morning, Sophie.'}]},
  {id:'greeting-second',summary:'Another greeting at another movie time',evidence:[{kind:'subtitle',cueId:3,exactQuote:'Morning, Sophie.'}]},
  {id:'question',summary:'A character asks where someone is',evidence:[{kind:'subtitle',cueId:2,exactQuote:'Where are you?'}]}
 ],
 narrationUnits:[
  {language:'english',id:'en-first',text:'Morning, Sophie.',beatIds:['greeting-first']},
  {language:'english',id:'en-second',text:'Another greeting.',beatIds:['greeting-second']},
  {language:'english',id:'en-action',text:'Someone asks where they are.',beatIds:['question']},
  {language:'urdu',id:'ur-first',text:'A greeting to Sophie.',beatIds:['greeting-first']},
  {language:'urdu',id:'ur-second',text:'A later greeting.',beatIds:['greeting-second']},
  {language:'urdu',id:'ur-action',text:'Someone asks where they are.',beatIds:['question']}
 ],
 measuredCues:[
  {language:'english',index:1,startSeconds:0,endSeconds:.5,text:'Morning,',unitIds:['en-first']},
  {language:'english',index:2,startSeconds:.5,endSeconds:1.2,text:'Sophie.',unitIds:['en-first']},
  {language:'english',index:3,startSeconds:1.2,endSeconds:2.5,text:'Another greeting.',unitIds:['en-second']},
  {language:'urdu',index:1,startSeconds:0,endSeconds:2,text:'Someone asks where they are.',unitIds:['ur-action']}
 ]});
test('BFG pilot never mutates live project',()=>{assert.equal(BFG_PILOT.worker,'INT');assert.equal(BFG_PILOT.allowProductionMutation,false)});
test('source intake sees time gaps but does not invent silent-scene content',()=>{
 const a=inspectSourceIntake(sourceSrt,{expectedCues:3,gapSeconds:5});
 assert.equal(a.ready,true);assert.equal(a.gaps.length,2);
 assert.ok(a.gaps.every(g=>g.status==='uncaptioned_interval_only'));
 assert.equal(a.videoInputRequired,false);
 assert.equal(a.productionProjectCreated,false);
});
test('source integrity fails closed on cue count discrepancy',()=>{
 assert.equal(inspectSourceIntake(sourceSrt,{expectedCues:1239}).ready,false);
});
test('source-to-digest-to-narration references pass using separate repeated greetings',()=>{
 const a=inspectBeforeVoice(data());
 assert.equal(a.ready,true,JSON.stringify(a.errors));assert.equal(a.digestBeats,3);
});
test('same spoken words cannot be relabeled as a different source cue',()=>{
 const a=data();a.beats[1].evidence[0].cueId=2;
 assert.equal(inspectBeforeVoice(a).ready,false);
});
test('unbacked digest, narration, and visual-only claims fail without requiring video',()=>{
 const a=data();a.beats[0].evidence[0].exactQuote='Unsaid dialogue';
 a.narrationUnits[0].beatIds=['invented'];
 assert.equal(inspectBeforeVoice(a).ready,false);
 const b=data();b.beats[2].evidence=[{kind:'visual',startSeconds:15,endSeconds:19,observedAction:'Unseen dinosaur'}];
 assert.match(inspectBeforeVoice(b).errors.join(' '),/excluded from the SRT-only workflow/);
});
test('short sentence remains one semantic narration group despite two STT cues',()=>{
 const a=data(),s=inspectAfterVoice({units:a.narrationUnits.filter(u=>['en-first','en-second','ur-action'].includes(u.id)),measuredCues:a.measuredCues});
 assert.equal(s.ready,true,JSON.stringify(s.errors));
 assert.deepEqual(s.groups.find(g=>g.unitId==='en-first').cueIndices,[1,2]);assert.equal(s.measuredSrtUnchanged,true);
});
test('missing or out-of-order measured SRT cue does not become a valid scene',()=>{
 const a=data();a.measuredCues.splice(1,1);
 assert.equal(inspectAfterVoice({units:a.narrationUnits.filter(u=>['en-first','en-second','ur-action'].includes(u.id)),measuredCues:a.measuredCues}).ready,false);
});
test('global plan refuses weak 0.60 match, and forbids lowered quality floor',()=>{
 const groups=[{language:'english',unitId:'en-first'}];
 const decisions=[{language:'english',unitId:'en-first',status:'verified',qualityScore:.6,startSeconds:1,endSeconds:2}];
 assert.deepEqual(inspectGlobalSceneDryRun({sourceSrt,groups,decisions}).precision,['english:en-first']);
 assert.equal(inspectGlobalSceneDryRun({sourceSrt,groups,decisions,qualityFloor:.6}).ready,false);
});
test('two narration units sharing one source time cannot silently overlap',()=>{
 const groups=[{language:'english',unitId:'one'},{language:'english',unitId:'two'}];
 const decisions=groups.map(g=>({...g,status:'verified',qualityScore:.96,startSeconds:1,endSeconds:2,sourceCueIds:[1],independentSubtitleReview:true,reviewerRef:'r1',evidenceQuote:'Morning, Sophie.',reason:'Exact original dialogue supports a greeting at this time.'}));
 assert.equal(inspectGlobalSceneDryRun({sourceSrt,groups,decisions}).ready,false);
});
test('English and Urdu can select same source time in independent rendered videos',()=>{
 const groups=[{language:'english',unitId:'one'},{language:'urdu',unitId:'one'}];
 const decisions=groups.map(g=>({...g,status:'verified',qualityScore:.96,startSeconds:1,endSeconds:2,sourceCueIds:[1],independentSubtitleReview:true,reviewerRef:'r1',evidenceQuote:'Morning, Sophie.',reason:'Exact original dialogue supports a greeting at this time.'}));
 assert.equal(inspectGlobalSceneDryRun({sourceSrt,groups,decisions}).ready,true);
});
test('unverified source-SRT evidence cannot be auto-accepted',()=>{
 const groups=[{language:'urdu',unitId:'one'}];
 const decisions=[{language:'urdu',unitId:'one',status:'verified',qualityScore:.99,startSeconds:1,endSeconds:2,sourceCueIds:[1]}];
 const result=inspectGlobalSceneDryRun({sourceSrt,groups,decisions});
 assert.equal(result.ready,false);assert.deepEqual(result.precision,['urdu:one']);
});

test('BFG exact-source hash is pinned independently of cue count',()=>{
 assert.equal(BFG_PILOT.expectedSourceSha256,'c8ba15b4dd98e7d5c50266f2d01fcb689c0d5fb15fd63b240802f91bf91c9268');
 assert.equal(BFG_PILOT.reportedSourceCues,1239);
});
test('proper source quotation is required even for a claimed 0.99 semantic match',()=>{
 const groups=[{language:'english',unitId:'greeting'}];
 const decisions=[{language:'english',unitId:'greeting',status:'verified',qualityScore:.99,
  startSeconds:1,endSeconds:2,sourceCueIds:[1],independentSubtitleReview:true,
  reviewerRef:'reader-1',reason:'An exact morning greeting from the original subtitle cue',
  evidenceQuote:'fabricated dialogue'}];
 const report=inspectGlobalSceneDryRun({sourceSrt,groups,decisions});
 assert.equal(report.ready,false);
 assert.deepEqual(report.precision,['english:greeting']);
});
test('SRT-only pre-TTS pilot accepts source-backed narration with no video hash',()=>{
 const r=inspectBeforeVoice(data());
 assert.equal(r.ready,true,JSON.stringify(r.errors));
 assert.equal(r.videoInputRequired,false);
});

test('silent interval captures dialogue before and after and near bracketed SRT cues',()=>{
 const s=[
  '1\n00:00:01,000 --> 00:00:02,000\nWe need to find her.',
  '2\n00:00:03,000 --> 00:00:04,000\n(FOOTSTEPS APPROACHING)',
  '3\n00:00:30,000 --> 00:00:31,000\nDid you hear something?',
  '4\n00:00:32,000 --> 00:00:33,000\n[BIRDS CHIRPING]'
 ].join('\n\n');
 const gaps=analyzeSrtUncaptionedIntervals(s,{minGapSeconds:5,neighborCues:2});
 assert.equal(gaps.length,1);
 const g=gaps[0];assert.equal(g.durationSeconds,26);
 assert.deepEqual([g.precedingCue,g.followingCue],[2,3]);
 assert.deepEqual(g.before.map(x=>x.cueId),[1,2]);
 assert.deepEqual(g.after.map(x=>x.cueId),[3,4]);
 assert.deepEqual(g.bracketedCaptionEvidence.map(x=>x.cueId),[2,4]);
 assert.equal(g.contextPriority,'caption_context_priority');
 assert.equal(g.audioSilenceVerified,false);
 assert.equal(g.verifiedVisualAction,false);
 assert.equal(g.autoNarrateSpecificUncaptionedAction,false);
});
test('quiet gap with no bracket caption remains dialogue-context-only, not invented action',()=>{
 const s=[
  '1\n00:00:01,000 --> 00:00:02,000\nAre you coming?',
  '2\n00:00:20,000 --> 00:00:22,000\nYes.'
 ].join('\n\n');
 const [g]=analyzeSrtUncaptionedIntervals(s,{minGapSeconds:5});
 assert.equal(g.contextPriority,'dialogue_context_review');
 assert.deepEqual(g.bracketedCaptionEvidence,[]);
 assert.equal(g.status,'uncaptioned_interval_only');
 assert.equal(g.autoNarrateSpecificUncaptionedAction,false);
});
test('bracket text proves the literal caption only, never a visual event',()=>{
 const c=extractBracketedSrtCaptions('(DINOSAUR GROWLING) then [BIRDS CHIRPING]');
 assert.deepEqual(c.map(x=>x.captionText),['DINOSAUR GROWLING','BIRDS CHIRPING']);
 assert.ok(c.every(x=>!x.impliesVisibleAction));
});
test('SRT-only intake remains usable with contextual gaps and no video',()=>{
 const audit=inspectSourceIntake(sourceSrt,{expectedCues:3,gapSeconds:5});
 assert.equal(audit.ready,true);
 assert.equal(audit.neighborDialogueCaptured,true);
 assert.ok(audit.gaps.every(g=>g.contextUsableForDraft===true&&g.autoNarrateSpecificUncaptionedAction===false));
});

test('BFG source-grounded digest may cite exact SRT gap boundaries as a temporal transition',()=>{
 const a=data();
 a.beats.push({id:'gap-bridge',summary:'A pause separates the question from the later greeting.',
  evidence:[{kind:'srt_context',precedingCueId:2,followingCueId:3,
   precedingExactQuote:'Where are you?',followingExactQuote:'Morning, Sophie.',
   role:'temporal_transition',reason:'The dialogue pause connects the two spoken story moments'}]});
 a.blueprint.push({beatId:'gap-bridge',startSeconds:13,endSeconds:25});
 a.narrationUnits.push({language:'english',id:'en-bridge',text:'Later, someone greets Sophie.',
  beatIds:['gap-bridge']},{language:'urdu',id:'ur-bridge',text:'After a pause, there is another greeting.',
  beatIds:['gap-bridge']});
 const out=inspectBeforeVoice(a);
 assert.equal(out.ready,true,JSON.stringify(out.errors));
 assert.equal(out.contextBridgeBeats.length,1);
 assert.equal(out.contextBridgeBeats[0].visualContentVerified,false);
 assert.equal(out.contextBridgeBeats[0].requiresSemanticReview,true);
});
test('SRT contextual silence never authorizes invented action or false boundary quotes',()=>{
 const source=[{startSeconds:1,endSeconds:2,text:'Where are you?'},
  {startSeconds:13,endSeconds:14,text:'(FOOTSTEPS APPROACHING)'}];
 const e={kind:'srt_context',precedingCueId:1,followingCueId:2,
  precedingExactQuote:'Where are you?',followingExactQuote:'(FOOTSTEPS APPROACHING)',
  role:'caption_supported_context',reason:'An SRT sound caption follows a long pause',
  captionCueId:2,exactCaption:'(DINOSAUR WALKING)'};
 assert.equal(verifySrtContextBridge(source,e).valid,false);
 e.exactCaption='(FOOTSTEPS APPROACHING)';
 const valid=verifySrtContextBridge(source,e);
 assert.equal(valid.valid,true);
 assert.equal(valid.visualContentVerified,false);
 e.precedingExactQuote='fabricated conversation';
 assert.equal(verifySrtContextBridge(source,e).valid,false);
});
