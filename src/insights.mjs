// Análises de alto nível: resumo, comparação de períodos, estações frequentes, novos indicativos,
// concursos, propagação e saúde do log.
import { modeGroup, bandFromFreq, sortBands, BAND_ORDER } from './bands.mjs';
import { byTime, groupCount, distinct, dxccKey, grid4, positions, operatingTime, maxRate, markDupes, bucketStart } from './stats.mjs';
import { distanceKm, bearingDeg } from './geo.mjs';
import { isConfirmed } from './db.mjs';

const DAY = 86400000;
const monthKey = ts => new Date(ts).toISOString().slice(0, 7);

// Fatos para o resumo em linguagem natural do Dashboard.
export function summaryFacts(qsos, { home = null, totalEntities = 340, now = Date.now() } = {}) {
  if (!qsos.length) return null;
  const sorted = byTime(qsos);
  const modes = groupCount(sorted, q => q.mode), months = groupCount(sorted, q => monthKey(q.ts)), bands = groupCount(sorted, q => q.band);
  let far = null;
  for (const q of sorted) { const { home: h, target } = positions(q, home); if (h && target) { const d = distanceKm(h, target); if (!far || d > far.km) far = { call: q.call, km: Math.round(d), country: q.country }; } }
  const dxcc = distinct(sorted, q => q.dxcc || null).size;
  const recent = sorted.filter(q => q.ts >= now - 30 * DAY);
  return {
    total: sorted.length, first: sorted[0].ts, last: sorted[sorted.length - 1].ts, calls: distinct(sorted, q => q.call).size,
    topMode: modes[0] ? { mode: modes[0][0], pct: Math.round((modes[0][1] / sorted.length) * 100) } : null,
    topBand: bands[0] ? { band: bands[0][0], count: bands[0][1] } : null,
    bestMonth: months[0] ? { month: months[0][0], count: months[0][1] } : null,
    farthest: far, dxcc, missingDxcc: Math.max(0, totalEntities - dxcc),
    confirmedPct: Math.round((sorted.filter(isConfirmed).length / sorted.length) * 100),
    recent30: recent.length, recentNewCalls: recent.filter(q => !sorted.some(o => o.call === q.call && o.ts < q.ts)).length,
  };
}

function metrics(list) {
  const s = byTime(list);
  return {
    qsos: s.length, calls: distinct(s, q => q.call).size, dxcc: distinct(s, dxccKey).size, grids: distinct(s, grid4).size, bands: distinct(s, q => q.band).size,
    confirmed: s.filter(isConfirmed).length, operatingMs: operatingTime(s, 15), max60: maxRate(s, 60).count,
  };
}

// Comparação entre dois períodos: métricas lado a lado e o que é novo no período A.
export function comparePeriods(qsos, a, b) {
  const inRange = (q, r) => q.ts >= r[0] && q.ts < r[1];
  const la = qsos.filter(q => inRange(q, a)), lb = qsos.filter(q => inRange(q, b));
  const before = qsos.filter(q => q.ts < a[0]);
  const seen = (list, key) => new Set(list.map(key).filter(Boolean));
  const prevDxcc = seen(before, dxccKey), prevCalls = seen(before, q => q.call), prevGrids = seen(before, grid4);
  const firstOf = (list, key, prev) => { const out = new Map(); for (const q of byTime(list)) { const k = key(q); if (k && !prev.has(k) && !out.has(k)) out.set(k, q); } return [...out.values()]; };
  const bands = sortBands([...new Set([...la, ...lb].map(q => q.band))]);
  return {
    a: metrics(la), b: metrics(lb),
    perBand: bands.map(band => ({ band, a: la.filter(q => q.band === band).length, b: lb.filter(q => q.band === band).length })),
    perMode: [...new Set([...la, ...lb].map(q => q.mode))].sort().map(mode => ({ mode, a: la.filter(q => q.mode === mode).length, b: lb.filter(q => q.mode === mode).length })),
    newDxcc: firstOf(la, dxccKey, prevDxcc), newCalls: firstOf(la, q => q.call, prevCalls).length, newGrids: firstOf(la, grid4, prevGrids).length,
  };
}

export function periodPresets(now = Date.now()) {
  const d = new Date(now), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const Y = yy => Date.UTC(yy, 0, 1), M = (yy, mm) => Date.UTC(yy, mm, 1);
  return {
    yearVsLast: { a: [Y(y), Y(y + 1)], b: [Y(y - 1), Y(y)] },
    lastYearVsBefore: { a: [Y(y - 1), Y(y)], b: [Y(y - 2), Y(y - 1)] },
    monthVsLastYear: { a: [M(y, m), M(y, m + 1)], b: [M(y - 1, m), M(y - 1, m + 1)] },
    monthVsPrevious: { a: [M(y, m), M(y, m + 1)], b: [M(y, m - 1), M(y, m)] },
  };
}

// Estações mais contatadas e estações "sumidas" (com vários contatos e nenhum recente).
export function friends(qsos, { minQsos = 3, months = 12, now = Date.now() } = {}) {
  const map = new Map();
  for (const q of qsos) { const f = map.get(q.call) || { call: q.call, qsos: 0, first: q.ts, last: q.ts, bands: new Set(), country: q.country || '' }; f.qsos++; f.first = Math.min(f.first, q.ts); f.last = Math.max(f.last, q.ts); f.bands.add(q.band); map.set(q.call, f); }
  const list = [...map.values()].map(f => ({ ...f, bands: sortBands([...f.bands]) }));
  const limit = now - months * 30.44 * DAY;
  return {
    frequent: list.filter(f => f.qsos >= minQsos).sort((a, b) => b.qsos - a.qsos || b.last - a.last),
    missing: list.filter(f => f.qsos >= minQsos && f.last < limit).sort((a, b) => b.qsos - a.qsos),
  };
}

export function newCallsPerPeriod(qsos, unit = 'month') {
  const seen = new Set(), rows = new Map();
  for (const q of byTime(qsos)) {
    const k = unit === 'year' ? String(new Date(q.ts).getUTCFullYear()) : monthKey(q.ts);
    const r = rows.get(k) || { period: k, qsos: 0, newCalls: 0, newDxcc: 0 };
    r.qsos++;
    if (!seen.has('c' + q.call)) { seen.add('c' + q.call); r.newCalls++; }
    const d = dxccKey(q);
    if (d && !seen.has('d' + d)) { seen.add('d' + d); r.newDxcc++; }
    rows.set(k, r);
  }
  let acc = 0;
  return [...rows.values()].map(r => ({ ...r, cumulative: (acc += r.newCalls) }));
}

// Concursos: agrupados por CONTEST_ID e ano.
export function contests(qsos) {
  const map = new Map();
  for (const q of qsos) {
    if (!q.contest) continue;
    const year = new Date(q.ts).getUTCFullYear(), key = q.contest.toUpperCase() + '|' + year;
    const c = map.get(key) || { key, id: q.contest.toUpperCase(), year, start: q.ts, end: q.ts, qsos: 0 };
    c.qsos++; c.start = Math.min(c.start, q.ts); c.end = Math.max(c.end, q.ts);
    map.set(key, c);
  }
  return [...map.values()].sort((a, b) => b.start - a.start);
}

export function contestAnalysis(qsos, key, points = () => 1) {
  const [id, year] = key.split('|');
  const pick = y => byTime(qsos.filter(q => (q.contest || '').toUpperCase() === id && new Date(q.ts).getUTCFullYear() === Number(y)));
  const analyse = list => {
    if (!list.length) return null;
    const dupes = markDupes(list), valid = list.filter(q => !dupes.has(q.id));
    const bands = sortBands([...distinct(valid, q => q.band)]);
    const mults = {
      dxcc: bands.reduce((s, b) => s + distinct(valid.filter(q => q.band === b), dxccKey).size, 0),
      cqz: bands.reduce((s, b) => s + distinct(valid.filter(q => q.band === b), q => q.cqz).size, 0),
      pfx: distinct(valid, q => q.pfx).size,
    };
    const pts = valid.reduce((s, q) => s + points(q), 0);
    const hours = groupCount(list, q => bucketStart(q.ts, 'hour')).sort((a, b) => a[0] - b[0]);
    return {
      start: list[0].ts, end: list[list.length - 1].ts, qsos: list.length, dupes: dupes.size, valid: valid.length, points: pts, mults,
      perBand: bands.map(b => ({ band: b, qsos: valid.filter(q => q.band === b).length, dxcc: distinct(valid.filter(q => q.band === b), dxccKey).size, cqz: distinct(valid.filter(q => q.band === b), q => q.cqz).size })),
      hours, operatingMs: operatingTime(list, 15), max60: maxRate(list, 60).count,
      scoreDxcc: pts * mults.dxcc, scoreCq: pts * (mults.cqz + mults.dxcc), scorePfx: pts * mults.pfx,
    };
  };
  return { id, year: Number(year), current: analyse(pick(year)), previous: analyse(pick(Number(year) - 1)) };
}

// Propagação inferida dos próprios contatos.
export function propagation(qsos, { band = '', home = null, esKm = 500 } = {}) {
  const list = byTime(band ? qsos.filter(q => q.band === band) : qsos);
  const months = [...new Set(list.map(q => monthKey(q.ts)))].sort();
  const mi = new Map(months.map((m, i) => [m, i]));
  const matrix = keyFn => {
    const rows = new Map();
    for (const q of list) { const k = keyFn(q); if (!k) continue; if (!rows.has(k)) rows.set(k, new Array(months.length).fill(0)); rows.get(k)[mi.get(monthKey(q.ts))]++; }
    return [...rows.entries()].map(([key, values]) => ({ key, values, total: values.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
  };
  const hourMonth = Array.from({ length: 24 }, (_, h) => ({ key: String(h).padStart(2, '0') + 'h', values: new Array(months.length).fill(0) }));
  const dist = months.map(() => ({ n: 0, sum: 0, max: 0, az: new Array(8).fill(0) }));
  const longs = [];
  for (const q of list) {
    const m = mi.get(monthKey(q.ts));
    hourMonth[new Date(q.ts).getUTCHours()].values[m]++;
    const { home: h, target } = positions(q, home);
    if (h && target && target.precise !== false) {
      const d = distanceKm(h, target), b = bearingDeg(h, target);
      dist[m].n++; dist[m].sum += d; dist[m].max = Math.max(dist[m].max, d); dist[m].az[Math.floor(((b + 22.5) % 360) / 45)]++;
      const vhf = BAND_ORDER.indexOf(q.band) >= BAND_ORDER.indexOf('6m');
      if (vhf && d >= esKm) longs.push({ q, km: Math.round(d), az: Math.round(b) });
    }
  }
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const openings = new Map();
  for (const l of longs) { const day = new Date(l.q.ts).toISOString().slice(0, 10) + ' ' + l.q.band; const o = openings.get(day) || { day: day.slice(0, 10), band: l.q.band, qsos: [], maxKm: 0 }; o.qsos.push(l); o.maxKm = Math.max(o.maxKm, l.km); openings.set(day, o); }
  const years = [...new Set(list.map(q => new Date(q.ts).getUTCFullYear()))].sort();
  return {
    months, byCont: matrix(q => q.cont), byCountry: matrix(q => q.country).slice(0, 30), hourMonth,
    distance: months.map((m, i) => ({ month: m, n: dist[i].n, avg: dist[i].n ? Math.round(dist[i].sum / dist[i].n) : 0, max: Math.round(dist[i].max), dir: dist[i].n ? dirs[dist[i].az.indexOf(Math.max(...dist[i].az))] : '' })),
    openings: [...openings.values()].sort((a, b) => b.day.localeCompare(a.day)),
    years: years.map(y => { const l = list.filter(q => new Date(q.ts).getUTCFullYear() === y); return { year: y, qsos: l.length, dxcc: distinct(l, dxccKey).size, conts: distinct(l, q => q.cont).size }; }),
  };
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

const KNOWN_MODES = new Set(['SSB', 'CW', 'FM', 'AM', 'FT8', 'FT4', 'RTTY', 'PSK31', 'PSK63', 'PSK', 'JT65', 'JT9', 'MSK144', 'Q65', 'FST4', 'JS8', 'OLIVIA', 'SSTV', 'DSTAR', 'DMR', 'C4FM', 'MFSK', 'DATA', 'PKT', 'PACKET', 'HELL', 'CONTESTI', 'VARA', 'FREEDV', 'M17', 'ATV', 'WSPR', 'DIGITALVOICE', 'MT63', 'THOR', 'DOMINO', 'FSK441', 'ISCAT', 'JT4']);

// Saúde do log: problemas encontrados e correções possíveis em lote.
export function logHealth(qsos, { now = Date.now(), dupMinutes = 3 } = {}) {
  const sorted = byTime(qsos);
  const issues = { bandMismatch: [], missingBand: [], invalidMode: [], missingGrid: [], missingStation: [], future: [], nearDupes: [], typos: [] };
  for (const q of sorted) {
    const fb = q.freq ? bandFromFreq(q.freq) : '';
    if (fb && q.band && fb !== q.band) issues.bandMismatch.push({ q, fix: fb });
    if (!q.band) issues.missingBand.push({ q, fix: fb || '' });
    if (!q.mode || !KNOWN_MODES.has(q.mode)) issues.invalidMode.push({ q });
    if (!q.grid) issues.missingGrid.push({ q });
    if (!q.station) issues.missingStation.push({ q });
    if (q.ts > now + DAY) issues.future.push({ q });
  }
  const lastBy = new Map();
  for (const q of sorted) {
    const k = `${q.station}|${q.call}|${q.band}|${modeGroup(q.mode)}`, prev = lastBy.get(k);
    if (prev && q.ts - prev.ts <= dupMinutes * 60000 && q.ts - prev.ts >= 0 && prev.id !== q.id) issues.nearDupes.push({ q, original: prev });
    lastBy.set(k, q);
  }
  // Indicativo possivelmente mal digitado: aparece uma vez e difere em 1 caractere de outro frequente,
  // na mesma banda e a poucos minutos de distância.
  const counts = groupCount(sorted, q => q.call), freq = new Map(counts);
  const common = counts.filter(([, n]) => n >= 2).map(([c]) => c);
  for (const q of sorted) {
    if (freq.get(q.call) !== 1) continue;
    for (const c of common) {
      if (c === q.call || Math.abs(c.length - q.call.length) > 1 || levenshtein(c, q.call) !== 1) continue;
      const near = sorted.find(o => o.call === c && o.band === q.band && Math.abs(o.ts - q.ts) <= 30 * 60000);
      if (near || freq.get(c) >= 5) { issues.typos.push({ q, suggestion: c }); break; }
    }
  }
  return issues;
}
