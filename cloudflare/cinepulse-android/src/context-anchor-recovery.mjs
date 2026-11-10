/** CAR v1.1: isolated, opt-in recovery eligibility and immutable patch preparation.
 * Does NOT alter the normal Muse deep-match path. Production wiring is separate.
 */
export const CAR_MAX_UNRESOLVED = 3;
export function carEligibility({enabled=false, unresolvedSegmentIds, acceptedSegmentIds=[]}={}) {
  if(!enabled) return {eligible:false,reason:'disabled'};
  if(!Array.isArray(unresolvedSegmentIds)) return {eligible:false,reason:'unresolved_inventory_unknown'};
  if(unresolvedSegmentIds.length<1 || unresolvedSegmentIds.length>CAR_MAX_UNRESOLVED)
    return {eligible:false,reason:'unresolved_count_out_of_range'};
  const ids=unresolvedSegmentIds.map(String);
  if(ids.some(id=>!id.trim()) || new Set(ids).size!==ids.length)
    return {eligible:false,reason:'invalid_unresolved_inventory'};
  if(ids.some(id=>acceptedSegmentIds.map(String).includes(id)))
    return {eligible:false,reason:'accepted_segment_collision'};
  return {eligible:true,ids};
}
/** Return a NEW map, replacing only an explicitly unresolved key.
 * Caller must persist with an atomic compare-and-swap transaction and recheck eligibility.
 */
export function prepareCarPatch({accepted, unresolvedSegmentIds, targetId, recovery, enabled=false}) {
  if(!accepted || typeof accepted!=='object' || Array.isArray(accepted))
    throw Error('Accepted decision snapshot required');
  const eligibility=carEligibility({enabled,unresolvedSegmentIds,acceptedSegmentIds:Object.keys(accepted)});
  if(!eligibility.eligible) throw Error('CAR not eligible: '+eligibility.reason);
  const key=String(targetId);
  if(!eligibility.ids.includes(key) || Object.hasOwn(accepted,key))
    throw Error('CAR may update only a declared unresolved segment');
  if(!recovery || recovery.anchorMethod!=='context' || recovery.visualVerified!==false ||
     !Array.isArray(recovery.sourceCueIds) || !recovery.sourceCueIds.length ||
     typeof recovery.museRequestId!=='string' || recovery.museRequestId.length<6)
    throw Error('Context recovery evidence incomplete');
  return {...accepted,[key]:structuredClone(recovery)};
}
