// Diplomas (DXCC, WAS, WAZ, WPX, VUCC, IOTA), contatos que faltam confirmar e entidades raras.
import { modeGroup, sortBands } from './bands.mjs';
import { dxccKey } from './stats.mjs';

export const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];
const US_DXCC = new Set([291, 6, 110]);
// Metas do VUCC por banda (número de quadrículas confirmadas).
export const VUCC_TARGETS = { '6m': 100, '2m': 100, '1.25m': 50, '70cm': 50, '33cm': 25, '23cm': 25, '13cm': 10, '9cm': 5, '6cm': 5, '3cm': 5 };
// Entidades historicamente no topo da lista "Most Wanted" do Club Log (referência; a classificação muda com o tempo).
export const RARE_DXCC = [344, 24, 199, 41, 506, 217, 505, 138, 123, 153, 489, 131, 20, 240, 235, 16, 111, 197, 182, 99, 124, 201, 174, 492, 10, 36];

// Confirmação válida: DXCC/WAS/WAZ/VUCC aceitam LoTW e QSL em papel; "any" inclui eQSL.
export const confirmedBy = (q, accept = 'lotw-paper') => q.lotwRcvd === 'Y' || q.qslRcvd === 'Y' || (accept === 'any' && q.eqslRcvd === 'Y');

export function currentEntities(cty) {
  const map = new Map();
  for (const e of cty?.entities || []) if (e.dxcc && !e.waeOnly && !map.has(e.dxcc)) map.set(e.dxcc, { dxcc: e.dxcc, name: e.name, cont: e.cont });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function progress(qsos, keyFn, accept) {
  const worked = new Map(), confirmed = new Set();
  for (const q of qsos) {
    const k = keyFn(q);
    if (k === null || k === undefined || k === '') continue;
    if (!worked.has(k)) worked.set(k, q);
    if (confirmedBy(q, accept)) confirmed.add(k);
  }
  return { worked, confirmed };
}

export function dxccAward(qsos, cty, accept = 'lotw-paper') {
  const all = currentEntities(cty);
  const code = q => q.dxcc || null;
  const cat = (name, filter) => {
    const p = progress(qsos.filter(filter), code, accept);
    return { key: name, worked: p.worked.size, confirmed: p.confirmed.size, missing: all.filter(e => !p.worked.has(e.dxcc)), unconfirmed: all.filter(e => p.worked.has(e.dxcc) && !p.confirmed.has(e.dxcc)) };
  };
  const bands = sortBands([...new Set(qsos.map(q => q.band).filter(Boolean))]);
  return {
    total: all.length,
    categories: [cat('mixed', () => true), cat('phone', q => modeGroup(q.mode) === 'PHONE'), cat('cw', q => q.mode === 'CW'), cat('digi', q => modeGroup(q.mode) === 'DIGI')],
    perBand: bands.map(b => { const p = progress(qsos.filter(q => q.band === b), code, accept); return { band: b, worked: p.worked.size, confirmed: p.confirmed.size }; }),
  };
}

export function wasAward(qsos, accept = 'lotw-paper') {
  const p = progress(qsos.filter(q => US_DXCC.has(Number(q.dxcc))), q => String(q.state || '').toUpperCase().slice(0, 2), accept);
  return { total: 50, rows: US_STATES.map(s => ({ key: s, worked: p.worked.has(s), confirmed: p.confirmed.has(s), qso: p.worked.get(s) || null })) };
}

export function wazAward(qsos, accept = 'lotw-paper') {
  const p = progress(qsos, q => (q.cqz >= 1 && q.cqz <= 40 ? q.cqz : null), accept);
  return { total: 40, rows: Array.from({ length: 40 }, (_, i) => ({ key: i + 1, worked: p.worked.has(i + 1), confirmed: p.confirmed.has(i + 1), qso: p.worked.get(i + 1) || null })) };
}

export function wpxAward(qsos, accept = 'lotw-paper') {
  const p = progress(qsos, q => q.pfx, accept);
  return { worked: p.worked.size, confirmed: p.confirmed.size, targets: [300, 400, 500, 600, 1000] };
}

export function vuccAward(qsos, accept = 'lotw-paper') {
  return Object.entries(VUCC_TARGETS).map(([band, target]) => {
    const p = progress(qsos.filter(q => q.band === band), q => (q.grid || '').slice(0, 4).toUpperCase() || null, accept);
    return { band, target, worked: p.worked.size, confirmed: p.confirmed.size };
  }).filter(r => r.worked);
}

export function iotaAward(qsos, accept = 'any') {
  const p = progress(qsos, q => String(q.iota || '').toUpperCase().replace(/\s/g, '') || null, accept);
  return { worked: p.worked.size, confirmed: p.confirmed.size, refs: [...p.worked.keys()].sort().map(k => ({ ref: k, confirmed: p.confirmed.has(k), qso: p.worked.get(k) })) };
}

// Entidades trabalhadas sem confirmação, com o "melhor" QSO para pedir QSL: um já enviado ao LoTW, senão o mais recente.
export function unconfirmed(qsos, { perBand = false, accept = 'lotw-paper' } = {}) {
  const groups = new Map();
  for (const q of qsos) {
    const base = dxccKey(q);
    if (!base) continue;
    const k = perBand ? base + '|' + q.band : base;
    let g = groups.get(k);
    if (!g) groups.set(k, g = { key: k, country: q.country || '#' + q.dxcc, dxcc: q.dxcc, band: perBand ? q.band : '', cont: q.cont, qsos: [], confirmed: false });
    g.qsos.push(q);
    if (confirmedBy(q, accept)) g.confirmed = true;
  }
  return [...groups.values()].filter(g => !g.confirmed).map(g => {
    const best = [...g.qsos].sort((a, b) => (b.lotwSent === 'Y') - (a.lotwSent === 'Y') || b.ts - a.ts)[0];
    return { country: g.country, dxcc: g.dxcc, band: g.band, cont: g.cont, attempts: g.qsos.length, best };
  }).sort((a, b) => a.country.localeCompare(b.country) || a.band.localeCompare(b.band));
}

export function rareWorked(qsos, cty) {
  const names = new Map(currentEntities(cty).map(e => [e.dxcc, e.name]));
  const byCode = new Map();
  for (const q of qsos) if (q.dxcc) { const l = byCode.get(Number(q.dxcc)) || []; l.push(q); byCode.set(Number(q.dxcc), l); }
  return RARE_DXCC.map((code, i) => {
    const list = byCode.get(code) || [];
    return { rank: i + 1, dxcc: code, name: names.get(code) || '#' + code, qsos: list.length, confirmed: list.some(q => confirmedBy(q, 'any')), first: list.length ? Math.min(...list.map(q => q.ts)) : null };
  });
}
