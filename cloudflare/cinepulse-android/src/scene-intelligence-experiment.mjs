/**
 * CinePulse v3.8.28: isolated subtitle evidence index.
 * This is candidate retrieval, NOT visual verification or final clip selection.
 * Production Muse V4 and existing Worker endpoints are deliberately unchanged.
 */
export const SCENE_INDEX_SCHEMA = 'cinepulse.scene-intelligence.v1';
export const EXPERIMENT_MODE = 'scene_intelligence_experiment';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{5,127}$/.test(value);
const stampToMs = value => {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
  if (!match || +match[2] > 59 || +match[3] > 59) throw new Error('Invalid SRT timecode');
  return ((+match[1] * 3600 + +match[2] * 60 + +match[3]) * 1000) + +match[4];
};
const tokenize = text => [...new Set(String(text).normalize('NFKC').toLowerCase()
  .match(/[\p{L}\p{N}]{3,}/gu) ?? [])];

export function parseOriginalSrt(srt) {
  if (typeof srt !== 'string' || !srt.trim() || new TextEncoder().encode(srt).length > 2097152)
    throw new Error('Original source SRT is missing or exceeds 2 MiB');
  const blocks = srt.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const lineIndex = lines.findIndex(line => /^\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(line));
    if (lineIndex === -1) throw new Error('Source SRT contains a block without timecodes');
    const match = /^\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/.exec(lines[lineIndex]);
    if (!match) throw new Error('Invalid original subtitle timing');
    const startMs = stampToMs(match[1]), endMs = stampToMs(match[2]);
    if (endMs <= startMs || (cues.length && startMs < cues[cues.length - 1].startMs))
      throw new Error('Source SRT has invalid chronological timing');
    const text = lines.slice(lineIndex + 1).join(' ').trim();
    if (!text) throw new Error('Empty original subtitle cue');
    cues.push({cueNumber:cues.length + 1, startMs, endMs, text});
  }
  if (!cues.length) throw new Error('Source SRT has no cues');
  return cues;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}

/** Build during digest. Does not modify stable jobs or contact Muse. */
export async function buildSceneEvidenceIndex({projectId, title, sourceSrt, maxCues=6, stride=3}) {
  if (!validId(projectId) || !String(title ?? '').trim()) throw new Error('Project identity required');
  if (!Number.isInteger(maxCues) || maxCues < 1 || maxCues > 12 ||
      !Number.isInteger(stride) || stride < 1 || stride > maxCues)
    throw new Error('Invalid subtitle window settings');
  const cues = parseOriginalSrt(sourceSrt);
  const windows = [];
  for (let at=0; at<cues.length; at+=stride) {
    const part = cues.slice(at, at+maxCues);
    windows.push({
      id:'srt-' + String(windows.length + 1).padStart(5,'0'),
      cueStart:part[0].cueNumber, cueEnd:part.at(-1).cueNumber,
      sourceStartMs:part[0].startMs, sourceEndMs:Math.max(...part.map(x=>x.endMs)),
      text:part.map(x=>x.text).join(' '),
      evidenceType:'subtitle_dialogue', visualVerified:false
    });
  }
  return {
    schema:SCENE_INDEX_SCHEMA, mode:EXPERIMENT_MODE,
    projectId,title:String(title).trim(),sourceSrtSha256:await sha256(sourceSrt),
    sourceCueCount:cues.length,
    windows, indexType:'original-srt-window-retrieval',
    visualVerified:false
  };
}

/** Retrieve candidate evidence only. Muse must still make final contextual cut decisions. */
export function retrieveSceneCandidates(index, narrationText, limit=12) {
  if (index?.schema !== SCENE_INDEX_SCHEMA || index?.mode !== EXPERIMENT_MODE)
    throw new Error('Unsupported or non-experimental scene index');
  if (!Array.isArray(index.windows) || !Number.isInteger(limit) || limit<1 || limit>50)
    throw new Error('Invalid retrieval parameters');
  const query = tokenize(narrationText);
  return index.windows.map(window => {
    const terms = new Set(tokenize(window.text));
    const overlap = query.filter(word => terms.has(word)).length;
    return {windowId:window.id, sourceStartMs:window.sourceStartMs,
      sourceEndMs:window.sourceEndMs, text:window.text,
      lexicalOverlap:overlap, evidenceType:window.evidenceType,
      visualVerified:false};
  }).sort((a,b)=>b.lexicalOverlap-a.lexicalOverlap || a.sourceStartMs-b.sourceStartMs)
    .slice(0,limit);
}

const requiredKinds = new Set([
  'windows_project_json','source_srt','english_mp3','urdu_mp3',
  'english_srt','urdu_srt','english_narration','urdu_narration',
  'scene_index_sqlite','english_final_cuts','urdu_final_cuts'
]);
export function validateExperimentPackage(manifest) {
  if (!manifest || manifest.mode !== EXPERIMENT_MODE ||
    !validId(manifest.projectId) || manifest.schema !== 'cinepulse.experimental-package.v1')
    throw new Error('Not a valid experimental package');
  if (!/^[a-f0-9]{64}$/.test(manifest.sourceSrtSha256 ?? ''))
    throw new Error('Missing verified source SRT SHA-256');
  const seen = new Set(), prefix='experiments/'+manifest.projectId+'/';
  if (!Array.isArray(manifest.assets)) throw new Error('Missing asset manifest');
  for (const asset of manifest.assets) {
    if (!requiredKinds.has(asset?.kind) || seen.has(asset.kind))
      throw new Error('Unknown or duplicate package asset');
    seen.add(asset.kind);
    if (typeof asset.key !== 'string' || !asset.key.startsWith(prefix) ||
      asset.key.includes('..') || asset.key.includes('\\') ||
      !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0)
      throw new Error('Unsafe asset path, invalid hash or byte count');
  }
  for (const kind of requiredKinds) if (!seen.has(kind)) throw new Error('Missing '+kind);
  return true;
}
