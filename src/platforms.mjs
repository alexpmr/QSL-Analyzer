// Integração com plataformas online que fornecem o log em ADIF: QRZ.com Logbook, LoTW, eQSL e Club Log.
// Este módulo apenas monta requisições e interpreta respostas; o transporte é feito pelo processo principal.
export const PLATFORMS = {
  qrz: { name: 'QRZ.com Logbook', fields: ['apiKey'], url: 'https://logbook.qrz.com/api', help: 'qrzHelp' },
  lotw: { name: 'ARRL LoTW', fields: ['username', 'password', 'since'], url: 'https://lotw.arrl.org/lotwuser/lotwreport.adi', help: 'lotwHelp' },
  eqsl: { name: 'eQSL.cc (Inbox)', fields: ['username', 'password', 'qthNickname'], url: 'https://www.eqsl.cc/qslcard/DownloadInBox.cfm', help: 'eqslHelp' },
  clublog: { name: 'Club Log', fields: ['email', 'password', 'callsign', 'apiKey'], url: 'https://clublog.org/getadif.php', help: 'clublogHelp' },
};

const form = obj => Object.entries(obj).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

export function buildRequest(kind, creds = {}, state = {}) {
  if (kind === 'qrz') {
    const option = ['MAX:2000', 'AFTERLOGID:' + (state.afterLogId || 0)].join(',');
    return { url: PLATFORMS.qrz.url, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ KEY: creds.apiKey, ACTION: 'FETCH', OPTION: option }) };
  }
  if (kind === 'lotw') {
    const q = { login: creds.username, password: creds.password, qso_query: 1, qso_qsl: 'no', qso_qsldetail: 'yes', qso_mydetail: 'yes', qso_withown: 'yes', qso_qsorxsince: creds.since || undefined };
    return { url: PLATFORMS.lotw.url + '?' + form(q), method: 'GET' };
  }
  if (kind === 'eqsl') {
    if (state.next) return { url: state.next, method: 'GET' };
    return { url: PLATFORMS.eqsl.url + '?' + form({ UserName: creds.username, Password: creds.password, QTHNickname: creds.qthNickname }), method: 'GET' };
  }
  if (kind === 'clublog') {
    return { url: PLATFORMS.clublog.url, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ email: creds.email, password: creds.password, call: creds.callsign, api: creds.apiKey }) };
  }
  throw new Error('UNKNOWN_PLATFORM');
}

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
    if (!/<eoh>/i.test(body)) return { error: /password|incorrect/i.test(body) ? 'AUTH' : 'INVALID_RESPONSE' };
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

export function validateCreds(kind, creds = {}) {
  const required = { qrz: ['apiKey'], lotw: ['username', 'password'], eqsl: ['username', 'password'], clublog: ['email', 'password', 'callsign', 'apiKey'] }[kind] || [];
  return required.filter(f => !String(creds[f] || '').trim());
}
