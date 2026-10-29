// Leitura de logs em ADIF (.adi), ADX (.adx), Cabrillo, EDI (REG1TEST) e CSV.
// Cada formato é convertido primeiro em um dicionário de campos ADIF e depois normalizado em QSO.
import { bandFromFreq, bandFromCabrillo, normalizeBand, normalizeMode } from './bands.mjs';
import { cleanCall } from './cty.mjs';
import { adifCoord, gridValid } from './geo.mjs';

export const FORMATS = ['adif', 'adx', 'cabrillo', 'edi', 'csv'];

export function detectFormat(text, filename = '') {
  const name = filename.toLowerCase(), head = String(text || '').slice(0, 4000);
  if (/\.adx$/.test(name) || /<\?xml[\s\S]*<ADX/i.test(head) || /^\s*<ADX/i.test(head)) return 'adx';
  if (/^\s*START-OF-LOG:/im.test(head)) return 'cabrillo';
  if (/\[REG1TEST/i.test(head)) return 'edi';
  if (/\.(adi|adif)$/.test(name) || /<eoh>|<eor>|<call:\d+/i.test(head)) return 'adif';
  if (/\.(csv|tsv|txt)$/.test(name) && /[,;\t]/.test(head.split(/\r?\n/)[0] || '')) return 'csv';
  if (/\.(log|cbr)$/.test(name) && /^QSO:/im.test(head)) return 'cabrillo';
  if (/^QSO:/im.test(head)) return 'cabrillo';
  if (/[,;\t]/.test(head.split(/\r?\n/)[0] || '') && /call/i.test(head.split(/\r?\n/)[0])) return 'csv';
  return null;
}

const utf8Length = s => { let n = 0; for (const ch of s) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };

function sliceByBytes(text, start, bytes) {
  let n = 0, i = start;
  while (i < text.length && n < bytes) {
    const c = text.codePointAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    i += c > 0xffff ? 2 : 1;
  }
  return text.slice(start, i);
}

export function parseAdifRecords(text) {
  const src = String(text || '');
  const records = [], header = {};
  let i = 0, current = {}, inHeader = !src.trimStart().startsWith('<');
  const eoh = src.search(/<eoh>/i);
  if (eoh < 0) inHeader = false;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    const gt = src.indexOf('>', lt);
    if (gt < 0) break;
    const tag = src.slice(lt + 1, gt);
    const m = tag.match(/^([A-Za-z0-9_]+)(?::(\d+)(?::([A-Za-z]))?)?$/);
    i = gt + 1;
    if (!m) continue;
    const name = m[1].toUpperCase();
    if (name === 'EOH') { inHeader = false; current = {}; continue; }
    if (name === 'EOR') { if (!inHeader && Object.keys(current).length) records.push(current); current = {}; continue; }
    if (m[2] === undefined) continue;
    const len = Number(m[2]);
    let value = src.slice(i, i + len);
    // Alguns programas contam bytes UTF-8 em vez de caracteres: escolhe a leitura que termina numa fronteira válida.
    if (utf8Length(value) > len) {
      const boundary = k => k >= src.length || /[\s<]/.test(src[k]);
      const byBytes = sliceByBytes(src, i, len);
      if (boundary(i + byBytes.length) && (!boundary(i + value.length) || !value.slice(byBytes.length).trim())) value = byBytes;
    }
    i += value.length;
    if (inHeader && eoh >= 0 && lt < eoh) header[name] = value;
    else current[name] = value;
  }
  if (Object.keys(current).length && current.CALL) records.push(current);
  return { header, records };
}

const xmlUnescape = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

export function parseAdxRecords(text) {
  const records = [], header = {};
  const headerBlock = String(text).match(/<HEADER>([\s\S]*?)<\/HEADER>/i);
  if (headerBlock) for (const m of headerBlock[1].matchAll(/<([A-Z0-9_]+)[^>]*>([\s\S]*?)<\/\1>/gi)) header[m[1].toUpperCase()] = xmlUnescape(m[2].trim());
  for (const rec of String(text).matchAll(/<RECORD>([\s\S]*?)<\/RECORD>/gi)) {
    const fields = {};
    for (const m of rec[1].matchAll(/<(APP|USERDEF|[A-Z0-9_]+)((?:\s+[A-Z_]+="[^"]*")*)\s*>([\s\S]*?)<\/\1>/gi)) {
      let name = m[1].toUpperCase();
      if (name === 'APP') {
        const prog = (m[2].match(/PROGRAMID="([^"]*)"/i) || [])[1] || 'X', field = (m[2].match(/FIELDNAME="([^"]*)"/i) || [])[1] || 'FIELD';
        name = `APP_${prog}_${field}`.toUpperCase();
      } else if (name === 'USERDEF') name = ((m[2].match(/FIELDNAME="([^"]*)"/i) || [])[1] || 'USERDEF').toUpperCase();
      fields[name] = xmlUnescape(m[3].trim());
    }
    if (Object.keys(fields).length) records.push(fields);
  }
  return { header, records };
}

const CAB_MODES = { CW: 'CW', PH: 'SSB', SSB: 'SSB', FM: 'FM', RY: 'RTTY', RTTY: 'RTTY', DG: 'DATA', DATA: 'DATA', AM: 'AM', FT8: 'FT8', FT4: 'FT4' };
const looksLikeCall = s => /^[A-Z0-9]{1,4}\/?[A-Z0-9]*\d[A-Z0-9/]*$/i.test(s) && /[A-Z]/i.test(s) && s.length >= 3;

export function parseCabrilloRecords(text) {
  const header = {}, records = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^([A-Z0-9-]+):\s?(.*)$/i);
    if (!m) continue;
    const key = m[1].toUpperCase(), rest = m[2].trim();
    if (key !== 'QSO' && key !== 'X-QSO') { header[key] = header[key] ? header[key] + ' ' + rest : rest; continue; }
    if (key === 'X-QSO') continue;
    const t = rest.split(/\s+/);
    if (t.length < 6) continue;
    const [freq, mo, date, time, ...tail] = t;
    const mycall = tail[0];
    const exch = tail.slice(1);
    let n = exch.length % 2 === 0 ? (exch.length - 2) / 2 : (exch.length - 3) / 2, idx = n;
    if (!(idx >= 0 && looksLikeCall(exch[idx] || ''))) {
      idx = exch.findIndex((v, k) => k > 0 && looksLikeCall(v) && !/^\d+$/.test(v));
      if (idx < 0) idx = 0;
      n = idx;
    }
    const call = exch[idx], sent = exch.slice(0, n), rcvd = exch.slice(idx + 1, idx + 1 + n), txId = exch.length > idx + 1 + n ? exch[exch.length - 1] : '';
    const { band, freq: mhz } = bandFromCabrillo(freq);
    const rec = {
      CALL: call, STATION_CALLSIGN: mycall, QSO_DATE: date.replace(/-/g, ''), TIME_ON: time.padStart(4, '0'), BAND: band,
      MODE: CAB_MODES[mo.toUpperCase()] || mo.toUpperCase(), STX_STRING: sent.join(' '), SRX_STRING: rcvd.join(' '),
    };
    if (mhz) rec.FREQ = String(mhz);
    if (sent.length && /^\d{2,3}$/.test(sent[0])) rec.RST_SENT = sent[0];
    if (rcvd.length && /^\d{2,3}$/.test(rcvd[0])) rec.RST_RCVD = rcvd[0];
    if (txId && /^[01]$/.test(txId)) rec.APP_CABRILLO_TX = txId;
    if (header.CONTEST) rec.CONTEST_ID = header.CONTEST;
    records.push(rec);
  }
  const ops = (header.OPERATORS || '').split(/[\s,]+/).filter(Boolean);
  if (ops.length === 1) for (const r of records) r.OPERATOR = ops[0];
  if (header['GRID-LOCATOR']) for (const r of records) r.MY_GRIDSQUARE = header['GRID-LOCATOR'];
  return { header, records };
}

const EDI_MODES = { 1: 'SSB', 2: 'CW', 3: 'SSB', 4: 'CW', 5: 'AM', 6: 'FM', 7: 'RTTY', 8: 'SSTV', 9: 'ATV' };

export function parseEdiRecords(text) {
  const header = {}, records = [];
  let section = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(/^\[([A-Za-z0-9]+)/);
    if (sec) { section = sec[1].toUpperCase(); continue; }
    if (section === 'REG1TEST') {
      const kv = line.match(/^([A-Za-z0-9]+)=(.*)$/);
      if (kv) header[kv[1].toUpperCase()] = kv[2].trim();
    } else if (section === 'QSORECORDS') {
      const f = line.split(';');
      if (f.length < 10 || !f[2]) continue;
      const yy = Number(f[0].slice(0, 2));
      const bandText = (header.PBAND || '').replace(/,/g, '.');
      const mhz = parseFloat(bandText);
      let band = '';
      if (/ghz/i.test(bandText)) band = bandFromFreq(mhz * 1000); else band = bandFromFreq(mhz);
      records.push({
        CALL: f[2], QSO_DATE: (yy > 70 ? '19' : '20') + f[0], TIME_ON: f[1], MODE: EDI_MODES[f[3]] || '', RST_SENT: f[4], STX: f[5],
        RST_RCVD: f[6], SRX: f[7], SRX_STRING: f[8], GRIDSQUARE: f[9], APP_EDI_POINTS: f[10], BAND: band,
        STATION_CALLSIGN: header.PCALL || '', MY_GRIDSQUARE: header.PWWLO || '', CONTEST_ID: header.TNAME || '',
        APP_EDI_DUPE: f[14] || '',
      });
    }
  }
  return { header, records };
}

const CSV_ALIASES = {
  CALL: ['call', 'callsign', 'indicativo', 'dx_call', 'contact'], QSO_DATE: ['qso_date', 'date', 'data', 'qsodate', 'date_on'],
  TIME_ON: ['time_on', 'time', 'utc', 'hora', 'time_utc', 'start_time'], BAND: ['band', 'banda'], FREQ: ['freq', 'frequency', 'frequencia', 'frequência', 'mhz'],
  MODE: ['mode', 'modo'], SUBMODE: ['submode'], RST_SENT: ['rst_sent', 'rst_s', 'sent', 'rst sent', 'rsts'], RST_RCVD: ['rst_rcvd', 'rst_r', 'rcvd', 'rst rcvd', 'rstr'],
  GRIDSQUARE: ['gridsquare', 'grid', 'locator', 'loc', 'wwl'], STATION_CALLSIGN: ['station_callsign', 'my_call', 'mycall', 'station', 'owncall'],
  OPERATOR: ['operator', 'op', 'operador'], NAME: ['name', 'nome'], QTH: ['qth'], COMMENT: ['comment', 'comments', 'comentario', 'comentário', 'notes'],
  DXCC: ['dxcc'], COUNTRY: ['country', 'pais', 'país', 'entity'], CONT: ['cont', 'continent'], CQZ: ['cqz', 'cq_zone', 'cq'], ITUZ: ['ituz', 'itu_zone', 'itu'],
  QSL_RCVD: ['qsl_rcvd'], QSL_SENT: ['qsl_sent'], LOTW_QSL_RCVD: ['lotw_qsl_rcvd', 'lotw'], EQSL_QSL_RCVD: ['eqsl_qsl_rcvd', 'eqsl'],
  TIME_OFF: ['time_off'], MY_GRIDSQUARE: ['my_gridsquare', 'my_grid'], CONTEST_ID: ['contest_id', 'contest'], TX_PWR: ['tx_pwr', 'power', 'pwr'],
};

export function splitCsvLine(line, delim) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(v => v.trim());
}

export function parseCsvRecords(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { header: {}, records: [] };
  const first = lines[0];
  const delim = ['\t', ';', ','].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const cols = splitCsvLine(first, delim).map(c => c.toLowerCase().replace(/^"|"$/g, ''));
  const mapping = cols.map(c => {
    for (const [field, names] of Object.entries(CSV_ALIASES)) if (names.includes(c)) return field;
    return /^[a-z0-9_]+$/.test(c) ? c.toUpperCase() : null;
  });
  const records = [];
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line, delim), rec = {};
    mapping.forEach((field, k) => { if (field && values[k] !== undefined && values[k] !== '') rec[field] = values[k]; });
    if (!rec.CALL) continue;
    // Datas e horas em formatos comuns de planilhas.
    if (rec.QSO_DATE) {
      const d = rec.QSO_DATE.trim();
      let m;
      if ((m = d.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):?(\d{2})(?::?(\d{2}))?)?/))) { rec.QSO_DATE = m[1] + m[2] + m[3]; if (m[4] && !rec.TIME_ON) rec.TIME_ON = m[4] + m[5] + (m[6] || '00'); }
      else if ((m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})/))) rec.QSO_DATE = m[3] + m[2] + m[1];
      else if ((m = d.match(/^(\d{4})\/(\d{2})\/(\d{2})/))) rec.QSO_DATE = m[1] + m[2] + m[3];
    }
    if (rec.TIME_ON) rec.TIME_ON = rec.TIME_ON.replace(/[:\sZ]/gi, '').slice(0, 6);
    records.push(rec);
  }
  return { header: {}, records };
}

const bool = v => String(v || '').toUpperCase();
const num = v => { const n = Number(String(v ?? '').trim().replace(',', '.')); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };

export function adifTimestamp(date, time) {
  const d = String(date || '').replace(/\D/g, ''), t = String(time || '').replace(/\D/g, '').padEnd(4, '0');
  if (d.length !== 8) return null;
  const ms = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)), Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6) || 0));
  return Number.isFinite(ms) ? ms : null;
}

const MAPPED = new Set(['CALL', 'QSO_DATE', 'TIME_ON', 'QSO_DATE_OFF', 'TIME_OFF', 'BAND', 'BAND_RX', 'FREQ', 'FREQ_RX', 'MODE', 'SUBMODE', 'RST_SENT', 'RST_RCVD', 'STATION_CALLSIGN', 'OPERATOR', 'OWNER_CALLSIGN', 'MY_GRIDSQUARE', 'GRIDSQUARE', 'NAME', 'QTH', 'COMMENT', 'DXCC', 'COUNTRY', 'CONT', 'CQZ', 'ITUZ', 'PFX', 'STATE', 'CNTY', 'IOTA', 'SOTA_REF', 'POTA_REF', 'PROP_MODE', 'SAT_NAME', 'TX_PWR', 'SRX', 'STX', 'SRX_STRING', 'STX_STRING', 'CONTEST_ID', 'QSL_RCVD', 'QSL_SENT', 'LOTW_QSL_RCVD', 'LOTW_QSL_SENT', 'EQSL_QSL_RCVD', 'EQSL_QSL_SENT', 'QSLRDATE', 'LOTW_QSLRDATE', 'EQSL_QSLRDATE', 'LAT', 'LON', 'MY_LAT', 'MY_LON', 'DISTANCE', 'ANT_AZ']);

// Normaliza um registro (campos ADIF) para o esquema interno de QSO.
export function normalizeRecord(r, defaults = {}) {
  const call = cleanCall(r.CALL);
  const ts = adifTimestamp(r.QSO_DATE, r.TIME_ON);
  if (!call || ts === null) return null;
  const freq = num(r.FREQ), freqRx = num(r.FREQ_RX);
  let band = normalizeBand(r.BAND) || bandFromFreq(freq);
  let tsOff = r.TIME_OFF ? adifTimestamp(r.QSO_DATE_OFF || r.QSO_DATE, r.TIME_OFF) : null;
  if (tsOff !== null && tsOff < ts) tsOff += 86400000;
  const station = cleanCall(r.STATION_CALLSIGN || r.OWNER_CALLSIGN || defaults.station || r.OPERATOR || '');
  const app = key => { for (const k of Object.keys(r)) if (k.startsWith('APP_') && k.endsWith('_' + key)) return r[k]; return undefined; };
  const extra = {};
  for (const [k, v] of Object.entries(r)) if (!MAPPED.has(k) && v !== '') extra[k] = v;
  const q = {
    call, ts, band, freq, mode: normalizeMode(r.MODE, r.SUBMODE) || defaults.mode || '', submode: String(r.SUBMODE || '').toUpperCase(),
    station, operator: cleanCall(r.OPERATOR || defaults.operator || '') || station,
    rstS: r.RST_SENT || '', rstR: r.RST_RCVD || '', myGrid: (r.MY_GRIDSQUARE || defaults.myGrid || '').trim(), grid: gridValid(r.GRIDSQUARE) ? r.GRIDSQUARE.trim() : '',
    name: r.NAME || '', qth: r.QTH || '', comment: r.COMMENT || '',
    dxcc: num(r.DXCC), country: r.COUNTRY || '', cont: (r.CONT || '').toUpperCase(), cqz: num(r.CQZ), ituz: num(r.ITUZ), pfx: (r.PFX || '').toUpperCase(),
    state: r.STATE || '', iota: r.IOTA || '', propMode: r.PROP_MODE || '', satName: r.SAT_NAME || '', txPwr: num(r.TX_PWR),
    srx: r.SRX_STRING || r.SRX || '', stx: r.STX_STRING || r.STX || '', contest: r.CONTEST_ID || defaults.contest || '',
    points: num(app('POINTS')), radio: String(app('RADIO_NR') || app('TX') || r.MY_RIG || '').trim(),
    qslRcvd: bool(r.QSL_RCVD), qslSent: bool(r.QSL_SENT), lotwRcvd: bool(r.LOTW_QSL_RCVD), lotwSent: bool(r.LOTW_QSL_SENT),
    eqslRcvd: bool(r.EQSL_QSL_RCVD), eqslSent: bool(r.EQSL_QSL_SENT), qslRdate: r.QSLRDATE || r.LOTW_QSLRDATE || r.EQSL_QSLRDATE || '',
    lat: adifCoord(r.LAT), lon: adifCoord(r.LON), myLat: adifCoord(r.MY_LAT), myLon: adifCoord(r.MY_LON),
    tsOff, freqRx, bandRx: normalizeBand(r.BAND_RX) || bandFromFreq(freqRx), extra,
  };
  if (!q.band && defaults.band) q.band = defaults.band;
  return q;
}

export function parseLog(text, filename = '', defaults = {}, forced = null) {
  const format = forced || detectFormat(text, filename);
  if (!format) throw new Error('UNKNOWN_FORMAT');
  const parsed = format === 'adx' ? parseAdxRecords(text) : format === 'cabrillo' ? parseCabrilloRecords(text) : format === 'edi' ? parseEdiRecords(text) : format === 'csv' ? parseCsvRecords(text) : parseAdifRecords(text);
  const qsos = [], errors = [];
  const station = defaults.station || parsed.header.CALLSIGN || parsed.header.PCALL || parsed.header.STATION_CALLSIGN || '';
  // Relatório do LoTW (lotwreport.adi): QSL_RCVD significa confirmação pelo LoTW, não QSL em papel.
  // Inbox do eQSL: todos os registros são confirmações eQSL.
  const program = String(parsed.header.PROGRAMID || ''), preamble = format === 'adif' ? String(text).slice(0, 400) : '';
  const origin = /^lotw$/i.test(program) || /Logbook of the World/i.test(preamble) ? 'lotw' : /eqsl/i.test(program) || /eQSL\.cc/i.test(preamble) ? 'eqsl' : '';
  parsed.records.forEach((rec, k) => {
    const q = normalizeRecord(rec, { ...defaults, station });
    if (!q) { errors.push({ index: k + 1, call: rec.CALL || '', reason: !rec.CALL ? 'noCall' : 'badDate' }); return; }
    if (origin === 'lotw') { if (q.qslRcvd === 'Y') q.lotwRcvd = 'Y'; q.qslRcvd = ''; q.lotwSent = 'Y'; }
    if (origin === 'eqsl') { q.eqslRcvd = 'Y'; q.qslRcvd = ''; }
    qsos.push(q);
  });
  return { format, origin, header: parsed.header, qsos, errors, total: parsed.records.length };
}
