/**
 * Read-only CAR D1 preflight state fingerprint.
 * This detects changes between an audited handoff and a later re-read,
 * including accepted Muse batch outputs and checkpoint decisions.
 * It is NOT a D1 transaction, a production validator, or enqueue permission.
 */
import {sha256} from './helpers.mjs';

export async function fingerprintCarD1State({
 projectId,audit,checkpoints,sourceSrt,englishSrt,urduSrt,jobRows
}={}){
 if(typeof projectId!=='string'||audit?.projectId!==projectId||
    audit?.source!=='d1_read_only'||!audit.inventory||
    !Array.isArray(checkpoints)||typeof sourceSrt!=='string'||
    typeof englishSrt!=='string'||typeof urduSrt!=='string'||
    !Array.isArray(jobRows))
  throw Error('car_d1_fingerprint_incomplete');
 // The query supplying jobRows must include every deep-match job (not only
 // accepted rows), with its status and output, in stable database order.
 const state={projectId,snapshotVersion:audit.inventory.snapshotVersion,
  acceptedSegmentIds:audit.inventory.acceptedSegmentIds,
  unknownSegmentIds:audit.inventory.unknownSegmentIds,
  verifiedSegmentIds:audit.verifiedSegmentIds,
  verifiedProvenance:audit.verifiedProvenance,
  evidenceStatus:audit.evidenceStatus,
  checkpoints:checkpoints.map(x=>({targetId:x.targetId,
   snapshotVersion:x.snapshotVersion,decision:x.decision})),
  sourceSrt,englishSrt,urduSrt,
  jobs:jobRows.map(x=>({id:x.id,stepId:x.step_id,status:x.status,
   output:x.output,createdAt:x.created_at,finishedAt:x.finished_at}))};
 return sha256('cinepulse-car-d1-preflight-v1:'+JSON.stringify(state));
}
