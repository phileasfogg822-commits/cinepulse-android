import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalMuseAnalysis,verifyMuseAnalysis} from '../src/muse-production-contract.mjs';

const previous={
  narrations:{
    english:'Peter Rabbit narration exactly as Muse submitted.\nContains real movie dialogue, with CRLF where present.',
    urdu:'پیٹر ریبٹ کی مکمل اردو کہانی اور درست تحریر۔\nاصل عبارت جوں کی توں۔'
  },
  digest:'Peter Rabbit (2018): verified original chronological digest\nIncluding\nline breaks and source details.'
};
const make=()=>structuredClone(canonicalMuseAnalysis(previous));

test('canonical exact analysis fields copied without regenerating story or cuts are accepted',()=>{
  const a=make();
  assert.equal(a.narrations.english,previous.narrations.english);
  assert.equal(a.narrations.hindiUrdu,previous.narrations.urdu);
  assert.equal(a.research.verifiedSynopsis,previous.digest);
  assert.equal(verifyMuseAnalysis(a,previous),true);
});
test('no umbrella error: a missing analysis.narrations.english is reported by its exact path',()=>{
  const a=make();
  delete a.narrations.english;
  assert.throws(()=>verifyMuseAnalysis(a,previous),/analysis\.narrations\.english: missing or nonstring/);
});
test('wrong Urdu narration produces path, first mismatch offset and expected lengths',()=>{
  const a=make();a.narrations.hindiUrdu=a.narrations.hindiUrdu+'\n';
  assert.throws(()=>verifyMuseAnalysis(a,previous),e=>
    e.message.includes('analysis.narrations.hindiUrdu: exact previous Muse stage text mismatch')&&
    e.message.includes('UTF-16 offset')&&
    e.message.includes('previousOutputs.narration_urdu'));
});
test('changed synopsis says verifiedSynopsis differs; preserves original digest',()=>{
  const a=make();a.research.verifiedSynopsis='Brief rewritten digest';
  assert.throws(()=>verifyMuseAnalysis(a,previous),e=>
    e.message.includes('analysis.research.verifiedSynopsis:')&&
    e.message.includes('previousOutputs.digest'));
  assert.equal(previous.digest,make().research.verifiedSynopsis);
});
test('analysis.scripts aliases do NOT masquerade as required analysis.narrations',()=>{
  const a=make();
  a.scripts={english:a.narrations.english,urdu:a.narrations.hindiUrdu};
  delete a.narrations;
  assert.throws(()=>verifyMuseAnalysis(a,previous),/analysis\.narrations\.english: missing/);
});
test('validator does not normalize Unicode, paraphrase, or silently alter accepted Muse outputs',()=>{
  const a=make();
  a.narrations.hindiUrdu=a.narrations.hindiUrdu.normalize('NFD');
  if(a.narrations.hindiUrdu!==previous.narrations.urdu)
    assert.throws(()=>verifyMuseAnalysis(a,previous),/analysis\.narrations\.hindiUrdu/);
  const b=make();
  b.narrations.english=b.narrations.english.replace(/\n/g,'\r\n');
  assert.throws(()=>verifyMuseAnalysis(b,previous),/analysis\.narrations\.english/);
});
