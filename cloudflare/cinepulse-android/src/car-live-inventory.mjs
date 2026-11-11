/** CAR inventory v1.1: authoritative only with full English + Urdu coverage.
 * A stopped batch or a historical failure report is never a complete inventory.
 */
export function verifyCarLiveInventory({english,urdu,accepted=[],recovered=[],snapshotVersion}={}){
 if(!Number.isSafeInteger(snapshotVersion)||snapshotVersion<0) return {verified:false,reason:'snapshot_version_missing'};
 const seen=new Set(),unresolved=[];
 for(const [language,part] of [['english',english],['urdu',urdu]]){
  if(!part||part.complete!==true||!Number.isSafeInteger(part.total)||part.total<1||
     !Array.isArray(part.segments)||part.segments.length!==part.total)
   return {verified:false,reason:language+'_coverage_incomplete'};
  const indices=new Set();
  for(const seg of part.segments){
   if(!seg||!Number.isSafeInteger(seg.index)||seg.index<1||seg.index>part.total||
      indices.has(seg.index)||!['accepted','unresolved','recovered'].includes(seg.status))
    return {verified:false,reason:language+'_invalid_segment_state'};
   indices.add(seg.index);
   const id=language+':'+seg.index;
   seen.add(id);
   if(seg.status==='unresolved')unresolved.push(id);
  }
 }
 const acceptedSet=new Set(accepted),recoveredSet=new Set(recovered);
 if(acceptedSet.size!==accepted.length||recoveredSet.size!==recovered.length||
    [...acceptedSet,...recoveredSet].some(id=>!seen.has(id)||acceptedSet.has(id)&&recoveredSet.has(id)))
  return {verified:false,reason:'checkpoint_inventory_conflict'};
 for(const [language,part] of [['english',english],['urdu',urdu]]){
  for(const seg of part.segments){
   const id=language+':'+seg.index;
   if((seg.status==='accepted')!==acceptedSet.has(id)||
      (seg.status==='recovered')!==recoveredSet.has(id))
    return {verified:false,reason:'checkpoint_inventory_mismatch'};
  }
 }
 const lifetime=unresolved.length+recovered.length;
 if(lifetime<1||lifetime>3)return {verified:false,reason:'lifetime_cap_exceeded_or_empty',unresolvedCount:unresolved.length,recoveredCount:recovered.length};
 if(unresolved.length===0)return {verified:false,reason:'no_unresolved'};
 return {verified:true,snapshotVersion,unresolvedSegmentIds:unresolved,lifetimeCount:lifetime};
}
