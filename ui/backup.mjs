// Backup completo do app (.qslbackup): JSON compactado (gzip) com soma SHA-256 e credenciais opcionais
// cifradas com senha (PBKDF2 + AES-GCM). Também lê backups antigos (JSON simples do banco).
const enc = new TextEncoder(), dec = new TextDecoder();
export const FORMAT = 'pt2vhf-qsl-backup';

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export { b64, unb64 };

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const gzip = bytes => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = bytes => pipe(bytes, new DecompressionStream('gzip'));

export async function sha256(text) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...hash].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function keyFrom(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealSecrets(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(password, salt), enc.encode(JSON.stringify(obj))));
  return { kdf: 'PBKDF2-SHA256-200000', cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), data: b64(data) };
}

export async function openSecrets(sealed, password) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, await keyFrom(password, unb64(sealed.salt)), unb64(sealed.data));
  return JSON.parse(dec.decode(plain));
}

export async function buildBackup({ payload, credentials = null, app = {}, stats = {} }) {
  const body = JSON.stringify(payload);
  const doc = { format: FORMAT, schema: 1, created: new Date().toISOString(), app, stats, sha256: await sha256(body), credentials, payload: body };
  return gzip(enc.encode(JSON.stringify(doc)));
}

// Devolve { kind: 'full' | 'legacy', doc, payload } ou lança erro se o arquivo estiver corrompido.
export async function readBackup(bytes) {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzip(bytes) : bytes;
  let doc;
  try { doc = JSON.parse(dec.decode(raw)); } catch { throw new Error('BACKUP_INVALID'); }
  if (doc?.format === FORMAT) {
    if (typeof doc.payload !== 'string' || (await sha256(doc.payload)) !== doc.sha256) throw new Error('BACKUP_CORRUPT');
    return { kind: 'full', doc, payload: JSON.parse(doc.payload) };
  }
  if (Array.isArray(doc?.qsos)) return { kind: 'legacy', doc: { created: null, app: {}, stats: {} }, payload: { db: doc, cty: null } };
  throw new Error('BACKUP_INVALID');
}
