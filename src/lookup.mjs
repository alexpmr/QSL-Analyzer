// Consulta de dados da estação no QRZ.com (API XML oficial) e no HamQTH.com.
// Este módulo só monta URLs e interpreta respostas; o transporte é feito pelo processo principal.
const AGENT = 'PT2VHF-QSL-Manager';
const enc = encodeURIComponent;

export const QRZ_XML = 'https://xmldata.qrz.com/xml/current/';
export const HAMQTH_XML = 'https://www.hamqth.com/xml.php';

export const qrzLoginUrl = (user, pass) => `${QRZ_XML}?username=${enc(user)};password=${enc(pass)};agent=${AGENT}`;
export const qrzLookupUrl = (key, call) => `${QRZ_XML}?s=${enc(key)};callsign=${enc(call)}`;
export const hamqthLoginUrl = (user, pass) => `${HAMQTH_XML}?u=${enc(user)}&p=${enc(pass)}`;
export const hamqthLookupUrl = (id, call) => `${HAMQTH_XML}?id=${enc(id)}&callsign=${enc(call)}&prg=${AGENT}`;

const unxml = s => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').trim();
const block = (xml, tag) => (String(xml).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')) || [])[1] || '';
const fields = xml => { const out = {}; for (const m of String(xml).matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) out[m[1].toLowerCase()] = unxml(m[2]); return out; };
const num = v => (v === '' || v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v));
const yes = v => /^(y|1|yes)$/i.test(String(v || ''));

export function parseQrz(xml) {
  const session = fields(block(xml, 'Session'));
  const data = block(xml, 'Callsign');
  const limited = /non-?subscriber/i.test(session.subexp || '');
  if (!data) {
    const err = session.error || '';
    return { key: session.key || null, error: err || (session.key ? '' : 'INVALID_RESPONSE'), notFound: /not found/i.test(err), limited };
  }
  const f = fields(data);
  const name = [f.fname, f.name].filter(Boolean).join(' ');
  return {
    key: session.key || null, limited, error: '',
    data: {
      source: 'QRZ.com', call: (f.call || '').toUpperCase(), name: f.name_fmt || name, nickname: f.nickname || '',
      addr: [f.addr1, f.addr2, f.state, f.zip].filter(Boolean).join(', '), qth: f.addr2 || '', state: f.state || '', country: f.country || f.land || '',
      grid: f.grid || '', lat: num(f.lat), lon: num(f.lon), cqz: num(f.cqzone), ituz: num(f.ituzone), iota: f.iota || '', licenseClass: f.class || '',
      email: f.email || '', image: f.image || '', lotw: yes(f.lotw), eqsl: yes(f.eqsl), paper: yes(f.mqsl), web: f.url || '', bio: f.bio ? true : false,
      page: `https://www.qrz.com/db/${encodeURIComponent((f.call || '').toUpperCase())}`, limited,
    },
  };
}

export function parseHamqth(xml) {
  const session = fields(block(xml, 'session'));
  if (session.session_id && !block(xml, 'search')) return { key: session.session_id, error: '' };
  if (session.error) return { key: null, error: session.error, notFound: /not found/i.test(session.error) };
  const f = fields(block(xml, 'search'));
  if (!f.callsign) return { key: null, error: 'INVALID_RESPONSE' };
  return {
    key: null, error: '',
    data: {
      source: 'HamQTH.com', call: f.callsign.toUpperCase(), name: f.adr_name || f.nick || '', nickname: f.nick || '',
      addr: [f.adr_street1, f.adr_city, f.adr_zip, f.us_state].filter(Boolean).join(', '), qth: f.qth || f.adr_city || '', state: f.us_state || '', country: f.country || f.adr_country || '',
      grid: f.grid || '', lat: num(f.latitude), lon: num(f.longitude), cqz: num(f.cq), ituz: num(f.itu), iota: f.iota || '', licenseClass: '',
      email: f.email || '', image: f.picture || '', lotw: yes(f.lotw), eqsl: yes(f.eqsl), paper: yes(f.qsl) || yes(f.qsldirect), web: f.web || '',
      page: `https://www.hamqth.com/${encodeURIComponent(f.callsign.toUpperCase())}`, limited: false,
    },
  };
}

// Hosts que o processo principal aceita consultar para a ficha da estação (dados e foto).
export const LOOKUP_HOST = host => /(^|\.)qrz\.com$/i.test(host) || /(^|\.)hamqth\.com$/i.test(host) || /(^|\.)qrzcq\.com$/i.test(host);
