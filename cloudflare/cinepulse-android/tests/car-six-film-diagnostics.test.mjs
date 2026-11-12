import test from 'node:test';import assert from 'node:assert/strict';
import {MUSE_SIX_FILM_CAR_DIAGNOSTICS as films} from '../src/car-six-film-diagnostics.mjs';
import {carEligibility} from '../src/context-anchor-recovery.mjs';
test('six-film diagnostic inventory: only five eligible; Kung Fu Panda blocked',()=>{
 assert.equal(films.length,6);
 const outcomes=films.map(f=>({title:f.title,eligible:carEligibility({enabled:true,unresolvedSegmentIds:f.unresolved.map(n=>f.language+':'+n)}).eligible}));
 assert.equal(outcomes.filter(x=>x.eligible).length,5);
 assert.deepEqual(outcomes.filter(x=>!x.eligible).map(x=>x.title),['Kung Fu Panda']);
 assert.equal(films.reduce((sum,f)=>sum+f.unresolved.length,0),12);
});
test('diagnostic manifest cannot be used as substitute for live inventory',()=>assert.equal(carEligibility({enabled:true}).eligible,false));
