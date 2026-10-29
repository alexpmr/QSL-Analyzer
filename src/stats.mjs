// Motor de estatísticas: todas as análises sobre uma lista de QSOs.
import { sortBands, bandRank, modeGroup } from './bands.mjs';
import { lookup } from './cty.mjs';
import { gridToLatLon, distanceKm, bearingDeg } from './geo.mjs';
import { isConfirmed, contestDupeKey } from './db.mjs';

const MIN = 60000, HOUR = 3600000, DAY = 86400000;

export const byTime = qsos => [...qsos].sort((a, b) => a.ts - b.ts || a.id - b.id);
export const dxccKey = q => (q.dxcc ? 'D' + q.dxcc : q.country ? 'N' + q.country : '');
export const grid4 = q => (q.grid || '').slice(0, 4).toUpperCase();

export const DIMENSIONS = {
  band: q => q.band || '—', mode: q => q.mode || '—', modeGroup: q => modeGroup(q.mode) || '—', operator: q => q.operator || q.station || '—',
  station: q => q.station || '—', cont: q => q.cont || '—', radio: q => q.radio || '—', country: q => q.country || '—', container: q => q.c,
  year: q => String(new Date(q.ts).getUTCFullYear()),
};

export function sortKeys(dim, keys) {
  if (dim === 'band') return sortBands(keys);
  if (dim === 'year' || dim === 'radio') return [...keys].sort();
  return keys;
}

// Marca QSOs repetidos no sentido de concurso (mesmo indicativo, banda e modo).
export function markDupes(sorted) {
  const seen = new Set(), dupes = new Set();
  for (const q of sorted) { const k = contestDupeKey(q); if (seen.has(k)) dupes.add(q.id); else seen.add(k); }
  return dupes;
}

export function pointsFn(rule, cty, myCall) {
  if (rule === 'one') return () => 1;
  if (rule === 'dx') {
    const me = lookup(cty, myCall);
    return q => {
      const home = me || lookup(cty, q.station);
      if (!home) return 1;
      if (q.country && q.country === home.country) return 1;
      if (q.cont && q.cont === home.cont) return 2;
      return 3;
    };
  }
  return q => (Number.isFinite(q.points) ? q.points : 1);
}

export function groupCount(qsos, keyFn, valueFn = () => 1) {
  const map = new Map();
  for (const q of qsos) { const k = keyFn(q); if (k === null || k === undefined || k === '') continue; map.set(k, (map.get(k) || 0) + valueFn(q)); }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function distinct(qsos, keyFn) {
  const s = new Set();
  for (const q of qsos) { const k = keyFn(q); if (k !== null && k !== undefined && k !== '') s.add(k); }
  return s;
}

// Tempo de operação: blocos de QSOs separados por pausas maiores que o limite; cada bloco conta +1 minuto.
export function operatingTime(sorted, pauseMin = 15) {
  if (!sorted.length) return 0;
  const limit = pauseMin * MIN;
  let total = 0, start = sorted[0].ts, prev = sorted[0].ts;
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i].ts;
    if (t - prev > limit) { total += prev - start + MIN; start = t; }
    prev = t;
  }
  return total + prev - start + MIN;
}

export function pauses(sorted, pauseMin = 15, keyFn = null) {
  const groups = new Map();
  for (const q of sorted) { const k = keyFn ? keyFn(q) : '*'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(q); }
  const out = [];
  for (const [k, list] of groups) for (let i = 1; i < list.length; i++) {
    const gap = list[i].ts - list[i - 1].ts;
    if (gap > pauseMin * MIN) out.push({ group: k, start: list[i - 1].ts, end: list[i].ts, duration: gap, before: list[i - 1].call, after: list[i].call });
  }
  return out.sort((a, b) => a.start - b.start);
}

// Maior quantidade de QSOs em qualquer janela deslizante de N minutos.
export function maxRate(sorted, windowMin = 60) {
  const w = windowMin * MIN;
  let best = 0, bestStart = null, j = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (sorted[i].ts - sorted[j].ts >= w) j++;
    const n = i - j + 1;
    if (n > best) { best = n; bestStart = sorted[j].ts; }
  }
  return { count: best, perHour: Math.round(best * 60 / windowMin), start: bestStart };
}

export function rateSeries(sorted, sampleMin = 60, maxPoints = 1500) {
  if (!sorted.length) return [];
  const first = Math.floor(sorted[0].ts / MIN) * MIN, last = Math.ceil(sorted[sorted.length - 1].ts / MIN) * MIN;
  const step = Math.max(MIN, Math.ceil((last - first) / maxPoints / MIN) * MIN), w = sampleMin * MIN;
  const out = [];
  let lo = 0, hi = 0;
  for (let t = first; t <= last + step; t += step) {
    while (hi < sorted.length && sorted[hi].ts <= t) hi++;
    while (lo < hi && sorted[lo].ts <= t - w) lo++;
    out.push({ t, rate: Math.round((hi - lo) * 60 / sampleMin) });
  }
  return out;
}

export function basic(sorted, { pauseMin = 15, points = () => 1 } = {}) {
  const dupes = markDupes(sorted);
  const calls = distinct(sorted, q => q.call), dxcc = distinct(sorted, dxccKey);
  const opTime = operatingTime(sorted, pauseMin);
  const pts = sorted.reduce((s, q) => s + (dupes.has(q.id) ? 0 : points(q)), 0);
  return {
    qsos: sorted.length, dupes: dupes.size, valid: sorted.length - dupes.size, points: pts, uniqueCalls: calls.size, dxcc: dxcc.size,
    cqz: distinct(sorted, q => q.cqz).size, ituz: distinct(sorted, q => q.ituz).size, prefixes: distinct(sorted, q => q.pfx).size,
    grids: distinct(sorted, grid4).size, conts: distinct(sorted, q => q.cont).size, bands: distinct(sorted, q => q.band).size,
    modes: distinct(sorted, q => q.mode).size, operators: distinct(sorted, q => q.operator).size, stations: distinct(sorted, q => q.station).size,
    first: sorted[0]?.ts ?? null, last: sorted[sorted.length - 1]?.ts ?? null, operatingMs: opTime,
    avgRate: opTime ? +(sorted.length / (opTime / HOUR)).toFixed(1) : 0,
    max10: maxRate(sorted, 10), max30: maxRate(sorted, 30), max60: maxRate(sorted, 60),
    confirmed: sorted.filter(isConfirmed).length,
  };
}

export function stationsWorked(sorted) {
  const dupes = markDupes(sorted), map = new Map();
  for (const q of sorted) {
    let s = map.get(q.call);
    if (!s) map.set(q.call, s = { call: q.call, qsos: 0, bands: new Set(), modes: new Set(), slots: new Set(), dupes: 0, first: q.ts, last: q.ts, country: q.country || '', cont: q.cont || '', confirmed: false });
    s.qsos++; s.bands.add(q.band); s.modes.add(q.mode); s.slots.add(q.band + '|' + q.mode); s.last = q.ts;
    if (dupes.has(q.id)) s.dupes++;
    if (isConfirmed(q)) s.confirmed = true;
  }
  return [...map.values()].map(s => ({ ...s, bands: sortBands([...s.bands]), modes: [...s.modes].sort(), slots: s.slots.size })).sort((a, b) => b.qsos - a.qsos || a.call.localeCompare(b.call));
}

export function autoUnit(sorted) {
  if (!sorted.length) return 'hour';
  const span = sorted[sorted.length - 1].ts - sorted[0].ts;
  return span <= 4 * DAY ? 'hour' : span <= 400 * DAY ? 'day' : 'month';
}

export function bucketStart(ts, unit) {
  const d = new Date(ts);
  if (unit === 'hour') return Math.floor(ts / HOUR) * HOUR;
  if (unit === 'day') return Math.floor(ts / DAY) * DAY;
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return Date.UTC(d.getUTCFullYear(), 0, 1);
}

export function nextBucket(ts, unit) {
  const d = new Date(ts);
  if (unit === 'hour') return ts + HOUR;
  if (unit === 'day') return ts + DAY;
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
}

export function buckets(sorted, unit, limit = 5000) {
  if (!sorted.length) return [];
  const out = [];
  for (let t = bucketStart(sorted[0].ts, unit); t <= sorted[sorted.length - 1].ts && out.length < limit; t = nextBucket(t, unit)) out.push(t);
  return out;
}

// Mapa de atividade: linhas (banda/modo/operador/posição) × colunas de tempo.
export function activityMatrix(sorted, dim = 'band', unit = 'auto') {
  const u = unit === 'auto' ? autoUnit(sorted) : unit, key = DIMENSIONS[dim] || DIMENSIONS.band;
  const cols = buckets(sorted, u), index = new Map(cols.map((t, i) => [t, i]));
  const rows = new Map();
  for (const q of sorted) {
    const k = key(q);
    if (!rows.has(k)) rows.set(k, new Array(cols.length).fill(0));
    const i = index.get(bucketStart(q.ts, u));
    if (i !== undefined) rows.get(k)[i]++;
  }
  const keys = sortKeys(dim, [...rows.keys()].sort((a, b) => rows.get(b).reduce((x, y) => x + y, 0) - rows.get(a).reduce((x, y) => x + y, 0)));
  return { unit: u, cols, rows: keys.map(k => ({ key: k, values: rows.get(k), total: rows.get(k).reduce((x, y) => x + y, 0) })) };
}

export function bandsModes(sorted) {
  const bands = sortBands([...distinct(sorted, q => q.band)]), modes = [...distinct(sorted, q => q.mode)].sort();
  const cell = list => {
    const perCall = groupCount(list, q => q.call);
    return { qsos: list.length, calls: perCall.length, dxcc: distinct(list, dxccKey).size, multi: perCall.filter(([, n]) => n > 1).length };
  };
  const rows = bands.map(b => {
    const inBand = sorted.filter(q => q.band === b);
    return { band: b, total: cell(inBand), modes: Object.fromEntries(modes.map(m => [m, cell(inBand.filter(q => q.mode === m))])) };
  });
  const perCall = groupCount(sorted, q => q.call);
  const distribution = groupCount(perCall, ([, n]) => n).map(([n, c]) => ({ qsos: Number(n), stations: c })).sort((a, b) => a.qsos - b.qsos);
  return { bands, modes, rows, total: cell(sorted), totalModes: Object.fromEntries(modes.map(m => [m, cell(sorted.filter(q => q.mode === m))])), distribution };
}

export function firstWorked(sorted, keyFn = dxccKey, perBand = false) {
  const seen = new Set(), out = [];
  for (const q of sorted) {
    const k0 = keyFn(q);
    if (!k0) continue;
    const k = perBand ? q.band + '|' + k0 : k0;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ n: out.length + 1, ts: q.ts, call: q.call, band: q.band, mode: q.mode, country: q.country, dxcc: q.dxcc, cont: q.cont, key: k0 });
  }
  return out;
}

export function bandChanges(sorted, keyFn = null) {
  const groups = new Map();
  for (const q of sorted) { const k = keyFn ? keyFn(q) : '*'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(q); }
  const stints = [];
  for (const [g, list] of groups) {
    let cur = null;
    for (const q of list) {
      if (!cur || cur.band !== q.band) { if (cur) stints.push(cur); cur = { group: g, band: q.band, start: q.ts, end: q.ts, qsos: 0 }; }
      cur.end = q.ts; cur.qsos++;
    }
    if (cur) stints.push(cur);
  }
  stints.sort((a, b) => a.start - b.start);
  const perBand = new Map();
  for (const s of stints) {
    const p = perBand.get(s.band) || { band: s.band, stints: 0, totalMs: 0, maxMs: 0, qsos: 0 };
    const d = s.end - s.start + MIN;
    p.stints++; p.totalMs += d; p.maxMs = Math.max(p.maxMs, d); p.qsos += s.qsos;
    perBand.set(s.band, p);
  }
  const changes = stints.length - groups.size;
  const perHour = groupCount(stints.slice(1), s => Math.floor(s.start / HOUR) * HOUR);
  return { stints, changes: Math.max(0, changes), perBand: sortBands([...perBand.keys()]).map(b => ({ ...perBand.get(b), avgMs: perBand.get(b).totalMs / perBand.get(b).stints })), perHour };
}

export function dupesBreakdown(sorted) {
  const dupes = markDupes(sorted), list = sorted.filter(q => dupes.has(q.id));
  return {
    total: list.length, list,
    byCall: groupCount(list, q => q.call), byDxcc: groupCount(list, q => q.country || dxccKey(q)), byBand: groupCount(list, q => q.band),
    byMode: groupCount(list, q => q.mode), byCont: groupCount(list, q => q.cont), byOperator: groupCount(list, q => q.operator),
  };
}

export function pointsBreakdown(sorted, points) {
  const dupes = markDupes(sorted), valid = sorted.filter(q => !dupes.has(q.id));
  return {
    total: valid.reduce((s, q) => s + points(q), 0),
    byCall: groupCount(valid, q => q.call, points), byBand: groupCount(valid, q => q.band, points), byMode: groupCount(valid, q => q.mode, points),
    byOperator: groupCount(valid, q => q.operator, points), byCont: groupCount(valid, q => q.cont, points),
  };
}

export function zones(sorted) {
  const cq = new Array(40).fill(0), itu = new Array(90).fill(0);
  for (const q of sorted) { if (q.cqz >= 1 && q.cqz <= 40) cq[q.cqz - 1]++; if (q.ituz >= 1 && q.ituz <= 90) itu[q.ituz - 1]++; }
  return { cq, itu };
}

export function dxccLocator(sorted) {
  const bands = sortBands([...distinct(sorted, q => q.band)]), modes = [...distinct(sorted, q => q.mode)].sort();
  return {
    byDxcc: groupCount(sorted, q => q.country || (q.dxcc ? '#' + q.dxcc : '')), byGrid: groupCount(sorted, grid4), byField: groupCount(sorted, q => grid4(q).slice(0, 2)),
    perBand: bands.map(b => { const l = sorted.filter(q => q.band === b); return { key: b, dxcc: distinct(l, dxccKey).size, grids: distinct(l, grid4).size }; }),
    perMode: modes.map(m => { const l = sorted.filter(q => q.mode === m); return { key: m, dxcc: distinct(l, dxccKey).size, grids: distinct(l, grid4).size }; }),
  };
}

export function positions(q, homeFallback) {
  const home = Number.isFinite(q.myLat) && Number.isFinite(q.myLon) ? { lat: q.myLat, lon: q.myLon } : gridToLatLon(q.myGrid) || homeFallback || null;
  const target = Number.isFinite(q.lat) && Number.isFinite(q.lon) ? { lat: q.lat, lon: q.lon, precise: true } : gridToLatLon(q.grid) ? { ...gridToLatLon(q.grid), precise: true } : Number.isFinite(q.elat) ? { lat: q.elat, lon: q.elon, precise: false } : null;
  return { home, target };
}

export function azimuthDistance(sorted, homeFallback, { distStep = 500, sectors = 16, preciseOnly = false } = {}) {
  const dist = new Map(), az = new Array(sectors).fill(0), items = [];
  let skipped = 0, max = 0;
  for (const q of sorted) {
    const { home, target } = positions(q, homeFallback);
    if (!home || !target || (preciseOnly && !target.precise)) { skipped++; continue; }
    const d = distanceKm(home, target), b = bearingDeg(home, target);
    const bucket = Math.floor(d / distStep) * distStep;
    dist.set(bucket, (dist.get(bucket) || 0) + 1);
    az[Math.floor(((b + 180 / sectors) % 360) / (360 / sectors))]++;
    items.push({ q, d, b });
    if (d > max) max = d;
  }
  const distribution = [];
  for (let k = 0; k <= max; k += distStep) distribution.push([k, dist.get(k) || 0]);
  const best = items.sort((a, b) => b.d - a.d).slice(0, 25).map(i => ({ call: i.q.call, ts: i.q.ts, band: i.q.band, mode: i.q.mode, km: Math.round(i.d), az: Math.round(i.b), grid: i.q.grid, country: i.q.country }));
  return { distribution, azimuth: az, skipped, measured: items.length, longest: best, distStep };
}

// Séries horárias/diárias de QSOs, pontos e novos multiplicadores.
export function timeSeries(sorted, unit = 'auto', points = () => 1) {
  const u = unit === 'auto' ? autoUnit(sorted) : unit, cols = buckets(sorted, u), index = new Map(cols.map((t, i) => [t, i]));
  const blank = () => new Array(cols.length).fill(0);
  const s = { qsos: blank(), points: blank(), newCqz: blank(), newItuz: blank(), newDxcc: blank(), newPfx: blank(), newGrid: blank() };
  const seen = { cqz: new Set(), ituz: new Set(), dxcc: new Set(), pfx: new Set(), grid: new Set() };
  const dupes = markDupes(sorted);
  for (const q of sorted) {
    const i = index.get(bucketStart(q.ts, u));
    if (i === undefined) continue;
    s.qsos[i]++;
    if (!dupes.has(q.id)) s.points[i] += points(q);
    const mark = (set, v, arr) => { if (v !== null && v !== undefined && v !== '' && !set.has(v)) { set.add(v); arr[i]++; } };
    mark(seen.cqz, q.cqz, s.newCqz); mark(seen.ituz, q.ituz, s.newItuz); mark(seen.dxcc, dxccKey(q), s.newDxcc); mark(seen.pfx, q.pfx, s.newPfx); mark(seen.grid, grid4(q), s.newGrid);
  }
  const cumulative = arr => { let acc = 0; return arr.map(v => (acc += v)); };
  return { unit: u, cols, ...s, cum: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, cumulative(v)])) };
}

export function historical(sorted) {
  const years = groupCount(sorted, DIMENSIONS.year).sort((a, b) => a[0].localeCompare(b[0]));
  const months = groupCount(sorted, q => new Date(q.ts).toISOString().slice(0, 7)).sort((a, b) => a[0].localeCompare(b[0]));
  const hourOfDay = new Array(24).fill(0), weekday = new Array(7).fill(0), monthOfYear = new Array(12).fill(0);
  for (const q of sorted) { const d = new Date(q.ts); hourOfDay[d.getUTCHours()]++; weekday[d.getUTCDay()]++; monthOfYear[d.getUTCMonth()]++; }
  const yearList = years.map(y => y[0]);
  const bands = sortBands([...distinct(sorted, q => q.band)]);
  const bandYear = bands.map(b => ({ key: b, values: yearList.map(y => sorted.filter(q => q.band === b && DIMENSIONS.year(q) === y).length) }));
  const dxccYear = yearList.map(y => [y, distinct(sorted.filter(q => DIMENSIONS.year(q) === y), dxccKey).size]);
  return { years, months, hourOfDay, weekday, monthOfYear, bandYear, yearList, dxccYear };
}

function splitBy(sorted, dim) {
  const key = DIMENSIONS[dim] || DIMENSIONS.band, map = new Map();
  for (const q of sorted) { const k = key(q); if (!map.has(k)) map.set(k, []); map.get(k).push(q); }
  return sortKeys(dim, [...map.keys()].sort((a, b) => map.get(b).length - map.get(a).length)).map(k => [k, map.get(k)]);
}

export function operatingTimeBy(sorted, dim, pauseMin) {
  return splitBy(sorted, dim).map(([k, l]) => ({ key: k, qsos: l.length, ms: operatingTime(l, pauseMin) }));
}

export function maxRatesBy(sorted, dim, windowMin) {
  return splitBy(sorted, dim).map(([k, l]) => ({ key: k, qsos: l.length, ...maxRate(l, windowMin) }));
}

export function avgRatesBy(sorted, dim, pauseMin) {
  return splitBy(sorted, dim).map(([k, l]) => { const ms = operatingTime(l, pauseMin); return { key: k, qsos: l.length, ms, rate: ms ? +(l.length / (ms / HOUR)).toFixed(1) : 0 }; });
}

export function rateSeriesBy(sorted, dim, sampleMin, maxPoints = 800) {
  if (!dim || dim === 'all') return [{ key: 'all', series: rateSeries(sorted, sampleMin, maxPoints) }];
  return splitBy(sorted, dim).slice(0, 8).map(([k, l]) => ({ key: k, series: rateSeries(l, sampleMin, maxPoints) }));
}

// Situação de confirmações (QSL em papel, LoTW, eQSL) e matriz DXCC trabalhado/confirmado por banda.
export function qslStatus(sorted) {
  const total = sorted.length;
  const count = f => sorted.filter(f).length;
  const bands = sortBands([...distinct(sorted, q => q.band)]);
  const entities = new Map();
  for (const q of sorted) {
    const k = dxccKey(q);
    if (!k) continue;
    let e = entities.get(k);
    if (!e) entities.set(k, e = { key: k, country: q.country || '#' + q.dxcc, dxcc: q.dxcc, cont: q.cont, worked: new Set(), confirmed: new Set(), qsos: 0 });
    e.qsos++; e.worked.add(q.band);
    if (isConfirmed(q)) e.confirmed.add(q.band);
  }
  const list = [...entities.values()].sort((a, b) => a.country.localeCompare(b.country));
  return {
    total, paper: count(q => q.qslRcvd === 'Y'), lotw: count(q => q.lotwRcvd === 'Y'), eqsl: count(q => q.eqslRcvd === 'Y'), any: count(isConfirmed),
    paperSent: count(q => q.qslSent === 'Y'), lotwSent: count(q => q.lotwSent === 'Y'), eqslSent: count(q => q.eqslSent === 'Y'),
    bands, entities: list.map(e => ({ ...e, worked: [...e.worked], confirmed: [...e.confirmed] })),
    dxccWorked: list.length, dxccConfirmed: list.filter(e => e.confirmed.size).length,
    perBand: bands.map(b => ({ band: b, worked: list.filter(e => e.worked.has(b)).length, confirmed: list.filter(e => e.confirmed.has(b)).length })),
    unconfirmed: list.filter(e => !e.confirmed.size).map(e => e.country),
  };
}

export { bandRank };
