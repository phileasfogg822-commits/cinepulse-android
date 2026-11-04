import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unwrapMeasuredSrt,parseMeasuredCues} from '../src/scene-lab-package.mjs';
const measured='1\n00:00:00,000 --> 00:00:04,321\nThe hero opens the gate.\n\n2\n00:00:04,322 --> 00:00:07,100\nThe team arrives.\n';
test('future Windows .srt assets must contain actual timed cues, not JSON metadata',()=>{
 const wrapped=JSON.stringify({format:'srt',text:measured,firstSegment:0,lastSegment:7100});
 assert.equal(unwrapMeasuredSrt(wrapped),measured);
 assert.equal(parseMeasuredCues(unwrapMeasuredSrt(wrapped)).length,2);
 assert.equal(unwrapMeasuredSrt(measured),measured);
 const backend=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
 assert.match(backend,/english_srt:unwrapMeasuredSrt\(manifest\.narrationSrts\.english\)/);
 assert.match(backend,/urdu_srt:unwrapMeasuredSrt\(manifest\.narrationSrts\.urdu\)/);
});
test('Android normal movies request native eight-file server bundle instead of legacy 4-file converter',()=>{
 const main=readFileSync(new URL('../../../app/src/main/java/com/cinepulse/mobile/MainActivity.java',import.meta.url),'utf8');
 assert.match(main,/api\.windowsDownloads\(id\)/);
 assert.match(main,/manager\.downloadNativeWindowsToDownloads/);
 assert.match(main,/manager\.createNativeWindowsZip/);
 assert.doesNotMatch(main,/manager\.downloadToDownloads\(/);
 assert.doesNotMatch(main,/manager\.createVerifiedZip\(/);
});
