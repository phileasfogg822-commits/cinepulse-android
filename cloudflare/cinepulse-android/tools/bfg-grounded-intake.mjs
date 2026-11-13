#!/usr/bin/env node
// LOCAL, READ-ONLY BFG pilot intake receipt; does not create or resume movies.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {inspectSourceIntake,BFG_PILOT} from '../src/bfg-v5-grounded-restart.mjs';
const args=process.argv.slice(2);
const file=args[args.indexOf('--source-srt')+1],out=args[args.indexOf('--out-dir')+1];
if(!file||!out||file.startsWith('--')||out.startsWith('--')){console.error('Usage: node tools/bfg-grounded-intake.mjs --source-srt FILE --out-dir DIR');process.exit(2)}
const bytes=await readFile(resolve(file));
const sourceSha256=createHash('sha256').update(bytes).digest('hex');
if(sourceSha256!==BFG_PILOT.expectedSourceSha256){
 console.error(JSON.stringify({error:'Unexpected BFG source SRT SHA-256. Refusing a different subtitle version.',expected:BFG_PILOT.expectedSourceSha256,received:sourceSha256}));
 process.exit(1);
}
const audit=inspectSourceIntake(bytes.toString('utf8'),{expectedCues:BFG_PILOT.reportedSourceCues});
if(!audit.ready){console.error(JSON.stringify(audit));process.exit(1)}
const receipt={pilot:BFG_PILOT,phase:'source_intake_verified_only',sha256:sourceSha256,
 sourceCueCount:audit.sourceCueCount,gapsForRealVideoReview:audit.gaps.length,sourceVideoInspected:false,
 projectCreated:false,digestApproved:false,narrationsApproved:false,movieResumed:false,
 acceptedV5Unchanged:true,producedAt:new Date().toISOString()};
await mkdir(resolve(out),{recursive:true});
const name=join(resolve(out),'bfg-v5-grounded-intake-receipt.json');
await writeFile(name,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({receiptPath:name,...receipt})+'\n');
