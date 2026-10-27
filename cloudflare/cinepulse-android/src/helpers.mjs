export const API_BUILD = 'android-cloud-backend-0.3.0-server-cuts-eight-files';
export const MAX_NAME = 160;
export const MAX_JOB_CHARS = 300_000;
export const kinds = new Set(['source_srt','english_mp3','urdu_mp3','export_json','windows_project_json','english_srt','urdu_srt','english_narration','urdu_narration']);
export const fileNames = {
  export_json: 'CinePulse_Project.json',
  english_mp3: 'CinePulse_English.mp3',
  urdu_mp3: 'CinePulse_Urdu.mp3'
};
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const dayUTC = (ts=nowSeconds()) => new Date(ts * 1000).toISOString().slice(0,10);
export const newId = () => crypto.randomUUID();
export const isUuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value || '');
export const toHex = buffer => [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}
export async function hashWorkerToken(token) { return sha256('cinepulse-worker-v1:' + token); }
export function requireString(v, name, length=MAX_NAME) {
  if (typeof v !== 'string' || !v.trim() || v.length > length) throw new HttpError(400, `Invalid ${name}`);
  return v.trim();
}
export class HttpError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
export function json(value,status=200) { return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}); }
export function randomToken(bytes=40) { const array=crypto.getRandomValues(new Uint8Array(bytes)); return toHex(array); }
export function secureEqual(a,b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let n=0; for(let i=0;i<a.length;i++) n |= a.charCodeAt(i)^b.charCodeAt(i); return n===0; }
export function hexToBytes(hex) { if (!/^[0-9a-f]+$/i.test(hex) || hex.length%2) throw new Error('Invalid hexadecimal signing secret'); return new Uint8Array(hex.match(/../g).map(s=>parseInt(s,16))); }
export async function signDownload(secretHex,projectId,kind,expiresAt) {
  const key=await crypto.subtle.importKey('raw',hexToBytes(secretHex),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return toHex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${projectId}\n${kind}\n${expiresAt}`)));
}
export async function verifyDownload(secretHex,projectId,kind,expiresAt,signature,time=nowSeconds()) {
  if (!Number.isSafeInteger(Number(expiresAt)) || Number(expiresAt)<time || Number(expiresAt)>time+3600 || !/^[a-f0-9]{64}$/.test(signature||'')) return false;
  return secureEqual(await signDownload(secretHex,projectId,kind,expiresAt),signature);
}
export function normalizeSrt(input){
  if (typeof input!=='string' || !input.trim() || input.length>2_000_000) throw new HttpError(400,'Source SRT is missing or too large');
  const body=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  if(!/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(body)) throw new HttpError(422,'Source file does not appear to be timed SRT subtitles');
  return body;
}
export function validateManifest(m) {
  if(!m || typeof m!=='object' || Array.isArray(m)) throw new HttpError(422,'Export manifest must be a JSON object');
  for(const f of ['digest','narrations','narrationSrts','sceneMatches','cutPlan','viralScenes','metadata']) {
    if(m[f]===undefined || m[f]===null) throw new HttpError(422,`Export manifest missing ${f}`);
  }
  if(typeof m.narrations?.english!=='string' || !m.narrations.english.trim() || typeof m.narrations?.urdu!=='string' || !m.narrations.urdu.trim()) throw new HttpError(422,'Both English and Urdu narration texts required');
  if(!m.narrationSrts?.english || !m.narrationSrts?.urdu) throw new HttpError(422,'Both narration subtitle tracks required');
  normalizeSrt(m.narrationSrts.english); normalizeSrt(m.narrationSrts.urdu);
  if(!Array.isArray(m.cutPlan) || !m.cutPlan.length) throw new HttpError(422,'Nonempty cut plan required');
  for(const cut of m.cutPlan){if(!Number.isFinite(cut?.sourceStartSeconds)||!Number.isFinite(cut?.sourceEndSeconds)||cut.sourceEndSeconds<=cut.sourceStartSeconds)throw new HttpError(422,'Each cut requires increasing source timestamp values in seconds');}
  if(!Array.isArray(m.viralScenes)) throw new HttpError(422,'viralScenes must be an array');
  return m;
}
export function isProbablyMp3(bytes){ return bytes.length>3 && ((bytes[0]===0x49&&bytes[1]===0x44&&bytes[2]===0x33) || (bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0)); }