// Exportação: ADIF v3, CSV, Cabrillo e KML (Google Earth / Google Maps).
import { gridToLatLon } from './geo.mjs';
import { positions, grid4 } from './stats.mjs';

const pad = n => String(n).padStart(2, '0');
export const adifDate = ts => { const d = new Date(ts); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()); };
export const adifTime = ts => { const d = new Date(ts); return pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()); };
const adifCoord = (v, pos, neg) => { if (!Number.isFinite(v)) return ''; const a = Math.abs(v), d = Math.floor(a); return (v < 0 ? neg : pos) + String(d).padStart(3, '0') + ' ' + ((a - d) * 60).toFixed(3).padStart(6, '0'); };

const field = (name, value) => {
  if (value === null || value === undefined || value === '') return '';
  const v = String(value);
  return `<${name}:${[...v].length}>${v} `;
};

export function toAdifRecord(q) {
  let r = '';
  r += field('CALL', q.call) + field('QSO_DATE', adifDate(q.ts)) + field('TIME_ON', adifTime(q.ts));
  if (q.tsOff) r += field('QSO_DATE_OFF', adifDate(q.tsOff)) + field('TIME_OFF', adifTime(q.tsOff));
  r += field('BAND', q.band) + field('FREQ', q.freq ? q.freq.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : '') + field('BAND_RX', q.bandRx) + field('FREQ_RX', q.freqRx);
  r += field('MODE', ['FT4', 'JS8', 'Q65', 'FST4'].includes(q.mode) ? 'MFSK' : q.mode) + field('SUBMODE', q.submode || (['FT4', 'JS8', 'Q65', 'FST4'].includes(q.mode) ? q.mode : ''));
  r += field('RST_SENT', q.rstS) + field('RST_RCVD', q.rstR) + field('STATION_CALLSIGN', q.station) + field('OPERATOR', q.operator !== q.station ? q.operator : '');
  r += field('MY_GRIDSQUARE', q.myGrid) + field('GRIDSQUARE', q.grid) + field('NAME', q.name) + field('QTH', q.qth) + field('COMMENT', q.comment);
  r += field('DXCC', q.dxcc) + field('COUNTRY', q.country) + field('CONT', q.cont) + field('CQZ', q.cqz) + field('ITUZ', q.ituz) + field('PFX', q.pfx);
  r += field('STATE', q.state) + field('IOTA', q.iota) + field('PROP_MODE', q.propMode) + field('SAT_NAME', q.satName) + field('TX_PWR', q.txPwr);
  r += field('SRX_STRING', q.srx) + field('STX_STRING', q.stx) + field('CONTEST_ID', q.contest);
  r += field('QSL_RCVD', q.qslRcvd) + field('QSL_SENT', q.qslSent) + field('LOTW_QSL_RCVD', q.lotwRcvd) + field('LOTW_QSL_SENT', q.lotwSent) + field('EQSL_QSL_RCVD', q.eqslRcvd) + field('EQSL_QSL_SENT', q.eqslSent) + field('QSLRDATE', q.qslRdate);
  r += field('LAT', adifCoord(q.lat, 'N', 'S')) + field('LON', adifCoord(q.lon, 'E', 'W')) + field('MY_LAT', adifCoord(q.myLat, 'N', 'S')) + field('MY_LON', adifCoord(q.myLon, 'E', 'W'));
  if (Number.isFinite(q.points)) r += field('APP_QSLANALYZER_POINTS', q.points);
  for (const [k, v] of Object.entries(q.extra || {})) if (/^[A-Z0-9_]+$/.test(k) && !k.startsWith('APP_QSLANALYZER')) r += field(k, v);
  return r.trim() + ' <EOR>\n';
}

export function toAdif(qsos, version) {
  const now = new Date();
  const header = `Exportado por PT2VHF QSL Manager\n${field('ADIF_VER', '3.1.4')}${field('PROGRAMID', 'PT2VHF QSL Manager')}${field('PROGRAMVERSION', version || '')}${field('CREATED_TIMESTAMP', adifDate(+now) + ' ' + adifTime(+now))}<EOH>\n\n`;
  return header + qsos.map(toAdifRecord).join('');
}

const csvCell = v => { const s = v === null || v === undefined ? '' : String(v); return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const toCsvRows = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export const QSO_COLUMNS = ['call', 'date', 'time', 'band', 'freq', 'mode', 'rstS', 'rstR', 'station', 'operator', 'grid', 'myGrid', 'country', 'dxcc', 'cont', 'cqz', 'ituz', 'pfx', 'name', 'qth', 'contest', 'srx', 'stx', 'qslRcvd', 'lotwRcvd', 'eqslRcvd', 'comment'];

export function toCsv(qsos) {
  const rows = [QSO_COLUMNS.map(c => c.toUpperCase())];
  for (const q of qsos) rows.push(QSO_COLUMNS.map(c => c === 'date' ? adifDate(q.ts) : c === 'time' ? adifTime(q.ts) : q[c]));
  return toCsvRows(rows);
}

const CAB_BAND = { '160m': 1800, '80m': 3500, '40m': 7000, '20m': 14000, '15m': 21000, '10m': 28000, '6m': '50', '4m': '70', '2m': '144', '1.25m': '222', '70cm': '432', '33cm': '902', '23cm': '1.2G', '13cm': '2.3G' };
const CAB_MODE = m => (m === 'CW' ? 'CW' : ['SSB', 'AM'].includes(m) ? 'PH' : m === 'FM' ? 'FM' : m === 'RTTY' ? 'RY' : 'DG');

export function toCabrillo(qsos, { call = '', contest = '', operators = '', grid = '', version = '' } = {}) {
  const lines = ['START-OF-LOG: 3.0', `CALLSIGN: ${call}`, `CONTEST: ${contest}`, `OPERATORS: ${operators}`, grid ? `GRID-LOCATOR: ${grid}` : null, `CREATED-BY: PT2VHF QSL Manager ${version}`].filter(Boolean);
  for (const q of qsos) {
    const f = q.freq ? Math.round(q.freq * 1000) : CAB_BAND[q.band] || q.band;
    const d = new Date(q.ts), date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time = pad(d.getUTCHours()) + pad(d.getUTCMinutes());
    const sent = q.stx || q.rstS || '59', rcvd = q.srx || q.rstR || '59';
    lines.push(`QSO: ${String(f).padStart(5)} ${CAB_MODE(q.mode)} ${date} ${time} ${(q.station || call).padEnd(13)} ${sent.padEnd(10)} ${q.call.padEnd(13)} ${rcvd}`);
  }
  lines.push('END-OF-LOG:');
  return lines.join('\r\n') + '\r\n';
}

const xml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const iso = ts => new Date(ts).toISOString().replace('.000', '');

// KML com camadas: entidades DXCC, quadrículas, linhas de QSO e replay temporal.
export function toKml(qsos, { title = 'QSL Manager', home = null, layers = ['dxcc', 'grids', 'lines'], timeline = false } = {}) {
  const out = [`<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(title)}</name>`,
    '<Style id="dx"><IconStyle><color>ffc2e169</color><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>',
    '<Style id="grid"><LineStyle><color>ff69e1c2</color><width>1</width></LineStyle><PolyStyle><color>5569e1c2</color></PolyStyle></Style>',
    '<Style id="line"><LineStyle><color>aad6782a</color><width>1.5</width></LineStyle></Style>',
    '<Style id="home"><IconStyle><color>ff3a45ff</color><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/star.png</href></Icon></IconStyle></Style>'];
  if (home) out.push(`<Placemark><name>QTH</name><styleUrl>#home</styleUrl><Point><coordinates>${home.lon},${home.lat},0</coordinates></Point></Placemark>`);
  if (layers.includes('dxcc')) {
    const ent = new Map();
    for (const q of qsos) { if (!q.country || !Number.isFinite(q.elat)) continue; const e = ent.get(q.country) || { country: q.country, lat: q.elat, lon: q.elon, qsos: 0, first: q.ts, bands: new Set() }; e.qsos++; e.first = Math.min(e.first, q.ts); e.bands.add(q.band); ent.set(q.country, e); }
    out.push('<Folder><name>DXCC</name>');
    for (const e of ent.values()) out.push(`<Placemark><name>${xml(e.country)}</name><description>${e.qsos} QSOs · ${xml([...e.bands].join(' '))}</description>${timeline ? `<TimeStamp><when>${iso(e.first)}</when></TimeStamp>` : ''}<styleUrl>#dx</styleUrl><Point><coordinates>${e.lon},${e.lat},0</coordinates></Point></Placemark>`);
    out.push('</Folder>');
  }
  if (layers.includes('grids')) {
    const grids = new Map();
    for (const q of qsos) { const g = grid4(q); if (g.length === 4 && !grids.has(g)) grids.set(g, q.ts); }
    out.push('<Folder><name>Locators</name>');
    for (const [g, ts] of grids) {
      const c = gridToLatLon(g);
      if (!c) continue;
      const w = c.lon - 1, s = c.lat - 0.5, e = c.lon + 1, n = c.lat + 0.5;
      out.push(`<Placemark><name>${g}</name>${timeline ? `<TimeStamp><when>${iso(ts)}</when></TimeStamp>` : ''}<styleUrl>#grid</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${w},${s},0 ${e},${s},0 ${e},${n},0 ${w},${n},0 ${w},${s},0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`);
    }
    out.push('</Folder>');
  }
  if (layers.includes('lines') || layers.includes('qsos')) {
    out.push('<Folder><name>QSOs</name>');
    for (const q of qsos.slice(0, 20000)) {
      const { home: h, target } = positions(q, home);
      if (!target) continue;
      const when = timeline ? `<TimeStamp><when>${iso(q.ts)}</when></TimeStamp>` : '';
      const desc = `${new Date(q.ts).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${q.band} ${q.mode}`;
      if (layers.includes('lines') && h) out.push(`<Placemark><name>${xml(q.call)}</name><description>${xml(desc)}</description>${when}<styleUrl>#line</styleUrl><LineString><tessellate>1</tessellate><coordinates>${h.lon},${h.lat},0 ${target.lon},${target.lat},0</coordinates></LineString></Placemark>`);
      else out.push(`<Placemark><name>${xml(q.call)}</name><description>${xml(desc)}</description>${when}<styleUrl>#dx</styleUrl><Point><coordinates>${target.lon},${target.lat},0</coordinates></Point></Placemark>`);
    }
    out.push('</Folder>');
  }
  out.push('</Document></kml>\n');
  return out.join('\n');
}
