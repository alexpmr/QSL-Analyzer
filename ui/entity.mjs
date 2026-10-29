// Ficha de uma entidade clicada (indicativo, país/DXCC, quadrícula, prefixo, zona, continente ou estação).
import * as S from '../src/stats.mjs';
import { isConfirmed } from '../src/db.mjs';
import { distanceKm, bearingDeg, gridToLatLon } from '../src/geo.mjs';
import { sortBands } from '../src/bands.mjs';
import { table, tile, worldMap, esc, entityLink } from './charts.mjs';
import { fmtDate, fmtDateTime } from './pages.mjs';

export const ENTITY_FILTER = { call: 'calls', country: 'countries', grid: 'grids', cont: 'conts', cqz: 'cqz', ituz: 'ituz', station: 'stations' };

export function entityMatcher(type, value) {
  const v = String(value);
  switch (type) {
    case 'call': return q => q.call === v;
    case 'country': return q => (q.country || (q.dxcc ? '#' + q.dxcc : '')) === v;
    case 'grid': return q => S.grid4(q) === v.toUpperCase().slice(0, 4);
    case 'pfx': return q => q.pfx === v;
    case 'cqz': return q => String(q.cqz) === v;
    case 'ituz': return q => String(q.ituz) === v;
    case 'cont': return q => q.cont === v;
    case 'station': return q => (q.station || '') === v;
    default: return () => false;
  }
}

const qslMarks = q => [q.qslRcvd === 'Y' ? 'P' : '', q.lotwRcvd === 'Y' ? 'L' : '', q.eqslRcvd === 'Y' ? 'E' : ''].join('');

function lookupCard(t, data, meta) {
  if (!data) {
    return `<div class="lookupCard empty"><p>${esc(meta.error ? t('lookupError', { e: meta.error }) : meta.configured ? t('lookupNotFound') : t('lookupNotConfigured'))}</p>
      <div class="lookupActions">${meta.configured ? `<button data-lookup-refresh="${esc(meta.call)}">${esc(t('lookupRefresh'))}</button>` : `<button data-go="settings:preferences">${esc(t('page_preferences'))}</button>`}<button data-link="https://www.qrz.com/db/${esc(encodeURIComponent(meta.call))}">${esc(t('openQrz'))}</button></div></div>`;
  }
  const row = (label, value) => (value || value === 0 ? `<div><small>${esc(label)}</small><span>${esc(value)}</span></div>` : '');
  const badges = [data.lotw ? 'LoTW' : '', data.eqsl ? 'eQSL' : '', data.paper ? t('paperQsl') : ''].filter(Boolean).map(b => `<span class="badge">${esc(b)}</span>`).join('');
  return `<div class="lookupCard">${data.imageData ? `<img src="${esc(data.imageData)}" alt="${esc(data.call)}">` : ''}
    <div class="lookupInfo"><h3>${esc(data.name || data.call)}</h3>${data.nickname && data.nickname !== data.name ? `<p class="help">"${esc(data.nickname)}"</p>` : ''}
      <div class="lookupFields">${row(t('qth'), data.addr || data.qth)}${row(t('country'), data.country)}${row(t('locator'), data.grid)}${row('Lat/Lon', data.lat !== null && data.lon !== null ? `${data.lat.toFixed(3)}, ${data.lon.toFixed(3)}` : '')}${row('CQ / ITU', [data.cqz, data.ituz].filter(Boolean).join(' / '))}${row('IOTA', data.iota)}${row(t('licenseClass'), data.licenseClass)}${row('E-mail', data.email)}</div>
      <div class="badges">${badges}</div>
      ${data.limited ? `<p class="notice">${esc(t('lookupLimited'))}</p>` : ''}
      <p class="help">${esc(t('lookupSource', { s: data.source, d: fmtDateTime(meta.fetched) }))}</p>
      <div class="lookupActions"><button data-lookup-refresh="${esc(data.call)}">${esc(t('lookupRefresh'))}</button><button data-link="${esc(data.page)}">${esc(data.source === 'QRZ.com' ? t('openQrz') : t('openHamqth'))}</button>${data.web ? `<button data-link="${esc(data.web)}">${esc(t('website'))}</button>` : ''}</div></div></div>`;
}

export function renderEntity({ t, qsos, type, value, home = null, lookup = null }) {
  const list = S.byTime(qsos.filter(entityMatcher(type, value)));
  const title = type === 'grid' ? value.toUpperCase().slice(0, 4) : value;
  const typeLabel = t('entity_' + type);
  let html = `<div class="entityHead"><div><small>${esc(typeLabel)}</small><h2>${esc(title)}</h2></div><div class="entityActions">${ENTITY_FILTER[type] ? `<button data-entity-filter="${esc(type + ':' + value)}">${esc(t('filterByEntity'))}</button>` : ''}<button data-entity-close>${esc(t('close'))}</button></div></div>`;
  if (type === 'call') html += lookupCard(t, lookup?.data || null, { call: value, ...(lookup?.meta || {}) });
  if (!list.length) return html + `<p class="notice">${esc(t('entityNoQsos'))}</p>`;
  const bands = sortBands([...S.distinct(list, q => q.band)]), modes = [...S.distinct(list, q => q.mode)].sort();
  const calls = S.groupCount(list, q => q.call), confirmed = list.filter(isConfirmed).length;
  let km = '';
  if (type === 'call' || type === 'grid') {
    const last = list[list.length - 1], { home: h, target } = S.positions(last, home);
    if (h && target) km = `${Math.round(distanceKm(h, target)).toLocaleString()} km · ${Math.round(bearingDeg(h, target))}°`;
  }
  html += `<div class="tiles">${tile(t('qsos'), list.length)}${type !== 'call' ? tile(t('uniqueCalls'), calls.length) : ''}${tile(t('bands'), bands.length, bands.join(' '))}${tile(t('modes'), modes.length, modes.join(' '))}${tile(t('firstQso'), fmtDate(list[0].ts))}${tile(t('lastQso'), fmtDate(list[list.length - 1].ts))}${tile(t('confirmedQsos'), confirmed, Math.round((confirmed / list.length) * 100) + '%')}${km ? tile(t('distanceAzimuth'), km) : ''}</div>`;
  // Slots banda × modo: W = trabalhado, C = confirmado.
  const slotRows = bands.map(b => [b, ...modes.map(m => { const l = list.filter(q => q.band === b && q.mode === m); return { html: l.length ? (l.some(isConfirmed) ? `<b class="qslC">C</b> ${l.length}` : `<span class="qslW">W</span> ${l.length}`) : '' }; })]);
  html += `<h3>${esc(t('slotsTitle'))}</h3>` + table([t('band'), ...modes], slotRows, { className: 'matrix' });
  if (type !== 'call') {
    const callRows = calls.slice(0, 200).map(([c, n]) => { const l = list.filter(q => q.call === c); return [c, n, l[0].country || '', sortBands([...new Set(l.map(q => q.band))]).join(' '), fmtDate(l[l.length - 1].ts), l.some(isConfirmed) ? '✓' : '']; });
    html += `<h3>${esc(t('stationsWorkedHere', { n: calls.length }))}</h3>` + table([t('call'), t('qsos'), t('country'), t('bands'), t('lastQso'), 'QSL'], callRows, { numeric: [1], links: { 0: 'call', 2: 'country' } });
    if (type !== 'country') {
      const countries = S.groupCount(list, q => q.country);
      html += `<h3>${esc(t('countriesHere', { n: countries.length }))}</h3><p class="entityList">${countries.map(([c, n]) => `${entityLink('country', c)} <small>${n}</small>`).join(' · ')}</p>`;
    }
    const grids = S.groupCount(list, S.grid4);
    if (grids.length && type !== 'grid') html += `<h3>${esc(t('gridsHere', { n: grids.length }))}</h3><p class="entityList">${grids.slice(0, 300).map(([g, n]) => `${entityLink('grid', g)} <small>${n}</small>`).join(' · ')}</p>`;
  }
  // Mapa com as posições conhecidas (quadrícula ou centro da entidade).
  const pts = new Map();
  for (const q of list) {
    const { target } = S.positions(q, home);
    if (!target) continue;
    const k = target.lat.toFixed(1) + ',' + target.lon.toFixed(1), p = pts.get(k) || { lat: target.lat, lon: target.lon, value: 0, label: '' };
    p.value++; p.label = `${q.call} · ${S.grid4(q) || q.country}: ${p.value}`; pts.set(k, p);
  }
  if (pts.size) html += worldMap([...pts.values()], { title: t('entityMap'), home, lines: type === 'call' });
  const rows = [...list].reverse().map(q => [fmtDateTime(q.ts), q.call, q.band, q.mode, q.freq ? q.freq.toFixed(3) : '', q.rstS, q.rstR, q.station, q.operator, S.grid4(q), q.country, qslMarks(q)]);
  html += `<h3>${esc(t('allQsos', { n: list.length }))}</h3>` + table([t('date'), t('call'), t('band'), t('mode'), 'MHz', 'S', 'R', t('station'), t('operator'), t('locator'), t('country'), 'QSL'], rows, { links: { 1: 'call', 7: 'station', 9: 'grid', 10: 'country' }, max: 3000 });
  html += `<p class="help">${esc(t('qslMarksLegend'))}</p>`;
  return html;
}

export { gridToLatLon };
