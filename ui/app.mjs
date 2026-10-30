import { parseCty, attachDxcc, lookup } from '../src/cty.mjs';
import { parseLog, detectFormat, normalizeRecord } from '../src/parsers.mjs';
import * as DB from '../src/db.mjs';
import * as S from '../src/stats.mjs';
import { sortBands, bandFromFreq } from '../src/bands.mjs';
import { gridToLatLon, gridValid } from '../src/geo.mjs';
import { toAdif, toAdifRecord, toCsv, toCabrillo, toKml, toCsvRows } from '../src/export.mjs';
import { PLATFORMS, buildRequest, parseResponse, validateCreds, DEFAULT_SINCE, OPTIONAL_FIELDS, validDate, SENT, markSent, buildQrzInsert, parseQrzInsert, buildEqslUpload, parseEqslUpload, buildClublogUpload, parseClublogUpload } from '../src/platforms.mjs';
import { LANGUAGES, translate } from '../src/i18n.mjs';
import { APP_VERSION } from '../src/version.mjs';
import { backend, isDesktop } from './backend.mjs';
import { setPalette, loadLand, bars, worldMap, stacked, table, tile, esc, entityLink } from './charts.mjs';
import { STAT_PAGES, QSL_PAGES, ALL_SECTIONS, sectionById, defaultParams, fmtDate, fmtDateTime, fmtDur } from './pages.mjs';
import { renderEntity, ENTITY_FILTER } from './entity.mjs';
import { buildBackup, readBackup, sealSecrets, openSecrets, b64, unb64 } from './backup.mjs';
import { summaryFacts, logHealth } from '../src/insights.mjs';
import { currentEntities } from '../src/awards.mjs';
import { qrzLoginUrl, qrzLookupUrl, parseQrz, hamqthLoginUrl, hamqthLookupUrl, parseHamqth } from '../src/lookup.mjs';

const $ = s => document.querySelector(s);
const view = $('#view');
let db = DB.emptyDb(), cty = null, info = {}, saveTimer = null, lastResult = null;
const ui = { group: 'dashboard', page: 'dashboard', filter: {}, params: {}, tabs: {}, entityStack: [], importPreview: null, importReport: null, searchText: '', reportPreview: '', busy: false };

const t = (key, vars) => translate(db.prefs.language, key, vars);

// ---------- Navegação ----------
const NAV = [
  { id: 'dashboard', pages: ['dashboard'] },
  { id: 'logs', pages: ['contacts', 'import', 'platforms', 'exportlogs', 'modify', 'health', 'search', 'backup'] },
  { id: 'stats', pages: STAT_PAGES.map(p => p.id) },
  { id: 'qsl', pages: QSL_PAGES.map(p => p.id) },
  { id: 'reports', pages: ['report', 'compare'] },
  { id: 'settings', pages: ['preferences', 'database', 'scratchpad', 'activitylog', 'bug'] },
  { id: 'help', pages: ['help'] },
  { id: 'about', pages: ['about'] },
];

function renderHeader() {
  $('#appVersion').textContent = 'v' + (info.version || APP_VERSION);
  $('#subtitle').textContent = t('subtitle');
  $('#dbPill').textContent = t('dbPill', { n: db.qsos.length.toLocaleString(), s: DB.stations(db).length });
  const st = DB.stations(db).filter(s => s.station);
  if (db.prefs.activeStation && !st.some(s => s.station === db.prefs.activeStation)) db.prefs.activeStation = '';
  $('#stationSwitch').innerHTML = st.length > 1
    ? `<select id="activeStation" class="stationSelect" title="${esc(t('activeStation'))}"><option value="">${esc(t('allStations'))}</option>${options(st.map(s => s.station), db.prefs.activeStation || '')}</select>`
    : st.length ? `<span class="pill stationOne" title="${esc(t('activeStation'))}">${esc(st[0].station)}</span>` : '';
  $('#themeButton').textContent = db.prefs.theme === 'light' ? '☾ ' + t('dark') : '☀ ' + t('light');
  const lang = LANGUAGES.find(l => l.code === db.prefs.language) || LANGUAGES[0];
  $('#languageFlag').src = `flags/${lang.flag}.svg`;
  $('#currentLanguage').textContent = lang.name;
  $('#languages').innerHTML = LANGUAGES.map(l => `<button data-lang="${l.code}" aria-pressed="${l.code === lang.code}"><img src="flags/${l.flag}.svg" alt="">${esc(l.name)}</button>`).join('');
  $('#mainNav').innerHTML = NAV.map(g => `<button data-group="${g.id}" class="${g.id === ui.group ? 'selected' : ''}">${esc(t('nav_' + g.id))}${g.pages.length > 1 ? ' ▾' : ''}</button>`).join('');
  const group = NAV.find(g => g.id === ui.group);
  const sub = $('#subNav');
  if (group.pages.length > 1) {
    sub.classList.remove('hidden');
    sub.innerHTML = `<small>${esc(t('nav_' + group.id))}</small>` + group.pages.map((p, i) => `<button data-page="${p}" class="${p === ui.page ? 'selected' : ''}">${esc(t('page_' + p))}</button>`).join('');
  } else { sub.classList.add('hidden'); sub.innerHTML = ''; }
  document.documentElement.dataset.theme = db.prefs.theme;
  document.documentElement.lang = db.prefs.language;
  setPalette(db.prefs.palette, db.prefs.theme);
  document.title = 'PT2VHF QSL Manager v' + (info.version || APP_VERSION);
}

function go(group, page) {
  ui.group = group;
  ui.page = page || NAV.find(g => g.id === group).pages[0];
  lastResult = null;
  render();
  view.scrollTop = 0;
  window.scrollTo(0, 0);
}

// ---------- Persistência ----------
function persist(immediate = false) {
  clearTimeout(saveTimer);
  const job = async () => { try { await backend.saveDb(JSON.stringify(db)); } catch (e) { toast(t('saveError') + ': ' + e.message, true); } };
  if (immediate) return job();
  saveTimer = setTimeout(job, 300);
}

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message; el.className = error ? 'error' : '';
  el.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.style.display = 'none'), 4200);
}

// ---------- Utilidades de filtro ----------
const options = (list, selected, labelFn = v => v) => list.map(v => `<option value="${esc(v)}"${String(selected) === String(v) ? ' selected' : ''}>${esc(labelFn(v))}</option>`).join('');
const homePosition = () => gridToLatLon(db.prefs.myGrid) || null;
const pointsFor = () => S.pointsFn(db.prefs.pointsRule, cty, db.prefs.myCall);

// Indicativo ativo escolhido no cabeçalho: restringe todas as análises a essa estação.
function filteredQsos(filter = ui.filter) {
  const active = db.prefs.activeStation;
  return S.byTime(DB.applyFilter(db.qsos, active && !filter.stations?.length ? { ...filter, stations: [active] } : filter));
}

function filterValues() {
  const scope = db.qsos;
  return {
    stations: [...S.distinct(scope, q => q.station || '')].sort(), bands: sortBands([...S.distinct(scope, q => q.band)]), modes: [...S.distinct(scope, q => q.mode)].sort(),
    operators: [...S.distinct(scope, q => q.operator || '')].sort(), conts: [...S.distinct(scope, q => q.cont)].sort(),
  };
}

function filterBar() {
  const v = filterValues(), f = ui.filter, one = k => (f[k] && f[k][0]) ?? '';
  const sel = (key, list, label, fmt = x => x || '—') => `<label><span>${esc(t(label))}</span><select data-filter="${key}"><option value="">${esc(t('all'))}</option>${options(list, one(key), fmt)}</select></label>`;
  const active = Object.values(f).some(x => (Array.isArray(x) ? x.length : x));
  const count = Object.values(f).filter(x => (Array.isArray(x) ? x.length : x)).length;
  return `<details class="filterBox"${ui.filtersOpen ? ' open' : ''}><summary><span>${esc(t('filters'))}${count ? ` <b>${count}</b>` : ''}</span>${active ? `<span class="chips inline">${filterChips()}</span>` : `<small class="biHint">${esc(t('biHint'))}</small>`}</summary><form id="filterBar" class="filterBar">
    ${sel('stations', v.stations, 'station')}${sel('bands', v.bands, 'band')}${sel('modes', v.modes, 'mode')}${sel('operators', v.operators, 'operator')}${sel('conts', v.conts, 'cont')}
    <label><span>${esc(t('from'))}</span><input type="date" data-filter="from" value="${esc(f.from || '')}"></label><label><span>${esc(t('to'))}</span><input type="date" data-filter="to" value="${esc(f.to || '')}"></label>
    <label><span>${esc(t('callWildcard'))}</span><input data-filter="call" value="${esc(f.call || '')}" placeholder="PY*"></label>
    <div class="filterActions"><button type="submit">${esc(t('apply'))}</button>${active ? `<button type="button" id="clearFilter">${esc(t('clearFilter'))}</button>` : ''}${ui.filterHistory?.length ? `<button type="button" id="undoFilter" title="${esc(t('undoFilter'))}">↶</button>` : ''}</div>
    <div class="savedFilters"><select id="savedFilterSel" title="${esc(t('savedFilters'))}"><option value="">${esc(t('savedFilters'))}…</option>${options(Object.keys(db.prefs.savedFilters || {}), '')}</select>${active ? `<button type="button" id="saveFilter" title="${esc(t('saveFilterHint'))}">☆ ${esc(t('saveFilter'))}</button>` : ''}${Object.keys(db.prefs.savedFilters || {}).length ? `<button type="button" id="deleteSavedFilter" title="${esc(t('deleteSavedFilter'))}">✕</button>` : ''}</div></form></details>`;
}

const BAR_KEYS = ['stations', 'bands', 'modes', 'operators', 'conts', 'from', 'to', 'call'];
function readFilterBar() {
  const f = Object.fromEntries(Object.entries(ui.filter).filter(([k]) => !BAR_KEYS.includes(k)));
  for (const el of document.querySelectorAll('[data-filter]')) {
    const k = el.dataset.filter, val = el.value.trim();
    if (!val) continue;
    f[k] = ['from', 'to', 'call'].includes(k) ? val : [val];
  }
  return f;
}

const FILTER_LABELS = { stations: 'station', bands: 'band', modes: 'mode', operators: 'operator', conts: 'cont', from: 'from', to: 'to', call: 'callWildcard', calls: 'call', countries: 'country', cqz: 'cqZones', ituz: 'ituZones', grids: 'locator', hours: 'hourUtc', weekdays: 'weekday', radios: 'opt_radio', range: 'period' };

function filterValueText(k, v) {
  if (k === 'range') return `${fmtDateTime(Number(v[0]))} → ${fmtDateTime(Number(v[1]))}`;
  if (k === 'weekdays') return v.map(x => t('weekdays').split(',')[Number(x)]).join(', ');
  if (k === 'hours') return v.map(x => String(x).padStart(2, '0') + 'h').join(', ');
  return Array.isArray(v) ? v.map(x => x || '—').join(', ') : v;
}

function filterChips() {
  return Object.entries(ui.filter).filter(([, v]) => v && (!Array.isArray(v) || v.length)).map(([k, v]) => `<button type="button" class="chip" data-unfilter="${esc(k)}">${esc(t(FILTER_LABELS[k] || k))}: ${esc(filterValueText(k, v))} <b>✕</b></button>`).join('');
}

function setFilter(next) {
  (ui.filterHistory ||= []).push(structuredClone(ui.filter));
  if (ui.filterHistory.length > 30) ui.filterHistory.shift();
  ui.filter = next;
  render();
}

// Clique em gráfico: aplica o valor clicado como filtro (detalhamento estilo BI).
function applyDrill(spec) {
  const next = structuredClone(ui.filter);
  const pad = n => String(n).padStart(2, '0');
  for (const part of spec.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i), value = part.slice(i + 1);
    if (key === 'year') { next.from = `${value}-01-01`; next.to = `${value}-12-31`; delete next.range; }
    else if (key === 'month') { const [y, m] = value.split('-').map(Number); next.from = `${y}-${pad(m)}-01`; next.to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); delete next.range; }
    else if (key === 'range') next.range = value.split('~').map(Number);
    else if (key === 'call') next.calls = [value];
    else next[key] = [value];
  }
  setFilter(next);
  toast(t('drilled', { f: filterSummary(next) }));
}

function filterSummary(filter = ui.filter) {
  const parts = [];
  for (const [k, v] of Object.entries(filter)) {
    if (!v || (Array.isArray(v) && !v.length)) continue;
    parts.push(`${t(FILTER_LABELS[k] || k)}: ${filterValueText(k, v)}`);
  }
  return parts.length ? parts.join(' · ') : t('noFilter');
}

function paramsBar(page, qsos = []) {
  if (!page.params.length) return '';
  const p = ui.params[page.id] ||= defaultParams(page);
  const label = o => (o === '' ? t('all') : t('opt_' + o) === 'opt_' + o ? String(o).replace('|', ' ') : t('opt_' + o));
  return `<form id="paramsBar" class="paramsBar">${page.params.map(def => {
    const val = p[def.id];
    if (def.type === 'select') return `<label><span>${esc(t(def.label))}</span><select data-param="${def.id}">${options(def.options || def.optionsFn(qsos), val, label)}</select></label>`;
    return `<label><span>${esc(t(def.label))}</span><input type="number" data-param="${def.id}" min="${def.min}" max="${def.max}" value="${esc(val)}"></label>`;
  }).join('')}<button type="submit">${esc(t('recalculate'))}</button></form>`;
}

function statContext(qsos, report = false) {
  return { t, qsos, prefs: db.prefs, cty, points: pointsFor(), home: homePosition(), report, now: Date.now() };
}

function resultToolbar() {
  return `<div class="resultToolbar"><button data-export="csv">CSV</button><button data-export="txt">TXT</button><button data-export="png">PNG</button><button data-export="pdf">PDF</button><button data-export="addreport">＋ ${esc(t('addToReport'))}</button></div>`;
}

function head(small, title, help) {
  return `<div class="pageHead"><div><small>${esc(t('nav_' + small))}</small><h1>${esc(t(title))}</h1></div></div>${help ? `<p class="help">${esc(t(help))}</p>` : ''}`;
}

// ---------- Páginas ----------
const PAGES = {};

// Frase traduzida com um atalho de ficha no lugar de um marcador.
const sentence = (key, vars, links = {}) => {
  let text = esc(t(key, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, links[k] ? `\u0001${k}\u0001` : v]))));
  for (const [k, [type, value, label]] of Object.entries(links)) text = text.replace(`\u0001${k}\u0001`, entityLink(type, value, label ?? value));
  return text;
};

function summaryHtml(all) {
  const f = summaryFacts(all, { home: homePosition(), totalEntities: currentEntities(cty).length });
  if (!f) return '';
  const parts = [sentence('sumIntro', { first: fmtDate(f.first), last: fmtDate(f.last), total: f.total.toLocaleString(), calls: f.calls.toLocaleString() })];
  if (f.topMode && f.topBand) parts.push(sentence('sumMode', { pct: f.topMode.pct, mode: f.topMode.mode, band: f.topBand.band }));
  if (f.bestMonth) parts.push(sentence('sumBestMonth', { month: f.bestMonth.month, count: f.bestMonth.count.toLocaleString() }));
  if (f.farthest) parts.push(sentence('sumFar', { call: f.farthest.call, country: f.farthest.country || '—', km: f.farthest.km.toLocaleString() }, { call: ['call', f.farthest.call], country: ['country', f.farthest.country, f.farthest.country] }));
  parts.push(sentence('sumDxcc', { dxcc: f.dxcc, missing: f.missingDxcc }));
  parts.push(sentence('sumConfirmed', { pct: f.confirmedPct }));
  if (f.recent30) parts.push(sentence('sumRecent', { n: f.recent30.toLocaleString(), newCalls: f.recentNewCalls.toLocaleString() }));
  return `<div class="summary"><small>${esc(t('yourActivity'))}</small><p>${parts.join(' ')}</p></div>`;
}

PAGES.dashboard = () => {
  if (!db.qsos.length) return `<section class="page wide"><div class="empty"><span>⌁</span><strong>${esc(t('emptyDbTitle'))}</strong><p>${esc(t('emptyDbBody'))}</p><button data-go="logs:import">${esc(t('page_import'))}</button> <button data-go="logs:platforms">${esc(t('page_platforms'))}</button></div></section>`;
  const all = filteredQsos();
  const b = S.basic(all, { pauseMin: db.prefs.pauseMinutes, points: pointsFor() }), q = S.qslStatus(all);
  const bandsData = S.groupCount(all, x => x.band), bandSorted = sortBands(bandsData.map(x => x[0])).map(k => [k, bandsData.find(x => x[0] === k)[1]]);
  const years = S.groupCount(all, S.DIMENSIONS.year).sort((a, b) => a[0].localeCompare(b[0]));
  const ent = new Map();
  for (const x of all) if (Number.isFinite(x.elat)) { const e = ent.get(x.country) || { lat: x.elat, lon: x.elon, value: 0, country: x.country }; e.value++; ent.set(x.country, e); }
  const stationRows = DB.stations(db).map(s => [s.station || '—', s.count, fmtDate(s.first), fmtDate(s.last)]);
  const recent = db.activity.slice(-8).reverse().map(a => [fmtDateTime(a.ts), t('act_' + a.type), a.detail]);
  return `<section class="page wide"><div class="pageHead"><div><small>${esc(t('overview'))}</small><h1>${esc(t('page_dashboard'))}</h1></div><span class="pill">${esc(fmtDate(b.first))} → ${esc(fmtDate(b.last))}</span></div>${filterBar()}
    ${all.length ? summaryHtml(all) : `<p class="notice">${esc(t('noQsosFilter'))}</p>`}
    <div class="tiles">${tile(t('qsos'), b.qsos.toLocaleString(), t('dupesN', { n: b.dupes }))}${tile(t('uniqueCalls'), b.uniqueCalls.toLocaleString())}${tile(t('dxccEntities'), b.dxcc, t('confirmedN', { n: q.dxccConfirmed }))}${tile(t('confirmedQsos'), q.any.toLocaleString(), b.qsos ? Math.round((q.any / b.qsos) * 100) + '%' : '')}${tile(t('cqZones'), b.cqz + ' / 40')}${tile(t('locators'), b.grids)}${tile(t('stationsCount'), b.stations)}${tile(t('operatingTime'), fmtDur(b.operatingMs))}</div>
    <div class="grid2">${bars(bandSorted, { title: t('qsosPerBand'), drill: 'bands' })}${bars(years, { title: t('qsosPerYear'), horizontal: false, colorIndex: 1, drill: 'year' })}</div>
    ${worldMap([...ent.values()].map(e => ({ ...e, label: `${e.country}: ${e.value}`, drill: 'countries=' + e.country })), { title: t('dxccMap'), home: homePosition() })}
    <div class="grid2"><div><h3>${esc(t('myStations'))}</h3>${table([t('station'), t('qsos'), t('firstQso'), t('lastQso')], stationRows, { numeric: [1], links: { 0: 'station' } })}</div><div><h3>${esc(t('recentActivity'))}</h3>${table([t('date'), t('event'), t('details')], recent)}</div></div></section>`;
};

// ---------- Importação (um passo, com popup de progresso) ----------
PAGES.import = () => {
  const rep = ui.importReport;
  return `<section class="page wide">${head('logs', 'page_import', 'importHelp')}
    <div id="dropZone" class="dropZone"><span>⇪</span><strong>${esc(t('dropFiles'))}</strong><p>${esc(t('supportedFormats'))}</p><button id="pickFiles" class="primary">${esc(t('selectFiles'))}</button></div>
    <details><summary>${esc(t('pasteLog'))}</summary><textarea id="pasteText" rows="8" placeholder="<CALL:5>K1ABC ... <EOR>"></textarea><button id="pasteImport">${esc(t('importPasted'))}</button></details>
    <details${ui.importOptionsOpen ? ' open' : ''} id="importOptions"><summary>${esc(t('importOptions'))}</summary><form id="importForm" class="fields">
      <label><span>${esc(t('defaultStation'))}</span><input name="station" maxlength="20" placeholder="${esc(db.prefs.myCall || 'PT2VHF')}" value="${esc(ui.importStation || '')}"></label>
      <label><span>${esc(t('defaultOperator'))}</span><input name="operator" maxlength="20"></label>
      <label><span>${esc(t('defaultMyGrid'))}</span><input name="myGrid" maxlength="8" placeholder="${esc(db.prefs.myGrid || 'GH64')}"></label>
      <label><span>${esc(t('formatOverride'))}</span><select name="format"><option value="">${esc(t('autoDetect'))}</option>${options(['adif', 'adx', 'cabrillo', 'edi', 'csv'], '', x => x.toUpperCase())}</select></label>
      <label class="check"><input type="checkbox" name="forceStation"> ${esc(t('forceStation'))}</label>
      <label class="check"><input type="checkbox" name="mergeQsl"${db.prefs.mergeQsl ? ' checked' : ''}> ${esc(t('mergeQsl'))}</label>
      <label class="check"><input type="checkbox" name="recalc"${db.prefs.recalcOnImport ? ' checked' : ''}> ${esc(t('recalcCountry'))}</label>
    </form></details>
    ${rep ? `<h2>${esc(t('importResult'))}</h2><div class="tiles">${tile(t('added'), rep.added)}${tile(t('skippedExisting'), rep.skipped)}${tile(t('qslUpdated'), rep.merged)}${tile(t('errors'), rep.errors)}</div><p><button data-go="dashboard">${esc(t('page_dashboard'))}</button> <button data-go="stats:basic">${esc(t('page_basic'))}</button></p>` : ''}</section>`;
};

function readImportForm() {
  const form = $('#importForm');
  const f = form ? new FormData(form) : new FormData();
  return { format: f.get('format') || null, station: String(f.get('station') || '').trim().toUpperCase(), operator: String(f.get('operator') || '').trim().toUpperCase(), myGrid: String(f.get('myGrid') || '').trim(), mergeQsl: form ? f.get('mergeQsl') === 'on' : db.prefs.mergeQsl, forceStation: f.get('forceStation') === 'on', recalc: form ? f.get('recalc') === 'on' : db.prefs.recalcOnImport };
}

const tick = () => new Promise(r => setTimeout(r, 0));

const progress = {
  open(title) {
    const d = $('#progressDialog');
    $('#progressTitle').textContent = title;
    $('#progressClose').classList.add('hidden'); $('#progressGo').classList.add('hidden');
    $('#progressClose').textContent = t('close'); $('#progressGo').textContent = t('page_dashboard');
    this.update({ done: 0, total: 0, added: 0, skipped: 0, merged: 0, errors: 0, label: '' });
    if (!d.open) d.showModal();
  },
  update({ done, total, added, skipped, merged, errors, label }) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('#progressBar').value = pct; $('#progressPct').textContent = total ? `${pct}%` : '';
    $('#progressLabel').textContent = label || '';
    $('#progressStats').innerHTML = [[t('processed'), total ? `${done.toLocaleString()} / ${total.toLocaleString()}` : '—'], [t('added'), added], [t('skippedExisting'), skipped], [t('qslUpdated'), merged], [t('errors'), errors]].map(([k, v]) => `<div><small>${esc(k)}</small><strong>${esc(typeof v === 'number' ? v.toLocaleString() : v)}</strong></div>`).join('');
  },
  finish(label) {
    $('#progressLabel').textContent = label;
    $('#progressBar').value = 100; $('#progressPct').textContent = '100%';
    $('#progressClose').classList.remove('hidden'); $('#progressGo').classList.remove('hidden');
  },
};

// Importa arquivos (ou texto colado) em lotes, atualizando o popup a cada lote.
async function importFiles(files, opts = readImportForm(), { title = t('importingTitle'), source = null, adjust = null, keep = null } = {}) {
  if (!files.length) return null;
  progress.open(title);
  const parsed = [], errors = [];
  for (const f of files) {
    progress.update({ done: 0, total: 0, added: 0, skipped: 0, merged: 0, errors: errors.length, label: t('readingFile', { f: f.name }) });
    await tick();
    try {
      const r = parseLog(f.text, f.name, { station: opts.forceStation ? '' : opts.station, operator: opts.operator, myGrid: opts.myGrid || db.prefs.myGrid }, opts.format);
      errors.push(...r.errors);
      parsed.push({ name: f.name, qsos: keep ? r.qsos.filter(keep) : r.qsos });
    } catch { errors.push({ index: f.name, call: '', reason: 'format' }); }
  }
  const total = parsed.reduce((s, p) => s + p.qsos.length, 0);
  const importer = DB.createImporter(db, 'main', { mergeQsl: opts.mergeQsl });
  let done = 0;
  for (const p of parsed) {
    for (let i = 0; i < p.qsos.length; i += 300) {
      const batch = p.qsos.slice(i, i + 300);
      for (const q of batch) {
        if (opts.forceStation && opts.station) q.station = opts.station;
        if (!q.station) q.station = opts.station || (db.prefs.myCall || '').toUpperCase();
        if (!q.operator) q.operator = q.station;
        if (adjust) adjust(q);
        DB.enrich(q, cty, { force: opts.recalc && !q.dxcc, myGrid: opts.myGrid || db.prefs.myGrid });
        q.src = source || p.name;
      }
      importer.add(batch, source || p.name);
      done += batch.length;
      progress.update({ done, total, ...importer.stats, errors: errors.length, label: t('importingFile', { f: p.name }) });
      await tick();
    }
  }
  const res = importer.finish(source || parsed.map(p => p.name).join(', '));
  DB.logActivity(db, 'upload', `${files.map(f => f.name).join(', ')} (${total})`);
  await persist(true);
  ui.importReport = { ...res, errors: errors.length };
  progress.finish(t('importFinished', { added: res.added, skipped: res.skipped }));
  renderHeader();
  if (ui.page === 'import' || ui.page === 'dashboard') render();
  return res;
}

// ---------- Contatos: lista, inserir, editar e apagar ----------
const PAGE_SIZE = 200;
const qslMarksOf = q => [q.qslRcvd === 'Y' ? 'P' : '', q.lotwRcvd === 'Y' ? 'L' : '', q.eqslRcvd === 'Y' ? 'E' : ''].join('');

PAGES.contacts = () => {
  const list = filteredQsos().reverse();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE)), page = Math.min(ui.contactsPage || 0, pages - 1);
  const rows = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(q => [fmtDateTime(q.ts), q.call, q.band, q.mode, q.freq ? q.freq.toFixed(3) : '', q.rstS, q.rstR, q.station, S.grid4(q), q.country, qslMarksOf(q), { html: `<button class="iconBtn" data-qso-edit="${q.id}" title="${esc(t('edit'))}">✎</button><button class="iconBtn danger" data-qso-delete="${q.id}" title="${esc(t('delete'))}">✕</button>` }]);
  const pager = pages > 1 ? `<div class="pager"><button data-contacts-page="${page - 1}"${page ? '' : ' disabled'}>‹</button><span>${esc(t('pageOf', { p: page + 1, n: pages }))}</span><button data-contacts-page="${page + 1}"${page < pages - 1 ? '' : ' disabled'}>›</button></div>` : '';
  return `<section class="page wide">${head('logs', 'page_contacts', 'contactsHelp')}${filterBar()}
    <div class="resultHead"><span class="pill">${esc(t('qsosInFilter', { n: list.length.toLocaleString() }))}</span><button class="primary" data-qso-new>＋ ${esc(t('newContact'))}</button></div>
    ${list.length ? table([t('date'), t('call'), t('band'), t('mode'), 'MHz', 'S', 'R', t('station'), t('locator'), t('country'), 'QSL', ''], rows, { links: { 1: 'call', 7: 'station', 8: 'grid', 9: 'country' }, max: PAGE_SIZE }) + pager : `<p class="notice">${esc(t('noQsosFilter'))}</p>`}
    <p class="help">${esc(t('qslMarksLegend'))}</p></section>`;
};

const QSO_FIELDS = [['call', 'CALL'], ['date', 'QSO_DATE'], ['time', 'TIME_ON'], ['band', 'BAND'], ['freq', 'FREQ'], ['mode', 'MODE'], ['submode', 'SUBMODE'], ['rstS', 'RST_SENT'], ['rstR', 'RST_RCVD'], ['station', 'STATION_CALLSIGN'], ['operator', 'OPERATOR'], ['myGrid', 'MY_GRIDSQUARE'], ['grid', 'GRIDSQUARE'], ['name', 'NAME'], ['qth', 'QTH'], ['comment', 'COMMENT'], ['contest', 'CONTEST_ID'], ['stx', 'STX_STRING'], ['srx', 'SRX_STRING']];
const QSL_FLAGS = [['qslSent', 'QSL_SENT'], ['qslRcvd', 'QSL_RCVD'], ['lotwSent', 'LOTW_QSL_SENT'], ['lotwRcvd', 'LOTW_QSL_RCVD'], ['eqslSent', 'EQSL_QSL_SENT'], ['eqslRcvd', 'EQSL_QSL_RCVD']];

function openQsoForm(id = null, presetCall = '') {
  const q = id ? db.qsos.find(x => x.id === id) : null;
  const now = new Date(), ts = q ? new Date(q.ts) : now;
  const v = {
    call: q?.call || presetCall, date: ts.toISOString().slice(0, 10), time: ts.toISOString().slice(11, 16), band: q?.band || '', freq: q?.freq ? String(q.freq) : '', mode: q?.mode || '', submode: q?.submode || '',
    rstS: q?.rstS || '', rstR: q?.rstR || '', station: q?.station || (db.prefs.myCall || '').toUpperCase(), operator: q?.operator || '', myGrid: q?.myGrid || db.prefs.myGrid || '', grid: q?.grid || '',
    name: q?.name || '', qth: q?.qth || '', comment: q?.comment || '', contest: q?.contest || '', stx: q?.stx || '', srx: q?.srx || '',
  };
  // Larguras (em caracteres) pelo tamanho usual de cada campo nos ADIFs.
  const QF_WIDTH = { call: 12, date: 16, time: 10, band: 8, freq: 11, mode: 9, submode: 9, rstS: 6, rstR: 6, station: 12, operator: 12, myGrid: 10, grid: 10, name: 30, qth: 38, contest: 16, stx: 8, srx: 8 };
  const input = (k, type = 'text', extra = '') => `<label style="--w:${QF_WIDTH[k] || 16}ch"><span>${esc(t('qf_' + k))}</span><input name="${k}" type="${type}" value="${esc(v[k])}" ${extra}></label>`;
  const flag = ([k]) => `<label class="check"><input type="checkbox" name="${k}"${q?.[k] === 'Y' ? ' checked' : ''}> ${esc(t('qf_' + k))}</label>`;
  const extra = Object.entries(q?.extra || {}).map(([k, val]) => `${k}=${val}`).join('\n');
  $('#qsoBody').innerHTML = `<form id="qsoForm" data-id="${id || ''}"><div class="dialogHead"><h2>${esc(t(q ? 'editContact' : 'newContact'))}</h2></div>
    <div class="fields qsoFields">${input('call', 'text', 'required maxlength="20" autofocus')}${input('date', 'date', 'required')}${input('time', 'time', 'required')}${input('band', 'text', 'list="bandList" maxlength="8"')}${input('freq', 'text', 'inputmode="decimal" placeholder="14.074"')}${input('mode', 'text', 'required list="modeList" maxlength="12"')}${input('submode')}${input('rstS')}${input('rstR')}${input('station', 'text', 'required maxlength="20"')}${input('operator')}${input('myGrid')}${input('grid')}${input('name')}${input('qth')}${input('contest')}${input('stx')}${input('srx')}</div>
    <div id="workedBefore" class="workedBefore"></div>
    <label><span>${esc(t('qf_comment'))}</span><input name="comment" value="${esc(v.comment)}"></label>
    <h3>QSL</h3><div class="qslFlags">${QSL_FLAGS.map(flag).join('')}</div>
    <details><summary>${esc(t('otherAdifFields'))}</summary><textarea name="extra" rows="5" placeholder="IOTA=SA-001&#10;SOTA_REF=PY/SP-001">${esc(extra)}</textarea></details>
    <datalist id="bandList">${['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '11m', '10m', '6m', '4m', '2m', '1.25m', '70cm', '23cm'].map(b => `<option value="${b}">`).join('')}</datalist>
    <datalist id="modeList">${['SSB', 'CW', 'FM', 'AM', 'FT8', 'FT4', 'RTTY', 'PSK31', 'JT65', 'MSK144', 'Q65', 'JS8', 'SSTV', 'DSTAR', 'DMR', 'C4FM'].map(m => `<option value="${m}">`).join('')}</datalist>
    <p id="qsoError" class="error"></p>
    <div class="dialogFoot">${q ? `<button type="button" class="dangerButton" data-qso-delete="${q.id}">${esc(t('delete'))}</button>` : ''}<button type="button" data-qso-cancel>${esc(t('cancel'))}</button><button type="submit" class="primary">${esc(t('save'))}</button></div></form>`;
  const dlg = $('#qsoDialog');
  $('#qsoForm').addEventListener('input', e => { if (['call', 'band', 'mode'].includes(e.target.name)) workedBefore(id); });
  workedBefore(id);
  if (!dlg.open) dlg.showModal();
}

// Indicador "já trabalhado" ao digitar o indicativo: contatos anteriores, bandas e se o slot banda/modo é novo.
function workedBefore(id) {
  const form = $('#qsoForm'), box = $('#workedBefore');
  if (!form || !box) return;
  const call = form.call.value.trim().toUpperCase(), band = form.band.value.trim().toLowerCase(), mode = form.mode.value.trim().toUpperCase();
  if (call.length < 3) { box.innerHTML = ''; return; }
  const list = db.qsos.filter(q => q.call === call && q.id !== id);
  if (!list.length) { box.innerHTML = `<span class="badge new">${esc(t('wbNew'))}</span>`; return; }
  const bands = sortBands([...new Set(list.map(q => q.band))]), last = list.reduce((a, b) => (b.ts > a.ts ? b : a));
  const slot = list.filter(q => (!band || q.band === band) && (!mode || q.mode === mode));
  const slotTxt = band || mode ? (slot.length ? (slot.some(DB.isConfirmed) ? t('wbSlotConfirmed') : t('wbSlotWorked')) : t('wbSlotNew')) : '';
  box.innerHTML = `<span class="badge">${esc(t('wbWorked', { n: list.length }))}</span> ${esc(bands.join(' '))} · ${esc(t('lastQso'))}: ${esc(fmtDate(last.ts))}${last.name ? ' · ' + esc(last.name) : ''}${list.some(DB.isConfirmed) ? ' · ✓ QSL' : ''}${slotTxt ? ` <span class="badge${slot.length ? '' : ' new'}">${esc(slotTxt)}</span>` : ''}`;
}

function saveQsoForm(form) {
  const f = Object.fromEntries(new FormData(form).entries()), id = Number(form.dataset.id) || null, err = $('#qsoError');
  const rec = {};
  for (const [k, adif] of QSO_FIELDS) if (String(f[k] ?? '').trim()) rec[adif] = String(f[k]).trim();
  rec.QSO_DATE = String(f.date || '').replace(/-/g, '');
  rec.TIME_ON = String(f.time || '').replace(/:/g, '').padEnd(4, '0');
  for (const [k, adif] of QSL_FLAGS) rec[adif] = f[k] === 'on' ? 'Y' : 'N';
  for (const line of String(f.extra || '').split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/); if (m) rec[m[1].toUpperCase()] = m[2].trim(); }
  const q = normalizeRecord(rec, { station: (f.station || '').toUpperCase() });
  if (!q) { err.textContent = t('qsoInvalid'); return; }
  if (q.freq && !q.band) q.band = bandFromFreq(q.freq);
  if (!q.band) { err.textContent = t('qsoNeedBand'); return; }
  if (q.freq && bandFromFreq(q.freq) && bandFromFreq(q.freq) !== q.band && !confirm(t('qsoBandMismatch', { b: q.band, f: bandFromFreq(q.freq) }))) return;
  for (const k of ['qslSent', 'qslRcvd', 'lotwSent', 'lotwRcvd', 'eqslSent', 'eqslRcvd']) if (q[k] === 'N') q[k] = '';
  const old = id ? db.qsos.find(x => x.id === id) : null;
  if (old && old.call === q.call) Object.assign(q, { country: old.country, dxcc: old.dxcc, cont: old.cont, cqz: old.cqz, ituz: old.ituz, pfx: old.pfx });
  DB.enrich(q, cty, { myGrid: db.prefs.myGrid });
  const dupe = db.qsos.find(x => x.id !== id && (DB.dedupeKey(x) === DB.dedupeKey(q) || DB.dedupeKey(x) === DB.dedupeKey(q, -1) || DB.dedupeKey(x) === DB.dedupeKey(q, 1)));
  if (dupe && !confirm(t('qsoDuplicate', { c: dupe.call, d: fmtDateTime(dupe.ts) }))) return;
  if (old) { Object.keys(old).forEach(k => { if (!['id', 'c', 'src', 'imported'].includes(k)) delete old[k]; }); Object.assign(old, q, { edited: Date.now() }); DB.logActivity(db, 'qso-edit', `${q.call} ${fmtDateTime(q.ts)}`); }
  else { db.qsos.push({ ...q, id: db.nextId++, c: 'main', src: 'manual', imported: Date.now() }); DB.logActivity(db, 'qso-new', `${q.call} ${fmtDateTime(q.ts)}`); }
  persist();
  $('#qsoDialog').close();
  toast(t('contactSaved', { c: q.call }));
  render();
  if ($('#entityDialog').open && ui.entityStack.length) { const top = ui.entityStack.pop(); openEntity(top.type, top.value, { keepHistory: true }); }
}

function deleteQso(id) {
  const q = db.qsos.find(x => x.id === id);
  if (!q || !confirm(t('confirmDeleteContact', { c: q.call, d: fmtDateTime(q.ts) }))) return;
  DB.deleteQsos(db, [id]);
  persist();
  if ($('#qsoDialog').open) $('#qsoDialog').close();
  toast(t('contactDeleted', { c: q.call }));
  render();
  if ($('#entityDialog').open && ui.entityStack.length) { const top = ui.entityStack.pop(); openEntity(top.type, top.value, { keepHistory: true }); }
}

// ---------- Backup e restauração completos ----------
async function collectSecrets() {
  const out = { platforms: {}, lookup: {} }, dec = async v => { try { return v ? await backend.decrypt(v) : ''; } catch { return ''; } };
  for (const id of Object.keys(PLATFORMS)) if (db.platforms[id]?.secret) { try { out.platforms[id] = JSON.parse(await dec(db.platforms[id].secret)); } catch { /* sem credencial */ } }
  const lk = db.platforms.lookup || {};
  if (lk.qrzSecret) out.lookup.qrzPass = await dec(lk.qrzSecret);
  if (lk.hamqthSecret) out.lookup.hamqthPass = await dec(lk.hamqthSecret);
  return out;
}

function withoutSecrets(source) {
  const copy = structuredClone(source);
  for (const id of Object.keys(copy.platforms || {})) if (copy.platforms[id]) delete copy.platforms[id].secret;
  if (copy.platforms?.lookup) { delete copy.platforms.lookup.qrzSecret; delete copy.platforms.lookup.hamqthSecret; }
  return copy;
}

async function makeBackup({ includeCreds = false, password = '' } = {}) {
  const payload = { db: withoutSecrets(db), cty: await backend.loadCty() };
  const credentials = includeCreds && password ? await sealSecrets(await collectSecrets(), password) : null;
  return buildBackup({ payload, credentials, app: { name: 'PT2VHF QSL Manager', version: info.version || APP_VERSION }, stats: { qsos: db.qsos.length, stations: DB.stations(db).length } });
}

const backupName = prefix => `${prefix}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.qslbackup`;

async function backupNow() {
  let password = '';
  if ($('#backupCreds')?.checked) {
    password = prompt(t('backupPasswordPrompt')) || '';
    if (!password) return toast(t('backupNoPassword'), true);
    if (prompt(t('backupPasswordConfirm')) !== password) return toast(t('backupPasswordMismatch'), true);
  }
  const bytes = await makeBackup({ includeCreds: Boolean(password), password });
  const path = await backend.saveBinary(backupName('PT2VHF-QSL-Manager-backup'), b64(bytes), 'qslbackup');
  if (path) { DB.logActivity(db, 'backup', path); persist(); toast(t('savedTo', { p: path })); }
}

async function autoBackup(force = false) {
  const p = db.prefs;
  if (!isDesktop || info.smoke || p.autoBackup === 'off' || !db.qsos.length) return;
  const due = force || p.autoBackup === 'open' || (p.autoBackup === 'daily' && Date.now() - (p.lastAutoBackup || 0) > 86400000);
  if (!due) return;
  try {
    const bytes = await makeBackup();
    await backend.backupWrite({ name: backupName('auto'), base64: b64(bytes), folder: p.backupFolder || '', keep: Number(p.backupKeep) || 5 });
    p.lastAutoBackup = Date.now();
    persist();
  } catch (e) { toast(t('autoBackupFailed', { e: e.message }), true); }
}

async function restoreBackup() {
  const files = await backend.openFiles({ binary: true, backup: true });
  if (!files?.length) return;
  let parsed;
  try { parsed = await readBackup(unb64(files[0].base64)); } catch (e) { return toast(t(e.message === 'BACKUP_CORRUPT' ? 'backupCorrupt' : 'invalidBackup'), true); }
  const data = parsed.payload.db, stations = new Set((data.qsos || []).map(q => q.station || '')).size;
  const summary = t('restorePreview', { d: parsed.doc.created ? fmtDateTime(Date.parse(parsed.doc.created)) : '—', v: parsed.doc.app?.version || '—', n: (data.qsos || []).length.toLocaleString(), s: stations });
  if (!confirm(summary)) return;
  let secrets = null;
  if (parsed.doc.credentials) {
    const password = prompt(t('restorePasswordPrompt'));
    if (password) { try { secrets = await openSecrets(parsed.doc.credentials, password); } catch { toast(t('restoreWrongPassword'), true); } }
  }
  // Antes de substituir, guarda o estado atual.
  try { await backend.backupWrite({ name: backupName('antes-de-restaurar'), base64: b64(await makeBackup()), folder: db.prefs.backupFolder || '', keep: 0 }); } catch { /* segue mesmo sem a cópia */ }
  db = DB.migrate(data);
  if (parsed.payload.cty !== undefined) { await backend.saveCty(parsed.payload.cty || ''); await loadCountryFile(); }
  if (secrets) {
    for (const [id, creds] of Object.entries(secrets.platforms || {})) if (db.platforms[id]) db.platforms[id].secret = await backend.encrypt(JSON.stringify(creds));
    const lk = db.platforms.lookup ||= {};
    if (secrets.lookup?.qrzPass) lk.qrzSecret = await backend.encrypt(secrets.lookup.qrzPass);
    if (secrets.lookup?.hamqthPass) lk.hamqthSecret = await backend.encrypt(secrets.lookup.hamqthPass);
  }
  DB.logActivity(db, 'restore', files[0].name);
  await persist(true);
  toast(t(secrets || !parsed.doc.credentials ? 'restored' : 'restoredNoCreds'));
  render();
}

function backupSection() {
  const p = db.prefs;
  return `<h2>${esc(t('backupTitle'))}</h2><p class="help">${esc(t('backupFullHelp'))}</p>
    <label class="check"><input type="checkbox" id="backupCreds"> ${esc(t('backupIncludeCreds'))}</label>
    <div class="formActions left"><button id="backupNow" class="primary">${esc(t('backupNow'))}</button><button id="restoreNow">${esc(t('restoreNow'))}</button></div>
    <form id="autoBackupForm" class="fields">
      <label><span>${esc(t('autoBackup'))}</span><select name="autoBackup">${options(['off', 'daily', 'open'], p.autoBackup || 'off', o => t('autoBackup_' + o))}</select></label>
      <label><span>${esc(t('backupKeep'))}</span><input name="backupKeep" type="number" min="1" max="100" value="${Number(p.backupKeep) || 5}"></label>
      <label><span>${esc(t('backupFolder'))}</span><input name="backupFolder" value="${esc(p.backupFolder || '')}" placeholder="${esc(ui.backupDefaultDir || '')}" readonly></label>
      <div class="formActions left">${(ui.cloudFolders || []).map(c => `<button type="button" data-cloud-folder="${esc(c.dir)}" title="${esc(c.dir)}">☁ ${esc(c.name)}</button>`).join('')}<button type="button" id="chooseBackupFolder">${esc(t('chooseFolder'))}</button><button type="button" id="defaultBackupFolder">${esc(t('defaultFolder'))}</button><button type="submit">${esc(t('save'))}</button></div>
    </form><p class="help">${esc(t('autoBackupHelp', { last: p.lastAutoBackup ? fmtDateTime(p.lastAutoBackup) : '—' }))}</p>`;
}

// ---------- Plataformas online: baixar, enviar e sincronizar ----------
const SECRET_FIELDS = f => !OPTIONAL_FIELDS.has(f);
const DAY_MS = 86400000;

PAGES.platforms = () => {
  const saved = db.platforms || {};
  const cards = Object.entries(PLATFORMS).map(([id, p]) => {
    const s = saved[id] || {}, cmp = ui.platformCompare?.[id];
    const pendingSend = db.qsos.filter(q => !SENT[id](q)).length;
    const input = f => {
      if (f === 'since') return `<label><span>${esc(t('cred_since'))}</span><input name="since" type="date" value="${esc(s.since || DEFAULT_SINCE)}"></label>`;
      if (f === 'qthNickname' || f === 'tqslLocation') return `<label><span>${esc(t('cred_' + f))}</span><input name="${f}" type="text" autocomplete="off" value="${esc(s[f] || '')}"></label>`;
      return `<label><span>${esc(t('cred_' + f))}</span><input name="${f}" type="${/password|apiKey/.test(f) ? 'password' : 'text'}" autocomplete="off" placeholder="${s.secret ? '••••••• (' + esc(t('saved')) + ')' : ''}"></label>`;
    };
    return `<form class="platformCard" data-platform="${id}"><div class="cardHead"><strong>${esc(p.name)}</strong><small>${esc(new URL(p.url).host)}</small></div><p class="help">${esc(t(p.help))}</p>
      <div class="fields">${p.fields.map(input).join('')}
      <label><span>${esc(t('defaultStation'))}</span><input name="station" maxlength="20" value="${esc(s.station || db.prefs.myCall || '')}"></label></div>
      <label class="check"><input type="checkbox" name="remember"${s.remember ? ' checked' : ''}> ${esc(t('rememberCreds'))}</label>
      <label class="check"><input type="checkbox" name="autoSync"${s.autoSync ? ' checked' : ''}> ${esc(t('autoSync'))}</label>
      <p class="platformStatus" data-status="${id}">${esc(s.lastError ? t('platformError', { e: s.lastError }) : s.last ? t('lastSync', { d: fmtDateTime(s.last), n: s.lastAdded ?? 0 }) : '')}</p>
      <div class="platformActions">
        <button type="submit" class="primary">⇩ ${esc(t('downloadImport'))}</button>
        <button type="button" data-platform-upload="${id}">⇧ ${esc(t('uploadPlatform', { n: pendingSend.toLocaleString() }))}</button>
        <button type="button" data-platform-sync="${id}">⇅ ${esc(t('syncPlatform'))}</button>
        <button type="button" data-platform-compare="${id}">${esc(t('comparePlatform'))}</button>
        <button type="button" data-platform-export="${id}">${esc(t('exportForPlatform'))}</button>
      </div>
      ${cmp ? `<div class="compareResult"><div class="tiles">${tile(t('inBoth'), cmp.both)}${tile(t('onlyLocal'), cmp.onlyLocal.length)}${tile(t('onlyRemote'), cmp.onlyRemote.length)}</div>${cmp.onlyLocal.length ? `<button type="button" data-export-only-local="${id}">${esc(t('exportOnlyLocal'))}</button>` : ''}${cmp.onlyRemote.length ? `<button type="button" data-import-only-remote="${id}">${esc(t('importOnlyRemote'))}</button>` : ''}</div>` : ''}</form>`;
  }).join('');
  return `<section class="page wide">${head('logs', 'page_platforms', 'platformsHelp')}${isDesktop ? '' : `<p class="notice">${esc(t('platformsDesktopOnly'))}</p>`}<p class="help">${esc(t('uploadScopeHelp'))}</p><div class="platformGrid">${cards}</div>
    <p class="help">${esc(t('platformsOther'))}</p></section>`;
};

async function platformCreds(id, form) {
  const data = form ? Object.fromEntries(new FormData(form).entries()) : {};
  const saved = db.platforms[id] || {};
  let stored = {};
  if (saved.secret) { try { stored = JSON.parse(await backend.decrypt(saved.secret)); } catch { stored = {}; } }
  const creds = {};
  for (const f of PLATFORMS[id].fields) creds[f] = (data[f] ?? '') || (OPTIONAL_FIELDS.has(f) ? saved[f] : stored[f]) || '';
  if (!validDate(creds.since)) creds.since = DEFAULT_SINCE;
  return { creds, data: { station: data.station ?? saved.station ?? db.prefs.myCall ?? '', remember: form ? data.remember === 'on' : saved.remember, autoSync: form ? data.autoSync === 'on' : saved.autoSync, since: creds.since, qthNickname: creds.qthNickname || '', tqslLocation: creds.tqslLocation || '' } };
}

const platformErrorText = (code, detail = '') => (code === 'AUTH' ? t('authFailed') : code === 'RATE_LIMIT' ? t('lotwRateLimit') : code === 'INVALID_RESPONSE' ? t('invalidResponse', { d: detail || '—' }) : code) + (detail && code !== 'INVALID_RESPONSE' && code !== 'RATE_LIMIT' ? ` (${detail})` : '');

async function downloadPlatform(id, creds, onStatus = () => {}) {
  let state = {}, adif = '', guard = 0;
  while (guard++ < 200) {
    let res = await backend.fetchPlatform(buildRequest(id, creds, state));
    // LoTW/Club Log lentos ou ocupados: uma nova tentativa após uma pausa.
    if (res.error || res.status === 503 || res.status === 502) { onStatus(t('retrying')); await new Promise(r => setTimeout(r, 8000)); res = await backend.fetchPlatform(buildRequest(id, creds, state)); }
    if (res.error) throw new Error(res.error);
    const parsed = parseResponse(id, res.text, state);
    if (parsed.error) { const e = new Error(platformErrorText(parsed.error, parsed.detail || (res.status !== 200 ? 'HTTP ' + res.status : ''))); e.code = parsed.error; throw e; }
    adif += parsed.adif + '\n';
    state = parsed.state;
    onStatus(t('downloadingN', { n: (adif.match(/<eor>/gi) || []).length }));
    if (parsed.done) break;
  }
  return /<eoh>/i.test(adif) ? adif : '<EOH>\n' + adif;
}

// No relatório do LoTW, QSL_RCVD significa confirmação LoTW; o Inbox do eQSL contém apenas confirmações eQSL.
const platformAdjust = id => q => {
  if (id === 'lotw') { if (q.qslRcvd === 'Y') q.lotwRcvd = 'Y'; q.qslRcvd = ''; q.lotwSent = 'Y'; }
  if (id === 'eqsl') { q.eqslRcvd = 'Y'; q.qslRcvd = ''; }
  if (id === 'qrz') { q.extra ||= {}; q.extra.QRZCOM_QSO_UPLOAD_STATUS = 'Y'; }
  if (id === 'clublog') { q.extra ||= {}; q.extra.CLUBLOG_QSO_UPLOAD_STATUS = 'Y'; }
};

async function savePlatform(id, data, creds, patch = {}) {
  const entry = { ...(db.platforms[id] || {}), station: data.station, remember: data.remember, autoSync: data.autoSync, since: data.since, qthNickname: data.qthNickname, tqslLocation: data.tqslLocation, ...patch };
  if (entry.remember) entry.secret = await backend.encrypt(JSON.stringify(Object.fromEntries(Object.entries(creds).filter(([f]) => SECRET_FIELDS(f)))));
  else { delete entry.secret; entry.autoSync = false; }
  db.platforms[id] = entry;
  await persist(true);
}

function platformLocked(id) {
  // O LoTW limita consultas repetidas: intervalo mínimo de 60 s entre consultas manuais.
  const s = db.platforms[id] || {};
  if (id === 'lotw' && s.lastAttempt && Date.now() - s.lastAttempt < 60000) return t('lotwWait', { s: Math.ceil((60000 - (Date.now() - s.lastAttempt)) / 1000) });
  return '';
}

async function runPlatform(id, form = null, { silent = false, incremental = false } = {}) {
  const { creds, data } = await platformCreds(id, form);
  const status = form?.querySelector('[data-status]') || { set textContent(v) {} };
  const missing = validateCreds(id, creds);
  if (missing.length) { status.textContent = t('missingFields', { f: missing.map(m => t('cred_' + m)).join(', ') }); return null; }
  const locked = platformLocked(id);
  if (locked) { status.textContent = locked; return null; }
  if (incremental && db.platforms[id]?.lastSuccess) creds.since = new Date(db.platforms[id].lastSuccess - DAY_MS).toISOString().slice(0, 10);
  (db.platforms[id] ||= {}).lastAttempt = Date.now();
  form?.querySelectorAll('button').forEach(b => (b.disabled = true));
  try {
    if (!silent) { progress.open(t('platformImportTitle', { p: PLATFORMS[id].name })); progress.update({ done: 0, total: 0, added: 0, skipped: 0, merged: 0, errors: 0, label: t('downloading') }); }
    const adif = await downloadPlatform(id, creds, msg => { status.textContent = msg; if (!silent) $('#progressLabel').textContent = msg; });
    const opts = { ...readImportForm(), station: String(data.station || '').toUpperCase(), forceStation: false, mergeQsl: true, recalc: true, format: 'adif' };
    const from = Date.parse(creds.since + 'T00:00:00Z');
    const keep = q => !(id === 'qrz' || id === 'clublog') || q.ts >= from;
    let res;
    if (silent) {
      const r = parseLog(adif, id + '.adi', { station: opts.station, myGrid: db.prefs.myGrid }, 'adif');
      const list = r.qsos.filter(keep);
      for (const q of list) { if (!q.station) q.station = opts.station; if (!q.operator) q.operator = q.station; platformAdjust(id)(q); DB.enrich(q, cty, { myGrid: db.prefs.myGrid }); }
      res = DB.importQsos(db, list, 'main', { mergeQsl: true, source: PLATFORMS[id].name });
    } else res = await importFiles([{ name: id + '.adi', text: adif }], opts, { title: t('platformImportTitle', { p: PLATFORMS[id].name }), source: PLATFORMS[id].name, adjust: platformAdjust(id), keep });
    await savePlatform(id, data, creds, { last: Date.now(), lastSuccess: Date.now(), lastAdded: res.added, lastError: '' });
    status.textContent = t('platformResult', { added: res.added, skipped: res.skipped, merged: res.merged });
    if (silent && res.added + res.merged) toast(`${PLATFORMS[id].name}: ` + t('platformResult', { added: res.added, skipped: res.skipped, merged: res.merged }));
    DB.logActivity(db, 'platform-download', `${PLATFORMS[id].name}: +${res.added}`);
    renderHeader();
    return res;
  } catch (e) {
    const msg = e.message;
    await savePlatform(id, data, creds, { lastError: msg, lastErrorCode: e.code || '', lastErrorAt: Date.now() });
    DB.logActivity(db, 'platform-error', `${PLATFORMS[id].name}: ${msg}`);
    status.textContent = t('platformError', { e: msg });
    if (!silent) progress.finish(t('platformError', { e: msg }));
    else toast(`${PLATFORMS[id].name}: ` + t('platformError', { e: msg }), true);
    return null;
  } finally { form?.querySelectorAll('button').forEach(b => (b.disabled = false)); }
}

// Envio dos contatos que ainda não foram enviados à plataforma (respeitando o filtro atual).
async function uploadPlatform(id, form) {
  const { creds, data } = await platformCreds(id, form);
  const status = form?.querySelector('[data-status]') || { set textContent(v) {} };
  const required = id === 'lotw' ? [] : validateCreds(id, creds);
  if (required.length) { status.textContent = t('missingFields', { f: required.map(m => t('cred_' + m)).join(', ') }); return; }
  const list = filteredQsos().filter(q => !SENT[id](q));
  if (!list.length) { status.textContent = t('nothingToUpload'); return; }
  if (!confirm(t('confirmUpload', { n: list.length.toLocaleString(), p: PLATFORMS[id].name }))) return;
  form?.querySelectorAll('button').forEach(b => (b.disabled = true));
  progress.open(t('uploadTitle', { p: PLATFORMS[id].name }));
  const st = { done: 0, total: list.length, added: 0, skipped: 0, merged: 0, errors: 0 };
  const show = label => progress.update({ ...st, label });
  const stamp = new Date();
  try {
    if (id === 'qrz') {
      for (const q of list) {
        const res = await backend.fetchPlatform(buildQrzInsert(creds, toAdifRecord(q)));
        const r = res.error ? { ok: false, error: res.error } : parseQrzInsert(res.text);
        if (r.ok) { markSent(id, q, stamp); r.duplicate ? st.skipped++ : st.added++; } else st.errors++;
        st.done++; show(r.ok ? q.call : r.error);
        if (r.fatal) throw new Error(r.error);
        if (st.done % 20 === 0) { persist(); await tick(); }
      }
    } else if (id === 'eqsl') {
      for (let i = 0; i < list.length; i += 25) {
        const batch = list.slice(i, i + 25), res = await backend.fetchPlatform(buildEqslUpload(creds, batch.map(toAdifRecord)));
        const r = res.error ? { ok: false, error: res.error } : parseEqslUpload(res.text, batch.length);
        if (r.ok) { batch.forEach(q => markSent(id, q, stamp)); st.added += r.added ?? batch.length; st.skipped += r.duplicates || 0; } else st.errors += batch.length;
        st.done += batch.length; show(r.ok ? '' : r.error);
        if (r.fatal) throw new Error(r.error);
        await tick();
      }
    } else if (id === 'clublog') {
      show(t('uploading'));
      const res = await backend.fetchPlatform(buildClublogUpload(creds, toAdif(list, info.version || APP_VERSION)));
      const r = res.error ? { ok: false, error: res.error } : parseClublogUpload(res.status, res.text);
      if (!r.ok) throw new Error(r.error);
      list.forEach(q => markSent(id, q, stamp)); st.added = list.length; st.done = list.length;
    } else if (id === 'lotw') {
      if (!isDesktop) throw new Error(t('tqslDesktopOnly'));
      show(t('tqslSigning'));
      const r = await backend.tqslUpload({ adif: toAdif(list, info.version || APP_VERSION), location: data.tqslLocation });
      const msg = { TQSL_NOT_FOUND: t('tqslNotFound'), TQSL_NO_LOCATION: t('tqslNoLocation'), TQSL_TIMEOUT: t('tqslTimeout') }[r.error] || r.error;
      if (r.code === 0 || r.code === 8 || r.code === 9) { list.forEach(q => markSent(id, q, stamp)); st.added = r.code === 8 ? 0 : list.length; st.skipped = r.code === 8 ? list.length : 0; st.done = list.length; }
      else throw new Error(msg || t('tqslExit', { c: r.code, o: (r.output || '').slice(-200) }));
    }
    await savePlatform(id, data, creds, { lastUpload: Date.now() });
    DB.logActivity(db, 'platform-upload', `${PLATFORMS[id].name}: ${st.added} / ${st.skipped} / ${st.errors}`);
    await persist(true);
    progress.finish(t('uploadFinished', { a: st.added, d: st.skipped, e: st.errors }));
    render();
  } catch (e) {
    await persist(true);
    progress.finish(t('platformError', { e: e.message }));
  } finally { form?.querySelectorAll('button').forEach(b => (b.disabled = false)); }
}

// Conferência: o que existe só no app e só na plataforma, sem importar nada.
async function comparePlatform(id, form) {
  const { creds } = await platformCreds(id, form);
  const status = form.querySelector('[data-status]');
  const missing = validateCreds(id, creds);
  if (missing.length) { status.textContent = t('missingFields', { f: missing.map(m => t('cred_' + m)).join(', ') }); return; }
  const locked = platformLocked(id);
  if (locked) { status.textContent = locked; return; }
  (db.platforms[id] ||= {}).lastAttempt = Date.now();
  try {
    status.textContent = t('downloading');
    const adif = await downloadPlatform(id, creds, msg => (status.textContent = msg));
    const remote = parseLog(adif, id + '.adi', { station: (db.platforms[id]?.station || db.prefs.myCall || '').toUpperCase() }, 'adif').qsos;
    remote.forEach(platformAdjust(id));
    const key = q => `${q.call}|${q.band}|${Math.round(q.ts / 120000)}`;
    const remoteKeys = new Set(remote.flatMap(q => [key(q), key({ ...q, ts: q.ts - 60000 }), key({ ...q, ts: q.ts + 60000 })]));
    const localKeys = new Set(db.qsos.flatMap(q => [key(q), key({ ...q, ts: q.ts - 60000 }), key({ ...q, ts: q.ts + 60000 })]));
    const from = Date.parse(creds.since + 'T00:00:00Z');
    const onlyLocal = db.qsos.filter(q => q.ts >= from && !remoteKeys.has(key(q))), onlyRemote = remote.filter(q => !localKeys.has(key(q)));
    (ui.platformCompare ||= {})[id] = { both: db.qsos.filter(q => q.ts >= from).length - onlyLocal.length, onlyLocal, onlyRemote, adif };
    render();
  } catch (e) { status.textContent = t('platformError', { e: e.message }); }
}

async function syncPlatform(id, form) {
  const res = await runPlatform(id, form);
  if (res) await uploadPlatform(id, document.querySelector(`form[data-platform="${id}"]`) || form);
}

// Sincronização ao abrir: incremental e no máximo uma vez a cada 24 h; nunca logo após um bloqueio do LoTW.
async function autoSyncPlatforms() {
  for (const id of Object.keys(PLATFORMS)) {
    const s = db.platforms[id];
    if (!s?.autoSync || !s.secret) continue;
    if (s.lastAttempt && Date.now() - s.lastAttempt < DAY_MS) continue;
    if (s.lastErrorCode === 'RATE_LIMIT' && Date.now() - (s.lastErrorAt || 0) < DAY_MS) continue;
    await runPlatform(id, null, { silent: true, incremental: true });
  }
}

PAGES.modify = () => {
  const n = filteredQsos().length;
  const modes = [...S.distinct(db.qsos, q => q.mode)].sort();
  return `<section class="page wide">${head('logs', 'page_modify', 'modifyHelp')}${filterBar()}
    <p class="pill">${esc(t('selectedQsos', { n }))} · ${esc(filterSummary())}</p>
    <form id="modifyForm" class="fields">
      <label><span>${esc(t('countryFileUpdate'))}</span><select name="countryFile"><option value="none">${esc(t('cf_none'))}</option><option value="missing">${esc(t('cf_missing'))}</option><option value="all">${esc(t('cf_all'))}</option></select></label>
      <label class="check"><input type="checkbox" name="bandFromFreq"> ${esc(t('bandFromFreq'))}</label>
      <label><span>${esc(t('modeFrom'))}</span><select name="modeFrom"><option value=""></option>${options(modes, '')}</select></label>
      <label><span>${esc(t('modeTo'))}</span><input name="modeTo" maxlength="12" placeholder="SSB"></label>
      <label><span>${esc(t('setStation'))}</span><input name="setStation" maxlength="20"></label>
      <label><span>${esc(t('setOperator'))}</span><input name="setOperator" maxlength="20"></label>
      <label><span>${esc(t('setMyGrid'))}</span><input name="setMyGrid" maxlength="8"></label>
      <div class="formActions"><button type="submit" class="primary">${esc(t('applyChanges'))}</button><button type="button" id="removeDupesFiltered">${esc(t('removeDupesSelected'))}</button><button type="button" class="dangerButton" id="deleteSelected">${esc(t('deleteSelected'))}</button></div>
    </form><p class="help">${esc(t('ctyVersion', { v: cty?.version || '—' }))}</p></section>`;
};

// ---------- Saúde do log ----------
const HEALTH_CHECKS = ['bandMismatch', 'missingBand', 'nearDupes', 'typos', 'invalidMode', 'future', 'missingStation', 'missingGrid'];
const HEALTH_FIX = { bandMismatch: 'fixBand', missingBand: 'fixBand', nearDupes: 'deleteNearDupes', typos: 'fixTypos' };

PAGES.health = () => {
  const issues = logHealth(db.qsos);
  ui.health = issues;
  const sel = ui.healthCheck || HEALTH_CHECKS.find(k => issues[k].length) || 'bandMismatch';
  const cards = HEALTH_CHECKS.map(k => `<button class="healthCard${k === sel ? ' selected' : ''}${issues[k].length ? ' bad' : ''}" data-health-show="${k}"><strong>${issues[k].length.toLocaleString()}</strong><span>${esc(t('health_' + k))}</span></button>`).join('');
  const list = issues[sel] || [];
  const extra = item => sel === 'bandMismatch' || sel === 'missingBand' ? [item.q.freq ? item.q.freq.toFixed(3) : '', item.q.band || '—', item.fix || '—'] : sel === 'nearDupes' ? [fmtDateTime(item.original.ts)] : sel === 'typos' ? [{ html: `${entityLink('call', item.suggestion)} <button data-typo-fix="${item.q.id}">${esc(t('replace'))}</button>` }] : [];
  const extraHead = sel === 'bandMismatch' || sel === 'missingBand' ? ['MHz', t('band'), t('suggested')] : sel === 'nearDupes' ? [t('originalQso')] : sel === 'typos' ? [t('suggestion')] : [];
  const rows = list.slice(0, 500).map(item => [fmtDateTime(item.q.ts), item.q.call, item.q.band, item.q.mode, item.q.station, ...extra(item)]);
  const fix = HEALTH_FIX[sel] && list.some(i => sel !== 'missingBand' || i.fix) ? `<button class="primary" data-health-fix="${sel}">${esc(t('fix_' + HEALTH_FIX[sel], { n: list.length }))}</button>` : sel === 'invalidMode' && list.length ? `<button data-go="logs:modify">${esc(t('page_modify'))}</button>` : '';
  return `<section class="page wide">${head('logs', 'page_health', 'healthHelp')}<div class="healthCards">${cards}</div>
    <h2>${esc(t('health_' + sel))}</h2><p class="help">${esc(t('healthHelp_' + sel))}</p>${fix ? `<div class="formActions left">${fix}</div>` : ''}
    ${list.length ? table([t('date'), t('call'), t('band'), t('mode'), t('station'), ...extraHead], rows, { links: { 1: 'call', 4: 'station' } }) : `<p class="notice ok">${esc(t('healthOk'))}</p>`}</section>`;
};

function applyHealthFix(kind, onlyId = null) {
  const issues = logHealth(db.qsos);
  let n = 0;
  if (kind === 'fixBand') for (const i of [...issues.bandMismatch, ...issues.missingBand]) if (i.fix) { i.q.band = i.fix; n++; }
  if (kind === 'deleteNearDupes') n = DB.deleteQsos(db, issues.nearDupes.map(i => i.q.id));
  if (kind === 'fixTypos') for (const i of issues.typos) if (!onlyId || i.q.id === onlyId) { i.q.call = i.suggestion; i.q.country = ''; i.q.dxcc = null; i.q.cont = ''; i.q.cqz = null; i.q.ituz = null; i.q.pfx = ''; DB.enrich(i.q, cty, { force: true }); n++; }
  DB.logActivity(db, 'health-fix', `${kind}: ${n}`);
  persist();
  toast(t('healthFixed', { n }));
  render();
}

PAGES.search = () => {
  const q = ui.searchText;
  const results = q ? S.byTime(DB.applyFilter(db.qsos, { call: q })).reverse() : [];
  const rows = results.slice(0, 1000).map(x => [fmtDateTime(x.ts), x.call, x.band, x.mode, x.freq ? x.freq.toFixed(3) : '', x.rstS, x.rstR, x.station, x.operator, x.country, S.grid4(x), (x.lotwRcvd === 'Y' ? 'L' : '') + (x.eqslRcvd === 'Y' ? 'E' : '') + (x.qslRcvd === 'Y' ? 'P' : ''), x.name]);
  return `<section class="page wide">${head('logs', 'page_search', 'searchHelp')}
    <form id="searchForm" class="inline"><input id="searchInput" value="${esc(q)}" placeholder="PY2* · *VHF · K?ABC" autofocus><button type="submit">${esc(t('search'))}</button></form>
    ${q ? `<p class="pill">${esc(t('resultsN', { n: results.length }))}</p>` + table([t('date'), t('call'), t('band'), t('mode'), 'MHz', 'S', 'R', t('station'), t('operator'), t('country'), t('locator'), 'QSL', t('name')], rows, { links: { 1: 'call', 7: 'station', 9: 'country', 10: 'grid' } }) : ''}</section>`;
};

// Divide resultados longos em sub-abas: cada gráfico, grupo de gráficos ou seção com título vira uma aba.
function tabify(html, key) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const nodes = [...tpl.content.children], top = [], blocks = [];
  let current = null;
  const labelOf = n => n.matches('figure') ? n.querySelector('figcaption')?.textContent : n.matches('.grid2') ? [...n.querySelectorAll('figcaption')].map(x => x.textContent).join(' · ') || t('table') : n.matches('.tableWrap') ? t('table') : '';
  for (const n of nodes) {
    if (!blocks.length && !current && n.matches('.tiles, p, .summary, .notice, .lookupCard, .entityHead, .award')) { top.push(n); continue; }
    if (n.matches('h3')) { current = { label: n.textContent, nodes: [] }; blocks.push(current); continue; }
    if (current && !n.matches('figure, .grid2')) { current.nodes.push(n); continue; }
    if (current && current.nodes.length === 0) { current.nodes.push(n); continue; }
    if (n.matches('p, .notice') && blocks.length) { blocks[blocks.length - 1].nodes.push(n); continue; }
    current = null;
    blocks.push({ label: labelOf(n) || t('table'), nodes: [n] });
  }
  if (blocks.length < 3) return html;
  const sel = Math.min(ui.tabs[key] ?? 0, blocks.length - 1);
  const wrap = arr => arr.map(n => n.outerHTML).join('');
  return wrap(top) + `<div class="subTabs" data-tabs="${esc(key)}">${blocks.map((b, i) => `<button type="button" data-tab="${i}" class="${i === sel ? 'selected' : ''}">${esc(b.label.length > 48 ? b.label.slice(0, 46) + '…' : b.label)}</button>`).join('')}</div>`
    + blocks.map((b, i) => `<div class="tabPanel${i === sel ? '' : ' hidden'}" data-panel="${i}">${wrap(b.nodes)}</div>`).join('');
}

function statPage(page) {
  const qsos = filteredQsos();
  const p = ui.params[page.id] ||= defaultParams(page);
  let result;
  try { result = page.render(statContext(qsos), p); } catch (e) { console.error(e); result = { html: `<p class="notice">${esc(e.message)}</p>`, tables: [] }; }
  lastResult = { page: page.id, ...result };
  const kml = page.id === 'kml' ? `<form id="kmlForm" class="paramsBar"><strong>KML/KMZ</strong><label class="check"><input type="checkbox" name="dxcc" checked> DXCC</label><label class="check"><input type="checkbox" name="grids" checked> ${esc(t('locators'))}</label><label class="check"><input type="checkbox" name="lines"> ${esc(t('qsoLines'))}</label><label class="check"><input type="checkbox" name="timeline"> ${esc(t('logReplay'))}</label><button type="submit" class="primary">${esc(t('exportKml'))}</button></form>` : '';
  const group = QSL_PAGES.some(x => x.id === page.id) ? 'qsl' : 'stats';
  return `<section class="page wide">${head(group, 'page_' + page.id, 'help_' + page.id)}${filterBar()}${paramsBar(page, qsos)}${kml}
    <div class="resultHead"><span class="pill">${esc(t('qsosInFilter', { n: qsos.length.toLocaleString() }))} · ${esc(filterSummary())}</span>${resultToolbar()}</div>
    <div id="result">${qsos.length ? tabify(result.html, page.id) : `<p class="notice">${esc(t('noQsosFilter'))}</p>`}</div></section>`;
}
for (const p of [...STAT_PAGES, ...QSL_PAGES]) PAGES[p.id] = () => statPage(p);

// ---------- Relatórios ----------
const REPORT_DEFAULT = { title: 'Relatório de atividade', subtitle: '', author: '', orientation: 'portrait', paper: 'A4', cover: true, filters: true, charts: true, tables: 'all', breakEach: true, lightPrint: true, footer: '', sections: [{ id: 'basic', params: {} }, { id: 'qsocharts', params: {} }, { id: 'bandsmodes', params: {} }, { id: 'time', params: {} }, { id: 'qsl', params: {} }] };
const reportCfg = () => (db.prefs.report ||= structuredClone(REPORT_DEFAULT));

PAGES.report = () => {
  const cfg = reportCfg();
  const templates = db.prefs.reportTemplates || {};
  const selected = new Set(cfg.sections.map(s => s.id));
  const sectionRows = cfg.sections.map((s, i) => {
    const page = sectionById(s.id);
    if (!page) return '';
    const params = { ...defaultParams(page), ...s.params };
    const ctrls = page.params.map(def => def.type === 'select' ? `<select data-sparam="${i}:${def.id}" title="${esc(t(def.label))}">${options(def.options || def.optionsFn(db.qsos), params[def.id], o => t('opt_' + o) === 'opt_' + o ? o : t('opt_' + o))}</select>` : `<input type="number" data-sparam="${i}:${def.id}" value="${esc(params[def.id])}" min="${def.min}" max="${def.max}" title="${esc(t(def.label))}">`).join('');
    return `<li><span class="order"><button data-rs="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button data-rs="down" data-i="${i}" ${i === cfg.sections.length - 1 ? 'disabled' : ''}>↓</button></span><strong>${esc(t('page_' + s.id))}</strong><span class="sparams">${ctrls}</span><button data-rs="remove" data-i="${i}">✕</button></li>`;
  }).join('');
  const available = ALL_SECTIONS.filter(s => !selected.has(s.id)).map(s => `<option value="${s.id}">${esc(t('page_' + s.id))}</option>`).join('');
  return `<section class="page wide">${head('reports', 'page_report', 'reportHelp')}${filterBar()}
    <div class="reportBuilder"><form id="reportForm" class="reportSettings">
      <h3>${esc(t('reportLayout'))}</h3>
      <label><span>${esc(t('reportTitle'))}</span><input name="title" value="${esc(cfg.title)}" maxlength="120"></label>
      <label><span>${esc(t('reportSubtitle'))}</span><input name="subtitle" value="${esc(cfg.subtitle)}" maxlength="160"></label>
      <label><span>${esc(t('reportAuthor'))}</span><input name="author" value="${esc(cfg.author || db.prefs.myCall)}" maxlength="80"></label>
      <div class="two"><label><span>${esc(t('paper'))}</span><select name="paper">${options(['A4', 'Letter', 'Legal', 'A3'], cfg.paper)}</select></label><label><span>${esc(t('orientation'))}</span><select name="orientation">${options(['portrait', 'landscape'], cfg.orientation, o => t('opt_' + o))}</select></label></div>
      <label><span>${esc(t('tablesMode'))}</span><select name="tables">${options(['all', 'first', 'none'], cfg.tables, o => t('tables_' + o))}</select></label>
      <label class="check"><input type="checkbox" name="cover"${cfg.cover ? ' checked' : ''}> ${esc(t('includeCover'))}</label>
      <label class="check"><input type="checkbox" name="filters"${cfg.filters ? ' checked' : ''}> ${esc(t('includeFilters'))}</label>
      <label class="check"><input type="checkbox" name="charts"${cfg.charts ? ' checked' : ''}> ${esc(t('includeCharts'))}</label>
      <label class="check"><input type="checkbox" name="breakEach"${cfg.breakEach ? ' checked' : ''}> ${esc(t('breakEach'))}</label>
      <label class="check"><input type="checkbox" name="lightPrint"${cfg.lightPrint ? ' checked' : ''}> ${esc(t('lightPrint'))}</label>
      <label><span>${esc(t('footerText'))}</span><input name="footer" value="${esc(cfg.footer)}" maxlength="160"></label>
      <h3>${esc(t('reportSections'))}</h3><ol class="sectionList">${sectionRows}</ol>
      <div class="inline"><select id="addSection">${available}</select><button type="button" id="addSectionBtn">＋ ${esc(t('addSection'))}</button></div>
      <h3>${esc(t('templates'))}</h3>
      <div class="inline"><select id="templateSel"><option value=""></option>${options(Object.keys(templates), '')}</select><button type="button" id="loadTemplate">${esc(t('load'))}</button><button type="button" id="deleteTemplate">${esc(t('delete'))}</button></div>
      <div class="inline"><input id="templateName" placeholder="${esc(t('templateName'))}" maxlength="60"><button type="button" id="saveTemplate">${esc(t('save'))}</button></div>
      <div class="formActions"><button type="button" id="yearReport">★ ${esc(t('yearReportButton'))}</button><button type="button" id="resetReport">${esc(t('resetReport'))}</button><button type="submit">${esc(t('updatePreview'))}</button></div>
      <div class="formActions"><button type="button" id="reportHtml">HTML</button><button type="button" id="reportPdf" class="primary">${esc(t('exportPdf'))}</button></div>
    </form><div class="reportPreview"><div class="previewLabel">${esc(t('preview'))}</div><div id="reportPaper" class="paper ${cfg.orientation}">${buildReport(cfg)}</div></div></div></section>`;
};

function readReportForm() {
  const cfg = reportCfg(), f = new FormData($('#reportForm'));
  for (const k of ['title', 'subtitle', 'author', 'paper', 'orientation', 'tables', 'footer']) cfg[k] = String(f.get(k) ?? '');
  for (const k of ['cover', 'filters', 'charts', 'breakEach', 'lightPrint']) cfg[k] = f.get(k) === 'on';
  for (const el of document.querySelectorAll('[data-sparam]')) {
    const [i, id] = el.dataset.sparam.split(':');
    const s = cfg.sections[Number(i)];
    if (s) s.params[id] = el.type === 'number' ? Number(el.value) : el.value;
  }
  persist();
  return cfg;
}

function buildReport(cfg, filter = ui.filter) {
  const qsos = filteredQsos(filter), ctx = statContext(qsos, true);
  const b = S.basic(qsos, { pauseMin: db.prefs.pauseMinutes, points: ctx.points });
  const parts = [];
  if (cfg.cover) parts.push(`<section class="rCover"><small>PT2VHF QSL MANAGER</small><h1>${esc(cfg.title)}</h1>${cfg.subtitle ? `<h2>${esc(cfg.subtitle)}</h2>` : ''}<p>${esc(cfg.author)}</p><p>${esc(t('generatedAt', { d: fmtDateTime(Date.now()) + ' UTC' }))}</p><div class="tiles">${tile(t('qsos'), b.qsos.toLocaleString())}${tile(t('uniqueCalls'), b.uniqueCalls.toLocaleString())}${tile(t('dxccEntities'), b.dxcc)}${tile(t('period'), fmtDate(b.first) + ' → ' + fmtDate(b.last))}</div>${cfg.filters ? `<p class="rFilters">${esc(filterSummary(filter))}</p>` : ''}</section>`);
  else parts.push(`<header class="rHead"><h1>${esc(cfg.title)}</h1>${cfg.subtitle ? `<h2>${esc(cfg.subtitle)}</h2>` : ''}${cfg.filters ? `<p class="rFilters">${esc(filterSummary(filter))}</p>` : ''}</header>`);
  for (const s of cfg.sections) {
    const page = sectionById(s.id);
    if (!page) continue;
    let html = '';
    try {
      const r = page.render(ctx, { ...defaultParams(page), ...s.params });
      const tmp = document.createElement('div');
      tmp.innerHTML = r.html;
      if (!cfg.charts) tmp.querySelectorAll('figure.chartBox').forEach(e => e.remove());
      if (cfg.tables === 'none') tmp.querySelectorAll('.tableWrap').forEach(e => e.remove());
      if (cfg.tables === 'first') { const w = tmp.querySelectorAll('.tableWrap'); w.forEach((e, i) => { if (i > 0) e.remove(); else e.querySelectorAll('tbody tr').forEach((tr, k) => { if (k >= 40) tr.remove(); }); }); }
      tmp.querySelectorAll('[data-kml-actions]').forEach(e => e.remove());
      html = tmp.innerHTML;
    } catch (e) { html = `<p>${esc(e.message)}</p>`; }
    parts.push(`<section class="rSection${cfg.breakEach ? ' break' : ''}"><h2>${esc(t('page_' + s.id))}</h2>${html}</section>`);
  }
  if (cfg.footer) parts.push(`<footer class="rFooter">${esc(cfg.footer)}</footer>`);
  return parts.join('');
}

async function exportReportPdf(cfg, html, name) {
  const root = $('#printRoot');
  root.innerHTML = `<div class="printDoc ${cfg.orientation}">${html}</div>`;
  document.body.classList.add('printing');
  if (cfg.lightPrint) { document.body.classList.add('printLight'); document.documentElement.style.background = '#fff'; document.documentElement.style.colorScheme = 'light'; document.body.style.background = '#fff'; }
  const style = document.createElement('style');
  style.id = 'pageStyle';
  style.textContent = `@page{size:${cfg.paper} ${cfg.orientation};margin:12mm}`;
  document.head.appendChild(style);
  try {
    await new Promise(r => setTimeout(r, 120));
    const out = await backend.printPdf({ landscape: cfg.orientation === 'landscape', pageSize: cfg.paper, name, footer: cfg.footer || 'PT2VHF QSL Manager' });
    if (out && out !== 'print') toast(t('savedTo', { p: out }));
  } catch (e) { toast(e.message, true); }
  finally { document.body.classList.remove('printing', 'printLight'); document.documentElement.style.background = ''; document.documentElement.style.colorScheme = ''; document.body.style.background = ''; style.remove(); root.innerHTML = ''; }
}

function reportHtmlDocument(cfg, html) {
  const css = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
  return `<!doctype html><html lang="${db.prefs.language}" data-theme="${cfg.lightPrint ? 'light' : db.prefs.theme}"><head><meta charset="utf-8"><title>${esc(cfg.title)}</title><style>${css}</style></head><body class="standalone"><div class="printDoc ${cfg.orientation}">${html}</div></body></html>`;
}

PAGES.compare = () => {
  const items = DB.stations(db).map(s => ['s:' + s.station, s.station || '—']);
  const sel = (ui.compareSel || items.slice(0, 4).map(i => i[0])).filter(k => items.some(i => i[0] === k));
  const groups = sel.map(k => ({ key: k, label: items.find(i => i[0] === k)[1], qsos: filteredQsos({ ...ui.filter, stations: [k.slice(2)] }) }));
  const metrics = groups.map(g => S.basic(g.qsos, { pauseMin: db.prefs.pauseMinutes, points: pointsFor() }));
  const rowsDef = [['qsos', m => m.qsos], ['dupes', m => m.dupes], ['points', m => m.points], ['uniqueCalls', m => m.uniqueCalls], ['dxccEntities', m => m.dxcc], ['cqZones', m => m.cqz], ['ituZones', m => m.ituz], ['prefixes', m => m.prefixes], ['locators', m => m.grids], ['operatingTime', m => fmtDur(m.operatingMs)], ['avgRate', m => m.avgRate], ['maxRate60', m => m.max60.count], ['confirmedQsos', m => m.confirmed], ['firstQso', m => fmtDateTime(m.first)], ['lastQso', m => fmtDateTime(m.last)]];
  const rows = rowsDef.map(([k, f]) => [t(k), ...metrics.map(f)]);
  const bands = sortBands([...new Set(groups.flatMap(g => [...S.distinct(g.qsos, q => q.band)]))]);
  lastResult = { page: 'compare', tables: [{ title: t('page_compare'), head: [t('metric'), ...groups.map(g => g.label)], rows }] };
  return `<section class="page wide">${head('reports', 'page_compare', 'compareHelp')}${filterBar()}
    <form id="compareForm" class="compareSel">${items.map(([k, l]) => `<label class="check"><input type="checkbox" value="${esc(k)}"${sel.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}<button type="submit">${esc(t('compareRun'))}</button></form>
    <div class="resultHead"><span></span>${resultToolbar()}</div>
    <div id="result">${table([t('metric'), ...groups.map(g => g.label)], rows, { numeric: groups.map((_, i) => i + 1) })}
    ${stacked(bands, groups.map(g => ({ name: g.label, values: bands.map(b => g.qsos.filter(q => q.band === b).length) })), { title: t('qsosPerBand'), drill: 'bands', width: 1240 })}</div></section>`;
};

// ---------- Exportação ----------
PAGES.exportlogs = () => {
  const n = filteredQsos().length;
  return `<section class="page wide">${head('logs', 'page_exportlogs', 'exportHelp')}${filterBar()}<p class="pill">${esc(t('selectedQsos', { n }))} · ${esc(filterSummary())}</p>
    <form id="exportForm" class="fields"><label><span>${esc(t('format'))}</span><select name="format"><option value="adif">ADIF v3 (.adi)</option><option value="csv">CSV</option><option value="cabrillo">Cabrillo 3.0</option><option value="kml">KML (Google Earth)</option></select></label>
      <label><span>${esc(t('cabrilloContest'))}</span><input name="contest" maxlength="40" placeholder="CQ-WW-SSB"></label>
      <label><span>${esc(t('cabrilloCall'))}</span><input name="call" maxlength="20" value="${esc(db.prefs.myCall)}"></label>
      <div class="formActions"><button type="submit" class="primary">${esc(t('export'))}</button></div></form></section>`;
};

PAGES.backup = () => `<section class="page">${head('logs', 'page_backup')}${backupSection()}</section>`;

// ---------- Configurações ----------
PAGES.preferences = () => {
  const p = db.prefs;
  return `<section class="page">${head('settings', 'page_preferences', 'preferencesHelp')}
    <form id="prefsForm" class="fields">
      <label><span>${esc(t('myCall'))}</span><input name="myCall" maxlength="20" value="${esc(p.myCall)}" placeholder="PT2VHF"></label>
      <label><span>${esc(t('myGrid'))}</span><input name="myGrid" maxlength="8" value="${esc(p.myGrid)}" placeholder="GH64"></label>
      <label><span>${esc(t('pauseDefault'))}</span><input name="pauseMinutes" type="number" min="1" max="240" value="${p.pauseMinutes}"></label>
      <label><span>${esc(t('pointsRule'))}</span><select name="pointsRule">${options(['adif', 'one', 'dx'], p.pointsRule, o => t('rule_' + o))}</select></label>
      <label><span>${esc(t('palette'))}</span><select name="palette">${options(['default', 'pt2vhf', 'mono'], p.palette, o => t('palette_' + o))}</select></label>
      <label><span>${esc(t('theme'))}</span><select name="theme">${options(['dark', 'light'], p.theme, o => t(o))}</select></label>
      <label class="check"><input type="checkbox" name="mergeQsl"${p.mergeQsl ? ' checked' : ''}> ${esc(t('mergeQsl'))}</label>
      <label class="check"><input type="checkbox" name="recalcOnImport"${p.recalcOnImport ? ' checked' : ''}> ${esc(t('recalcCountry'))}</label>
      <h2 class="span">${esc(t('lookupTitle'))}</h2><p class="help span">${esc(t('lookupHelp'))}</p>
      <label><span>${esc(t('qrzUser'))}</span><input name="qrzUser" maxlength="40" autocomplete="off" value="${esc(db.platforms.lookup?.qrzUser || '')}"></label>
      <label><span>${esc(t('qrzPass'))}</span><input name="qrzPass" type="password" autocomplete="off" placeholder="${db.platforms.lookup?.qrzSecret ? '••••••• (' + esc(t('saved')) + ')' : ''}"></label>
      <label><span>${esc(t('hamqthUser'))}</span><input name="hamqthUser" maxlength="40" autocomplete="off" value="${esc(db.platforms.lookup?.hamqthUser || '')}"></label>
      <label><span>${esc(t('hamqthPass'))}</span><input name="hamqthPass" type="password" autocomplete="off" placeholder="${db.platforms.lookup?.hamqthSecret ? '••••••• (' + esc(t('saved')) + ')' : ''}"></label>
      <div class="formActions"><span id="prefsError" class="error"></span><button type="submit" class="primary">${esc(t('save'))}</button></div></form>
    <p class="help">${esc(t('dataDir', { d: info.dataDir || '—' }))}</p></section>`;
};

PAGES.database = () => {
  const list = DB.stations(db);
  const rows = list.map(s => `<tr><td><label class="check"><input type="checkbox" class="stationCheck" value="${esc(s.station)}"> <strong>${esc(s.station || '—')}</strong></label></td><td class="num">${s.count.toLocaleString()}</td><td>${esc(fmtDate(s.first))} → ${esc(fmtDate(s.last))}</td></tr>`).join('');
  return `<section class="page">${head('settings', 'page_database', 'databaseHelp')}
    <div class="tiles">${tile(t('qsos'), db.qsos.length.toLocaleString())}${tile(t('stationsCount'), DB.stations(db).length)}</div>
    <h2>${esc(t('clearByCall'))}</h2><p class="help">${esc(t('clearByCallHelp'))}</p>
    ${list.length ? `<div class="tableWrap"><table><thead><tr><th><label class="check"><input type="checkbox" id="checkAllStations"> ${esc(t('station'))}</label></th><th class="num">${esc(t('qsos'))}</th><th>${esc(t('period'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="formActions"><button class="dangerButton" id="deleteStations">${esc(t('deleteSelectedCalls'))}</button></div>` : `<p class="help">${esc(t('emptyDbTitle'))}</p>`}
    ${backupSection()}
    <h2>${esc(t('countryFile'))}</h2><p class="help">${esc(t('countryFileHelp', { v: cty?.version || '—' }))}</p><div class="formActions left"><button id="loadCty">${esc(t('loadCty'))}</button><button id="resetCty">${esc(t('resetCty'))}</button></div>
    <section class="factoryResetZone"><div><strong>${esc(t('clearAll'))}</strong><p class="help">${esc(t('clearAllHelp'))}</p></div><button class="dangerButton" id="clearAll">${esc(t('clearAll'))}</button></section>
    <section class="factoryResetZone"><div><strong>${esc(t('factoryReset'))}</strong><p class="help">${esc(t('factoryResetHelp'))}</p></div><button class="dangerButton" id="factoryReset">${esc(t('factoryReset'))}</button></section></section>`;
};

PAGES.scratchpad = () => `<section class="page">${head('settings', 'page_scratchpad', 'scratchpadHelp')}<textarea id="scratchpad" rows="22" spellcheck="false">${esc(db.scratchpad)}</textarea><p class="help" id="scratchStatus"></p></section>`;

PAGES.activitylog = () => {
  const rows = db.activity.slice().reverse().map(a => [fmtDateTime(a.ts), t('act_' + a.type), a.detail]);
  lastResult = { page: 'activitylog', tables: [{ title: t('page_activitylog'), head: [t('date'), t('event'), t('details')], rows }] };
  return `<section class="page wide">${head('settings', 'page_activitylog', 'activityHelp')}<div class="resultHead"><span class="pill">${rows.length}</span><div class="resultToolbar"><button data-export="csv">CSV</button><button data-export="txt">TXT</button></div></div>${table([t('date'), t('event'), t('details')], rows)}</section>`;
};

PAGES.bug = () => `<section class="page">${head('settings', 'page_bug', 'bugHelp')}<pre class="diag">${esc(diagnostics())}</pre><div class="formActions left"><button id="copyDiag">${esc(t('copyDiag'))}</button><button id="openIssues" class="primary">${esc(t('openIssues'))}</button></div></section>`;

const diagnostics = () => `PT2VHF QSL Manager ${info.version || APP_VERSION}\n${isDesktop ? 'Desktop' : 'Browser'} · ${navigator.userAgent}\nQSOs: ${db.qsos.length} · containers: ${db.containers.length} · CTY: ${cty?.version || '—'}\nLanguage: ${db.prefs.language}`;

PAGES.help = () => `<section class="page">${head('help', 'page_help')}${['Start', 'Logs', 'Platforms', 'Stats', 'Qsl', 'Reports', 'Database', 'Formats'].map(k => `<article><h2>${esc(t('helpT' + k))}</h2><p>${esc(t('helpB' + k))}</p></article>`).join('')}</section>`;

PAGES.about = () => `<section class="page">${head('about', 'page_about')}<h2>PT2VHF QSL Manager v${esc(info.version || APP_VERSION)}</h2><p>${esc(t('aboutText'))}</p><p>${esc(t('author'))}</p>
  <div class="contactLinks"><button data-link="https://www.pt2vhf.com/qsl">${esc(t('project'))}</button><button data-link="https://github.com/alexpmr/QSL-Analyzer/issues">${esc(t('openIssues'))}</button><button data-link="https://www.pt2vhf.com">www.pt2vhf.com</button></div>
  <p class="help">${esc(t('credits'))}</p><p class="help">${esc(t('ctyVersion', { v: cty?.version || '—' }))}</p></section>`;

// ---------- Renderização e eventos ----------
function render() {
  renderHeader();
  const fn = PAGES[ui.page] || PAGES.dashboard;
  view.innerHTML = fn();
  afterRender();
}

function afterRender() {
  if (ui.page === 'scratchpad') {
    const ta = $('#scratchpad');
    ta.addEventListener('input', () => { db.scratchpad = ta.value; $('#scratchStatus').textContent = t('savedAuto'); persist(); });
  }
  const drop = $('#dropZone');
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async e => { e.preventDefault(); drop.classList.remove('over'); const files = await Promise.all([...e.dataTransfer.files].map(async f => ({ name: f.name, size: f.size, text: await f.text() }))); importFiles(files); });
  }
}

function tableToText(tbl) {
  const widths = tbl.head.map((h, i) => Math.min(40, Math.max(String(h).length, ...tbl.rows.map(r => String(r[i] ?? '').length))));
  const line = r => r.map((c, i) => String(c ?? '').slice(0, 40).padEnd(widths[i])).join('  ');
  return `${tbl.title}\n${'='.repeat(tbl.title.length)}\n${line(tbl.head)}\n${widths.map(w => '-'.repeat(w)).join('  ')}\n${tbl.rows.map(line).join('\n')}\n`;
}

async function svgToPng(svg) {
  const clone = svg.cloneNode(true);
  const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => { const cs = getComputedStyle(el); for (const p of ['fill', 'stroke', 'stroke-width', 'font-size', 'font-family', 'font-weight', 'opacity', 'fill-opacity']) dst[i].style.setProperty(p, cs.getPropertyValue(p)); });
  const vb = svg.viewBox.baseVal, scale = 2;
  clone.setAttribute('width', vb.width); clone.setAttribute('height', vb.height);
  const data = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(data)));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = vb.width * scale; canvas.height = vb.height * scale;
  const g = canvas.getContext('2d');
  g.fillStyle = getComputedStyle(document.body).getPropertyValue('--panel') || '#0f1a29';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').split(',')[1];
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

async function exportResult(kind) {
  if (!lastResult) return;
  const base = `QSL-Manager-${lastResult.page}-${stamp()}`;
  if (kind === 'csv') {
    const rows = [];
    for (const tb of lastResult.tables) { if (lastResult.tables.length > 1) rows.push([tb.title]); rows.push(tb.head, ...tb.rows, []); }
    return saved(await backend.saveFile(base + '.csv', toCsvRows(rows), 'csv'));
  }
  if (kind === 'txt') return saved(await backend.saveFile(base + '.txt', `PT2VHF QSL Manager — ${t('page_' + lastResult.page)}\n${filterSummary()}\n\n` + lastResult.tables.map(tableToText).join('\n'), 'txt'));
  if (kind === 'png') {
    const svg = [...document.querySelectorAll('#result svg.chart')].find(x => x.getClientRects().length);
    if (!svg) return toast(t('noChart'), true);
    return saved(await backend.saveBinary(base + '.png', await svgToPng(svg), 'png'));
  }
  if (kind === 'pdf') {
    const cfg = { ...reportCfg(), cover: false, sections: [], breakEach: false };
    const html = `<header class="rHead"><small>PT2VHF QSL MANAGER</small><h1>${esc(t('page_' + lastResult.page))}</h1><p class="rFilters">${esc(filterSummary())} · ${esc(fmtDateTime(Date.now()))} UTC</p></header>` + (lastResult.html || $('#result').innerHTML);
    return exportReportPdf(cfg, html, base + '.pdf');
  }
  if (kind === 'addreport') {
    const cfg = reportCfg();
    if (sectionById(lastResult.page)) { cfg.sections.push({ id: lastResult.page, params: { ...(ui.params[lastResult.page] || {}) } }); persist(); toast(t('addedToReport')); }
  }
}

function saved(path) { if (path) toast(t('savedTo', { p: path })); }

document.addEventListener('click', async e => {
  if (brush.justDragged) { brush.justDragged = false; return; }
  const tab = e.target.closest?.('[data-tab]');
  if (tab) {
    const bar = tab.closest('[data-tabs]'), i = Number(tab.dataset.tab);
    ui.tabs[bar.dataset.tabs] = i;
    bar.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('selected', b === tab));
    let panel = bar.nextElementSibling;
    while (panel?.matches('.tabPanel')) { panel.classList.toggle('hidden', Number(panel.dataset.panel) !== i); panel = panel.nextElementSibling; }
    return;
  }
  const ent = e.target.closest?.('[data-entity]');
  if (ent) { e.preventDefault(); const [type, ...rest] = ent.dataset.entity.split(':'); return openEntity(type, rest.join(':'), { keepHistory: Boolean(ent.closest('#entityDialog')) }); }
  const drill = e.target.closest?.('[data-drill]');
  if (drill && !e.target.closest('button')) return applyDrill(drill.dataset.drill);
  const legendItem = e.target.closest?.('.legendItem');
  if (legendItem) {
    const fig = legendItem.closest('figure'), k = legendItem.dataset.series, on = legendItem.getAttribute('aria-pressed') !== 'false';
    legendItem.setAttribute('aria-pressed', String(!on));
    fig.classList.toggle('hide-s' + k, on);
    return;
  }
  const chip = e.target.closest?.('[data-unfilter]');
  if (chip) { const next = structuredClone(ui.filter); delete next[chip.dataset.unfilter]; return setFilter(next); }
  const el = e.target.closest('button, [data-go]');
  if (!el) { if (!e.target.closest('#languageMenu')) $('#languageMenu').open = false; return; }
  if (el.dataset.group) return go(el.dataset.group);
  if (el.dataset.page && el.closest('#subNav')) return go(ui.group, el.dataset.page);
  if (el.dataset.go) { const [g, p] = el.dataset.go.split(':'); return go(g, p); }
  if (el.dataset.lang) { db.prefs.language = el.dataset.lang; $('#languageMenu').open = false; persist(); return render(); }
  if (el.id === 'themeButton') { db.prefs.theme = db.prefs.theme === 'light' ? 'dark' : 'light'; persist(); return render(); }
  if (el.dataset.link) return backend.openExternal(el.dataset.link);
  if (el.dataset.export) return exportResult(el.dataset.export);
  if (el.id === 'clearFilter') return setFilter({});
  if (el.id === 'undoFilter') { ui.filter = ui.filterHistory.pop() || {}; return render(); }
  if (el.id === 'updateButton') return checkUpdate(true);
  if (el.id === 'pickFiles') return importFiles(await backend.openFiles());
  if (el.id === 'pasteImport') { const text = $('#pasteText').value; if (text.trim()) importFiles([{ name: 'colado-' + stamp() + '.adi', text, size: text.length }]); return; }
  if (el.id === 'progressClose') return $('#progressDialog').close();
  if (el.id === 'progressGo') { $('#progressDialog').close(); return go('dashboard'); }
  if (el.dataset.lookupRefresh) return openEntity('call', el.dataset.lookupRefresh, { refresh: true, keepHistory: true });
  if (el.dataset.entityFilter) {
    const [type, ...rest] = el.dataset.entityFilter.split(':'), value = rest.join(':'), next = structuredClone(ui.filter);
    next[ENTITY_FILTER[type]] = [type === 'grid' ? value.toUpperCase().slice(0, 4) : value];
    $('#entityDialog').close();
    return setFilter(next);
  }
  if (el.dataset.entityClose !== undefined) return $('#entityDialog').close();
  if (el.id === 'entityBack') { ui.entityStack.pop(); const prev = ui.entityStack.pop(); if (prev) openEntity(prev.type, prev.value, { keepHistory: true }); return; }
  if (el.id === 'saveFilter') {
    const name = prompt(t('saveFilterPrompt'), filterSummary());
    if (!name) return;
    (db.prefs.savedFilters ||= {})[name.trim()] = structuredClone(ui.filter);
    persist(); toast(t('filterSaved')); return render();
  }
  if (el.id === 'deleteSavedFilter') {
    const name = $('#savedFilterSel').value;
    if (!name) return toast(t('chooseSavedFilter'), true);
    delete db.prefs.savedFilters[name]; persist(); return render();
  }
  if (el.dataset.qsoNew !== undefined) return openQsoForm();
  if (el.dataset.qsoNewCall) return openQsoForm(null, el.dataset.qsoNewCall);
  if (el.dataset.qsoEdit) return openQsoForm(Number(el.dataset.qsoEdit));
  if (el.dataset.qsoDelete) return deleteQso(Number(el.dataset.qsoDelete));
  if (el.dataset.qsoCancel !== undefined) return $('#qsoDialog').close();
  if (el.dataset.contactsPage) { ui.contactsPage = Number(el.dataset.contactsPage); return render(); }
  if (el.dataset.platformCompare) return comparePlatform(el.dataset.platformCompare, el.closest('form'));
  if (el.dataset.platformUpload) return uploadPlatform(el.dataset.platformUpload, el.closest('form'));
  if (el.dataset.platformSync) return syncPlatform(el.dataset.platformSync, el.closest('form'));
  if (el.dataset.platformExport) { const id = el.dataset.platformExport, list = filteredQsos(); return saved(await backend.saveFile(`QSL-Manager-${id}-${stamp()}.adi`, toAdif(list, info.version || APP_VERSION), 'adif')); }
  if (el.dataset.exportOnlyLocal) { const c = ui.platformCompare[el.dataset.exportOnlyLocal]; return saved(await backend.saveFile(`QSL-Manager-somente-no-app-${el.dataset.exportOnlyLocal}-${stamp()}.adi`, toAdif(c.onlyLocal, info.version || APP_VERSION), 'adif')); }
  if (el.dataset.importOnlyRemote) { const id = el.dataset.importOnlyRemote, c = ui.platformCompare[id]; delete ui.platformCompare[id]; return importFiles([{ name: id + '.adi', text: c.adif }], { ...readImportForm(), station: (db.platforms[id]?.station || db.prefs.myCall || '').toUpperCase(), format: 'adif', mergeQsl: true, recalc: true }, { title: t('platformImportTitle', { p: PLATFORMS[id].name }), source: PLATFORMS[id].name, adjust: platformAdjust(id) }); }
  if (el.dataset.healthShow) { ui.healthCheck = el.dataset.healthShow; return render(); }
  if (el.dataset.healthFix) { const kind = HEALTH_FIX[el.dataset.healthFix]; if (kind === 'deleteNearDupes' && !confirm(t('confirmDeleteQsos', { n: ui.health.nearDupes.length }))) return; return applyHealthFix(kind); }
  if (el.dataset.typoFix) return applyHealthFix('fixTypos', Number(el.dataset.typoFix));
  if (el.id === 'removeDupesFiltered') {
    if (!confirm(t('confirmRemoveDupes'))) return;
    toast(t('removedN', { n: DB.removeDupesFiltered(db, ui.filter) })); persist(); return render();
  }
  if (el.id === 'yearReport') return applyYearReport();
  if (el.id === 'deleteSelected') {
    const list = filteredQsos();
    if (!list.length || !confirm(t('confirmDeleteQsos', { n: list.length }))) return;
    toast(t('removedN', { n: DB.deleteQsos(db, list.map(q => q.id)) })); persist(); return render();
  }
  if (el.id === 'checkAllStations') { document.querySelectorAll('.stationCheck').forEach(c => (c.checked = el.checked)); return; }
  if (el.id === 'deleteStations') {
    const list = [...document.querySelectorAll('.stationCheck:checked')].map(c => c.value);
    if (!list.length) return toast(t('selectCalls'), true);
    if (!confirm(t('confirmDeleteCalls', { calls: list.map(s => s || '—').join(', ') }))) return;
    const n = DB.deleteByStations(db, list);
    await persist(true); toast(t('removedN', { n })); return render();
  }
  if (el.id === 'clearAll') { if (confirm(t('confirmClearAll')) && confirm(t('confirmAgain'))) { toast(t('removedN', { n: DB.clearAll(db) })); await persist(true); render(); } return; }
  if (el.id === 'factoryReset') { if (confirm(t('confirmFactoryReset'))) { await backend.factoryReset(); } return; }
  if (el.id === 'loadCty') {
    const files = await backend.openFiles();
    if (!files?.length) return;
    const test = parseCty(files[0].text);
    if (test.entities.length < 300) return toast(t('invalidCty'), true);
    await backend.saveCty(files[0].text); await loadCountryFile(); toast(t('ctyLoaded', { v: cty.version || '—' })); return render();
  }
  if (el.id === 'resetCty') { await backend.saveCty(''); await loadCountryFile(); toast(t('ctyLoaded', { v: cty.version || '—' })); return render(); }
  if (el.id === 'backupNow') return backupNow();
  if (el.id === 'restoreNow') return restoreBackup();
  if (el.dataset.cloudFolder) { db.prefs.backupFolder = el.dataset.cloudFolder; if (db.prefs.autoBackup === 'off') db.prefs.autoBackup = 'daily'; persist(); toast(t('cloudFolderSet')); return render(); }
  if (el.id === 'chooseBackupFolder') { const dir = await backend.chooseFolder(); if (dir) { db.prefs.backupFolder = dir; persist(); render(); } return; }
  if (el.id === 'defaultBackupFolder') { db.prefs.backupFolder = ''; persist(); return render(); }
  if (el.id === 'copyDiag') { await navigator.clipboard?.writeText(diagnostics()); return toast(t('copied')); }
  if (el.id === 'openIssues') return backend.openExternal('https://github.com/alexpmr/QSL-Analyzer/issues/new?body=' + encodeURIComponent('\n\n---\n' + diagnostics()));
  // Relatório
  const cfgButtons = ['addSectionBtn', 'resetReport', 'saveTemplate', 'loadTemplate', 'deleteTemplate', 'reportPdf', 'reportHtml'];
  if (el.dataset.rs || cfgButtons.includes(el.id)) {
    const cfg = readReportForm();
    if (el.dataset.rs) {
      const i = Number(el.dataset.i), s = cfg.sections;
      if (el.dataset.rs === 'up' && i > 0) [s[i - 1], s[i]] = [s[i], s[i - 1]];
      if (el.dataset.rs === 'down' && i < s.length - 1) [s[i + 1], s[i]] = [s[i], s[i + 1]];
      if (el.dataset.rs === 'remove') s.splice(i, 1);
    }
    if (el.id === 'addSectionBtn' && $('#addSection').value) cfg.sections.push({ id: $('#addSection').value, params: {} });
    if (el.id === 'resetReport') db.prefs.report = structuredClone(REPORT_DEFAULT);
    if (el.id === 'saveTemplate') { const name = $('#templateName').value.trim(); if (!name) return toast(t('templateName'), true); (db.prefs.reportTemplates ||= {})[name] = structuredClone(cfg); toast(t('templateSaved')); }
    if (el.id === 'loadTemplate') { const name = $('#templateSel').value; if (name && db.prefs.reportTemplates?.[name]) db.prefs.report = structuredClone(db.prefs.reportTemplates[name]); }
    if (el.id === 'deleteTemplate') { const name = $('#templateSel').value; if (name) delete db.prefs.reportTemplates[name]; }
    if (el.id === 'reportPdf') return exportReportPdf(cfg, buildReport(cfg), `QSL-Manager-${(cfg.title || 'report').replace(/[^\p{L}\p{N}-]+/gu, '_')}-${stamp()}.pdf`);
    if (el.id === 'reportHtml') return saved(await backend.saveFile(`QSL-Manager-${(cfg.title || 'report').replace(/[^\p{L}\p{N}-]+/gu, '_')}-${stamp()}.html`, reportHtmlDocument(cfg, buildReport(cfg)), 'html'));
    persist();
    return render();
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  if (form.id === 'filterBar') return setFilter(readFilterBar());
  if (form.id === 'paramsBar') {
    const page = sectionById(ui.page), p = ui.params[ui.page] ||= defaultParams(page);
    for (const el of form.querySelectorAll('[data-param]')) p[el.dataset.param] = el.type === 'number' ? Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) || Number(el.min))) : el.value;
    return render();
  }
  if (form.id === 'importForm') return;
  if (form.id === 'qsoForm') return saveQsoForm(form);
  if (form.id === 'autoBackupForm') { const f = new FormData(form); db.prefs.autoBackup = f.get('autoBackup'); db.prefs.backupKeep = Math.max(1, Math.min(100, Number(f.get('backupKeep')) || 5)); persist(); toast(t('saved')); if (db.prefs.autoBackup !== 'off' && !db.prefs.lastAutoBackup) autoBackup(true); return render(); }
  if (form.dataset.platform) return runPlatform(form.dataset.platform, form);
  if (form.id === 'modifyForm') {
    const f = new FormData(form), list = filteredQsos();
    if (!list.length) return toast(t('noQsosFilter'), true);
    const ops = { countryFile: f.get('countryFile'), bandFromFreq: f.get('bandFromFreq') === 'on', modeMap: [{ from: f.get('modeFrom'), to: String(f.get('modeTo') || '').trim() }].filter(m => m.from && m.to), setStation: String(f.get('setStation') || '').trim(), setOperator: String(f.get('setOperator') || '').trim(), setMyGrid: String(f.get('setMyGrid') || '').trim() };
    if (!confirm(t('confirmModify', { n: list.length }))) return;
    const r = DB.reprocess(db, ui.filter, ops, cty);
    persist(); toast(t('modifyDone', { m: r.matched, c: r.changed })); return render();
  }
  if (form.id === 'searchForm') { ui.searchText = $('#searchInput').value.trim(); return render(); }
  if (form.id === 'reportForm') { readReportForm(); return render(); }
  if (form.id === 'compareForm') { ui.compareSel = [...form.querySelectorAll('input:checked')].map(i => i.value); return render(); }
  if (form.id === 'exportForm') {
    const f = new FormData(form), list = filteredQsos();
    if (!list.length) return toast(t('noQsosFilter'), true);
    const fmt = f.get('format'), base = `QSL-Manager-${stamp()}`;
    let content, name;
    if (fmt === 'adif') { content = toAdif(list, info.version || APP_VERSION); name = base + '.adi'; }
    if (fmt === 'csv') { content = toCsv(list); name = base + '.csv'; }
    if (fmt === 'cabrillo') { content = toCabrillo(list, { call: String(f.get('call') || '').toUpperCase(), contest: f.get('contest'), operators: [...S.distinct(list, q => q.operator)].join(' '), grid: db.prefs.myGrid, version: info.version || APP_VERSION }); name = base + '.log'; }
    if (fmt === 'kml') { content = toKml(list, { title: 'PT2VHF QSL Manager', home: homePosition(), layers: ['dxcc', 'grids'] }); name = base + '.kml'; }
    DB.logActivity(db, 'export', `${fmt}: ${list.length}`); persist();
    return saved(await backend.saveFile(name, content, fmt));
  }
  if (form.id === 'kmlForm') {
    const f = new FormData(form), layers = ['dxcc', 'grids', 'lines'].filter(k => f.get(k) === 'on');
    const content = toKml(filteredQsos(), { title: 'PT2VHF QSL Manager · ' + filterSummary(), home: homePosition(), layers, timeline: f.get('timeline') === 'on' });
    return saved(await backend.saveFile(`QSL-Manager-${stamp()}.kml`, content, 'kml'));
  }
  if (form.id === 'prefsForm') {
    const f = new FormData(form), grid = String(f.get('myGrid') || '').trim();
    if (grid && !gridValid(grid)) { $('#prefsError').textContent = t('invalidGrid'); return; }
    Object.assign(db.prefs, { myCall: String(f.get('myCall') || '').trim().toUpperCase(), myGrid: grid, pauseMinutes: Number(f.get('pauseMinutes')) || 15, pointsRule: f.get('pointsRule'), palette: f.get('palette'), theme: f.get('theme'), mergeQsl: f.get('mergeQsl') === 'on', recalcOnImport: f.get('recalcOnImport') === 'on' });
    const lk = db.platforms.lookup ||= {};
    lk.qrzUser = String(f.get('qrzUser') || '').trim(); lk.hamqthUser = String(f.get('hamqthUser') || '').trim();
    if (f.get('qrzPass')) lk.qrzSecret = await backend.encrypt(String(f.get('qrzPass')));
    if (f.get('hamqthPass')) lk.hamqthSecret = await backend.encrypt(String(f.get('hamqthPass')));
    if (!lk.qrzUser) delete lk.qrzSecret;
    if (!lk.hamqthUser) delete lk.hamqthSecret;
    lookupSession.qrz = lookupSession.hamqth = null;
    persist(); toast(t('saved')); return render();
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'activeStation') { db.prefs.activeStation = e.target.value; persist(); return render(); }
  if (e.target.id === 'savedFilterSel' && e.target.value) { const f = db.prefs.savedFilters?.[e.target.value]; if (f) setFilter(structuredClone(f)); }
  // Filtros "vivos": selects e datas aplicam imediatamente.
  if (e.target.matches?.('select[data-filter], input[type=date][data-filter]')) setFilter(readFilterBar());
  if (e.target.matches?.('#paramsBar select')) e.target.form.requestSubmit();
});

// Dica flutuante e mira dos gráficos de linha.
const tip = $('#tip');
document.addEventListener('mousemove', e => {
  const el = e.target.closest?.('[data-tip]');
  if (!el) { tip.style.display = 'none'; document.querySelectorAll('.crosshair.on').forEach(c => c.classList.remove('on')); return; }
  tip.textContent = el.dataset.tip;
  tip.style.display = 'block';
  const x = Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14), y = Math.max(8, e.clientY - tip.offsetHeight - 10);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
  if (el.dataset.cx) { const ch = el.ownerSVGElement?.querySelector('.crosshair'); if (ch) { ch.setAttribute('x1', el.dataset.cx); ch.setAttribute('x2', el.dataset.cx); ch.classList.add('on'); } }
});

// Seleção de período por arraste nos gráficos de linha (zoom no tempo).
const brush = { svg: null, start: 0, justDragged: false };
const svgX = (svg, clientX) => { const p = svg.createSVGPoint(); p.x = clientX; p.y = 0; return p.matrixTransform(svg.getScreenCTM().inverse()).x; };
document.addEventListener('mousedown', e => {
  const svg = e.target.closest?.('svg.lineChart');
  if (!svg || e.button !== 0) return;
  brush.svg = svg; brush.start = svgX(svg, e.clientX);
  e.preventDefault();
});
document.addEventListener('mousemove', e => {
  if (!brush.svg) return;
  const x = svgX(brush.svg, e.clientX), r = brush.svg.querySelector('.brush');
  r.setAttribute('x', Math.min(x, brush.start)); r.setAttribute('width', Math.abs(x - brush.start));
});
document.addEventListener('mouseup', e => {
  if (!brush.svg) return;
  const svg = brush.svg, x = svgX(svg, e.clientX);
  brush.svg = null;
  svg.querySelector('.brush').setAttribute('width', 0);
  if (Math.abs(x - brush.start) < 6) return;
  brush.justDragged = true;
  setTimeout(() => (brush.justDragged = false), 50);
  const [x0, x1, left, plotW] = svg.dataset.brush.split(',').map(Number);
  const toTs = px => Math.round(x0 + ((Math.min(Math.max(px, left), left + plotW) - left) / plotW) * (x1 - x0));
  const a = toTs(Math.min(x, brush.start)), b = toTs(Math.max(x, brush.start));
  if (b > a) { const next = structuredClone(ui.filter); next.range = [a, b]; setFilter(next); toast(t('drilled', { f: filterSummary(next) })); }
});

// ---------- Ficha da entidade e dados da estação (QRZ.com / HamQTH) ----------
const lookupSession = { qrz: null, hamqth: null };

async function lookupCreds() {
  const lk = db.platforms.lookup || {}, dec = async v => { try { return v ? await backend.decrypt(v) : ''; } catch { return ''; } };
  return { qrzUser: lk.qrzUser || '', qrzPass: await dec(lk.qrzSecret), hamqthUser: lk.hamqthUser || '', hamqthPass: await dec(lk.hamqthSecret) };
}

async function lookupStation(call) {
  const c = await lookupCreds();
  const configured = Boolean((c.qrzUser && c.qrzPass) || (c.hamqthUser && c.hamqthPass));
  if (!configured) return { data: null, meta: { configured: false } };
  let data = null, error = '';
  if (c.qrzUser && c.qrzPass) {
    try {
      for (let attempt = 0; attempt < 2 && !data; attempt++) {
        if (!lookupSession.qrz) { const r = parseQrz((await backend.lookup(qrzLoginUrl(c.qrzUser, c.qrzPass))).text); if (!r.key) throw new Error(r.error || 'QRZ'); lookupSession.qrz = r.key; }
        const r = parseQrz((await backend.lookup(qrzLookupUrl(lookupSession.qrz, call))).text);
        if (r.data) data = r.data;
        else if (r.notFound) break;
        else lookupSession.qrz = null;
      }
    } catch (e) { error = 'QRZ.com: ' + e.message; }
  }
  if (!data && c.hamqthUser && c.hamqthPass) {
    try {
      for (let attempt = 0; attempt < 2 && !data; attempt++) {
        if (!lookupSession.hamqth) { const r = parseHamqth((await backend.lookup(hamqthLoginUrl(c.hamqthUser, c.hamqthPass))).text); if (!r.key) throw new Error(r.error || 'HamQTH'); lookupSession.hamqth = r.key; }
        const r = parseHamqth((await backend.lookup(hamqthLookupUrl(lookupSession.hamqth, call))).text);
        if (r.data) data = r.data;
        else if (r.notFound) break;
        else lookupSession.hamqth = null;
      }
    } catch (e) { error = (error ? error + ' · ' : '') + 'HamQTH: ' + e.message; }
  }
  if (data?.image) {
    try { const img = await backend.lookup(data.image, true); if (img.base64 && img.base64.length < 700000) data.imageData = `data:${img.type || 'image/jpeg'};base64,${img.base64}`; } catch { /* sem foto */ }
  }
  return { data, meta: { configured: true, fetched: Date.now(), error: data ? '' : error } };
}

async function openEntity(type, value, { refresh = false, keepHistory = false } = {}) {
  const dlg = $('#entityDialog');
  if (!keepHistory) ui.entityStack = [];
  ui.entityStack.push({ type, value });
  const draw = () => {
    const html = renderEntity({ t, qsos: db.qsos, type, value, home: homePosition(), lookup: type === 'call' ? db.lookup[value] || ui.lookupPending?.[value] || null : null });
    $('#entityBody').innerHTML = (ui.entityStack.length > 1 ? `<button id="entityBack" class="back">← ${esc(t('back'))}</button>` : '') + tabify(html, 'entity-' + type);
  };
  draw();
  if (!dlg.open) dlg.showModal();
  $('#entityBody').scrollTop = 0;
  if (type !== 'call' || !isDesktop) return;
  const cached = db.lookup[value];
  if (!refresh && cached && Date.now() - (cached.meta?.fetched || 0) < 30 * 86400000) return;
  (ui.lookupPending ||= {})[value] = { data: cached?.data || null, meta: { ...(cached?.meta || {}), configured: true, error: '' } };
  const res = await lookupStation(value);
  delete ui.lookupPending[value];
  if (res.data || res.meta.configured) { db.lookup[value] = res; persist(); }
  const top = ui.entityStack[ui.entityStack.length - 1];
  if (dlg.open && top?.type === 'call' && top.value === value) draw();
}

// Relatório pronto "Meu ano no rádio": seções e filtro do ano corrente (ou do anterior no começo do ano).
function applyYearReport() {
  const now = new Date(), year = now.getUTCMonth() < 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  db.prefs.report = { ...structuredClone(REPORT_DEFAULT), title: t('yearReportTitle', { year }), subtitle: db.prefs.myCall || '', author: db.prefs.myCall || '', sections: ['basic', 'qsocharts', 'historical', 'newcalls', 'dxccfirst', 'propagation', 'awards', 'friends', 'qsl'].map(id => ({ id, params: {} })) };
  ui.filter = { ...ui.filter, from: `${year}-01-01`, to: `${year}-12-31` };
  persist();
  toast(t('yearReportReady', { year }));
  render();
}

async function loadCountryFile() {
  let text = await backend.loadCty();
  if (!text) text = await (await fetch('../src/data/cty.dat')).text();
  const table = await (await fetch('../src/data/dxcc.json')).json();
  cty = attachDxcc(parseCty(text), table);
}

const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';

// Atualização OTA: no Windows baixa, confere e instala sozinha; nas demais plataformas abre o site.
function showUpdateDialog(r) {
  const dlg = $('#updateNotice');
  $('#updateNoticeTitle').textContent = t('newVersionTitle');
  $('#updateNoticeMessage').textContent = t(r.canInstall ? 'newVersionOta' : 'newVersionMessage', { v: r.latest, current: info.version });
  $('#updateNoticeNotes').textContent = r.notes || '';
  $('#updateProgressBox').classList.add('hidden');
  const later = $('#updateNoticeLater'), go = $('#updateNoticeOpen');
  later.textContent = t('later'); later.disabled = false; later.onclick = () => dlg.close();
  go.textContent = r.canInstall ? t('updateNow') : t('openDownloadPage'); go.disabled = false;
  go.onclick = async () => {
    if (!r.canInstall) { dlg.close(); return backend.openExternal(r.url); }
    go.disabled = true; later.disabled = true;
    $('#updateProgressBox').classList.remove('hidden');
    const off = backend.onUpdateProgress(p => {
      $('#updateProgress').value = p.percent; $('#updatePct').textContent = Math.floor(p.percent) + '%';
      $('#updateStats').textContent = t('updateBytes', { done: mb(p.transferred), total: mb(p.total), speed: p.bytesPerSecond ? mb(p.bytesPerSecond) + '/s' : '—' });
    });
    try {
      $('#updateStats').textContent = t('downloading');
      await backend.downloadUpdate();
      $('#updateStats').textContent = t('updateInstalling');
      await persist(true);
      await backend.installUpdate();
    } catch (e) {
      $('#updateStats').textContent = t('updateFailed', { e: e.message });
      later.disabled = false; later.textContent = t('close');
      go.disabled = false; go.textContent = t('openDownloadPage'); r = { ...r, canInstall: false };
    } finally { off(); }
  };
  if (!dlg.open) dlg.showModal();
}

async function checkUpdate(manual = false) {
  if (!isDesktop) return;
  const btn = $('#updateButton');
  try {
    const r = await backend.checkUpdate();
    if (r?.available) {
      btn.textContent = t('updateAvailable', { v: r.latest }); btn.className = 'updateButton available';
      ui.updateInfo = r;
      showUpdateDialog(r);
    } else { btn.textContent = t('upToDate'); btn.className = 'updateButton current'; if (manual) toast(t('upToDate')); }
  } catch { btn.textContent = t('checkUpdate'); if (manual) toast(t('updateCheckFailed'), true); }
}

async function showMigration() {
  const m = await backend.takeMigration().catch(() => null);
  if (m?.qsos) toast(t('migratedData', { n: m.qsos.toLocaleString() }));
}

async function showNews() {
  const news = await backend.takeNews().catch(() => null);
  if (!news) return;
  $('#newsTitle').textContent = t('whatsNew', { v: news.version });
  $('#newsNotes').textContent = news.notes || '';
  $('#newsOk').textContent = t('continue');
  await new Promise(resolve => { $('#newsOk').onclick = () => $('#newsDialog').close(); $('#newsDialog').addEventListener('close', resolve, { once: true }); $('#newsDialog').showModal(); });
}

// Aviso do site oficial a cada abertura; a verificação de versão nova vem logo depois de fechá-lo.
function siteNotice() {
  const dlg = $('#siteNotice');
  $('#siteNoticeTitle').textContent = t('siteNoticeTitle');
  $('#siteNoticeMessage').textContent = t('siteNoticeMessage');
  $('#siteNoticeLink').textContent = 'www.PT2VHF.com';
  $('#siteNoticeOk').textContent = t('understood');
  $('#siteNoticeLink').onclick = e => { e.preventDefault(); backend.openExternal('https://www.pt2vhf.com/qsl'); };
  $('#siteNoticeOk').onclick = () => dlg.close();
  dlg.addEventListener('close', async () => { await showMigration(); await showNews(); checkUpdate(false); autoSyncPlatforms(); }, { once: true });
  dlg.showModal();
  $('#siteNoticeOk').focus();
}

async function start() {
  info = await backend.info();
  const raw = await backend.loadDb();
  try { db = DB.migrate(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { db = DB.emptyDb(); toast('DB inválido; iniciado vazio', true); }
  if (!raw) { const lang = navigator.language || ''; db.prefs.language = lang.startsWith('pt') ? 'pt-BR' : lang.startsWith('es') ? 'es' : 'en'; }
  await Promise.all([loadCountryFile(), loadLand()]);
  // QSOs antigos sem coordenadas de entidade recebem os dados atuais do CTY (sem sobrescrever o que veio do log).
  for (const q of db.qsos) if (!Number.isFinite(q.elat)) { const info2 = lookup(cty, q.call); if (info2) { q.elat = info2.lat; q.elon = info2.lon; } }
  $('#updateButton').classList.toggle('hidden', !isDesktop);
  $('#updateButton').textContent = t('checkUpdate');
  render();
  document.body.classList.remove('loading');
  if (isDesktop && !info.smoke) siteNotice();
  backend.backupDir('').then(d => (ui.backupDefaultDir = d)).catch(() => {});
  backend.cloudFolders().then(l => (ui.cloudFolders = l || [])).catch(() => {});
  autoBackup();
  $('#entityDialog').addEventListener('close', () => (ui.entityStack = []));
  view.addEventListener('toggle', e => { if (e.target.matches?.('.filterBox')) ui.filtersOpen = e.target.open; }, true);
}

start().catch(e => { console.error(e); view.innerHTML = `<section class="page"><p class="notice">${esc(e.message)}</p></section>`; });
