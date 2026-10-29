// Tabela de bandas ADIF, normalização de modos e utilitários de frequência.
export const BANDS = [
  ['2190m', 0.1357, 0.1378], ['630m', 0.472, 0.479], ['560m', 0.501, 0.504], ['160m', 1.8, 2.0], ['80m', 3.5, 4.0],
  ['60m', 5.06, 5.45], ['40m', 7.0, 7.3], ['30m', 10.1, 10.15], ['20m', 14.0, 14.35], ['17m', 18.068, 18.168],
  ['15m', 21.0, 21.45], ['12m', 24.89, 24.99], ['11m', 26.965, 27.405], ['10m', 28.0, 29.7], ['8m', 40, 45], ['6m', 50, 54],
  ['5m', 54.000001, 69.9], ['4m', 70, 71], ['2m', 144, 148], ['1.25m', 222, 225], ['70cm', 420, 450], ['33cm', 902, 928],
  ['23cm', 1240, 1300], ['13cm', 2300, 2450], ['9cm', 3300, 3500], ['6cm', 5650, 5925], ['3cm', 10000, 10500],
  ['1.25cm', 24000, 24250], ['6mm', 47000, 47200], ['4mm', 75500, 81000], ['2.5mm', 119980, 123000], ['2mm', 134000, 149000],
  ['1mm', 241000, 250000], ['submm', 300000, 7500000],
];
export const BAND_ORDER = BANDS.map(b => b[0]);

export function bandFromFreq(mhz) {
  const f = Number(mhz);
  if (!Number.isFinite(f) || f <= 0) return '';
  for (const [name, lo, hi] of BANDS) if (f >= lo && f <= hi) return name;
  return '';
}

// Cabrillo usa kHz e códigos especiais para VHF+.
export function bandFromCabrillo(value) {
  const v = String(value || '').trim().toUpperCase();
  const special = { '50': '6m', '70': '4m', '144': '2m', '222': '1.25m', '432': '70cm', '902': '33cm', '1.2G': '23cm', '2.3G': '13cm', '3.4G': '9cm', '5.7G': '6cm', '10G': '3cm', '24G': '1.25cm', '47G': '6mm', '75G': '4mm', LIGHT: 'submm' };
  if (special[v]) return { band: special[v], freq: null };
  const khz = Number(v);
  if (Number.isFinite(khz) && khz > 0) return { band: bandFromFreq(khz / 1000), freq: khz / 1000 };
  return { band: '', freq: null };
}

export function normalizeBand(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (BAND_ORDER.includes(v)) return v;
  const m = v.match(/^(\d+(?:\.\d+)?)\s*(m|cm|mm)$/);
  if (m) { const name = m[1] + m[2]; if (BAND_ORDER.includes(name)) return name; }
  return v;
}

export function bandRank(band) {
  const i = BAND_ORDER.indexOf(band);
  return i < 0 ? 999 : i;
}

export const sortBands = list => [...list].sort((a, b) => bandRank(a) - bandRank(b) || String(a).localeCompare(String(b)));

const DIGITAL = new Set(['FT8', 'FT4', 'RTTY', 'PSK', 'PSK31', 'PSK63', 'JT65', 'JT9', 'JT4', 'MSK144', 'Q65', 'FST4', 'FST4W', 'WSPR', 'OLIVIA', 'CONTESTI', 'HELL', 'MFSK', 'JS8', 'DOMINO', 'THOR', 'THROB', 'PACKET', 'PKT', 'SSTV', 'VARA', 'ARDOP', 'PAC', 'PAX', 'MT63', 'FSK441', 'ISCAT', 'JTMS', 'FSK', 'DATA', 'DIG', 'DIGI', 'PSK125', 'BPSK31', 'QPSK31', 'CW-R', 'DSTAR', 'DMR', 'C4FM', 'FREEDV', 'M17', 'APRS']);
const PHONE = new Set(['SSB', 'USB', 'LSB', 'AM', 'FM', 'PH', 'PHONE', 'DIGITALVOICE', 'DV']);
const VOICE_DIGITAL = new Set(['DSTAR', 'DMR', 'C4FM', 'FREEDV', 'M17', 'DIGITALVOICE', 'DV']);

// Converte variações de modos/submodos em um nome canônico.
export function normalizeMode(mode, submode) {
  const m = String(mode || '').trim().toUpperCase();
  const s = String(submode || '').trim().toUpperCase();
  if (m === 'MFSK' && ['FT4', 'JS8', 'Q65', 'FST4', 'FST4W'].includes(s)) return s;
  if (m === 'SSB' && (s === 'USB' || s === 'LSB')) return 'SSB';
  if (m === 'PSK' && s) return s;
  if (m === 'USB' || m === 'LSB' || m === 'PH' || m === 'PHONE') return 'SSB';
  if (m === 'RY' || m === 'RTTY') return 'RTTY';
  if (m === 'DG') return 'DATA';
  if (m === 'CW-R') return 'CW';
  return m;
}

export function modeGroup(mode) {
  const m = String(mode || '').toUpperCase();
  if (m === 'CW') return 'CW';
  if (VOICE_DIGITAL.has(m)) return 'PHONE';
  if (PHONE.has(m)) return 'PHONE';
  if (DIGITAL.has(m) || /^(PSK|JT|FT|MFSK|OLIVIA|Q65)/.test(m)) return 'DIGI';
  return m ? 'DIGI' : '';
}
