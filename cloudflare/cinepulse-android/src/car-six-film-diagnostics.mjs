/** Diagnostic inventory from Muse's 2026-11-10 six-film needs_review report.
 * READ-ONLY. These reports are not proof of live DB state or authorization to patch.
 * CAR must recheck the COMPLETE live unresolved inventory before each atomic write.
 */
export const MUSE_SIX_FILM_CAR_DIAGNOSTICS=Object.freeze([
 {title:'Shrek 2',projectId:'fed941ad-ff7f-4b0f-8439-25cfda24d187',language:'english',unresolved:[81],stage:'deep_match_english'},
 {title:'Kung Fu Panda',projectId:'179519ff-7dd0-4b73-80bf-889d8fc78b5c',language:'urdu',unresolved:[36,37,38,39],stage:'deep_match_urdu'},
 {title:'A Minecraft Movie',projectId:'87f470fe-f6eb-4d4c-b80f-f56abfb2a66b',language:'urdu',unresolved:[151,155],stage:'deep_match_urdu'},
 {title:'The Prestige',projectId:'7df898c0-15e2-45c9-a2ba-86645f51bc7b',language:'english',unresolved:[113,115],stage:'deep_match_english'},
 {title:'The School of Rock',projectId:'ca7b6e98-ae1a-4fa3-9ec4-1f05a4782b2e',language:'english',unresolved:[121,122],stage:'deep_match_english'},
 {title:'The BFG',projectId:'796b9f28-9f31-484f-91e2-e40a385950c6',language:'urdu',unresolved:[41],stage:'deep_match_urdu'}
]);
