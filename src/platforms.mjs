// Integração com plataformas online que fornecem o log em ADIF: QRZ.com Logbook, LoTW, eQSL e Club Log.
// Este módulo apenas monta requisições e interpreta respostas; o transporte é feito pelo processo principal.
export const PLATFORMS = {
  qrz: { name: 'QRZ.com Logbook', fields: ['apiKey', 'since'], url: 'https://logbook.qrz.com/api', help: 'qrzHelp' },
  lotw: { name: 'ARRL LoTW', fields: ['username', 'password', 'since', 'tqslLocation'], url: 'https://lotw.arrl.org/lotwuser/lotwreport.adi', help: 'lotwHelp' },
  eqsl: { name: 'eQSL.cc', fields: ['username', 'password', 'qthNickname', 'since'], url: 'https://www.eqsl.cc/qslcard/DownloadInBox.cfm', help: 'eqslHelp' },
  clublog: { name: 'Club Log', fields: ['email', 'password', 'callsign', 'apiKey', 'since'], url: 'https://clublog.org/getadif.php', help: 'clublogHelp' },
};

// Data inicial padrão das consultas (pode ser alterada no cartão de cada plataforma).
export const DEFAULT_SINCE = '1980-01-01';
export const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
const since = creds => (validDate(creds.since) ? creds.since : DEFAULT_SINCE);
// Campos de credencial (o "since" e a localização do TQSL não são segredos obrigatórios).
export const OPTIONAL_FIELDS = new Set(['since', 'qthNickname', 'tqslLocation']);

const form = obj => Object.entries(obj).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

export function buildRequest(kind, creds = {}, state = {}) {
  if (kind === 'qrz') {
    const option = ['MAX:2000', 'AFTERLOGID:' + (state.afterLogId || 0)].join(',');
    return { url: PLATFORMS.qrz.url, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ KEY: creds.apiKey, ACTION: 'FETCH', OPTION: option }) };
  }
  if (kind === 'lotw') {
    // Sem data, o LoTW devolve só o que chegou desde o último download: sempre envia a data inicial.
    const q = { login: creds.username, password: creds.password, qso_query: 1, qso_qsl: 'no', qso_qsldetail: 'yes', qso_mydetail: 'yes', qso_withown: 'yes', qso_qsorxsince: since(creds) };
    return { url: PLATFORMS.lotw.url + '?' + form(q), method: 'GET' };
  }
  if (kind === 'eqsl') {
    if (state.next) return { url: state.next, method: 'GET' };
    return { url: PLATFORMS.eqsl.url + '?' + form({ UserName: creds.username, Password: creds.password, QTHNickname: creds.qthNickname, RcvdSince: since(creds).replace(/-/g, '') + '0000' }), method: 'GET' };
  }
  if (kind === 'clublog') {
    return { url: PLATFORMS.clublog.url, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ email: creds.email, password: creds.password, call: creds.callsign, api: creds.apiKey }) };
  }
  throw new Error('UNKNOWN_PLATFORM');
}

// Trecho legível de uma resposta inesperada (HTML vira texto), sem dados sensíveis da URL.
export const snippet = body => String(body || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);

const decodeEntities = s => s.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&amp;/gi, '&');

// Retorna { adif, done, state } ou { error }.
export function parseResponse(kind, text, state = {}) {
  const body = String(text || '');
  if (kind === 'qrz') {
    const result = (body.match(/(?:^|&)RESULT=([A-Z]+)/) || [])[1];
    if (result === 'FAIL' || result === 'AUTH') {
      const reason = decodeURIComponent(((body.match(/(?:^|&)REASON=([^&]*)/) || [])[1] || '').replace(/\+/g, ' '));
      if (/no log entries|count:? ?0/i.test(reason)) return { adif: '', done: true, state };
      return { error: reason || result };
    }
    const count = Number((body.match(/(?:^|&)COUNT=(\d+)/) || [])[1] || 0);
    const idx = body.indexOf('ADIF=');
    const adif = idx >= 0 ? decodeEntities(body.slice(idx + 5)) : '';
    const ids = [...adif.matchAll(/<app_qrzlog_logid:\d+>(\d+)/gi)].map(m => Number(m[1]));
    const last = ids.length ? Math.max(...ids) : state.afterLogId || 0;
    return { adif, done: count < 2000 || !ids.length, state: { ...state, afterLogId: last + 1 }, count };
  }
  if (kind === 'lotw') {
    if (!/<eoh>/i.test(body)) {
      if (/password|incorrect|login/i.test(body) && !/request limit/i.test(body)) return { error: 'AUTH' };
      if (/request limit|too many|try again later|busy|temporarily/i.test(body)) return { error: 'RATE_LIMIT', detail: snippet(body) };
      return { error: 'INVALID_RESPONSE', detail: snippet(body) };
    }
    return { adif: body, done: true, state };
  }
  if (kind === 'eqsl') {
    if (state.next) return /<eoh>|<eor>/i.test(body) ? { adif: body, done: true, state } : { error: 'INVALID_RESPONSE' };
    const err = body.match(/Error:\s*([^<\n]+)/i);
    if (err) return { error: err[1].trim() };
    const link = body.match(/HREF="([^"]+\.adi)"/i);
    if (!link) return { error: /no such username|password/i.test(body) ? 'AUTH' : 'INVALID_RESPONSE' };
    const next = new URL(link[1], 'https://www.eqsl.cc/qslcard/').href;
    return { adif: '', done: false, state: { ...state, next } };
  }
  if (kind === 'clublog') {
    if (!/<eor>/i.test(body) && !/<eoh>/i.test(body)) return { error: body.trim().slice(0, 200) || 'INVALID_RESPONSE' };
    return { adif: body, done: true, state };
  }
  return { error: 'UNKNOWN_PLATFORM' };
}

// ---------- Envio de contatos às plataformas ----------
export const SENT = {
  qrz: q => q.extra?.QRZCOM_QSO_UPLOAD_STATUS === 'Y',
  lotw: q => q.lotwSent === 'Y',
  eqsl: q => q.eqslSent === 'Y',
  clublog: q => q.extra?.CLUBLOG_QSO_UPLOAD_STATUS === 'Y',
};

export function markSent(kind, q, date = new Date()) {
  const d = date.toISOString().slice(0, 10).replace(/-/g, '');
  q.extra ||= {};
  if (kind === 'qrz') { q.extra.QRZCOM_QSO_UPLOAD_STATUS = 'Y'; q.extra.QRZCOM_QSO_UPLOAD_DATE = d; }
  if (kind === 'clublog') { q.extra.CLUBLOG_QSO_UPLOAD_STATUS = 'Y'; q.extra.CLUBLOG_QSO_UPLOAD_DATE = d; }
  if (kind === 'lotw') { q.lotwSent = 'Y'; q.extra.LOTW_QSLSDATE = d; }
  if (kind === 'eqsl') { q.eqslSent = 'Y'; q.extra.EQSL_QSLSDATE = d; }
}

// QRZ.com: um contato por requisição (ACTION=INSERT).
export function buildQrzInsert(creds, adifRecord) {
  return { url: PLATFORMS.qrz.url, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ KEY: creds.apiKey, ACTION: 'INSERT', ADIF: adifRecord }) };
}
export function parseQrzInsert(text) {
  const body = String(text || ''), result = (body.match(/(?:^|&)RESULT=([A-Z]+)/) || [])[1];
  const reason = decodeURIComponent(((body.match(/(?:^|&)REASON=([^&]*)/) || [])[1] || '').replace(/\+/g, ' '));
  if (result === 'OK' || result === 'REPLACE') return { ok: true };
  if (/duplicate/i.test(reason)) return { ok: true, duplicate: true };
  if (result === 'AUTH' || /invalid api key|not authorized|subscription/i.test(reason)) return { ok: false, fatal: true, error: reason || 'AUTH' };
  return { ok: false, error: reason || snippet(body) || 'INVALID_RESPONSE' };
}

// eQSL: lote de registros num ADIF com usuário/senha no cabeçalho.
export function buildEqslUpload(creds, adifRecords) {
  const field = (n, v) => `<${n}:${[...String(v)].length}>${v}`;
  const head = `PT2VHF QSL Manager${field('ADIF_VER', '3.1.4')}${field('EQSL_USER', creds.username)}${field('EQSL_PSWD', creds.password)}${creds.qthNickname ? field('APP_EQSL_QTH_NICKNAME', creds.qthNickname) : ''}<EOH>`;
  return { url: 'https://www.eqsl.cc/qslcard/ImportADIF.cfm', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ ADIFData: head + adifRecords.join('') }) };
}
export function parseEqslUpload(text, sent) {
  const body = snippet(text);
  const m = body.match(/Result:\s*(\d+)\s+out of\s+(\d+)/i);
  if (/Error:\s*(No match on|Bad password|Unknown user|Missing)/i.test(body)) return { ok: false, fatal: true, error: body };
  if (m) return { ok: true, added: Number(m[1]), total: Number(m[2]), duplicates: Math.max(0, Number(m[2]) - Number(m[1])) };
  if (/duplicate/i.test(body)) return { ok: true, added: 0, total: sent, duplicates: sent };
  return { ok: false, error: body || 'INVALID_RESPONSE' };
}

// Club Log: envio do arquivo inteiro (putlogs).
export function buildClublogUpload(creds, adif) {
  return { url: 'https://clublog.org/putlogs.php', method: 'POST', form: { fields: { email: creds.email, password: creds.password, callsign: creds.callsign, api: creds.apiKey, clear: 0 }, file: { field: 'file', name: 'qsl-manager.adi', content: adif } } };
}
export function parseClublogUpload(status, text) {
  if (status === 200) return { ok: true };
  return { ok: false, fatal: status === 403, error: `HTTP ${status}: ${snippet(text)}` };
}

export function validateCreds(kind, creds = {}) {
  const required = { qrz: ['apiKey'], lotw: ['username', 'password'], eqsl: ['username', 'password'], clublog: ['email', 'password', 'callsign', 'apiKey'] }[kind] || [];
  return required.filter(f => !String(creds[f] || '').trim());
}
