import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateFinalLongFormCuts} from './server-cut-planner.mjs';

function srt(count, step=5) {
  return Array.from({length:count},(_,i)=>{
    const t=x=>'00:'+String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0')+',000';
    return (i+1)+'\n'+t(i*step)+' --> '+t((i+1)*step)+'\nCue '+(i+1)+'\n';
  }).join('\n');
}
const movie=srt(40);
const audio=srt(1);
test('default allocator refuses unsupported global subtitle fallback',()=>{
  assert.throws(()=>allocateFinalLongFormCuts({sourceSrt:movie,englishSrt:audio,urduSrt:audio}),/MUSE_SCENE_UNRESOLVED/);
});
test('explicit compatibility fallback remains opt-in and visible',()=>{
  const result=allocateFinalLongFormCuts({sourceSrt:movie,englishSrt:audio,urduSrt:audio,allowGlobalFallback:true});
  assert.equal(result.metrics.allowGlobalFallback,true);
  assert.equal(result.metrics.english.fallbackCuts,1);
  assert.equal(result.metrics.urdu.fallbackCuts,1);
});
test('evidence-backed source anchors allocate without global fallback',()=>{
  const sceneMatches=['english','urdu'].map(language=>({language,sourceStartSeconds:10,sourceEndSeconds:30,narrationStartSeconds:0,narrationEndSeconds:5,confidence:.95}));
  const result=allocateFinalLongFormCuts({sourceSrt:movie,englishSrt:audio,urduSrt:audio,sceneMatches});
  assert.equal(result.metrics.english.fallbackCuts,0);
  assert.equal(result.metrics.urdu.fallbackCuts,0);
});
