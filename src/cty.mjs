// Parser e resolução de indicativos com base no formato CTY.DAT (AD1C Country-Files).
const SUFFIXES = new Set(['P', 'M', 'MM', 'AM', 'QRP', 'QRPP', 'A', 'B', 'LH', 'R', 'BCN', 'LGT', 'PM', 'J', 'E', 'X', 'T']);

export function parseCty(text) {
  const entities = [], prefixes = new Map(), exact = new Map();
  let version = null;
  const blocks = String(text || '').replace(/\r/g, '').split(';');
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const colon = block.split(':');
    if (colon.length < 9) continue;
    const [name, cq, itu, cont, lat, lon, tz, primary] = colon.map(v => v.trim());
    const list = colon.slice(8).join(':');
    const waeOnly = primary.startsWith('*');
    const entity = {
      id: entities.length, name, cqz: Number(cq), ituz: Number(itu), cont, lat: Number(lat), lon: -Number(lon),
      tz: Number(tz), prefix: primary.replace(/^\*/, ''), waeOnly, dxcc: null, flag: null,
    };
    entities.push(entity);
    for (let item of list.split(',')) {
      item = item.trim();
      if (!item) continue;
      const override = {};
      item = item
        .replace(/\((\d+)\)/, (_, v) => { override.cqz = Number(v); return ''; })
        .replace(/\[(\d+)\]/, (_, v) => { override.ituz = Number(v); return ''; })
        .replace(/<([-\d.]+)\/([-\d.]+)>/, (_, a, b) => { override.lat = Number(a); override.lon = -Number(b); return ''; })
        .replace(/\{(\w+)\}/, (_, v) => { override.cont = v; return ''; })
        .replace(/~([-\d.]+)~/, (_, v) => { override.tz = Number(v); return ''; });
      const entry = { entity: entity.id, ...override };
      const key = item.replace(/^=/, '').toUpperCase();
      if (/^VER\d{8}$/.test(key)) version = key.slice(3);
      if (item.startsWith('=')) exact.set(key, entry);
      else if (!prefixes.has(key)) prefixes.set(key, entry);
    }
  }
  let maxPrefix = 0;
  for (const key of prefixes.keys()) maxPrefix = Math.max(maxPrefix, key.length);
  return { entities, prefixes, exact, version, maxPrefix };
}

export function cleanCall(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9/]/g, '');
}

// Decide qual parte de um indicativo composto (prefixo/indicativo/sufixo) define a entidade.
export function prefixBase(call) {
  const parts = cleanCall(call).split('/').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  let filtered = parts.filter(p => !SUFFIXES.has(p));
  if (!filtered.length) filtered = [parts[0]];
  let area = null;
  if (filtered.length > 1 && /^\d$/.test(filtered[filtered.length - 1])) area = filtered.pop();
  let base;
  if (filtered.length === 1) base = filtered[0];
  else {
    // Indicativo com prefixo/sufixo de outra entidade: a parte mais curta costuma ser o prefixo.
    const [a, b] = filtered;
    base = a.length <= b.length ? a : b;
    if (/^\d+$/.test(base)) base = a.length > b.length ? a : b;
  }
  if (area) {
    const m = base.match(/^([A-Z0-9]*?[A-Z])(\d)/);
    if (m) base = m[1] + area;
  }
  return base;
}

export function wpxPrefix(call) {
  const base = prefixBase(call);
  if (!base) return '';
  const m = base.match(/^([A-Z0-9]*?\d+)/);
  if (m && /[A-Z]/.test(m[1])) return m[1];
  if (/^[A-Z]+$/.test(base)) return base.slice(0, 2) + '0';
  return base.slice(0, 3);
}

export function lookup(db, rawCall) {
  if (!db) return null;
  const call = cleanCall(rawCall);
  if (!call) return null;
  let hit = db.exact.get(call);
  if (!hit) {
    const base = prefixBase(call);
    for (let len = Math.min(db.maxPrefix, base.length); len > 0 && !hit; len--) hit = db.prefixes.get(base.slice(0, len));
    if (!hit && call !== base) for (let len = Math.min(db.maxPrefix, call.length); len > 0 && !hit; len--) hit = db.prefixes.get(call.slice(0, len));
  }
  if (!hit) return null;
  const entity = db.entities[hit.entity];
  return {
    country: entity.name, prefix: entity.prefix, dxcc: entity.dxcc, flag: entity.flag,
    cont: hit.cont || entity.cont, cqz: hit.cqz || entity.cqz, ituz: hit.ituz || entity.ituz,
    lat: hit.lat ?? entity.lat, lon: hit.lon ?? entity.lon, waeOnly: entity.waeOnly,
  };
}

// Aplica os códigos ADIF DXCC às entidades do CTY.
export function attachDxcc(db, table) {
  const byPrefix = new Map(table.map(e => [e.ctyPrefix, e]));
  for (const entity of db.entities) {
    const info = byPrefix.get(entity.prefix);
    if (info) { entity.dxcc = info.dxcc; entity.flag = info.cc || null; }
  }
  db.byDxcc = new Map();
  for (const entity of db.entities) if (entity.dxcc && !entity.waeOnly && !db.byDxcc.has(entity.dxcc)) db.byDxcc.set(entity.dxcc, entity);
  return db;
}

export function entityByDxcc(db, code) {
  return db?.byDxcc?.get(Number(code)) || null;
}
