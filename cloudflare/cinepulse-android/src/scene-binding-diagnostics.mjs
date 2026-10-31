/** Read-only, authenticated proof that the experimental Worker can use
 * EXISTING D1 and R2 bindings independently of Cloudflare management REST APIs.
 * Do not expose account IDs, object names, credentials or project data.
 */
export async function probeExperimentBindings(env) {
  if (!env?.SCENE_DB?.prepare || !env?.SCENE_FILES?.head)
    throw new Error('Experimental storage bindings are unavailable');
  const row = await env.SCENE_DB.prepare('SELECT 1 AS probe_ok').first();
  if (Number(row?.probe_ok) !== 1)
    throw new Error('D1 Worker binding SELECT 1 failed');
  // The object need not exist. HEAD demonstrates a reachable R2 binding without
  // reading user content, listing objects or modifying storage.
  await env.SCENE_FILES.head('experiments/__binding_probe__/nonexistent');
  return Object.freeze({
    service: 'cinepulse-scene-intelligence',
    d1Binding: 'reachable',
    r2Binding: 'reachable',
    permissionsTested: 'runtime-read-only',
    directManagementApisTested: false,
    mutationsMade: false
  });
}
