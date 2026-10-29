// Banco local de contatos: deduplicação incremental, filtros e manutenção (container único interno).
import { modeGroup, bandFromFreq, normalizeMode } from './bands.mjs';
import { lookup, entityByDxcc, wpxPrefix } from './cty.mjs';

export const SCHEMA = 1;
export const DEFAULT_PREFS = {
  myCall: '', myGrid: '', language: 'pt-BR', theme: 'dark', palette: 'default', pauseMinutes: 15, rateWindow: 60,
  pointsRule: 'adif', utcOffset: 0, dateFormat: 'iso', pageSize: 100, mergeQsl: true, recalcOnImport: true,
  autoBackup: 'daily', backupKeep: 5, backupFolder: '',
};

export function emptyDb() {
  return { schema: SCHEMA, nextId: 1, containers: [{ id: 'main', name: 'Log principal', notes: '', created: Date.now() }], qsos: [], activity: [], scratchpad: '', prefs: { ...DEFAULT_PREFS }, uploads: [], platforms: {} };
}

export function migrate(raw) {
  const db = { ...emptyDb(), ...(raw || {}) };
  db.prefs = { ...DEFAULT_PREFS, ...(raw?.prefs || {}) };
  if (!Array.isArray(db.containers) || !db.containers.length) db.containers = emptyDb().containers;
  if (!Array.isArray(db.qsos)) db.qsos = [];
  if (!Array.isArray(db.activity)) db.activity = [];
  if (!Array.isArray(db.uploads)) db.uploads = [];
  if (!db.lookup || typeof db.lookup !== 'object') db.lookup = {};
  if (!db.platforms || typeof db.platforms !== 'object') db.platforms = {};
  db.nextId = db.qsos.reduce((m, q) => Math.max(m, q.id + 1), db.nextId || 1);
  unifyContainers(db);
  return db;
}

// Desde a 0.2.0 os containers não aparecem: tudo fica num único container interno, sem QSOs duplicados.
export function unifyContainers(db) {
  const extra = db.containers.length > 1 || db.qsos.some(q => q.c !== 'main');
  db.containers = [{ id: 'main', name: 'Log principal', notes: '', created: db.containers[0]?.created || Date.now() }];
  if (!extra) return 0;
  const seen = new Map(), keep = [];
  let removed = 0;
  for (const q of [...db.qsos].sort((a, b) => a.ts - b.ts || a.id - b.id)) {
    const k = dedupeKey(q), existing = seen.get(k) || seen.get(dedupeKey(q, -1)) || seen.get(dedupeKey(q, 1));
    if (existing) { mergeInto(existing, q); removed++; continue; }
    q.c = 'main';
    seen.set(k, q);
    keep.push(q);
  }
  db.qsos = keep;
  if (removed) logActivity(db, 'merge-containers', `-${removed}`);
  return removed;
}

export function logActivity(db, type, detail) {
  db.activity.push({ ts: Date.now(), type, detail });
  if (db.activity.length > 2000) db.activity.splice(0, db.activity.length - 2000);
}

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'log';

export function createContainer(db, name, notes = '') {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('NAME_REQUIRED');
  if (db.containers.some(c => c.name.toLowerCase() === clean.toLowerCase())) throw new Error('NAME_EXISTS');
  let id = slug(clean), n = 2;
  while (db.containers.some(c => c.id === id)) id = slug(clean) + '-' + n++;
  const container = { id, name: clean, notes, created: Date.now() };
  db.containers.push(container);
  logActivity(db, 'container-create', clean);
  return container;
}

export function renameContainer(db, id, name, notes) {
  const c = db.containers.find(x => x.id === id);
  if (!c) throw new Error('NOT_FOUND');
  const clean = String(name || '').trim();
  if (!clean) throw new Error('NAME_REQUIRED');
  if (db.containers.some(x => x.id !== id && x.name.toLowerCase() === clean.toLowerCase())) throw new Error('NAME_EXISTS');
  logActivity(db, 'container-rename', `${c.name} → ${clean}`);
  c.name = clean;
  if (notes !== undefined) c.notes = notes;
  return c;
}

export function deleteContainer(db, id) {
  const c = db.containers.find(x => x.id === id);
  if (!c) throw new Error('NOT_FOUND');
  const before = db.qsos.length;
  db.qsos = db.qsos.filter(q => q.c !== id);
  db.containers = db.containers.filter(x => x.id !== id);
  if (!db.containers.length) db.containers = emptyDb().containers;
  logActivity(db, 'container-delete', `${c.name} (${before - db.qsos.length} QSOs)`);
  return before - db.qsos.length;
}

export function dedupeKey(q, minuteShift = 0) {
  return `${q.station}|${q.call}|${q.band}|${modeGroup(q.mode)}|${Math.floor(q.ts / 60000) + minuteShift}`;
}

export function enrich(q, cty, { force = false, myGrid = '' } = {}) {
  const info = lookup(cty, q.call);
  if (info) {
    if (force || !q.country) q.country = info.country;
    if (force || !q.dxcc) q.dxcc = info.dxcc;
    if (force || !q.cont) q.cont = info.cont;
    if (force || !q.cqz) q.cqz = info.cqz;
    if (force || !q.ituz) q.ituz = info.ituz;
    q.elat = info.lat; q.elon = info.lon;
  } else if (q.dxcc) {
    const e = entityByDxcc(cty, q.dxcc);
    if (e) { if (!q.country) q.country = e.name; if (!q.cont) q.cont = e.cont; q.elat = e.lat; q.elon = e.lon; }
  }
  if (q.dxcc && !q.country) { const e = entityByDxcc(cty, q.dxcc); if (e) q.country = e.name; }
  if (force || !q.pfx) q.pfx = wpxPrefix(q.call);
  if (!q.myGrid && myGrid) q.myGrid = myGrid;
  return q;
}

const QSL_FIELDS = ['qslRcvd', 'qslSent', 'lotwRcvd', 'lotwSent', 'eqslRcvd', 'eqslSent'];
const FILL_FIELDS = ['grid', 'name', 'qth', 'state', 'iota', 'cqz', 'ituz', 'dxcc', 'country', 'cont', 'freq', 'qslRdate', 'rstS', 'rstR'];

function mergeInto(target, src) {
  let changed = false;
  for (const f of QSL_FIELDS) if (src[f] === 'Y' && target[f] !== 'Y') { target[f] = 'Y'; changed = true; }
  for (const f of FILL_FIELDS) if ((target[f] === '' || target[f] === null || target[f] === undefined) && src[f] !== '' && src[f] !== null && src[f] !== undefined) { target[f] = src[f]; changed = true; }
  return changed;
}

// Importa somente QSOs que ainda não existem (mesma estação, indicativo, banda, grupo de modo e minuto ±1).
// O importador é incremental para permitir mostrar o progresso em lotes.
export function createImporter(db, containerId = 'main', { mergeQsl = true } = {}) {
  if (!db.containers.some(c => c.id === containerId)) throw new Error('NOT_FOUND');
  const index = new Map();
  for (const q of db.qsos) if (q.c === containerId) index.set(dedupeKey(q), q);
  const stats = { added: 0, skipped: 0, merged: 0 };
  const now = Date.now();
  return {
    stats,
    add(qsos, source = '') {
      for (const raw of qsos) {
        const existing = index.get(dedupeKey(raw)) || index.get(dedupeKey(raw, -1)) || index.get(dedupeKey(raw, 1));
        if (existing) {
          stats.skipped++;
          if (mergeQsl && mergeInto(existing, raw)) stats.merged++;
          continue;
        }
        const q = { ...raw, id: db.nextId++, c: containerId, src: raw.src || source, imported: now };
        db.qsos.push(q);
        index.set(dedupeKey(q), q);
        stats.added++;
      }
      return stats;
    },
    finish(source = '') {
      logActivity(db, 'import', `${source || '—'}: +${stats.added}, =${stats.skipped}, ↻${stats.merged}`);
      return { ...stats };
    },
  };
}

export function importQsos(db, qsos, containerId = 'main', { mergeQsl = true, source = '' } = {}) {
  const importer = createImporter(db, containerId, { mergeQsl });
  importer.add(qsos, source);
  return importer.finish(source);
}

export function stations(db, containerId = null) {
  const map = new Map();
  for (const q of db.qsos) {
    if (containerId && q.c !== containerId) continue;
    const key = q.station || '';
    const s = map.get(key) || { station: key, count: 0, containers: new Set(), first: Infinity, last: -Infinity };
    s.count++; s.containers.add(q.c); s.first = Math.min(s.first, q.ts); s.last = Math.max(s.last, q.ts);
    map.set(key, s);
  }
  return [...map.values()].map(s => ({ ...s, containers: [...s.containers] })).sort((a, b) => b.count - a.count);
}

export function deleteByStations(db, list, containerId = null) {
  const set = new Set(list.map(s => String(s)));
  const before = db.qsos.length;
  db.qsos = db.qsos.filter(q => !(set.has(q.station || '') && (!containerId || q.c === containerId)));
  const removed = before - db.qsos.length;
  logActivity(db, 'delete-station', `${[...set].map(s => s || '—').join(', ')}${containerId ? ' @' + containerId : ''}: -${removed}`);
  return removed;
}

export function clearAll(db) {
  const n = db.qsos.length;
  db.qsos = [];
  logActivity(db, 'delete-all', `-${n}`);
  return n;
}

// Curingas: * (qualquer sequência) e ? (um caractere).
export function wildcardRegex(pattern) {
  const p = String(pattern || '').trim().toUpperCase();
  if (!p) return null;
  const body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(/[*?]/.test(p) ? '^' + body + '$' : body);
}

export function applyFilter(qsos, f = {}) {
  const set = v => (Array.isArray(v) && v.length ? new Set(v) : null);
  const containers = set(f.containers), st = set(f.stations), bands = set(f.bands), modes = set(f.modes), ops = set(f.operators), conts = set(f.conts);
  const from = f.from ? Date.parse(f.from + 'T00:00:00Z') : null, to = f.to ? Date.parse(f.to + 'T23:59:59Z') : null;
  const re = wildcardRegex(f.call);
  const confirmed = f.confirmed;
  // Filtros extras usados pelo detalhamento (clique) nos gráficos.
  const calls = set(f.calls), countries = set(f.countries), cqz = set(f.cqz), ituz = set(f.ituz), grids = set(f.grids), hours = set(f.hours), weekdays = set(f.weekdays), radios = set(f.radios);
  const range = Array.isArray(f.range) && f.range.length === 2 ? f.range.map(Number) : null;
  return qsos.filter(q => (!containers || containers.has(q.c)) && (!st || st.has(q.station || '')) && (!bands || bands.has(q.band)) && (!modes || modes.has(q.mode))
    && (!ops || ops.has(q.operator || '')) && (!conts || conts.has(q.cont || '')) && (from === null || q.ts >= from) && (to === null || q.ts <= to)
    && (!re || re.test(q.call)) && (!confirmed || (confirmed === 'yes') === isConfirmed(q))
    && (!calls || calls.has(q.call)) && (!countries || countries.has(q.country || (q.dxcc ? '#' + q.dxcc : ''))) && (!cqz || cqz.has(String(q.cqz))) && (!ituz || ituz.has(String(q.ituz)))
    && (!grids || grids.has((q.grid || '').slice(0, 4).toUpperCase())) && (!hours || hours.has(String(new Date(q.ts).getUTCHours())))
    && (!weekdays || weekdays.has(String(new Date(q.ts).getUTCDay()))) && (!radios || radios.has(q.radio || '')) && (!range || (q.ts >= range[0] && q.ts < range[1])));
}

export const isConfirmed = q => q.qslRcvd === 'Y' || q.lotwRcvd === 'Y' || q.eqslRcvd === 'Y';

export function contestDupeKey(q) { return `${q.call}|${q.band}|${q.mode}`; }

export function copyFilter(db, sourceIds, name, filter = {}, { removeDupes = false } = {}) {
  const target = createContainer(db, name);
  const sources = new Set(sourceIds);
  let list = applyFilter(db.qsos.filter(q => sources.has(q.c)), filter).sort((a, b) => a.ts - b.ts);
  if (removeDupes) { const seen = new Set(); list = list.filter(q => { const k = contestDupeKey(q); if (seen.has(k)) return false; seen.add(k); return true; }); }
  for (const q of list) db.qsos.push({ ...q, id: db.nextId++, c: target.id, extra: { ...(q.extra || {}) } });
  logActivity(db, 'copy-filter', `${[...sources].join('+')} → ${target.name}: ${list.length}`);
  return { container: target, count: list.length };
}

export function removeDupesFiltered(db, filter = {}) {
  const ids = new Set(applyFilter(db.qsos, filter).map(q => q.id)), seen = new Set(), keep = [];
  let removed = 0;
  for (const q of [...db.qsos].sort((a, b) => a.ts - b.ts)) {
    if (!ids.has(q.id)) { keep.push(q); continue; }
    const k = contestDupeKey(q);
    if (seen.has(k)) { removed++; continue; }
    seen.add(k); keep.push(q);
  }
  db.qsos = keep;
  logActivity(db, 'remove-dupes', `-${removed}`);
  return removed;
}

export function removeDupes(db, containerId) {
  const seen = new Set(), keep = [];
  let removed = 0;
  for (const q of [...db.qsos].sort((a, b) => a.ts - b.ts)) {
    if (q.c !== containerId) { keep.push(q); continue; }
    const k = contestDupeKey(q);
    if (seen.has(k)) { removed++; continue; }
    seen.add(k); keep.push(q);
  }
  db.qsos = keep;
  logActivity(db, 'remove-dupes', `${containerId}: -${removed}`);
  return removed;
}

// Reprocessamento (equivalente a "Modify Logs"): altera modos/bandas e atualiza dados de país pelo CTY.
export function reprocess(db, filter, ops, cty) {
  const list = applyFilter(db.qsos, filter);
  let changed = 0;
  const modeMap = new Map((ops.modeMap || []).filter(m => m.from).map(m => [m.from.toUpperCase(), normalizeMode(m.to)]));
  for (const q of list) {
    const before = JSON.stringify(q);
    if (ops.bandFromFreq && q.freq) { const b = bandFromFreq(q.freq); if (b) q.band = b; }
    if (modeMap.has(q.mode)) q.mode = modeMap.get(q.mode);
    if (ops.setStation) q.station = String(ops.setStation).toUpperCase();
    if (ops.setOperator) q.operator = String(ops.setOperator).toUpperCase();
    if (ops.setMyGrid) q.myGrid = ops.setMyGrid;
    if (ops.countryFile === 'missing' || ops.countryFile === 'all') enrich(q, cty, { force: ops.countryFile === 'all' });
    if (ops.moveTo && db.containers.some(c => c.id === ops.moveTo)) q.c = ops.moveTo;
    if (JSON.stringify(q) !== before) changed++;
  }
  logActivity(db, 'reprocess', `${list.length} QSOs, ${changed} alterados`);
  return { matched: list.length, changed };
}

export function deleteQsos(db, ids) {
  const set = new Set(ids), before = db.qsos.length;
  db.qsos = db.qsos.filter(q => !set.has(q.id));
  logActivity(db, 'delete-qso', `-${before - db.qsos.length}`);
  return before - db.qsos.length;
}
