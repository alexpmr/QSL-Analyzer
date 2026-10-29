import { parseCty, attachDxcc, lookup } from '../src/cty.mjs';
import { parseLog, detectFormat } from '../src/parsers.mjs';
import * as DB from '../src/db.mjs';
import * as S from '../src/stats.mjs';
import { sortBands } from '../src/bands.mjs';
import { gridToLatLon, gridValid } from '../src/geo.mjs';
import { toAdif, toCsv, toCabrillo, toKml, toCsvRows } from '../src/export.mjs';
import { PLATFORMS, buildRequest, parseResponse, validateCreds } from '../src/platforms.mjs';
import { LANGUAGES, translate } from '../src/i18n.mjs';
import { APP_VERSION } from '../src/version.mjs';
import { backend, isDesktop } from './backend.mjs';
import { setPalette, loadLand, bars, worldMap, stacked, table, tile, esc } from './charts.mjs';
import { STAT_PAGES, QSL_PAGE, ALL_SECTIONS, sectionById, defaultParams, fmtDate, fmtDateTime, fmtDur } from './pages.mjs';

const $ = s => document.querySelector(s);
const view = $('#view');
let db = DB.emptyDb(), cty = null, info = {}, saveTimer = null, lastResult = null;
const ui = { group: 'dashboard', page: 'dashboard', filter: {}, params: {}, importPreview: null, importReport: null, searchText: '', reportPreview: '', busy: false };

const t = (key, vars) => translate(db.prefs.language, key, vars);

// ---------- Navegação ----------
const NAV = [
  { id: 'dashboard', pages: ['dashboard'] },
  { id: 'logs', pages: ['containers', 'upload', 'import', 'modify', 'copyfilter', 'search', 'platforms'], numbered: 5 },
  { id: 'stats', pages: STAT_PAGES.map(p => p.id) },
  { id: 'qsl', pages: ['qsl'] },
  { id: 'reports', pages: ['report', 'compare'] },
  { id: 'export', pages: ['exportlogs', 'backup'] },
  { id: 'settings', pages: ['preferences', 'database', 'scratchpad', 'activitylog', 'bug'] },
  { id: 'help', pages: ['help'] },
  { id: 'about', pages: ['about'] },
];
const FILTERED = new Set([...STAT_PAGES.map(p => p.id), 'qsl', 'modify', 'copyfilter', 'exportlogs', 'report']);

function renderHeader() {
  $('#appVersion').textContent = 'v' + (info.version || APP_VERSION);
  $('#subtitle').textContent = t('subtitle');
  $('#dbPill').textContent = t('dbPill', { n: db.qsos.length.toLocaleString(), s: DB.stations(db).length });
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
    sub.innerHTML = `<small>${esc(t('nav_' + group.id))}</small>` + group.pages.map((p, i) => `<button data-page="${p}" class="${p === ui.page ? 'selected' : ''}">${group.numbered && i < group.numbered ? `<b>${i + 1}→</b> ` : ''}${esc(t('page_' + p))}</button>`).join('');
  } else { sub.classList.add('hidden'); sub.innerHTML = ''; }
  document.documentElement.dataset.theme = db.prefs.theme;
  document.documentElement.lang = db.prefs.language;
  setPalette(db.prefs.palette, db.prefs.theme);
  document.title = 'PT2VHF QSL Analyzer v' + (info.version || APP_VERSION);
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
const containerName = id => db.containers.find(c => c.id === id)?.name || id;
const options = (list, selected, labelFn = v => v) => list.map(v => `<option value="${esc(v)}"${String(selected) === String(v) ? ' selected' : ''}>${esc(labelFn(v))}</option>`).join('');
const homePosition = () => gridToLatLon(db.prefs.myGrid) || null;
const pointsFor = () => S.pointsFn(db.prefs.pointsRule, cty, db.prefs.myCall);

function filteredQsos(filter = ui.filter) {
  return S.byTime(DB.applyFilter(db.qsos, filter));
}

function filterValues() {
  const scope = ui.filter.containers?.length ? db.qsos.filter(q => ui.filter.containers.includes(q.c)) : db.qsos;
  return {
    stations: [...S.distinct(scope, q => q.station || '')].sort(), bands: sortBands([...S.distinct(scope, q => q.band)]), modes: [...S.distinct(scope, q => q.mode)].sort(),
    operators: [...S.distinct(scope, q => q.operator || '')].sort(), conts: [...S.distinct(scope, q => q.cont)].sort(),
  };
}

function filterBar() {
  const v = filterValues(), f = ui.filter, one = k => (f[k] && f[k][0]) ?? '';
  const sel = (key, list, label, fmt = x => x || '—') => `<label><span>${esc(t(label))}</span><select data-filter="${key}"><option value="">${esc(t('all'))}</option>${options(list, one(key), fmt)}</select></label>`;
  const active = Object.values(f).some(x => (Array.isArray(x) ? x.length : x));
  return `<form id="filterBar" class="filterBar">
    ${sel('containers', db.containers.map(c => c.id), 'container', containerName)}${sel('stations', v.stations, 'station')}${sel('bands', v.bands, 'band')}${sel('modes', v.modes, 'mode')}${sel('operators', v.operators, 'operator')}${sel('conts', v.conts, 'cont')}
    <label><span>${esc(t('from'))}</span><input type="date" data-filter="from" value="${esc(f.from || '')}"></label><label><span>${esc(t('to'))}</span><input type="date" data-filter="to" value="${esc(f.to || '')}"></label>
    <label><span>${esc(t('callWildcard'))}</span><input data-filter="call" value="${esc(f.call || '')}" placeholder="PY*"></label>
    <div class="filterActions"><button type="submit">${esc(t('apply'))}</button>${active ? `<button type="button" id="clearFilter">${esc(t('clearFilter'))}</button>` : ''}${ui.filterHistory?.length ? `<button type="button" id="undoFilter" title="${esc(t('undoFilter'))}">↶</button>` : ''}</div></form>
    ${active ? `<div class="chips"><small>${esc(t('activeFilters'))}</small>${filterChips()}</div>` : `<p class="biHint">${esc(t('biHint'))}</p>`}`;
}

const BAR_KEYS = ['containers', 'stations', 'bands', 'modes', 'operators', 'conts', 'from', 'to', 'call'];
function readFilterBar() {
  const f = Object.fromEntries(Object.entries(ui.filter).filter(([k]) => !BAR_KEYS.includes(k)));
  for (const el of document.querySelectorAll('[data-filter]')) {
    const k = el.dataset.filter, val = el.value.trim();
    if (!val) continue;
    f[k] = ['from', 'to', 'call'].includes(k) ? val : [val];
  }
  return f;
}

const FILTER_LABELS = { containers: 'container', stations: 'station', bands: 'band', modes: 'mode', operators: 'operator', conts: 'cont', from: 'from', to: 'to', call: 'callWildcard', calls: 'call', countries: 'country', cqz: 'cqZones', ituz: 'ituZones', grids: 'locator', hours: 'hourUtc', weekdays: 'weekday', radios: 'opt_radio', range: 'period' };

function filterValueText(k, v) {
  if (k === 'range') return `${fmtDateTime(Number(v[0]))} → ${fmtDateTime(Number(v[1]))}`;
  if (k === 'weekdays') return v.map(x => t('weekdays').split(',')[Number(x)]).join(', ');
  if (k === 'hours') return v.map(x => String(x).padStart(2, '0') + 'h').join(', ');
  return Array.isArray(v) ? v.map(x => (k === 'containers' ? containerName(x) : x || '—')).join(', ') : v;
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

function paramsBar(page) {
  if (!page.params.length) return '';
  const p = ui.params[page.id] ||= defaultParams(page);
  return `<form id="paramsBar" class="paramsBar">${page.params.map(def => {
    const val = p[def.id];
    if (def.type === 'select') return `<label><span>${esc(t(def.label))}</span><select data-param="${def.id}">${options(def.options, val, o => t('opt_' + o) === 'opt_' + o ? o : t('opt_' + o))}</select></label>`;
    return `<label><span>${esc(t(def.label))}</span><input type="number" data-param="${def.id}" min="${def.min}" max="${def.max}" value="${esc(val)}"></label>`;
  }).join('')}<button type="submit">${esc(t('recalculate'))}</button></form>`;
}

function statContext(qsos, report = false) {
  return { t, qsos, prefs: db.prefs, cty, points: pointsFor(), home: homePosition(), report };
}

function resultToolbar() {
  return `<div class="resultToolbar"><button data-export="csv">CSV</button><button data-export="txt">TXT</button><button data-export="png">PNG</button><button data-export="pdf">PDF</button><button data-export="addreport">＋ ${esc(t('addToReport'))}</button></div>`;
}

// ---------- Páginas ----------
const PAGES = {};

PAGES.dashboard = () => {
  const all = filteredQsos();
  if (!db.qsos.length) return `<section class="page wide"><div class="empty"><span>⌁</span><strong>${esc(t('emptyDbTitle'))}</strong><p>${esc(t('emptyDbBody'))}</p><button data-go="logs:upload">${esc(t('page_upload'))}</button> <button data-go="logs:platforms">${esc(t('page_platforms'))}</button></div></section>`;
  const b = S.basic(all, { pauseMin: db.prefs.pauseMinutes, points: pointsFor() }), q = S.qslStatus(all);
  const bandsData = S.groupCount(all, x => x.band), bandSorted = sortBands(bandsData.map(x => x[0])).map(k => [k, bandsData.find(x => x[0] === k)[1]]);
  const years = S.groupCount(all, S.DIMENSIONS.year).sort((a, b) => a[0].localeCompare(b[0]));
  const ent = new Map();
  for (const x of all) if (Number.isFinite(x.elat)) { const e = ent.get(x.country) || { lat: x.elat, lon: x.elon, value: 0, country: x.country }; e.value++; ent.set(x.country, e); }
  const conts = db.containers.map(c => { const l = all.filter(x => x.c === c.id); return [c.name, l.length, [...S.distinct(l, x => x.station)].join(' '), fmtDate(l[0]?.ts), fmtDate(l[l.length - 1]?.ts)]; });
  const recent = db.activity.slice(-8).reverse().map(a => [fmtDateTime(a.ts), t('act_' + a.type), a.detail]);
  return `<section class="page wide"><div class="pageHead"><div><small>${esc(t('overview'))}</small><h1>${esc(t('page_dashboard'))}</h1></div><span class="pill">${esc(fmtDate(b.first))} → ${esc(fmtDate(b.last))}</span></div>${filterBar()}
    ${all.length ? '' : `<p class="notice">${esc(t('noQsosFilter'))}</p>`}
    <div class="tiles">${tile(t('qsos'), b.qsos.toLocaleString(), t('dupesN', { n: b.dupes }))}${tile(t('uniqueCalls'), b.uniqueCalls.toLocaleString())}${tile(t('dxccEntities'), b.dxcc, t('confirmedN', { n: q.dxccConfirmed }))}${tile(t('confirmedQsos'), q.any.toLocaleString(), b.qsos ? Math.round((q.any / b.qsos) * 100) + '%' : '')}${tile(t('cqZones'), b.cqz + ' / 40')}${tile(t('locators'), b.grids)}${tile(t('stationsCount'), b.stations)}${tile(t('operatingTime'), fmtDur(b.operatingMs))}</div>
    <div class="grid2">${bars(bandSorted, { title: t('qsosPerBand'), drill: 'bands' })}${bars(years, { title: t('qsosPerYear'), horizontal: false, colorIndex: 1, drill: 'year' })}</div>
    ${worldMap([...ent.values()].map(e => ({ ...e, label: `${e.country}: ${e.value}`, drill: 'countries=' + e.country })), { title: t('dxccMap'), home: homePosition() })}
    <div class="grid2"><div><h3>${esc(t('containers'))}</h3>${table([t('container'), t('qsos'), t('stations'), t('firstQso'), t('lastQso')], conts, { numeric: [1] })}</div><div><h3>${esc(t('recentActivity'))}</h3>${table([t('date'), t('event'), t('details')], recent)}</div></div></section>`;
};

PAGES.containers = () => {
  const rows = db.containers.map(c => {
    const l = db.qsos.filter(q => q.c === c.id), ts = l.map(q => q.ts);
    return `<tr><td><strong>${esc(c.name)}</strong><br><small>${esc(c.id)}</small></td><td class="num">${l.length.toLocaleString()}</td><td>${esc([...S.distinct(l, q => q.station)].join(', '))}</td><td>${esc(ts.length ? fmtDate(Math.min(...ts)) + ' → ' + fmtDate(Math.max(...ts)) : '—')}</td><td>${esc(c.notes || '')}</td>
      <td class="actions"><button data-act="rename" data-id="${c.id}">${esc(t('rename'))}</button><button data-act="dedupe" data-id="${c.id}">${esc(t('removeDupes'))}</button><button data-act="open" data-id="${c.id}">${esc(t('analyze'))}</button><button class="dangerButton" data-act="delete" data-id="${c.id}">${esc(t('delete'))}</button></td></tr>`;
  }).join('');
  return `<section class="page wide">${head('logs', 'page_containers', 'containersHelp')}
    <form id="newContainer" class="inline"><input name="name" required maxlength="60" placeholder="${esc(t('containerNamePh'))}"><input name="notes" maxlength="200" placeholder="${esc(t('notes'))}"><button type="submit">＋ ${esc(t('createContainer'))}</button></form>
    <div class="tableWrap"><table><thead><tr><th>${esc(t('container'))}</th><th class="num">${esc(t('qsos'))}</th><th>${esc(t('stations'))}</th><th>${esc(t('period'))}</th><th>${esc(t('notes'))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
};

function head(small, title, help) {
  return `<div class="pageHead"><div><small>${esc(t('nav_' + small))}</small><h1>${esc(t(title))}</h1></div></div>${help ? `<p class="help">${esc(t(help))}</p>` : ''}`;
}

PAGES.upload = () => {
  const rows = db.uploads.map((u, i) => `<tr><td>${esc(u.name)}</td><td>${esc((u.format || '?').toUpperCase())}</td><td class="num">${u.records ?? '—'}</td><td class="num">${(u.size / 1024).toFixed(1)} KB</td><td>${esc(fmtDateTime(u.uploaded))}</td><td class="actions"><button data-act="import-upload" data-i="${i}">${esc(t('importArrow'))}</button><button class="dangerButton" data-act="remove-upload" data-i="${i}">${esc(t('remove'))}</button></td></tr>`).join('');
  return `<section class="page wide">${head('logs', 'page_upload', 'uploadHelp')}
    <div id="dropZone" class="dropZone"><span>⇪</span><strong>${esc(t('dropFiles'))}</strong><p>${esc(t('supportedFormats'))}</p><button id="pickFiles">${esc(t('selectFiles'))}</button></div>
    <details><summary>${esc(t('pasteLog'))}</summary><textarea id="pasteText" rows="8" placeholder="<CALL:5>K1ABC ... <EOR>"></textarea><button id="pasteAdd">${esc(t('addToQueue'))}</button></details>
    <h2>${esc(t('uploadQueue'))}</h2>${db.uploads.length ? `<div class="tableWrap"><table><thead><tr><th>${esc(t('file'))}</th><th>${esc(t('format'))}</th><th class="num">${esc(t('records'))}</th><th class="num">${esc(t('size'))}</th><th>${esc(t('uploaded'))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><p><button data-go="logs:import">${esc(t('goImport'))}</button></p>` : `<p class="help">${esc(t('queueEmpty'))}</p>`}</section>`;
};

async function addUploads(files) {
  let n = 0;
  for (const f of files) {
    const format = detectFormat(f.text, f.name);
    let records = null;
    try { records = format ? parseLog(f.text, f.name).total : null; } catch { records = null; }
    db.uploads.push({ name: f.name, size: f.size ?? f.text.length, text: f.text, format, records, uploaded: Date.now() });
    DB.logActivity(db, 'upload', `${f.name} (${format || '?'}, ${records ?? 0})`);
    n++;
  }
  ui.importReport = null; ui.importPreview = null;
  persist();
  toast(t('filesQueued', { n }));
  render();
}

PAGES.import = () => {
  const ups = db.uploads;
  const rep = ui.importReport;
  const repHtml = rep ? `<h2>${esc(t('importResult'))}</h2><div class="tiles">${tile(t('added'), rep.added)}${tile(t('skippedExisting'), rep.skipped)}${tile(t('qslUpdated'), rep.merged)}${tile(t('errors'), rep.errors)}</div><p><button data-go="dashboard">${esc(t('page_dashboard'))}</button> <button data-go="stats:basic">${esc(t('page_basic'))}</button></p>` : '';
  if (!ups.length) return `<section class="page wide">${head('logs', 'page_import', 'importHelp')}${repHtml}<p class="notice">${esc(t('queueEmpty'))}</p><button data-go="logs:upload">${esc(t('page_upload'))}</button></section>`;
  const sel = ui.importSel ?? 'all';
  const prev = ui.importPreview;
  return `<section class="page wide">${head('logs', 'page_import', 'importHelp')}
    <form id="importForm" class="fields">
      <label><span>${esc(t('file'))}</span><select name="upload"><option value="all"${sel === 'all' ? ' selected' : ''}>${esc(t('allQueued', { n: ups.length }))}</option>${ups.map((u, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(u.name)} · ${esc((u.format || '?').toUpperCase())}</option>`).join('')}</select></label>
      <label><span>${esc(t('targetContainer'))}</span><select name="container">${options(db.containers.map(c => c.id), ui.importContainer || 'main', containerName)}<option value="__new">＋ ${esc(t('newContainer'))}</option></select></label>
      <label><span>${esc(t('newContainerName'))}</span><input name="newName" maxlength="60" placeholder="${esc(t('optional'))}"></label>
      <label><span>${esc(t('formatOverride'))}</span><select name="format"><option value="">${esc(t('autoDetect'))}</option>${options(['adif', 'adx', 'cabrillo', 'edi', 'csv'], '', x => x.toUpperCase())}</select></label>
      <label><span>${esc(t('defaultStation'))}</span><input name="station" maxlength="20" placeholder="${esc(db.prefs.myCall || 'PT2VHF')}" value="${esc(ui.importStation || '')}"></label>
      <label><span>${esc(t('defaultOperator'))}</span><input name="operator" maxlength="20"></label>
      <label><span>${esc(t('defaultMyGrid'))}</span><input name="myGrid" maxlength="8" placeholder="${esc(db.prefs.myGrid || 'GH64')}"></label>
      <label class="check"><input type="checkbox" name="mergeQsl"${db.prefs.mergeQsl ? ' checked' : ''}> ${esc(t('mergeQsl'))}</label>
      <label class="check"><input type="checkbox" name="forceStation"> ${esc(t('forceStation'))}</label>
      <label class="check"><input type="checkbox" name="recalc"${db.prefs.recalcOnImport ? ' checked' : ''}> ${esc(t('recalcCountry'))}</label>
      <div class="formActions"><button type="button" id="previewImport">${esc(t('preview'))}</button><button type="submit" class="primary">${esc(t('importNow'))}</button></div>
    </form>
    ${prev ? `<h2>${esc(t('preview'))}</h2><div class="tiles">${tile(t('records'), prev.total)}${tile(t('validQsos'), prev.valid)}${tile(t('newQsos'), prev.fresh)}${tile(t('alreadyInDb'), prev.existing)}${tile(t('errors'), prev.errors.length)}</div>${prev.errors.length ? `<details><summary>${esc(t('errors'))}</summary>${table(['#', t('call'), t('reason')], prev.errors.slice(0, 200).map(e => [e.index, e.call, t('err_' + e.reason)]))}</details>` : ''}${table([t('date'), t('call'), t('band'), t('mode'), t('station'), t('operator'), t('country'), t('locator')], prev.sample.map(q => [fmtDateTime(q.ts), q.call, q.band, q.mode, q.station, q.operator, q.country, q.grid]))}` : ''}
    ${repHtml}
  </section>`;
};

function readImportForm() {
  const f = new FormData($('#importForm'));
  return { upload: f.get('upload'), container: f.get('container'), newName: String(f.get('newName') || '').trim(), format: f.get('format') || null, station: String(f.get('station') || '').trim().toUpperCase(), operator: String(f.get('operator') || '').trim().toUpperCase(), myGrid: String(f.get('myGrid') || '').trim(), mergeQsl: f.get('mergeQsl') === 'on', forceStation: f.get('forceStation') === 'on', recalc: f.get('recalc') === 'on' };
}

function parseUploads(opts) {
  const list = opts.upload === 'all' ? db.uploads : [db.uploads[Number(opts.upload)]].filter(Boolean);
  const qsos = [], errors = [];
  let total = 0;
  for (const u of list) {
    try {
      const r = parseLog(u.text, u.name, { station: opts.forceStation ? '' : opts.station, operator: opts.operator, myGrid: opts.myGrid || db.prefs.myGrid }, opts.format);
      total += r.total;
      errors.push(...r.errors.map(e => ({ ...e, index: u.name + ' #' + e.index })));
      for (const q of r.qsos) {
        if (opts.forceStation && opts.station) q.station = opts.station;
        if (!q.station && opts.station) q.station = opts.station;
        if (!q.station && db.prefs.myCall) q.station = db.prefs.myCall.toUpperCase();
        if (!q.operator) q.operator = q.station;
        DB.enrich(q, cty, { force: opts.recalc && !q.dxcc, myGrid: opts.myGrid || db.prefs.myGrid });
        q.src = u.name;
        qsos.push(q);
      }
    } catch (e) {
      errors.push({ index: u.name, call: '', reason: e.message === 'UNKNOWN_FORMAT' ? 'format' : 'parse' });
    }
  }
  return { qsos, errors, total, files: list.map(u => u.name) };
}

function previewExisting(qsos, containerId) {
  const keys = new Set(db.qsos.filter(q => q.c === containerId).map(q => DB.dedupeKey(q)));
  return qsos.filter(q => keys.has(DB.dedupeKey(q)) || keys.has(DB.dedupeKey(q, -1)) || keys.has(DB.dedupeKey(q, 1))).length;
}

function resolveTargetContainer(opts) {
  if (opts.container === '__new' || opts.newName) {
    const name = opts.newName || `${opts.station || 'Log'} ${new Date().toISOString().slice(0, 10)}`;
    const existing = db.containers.find(c => c.name.toLowerCase() === name.toLowerCase());
    return existing ? existing.id : DB.createContainer(db, name).id;
  }
  return opts.container;
}

PAGES.platforms = () => {
  const saved = db.platforms || {};
  const cards = Object.entries(PLATFORMS).map(([id, p]) => {
    const s = saved[id] || {};
    return `<form class="platformCard" data-platform="${id}"><div class="cardHead"><strong>${esc(p.name)}</strong><small>${esc(new URL(p.url).host)}</small></div><p class="help">${esc(t(p.help))}</p>
      <div class="fields">${p.fields.map(f => `<label><span>${esc(t('cred_' + f))}</span><input name="${f}" type="${/password|apiKey/.test(f) ? 'password' : f === 'since' ? 'date' : 'text'}" autocomplete="off" data-saved="${s[f] ? '1' : ''}" placeholder="${s[f] ? '••••••• (' + esc(t('saved')) + ')' : ''}"></label>`).join('')}
      <label><span>${esc(t('targetContainer'))}</span><select name="container">${options(db.containers.map(c => c.id), s.container || 'main', containerName)}</select></label>
      <label><span>${esc(t('defaultStation'))}</span><input name="station" maxlength="20" value="${esc(s.station || db.prefs.myCall || '')}"></label></div>
      <label class="check"><input type="checkbox" name="remember"${s.remember ? ' checked' : ''}> ${esc(t('rememberCreds'))}</label>
      <div class="formActions"><span class="platformStatus" data-status="${id}">${esc(s.last ? t('lastSync', { d: fmtDateTime(s.last), n: s.lastAdded ?? 0 }) : '')}</span><button type="submit" class="primary">${esc(t('downloadImport'))}</button></div></form>`;
  }).join('');
  return `<section class="page wide">${head('logs', 'page_platforms', 'platformsHelp')}${isDesktop ? '' : `<p class="notice">${esc(t('platformsDesktopOnly'))}</p>`}<div class="platformGrid">${cards}</div>
    <p class="help">${esc(t('platformsOther'))}</p></section>`;
};

async function runPlatform(form) {
  const id = form.dataset.platform, data = Object.fromEntries(new FormData(form).entries());
  const saved = db.platforms[id] || {};
  const creds = {};
  for (const f of PLATFORMS[id].fields) creds[f] = data[f] || (saved.secret ? JSON.parse(await backend.decrypt(saved.secret))[f] : '') || '';
  const missing = validateCreds(id, creds);
  const status = form.querySelector('[data-status]');
  if (missing.length) { status.textContent = t('missingFields', { f: missing.map(m => t('cred_' + m)).join(', ') }); return; }
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  status.textContent = t('downloading');
  try {
    let state = {}, adif = '', guard = 0;
    while (guard++ < 200) {
      const req = buildRequest(id, creds, state);
      const res = await backend.fetchPlatform(req);
      if (res.error) throw new Error(res.error);
      const parsed = parseResponse(id, res.text, state);
      if (parsed.error) throw new Error(parsed.error === 'AUTH' ? t('authFailed') : parsed.error);
      adif += parsed.adif + '\n';
      state = parsed.state;
      status.textContent = t('downloadingN', { n: (adif.match(/<eor>/gi) || []).length });
      if (parsed.done) break;
    }
    const r = parseLog(adif.includes('<EOH>') || adif.includes('<eoh>') ? adif : '<EOH>\n' + adif, id + '.adi', { station: data.station.toUpperCase(), myGrid: db.prefs.myGrid }, 'adif');
    for (const q of r.qsos) {
      if (!q.station) q.station = (data.station || db.prefs.myCall || '').toUpperCase();
      if (!q.operator) q.operator = q.station;
      // No relatório do LoTW, QSL_RCVD significa confirmação LoTW; o Inbox do eQSL contém apenas confirmações eQSL.
      if (id === 'lotw') { if (q.qslRcvd === 'Y') q.lotwRcvd = 'Y'; q.qslRcvd = ''; q.lotwSent = 'Y'; }
      if (id === 'eqsl') { q.eqslRcvd = 'Y'; q.qslRcvd = ''; }
      DB.enrich(q, cty, { myGrid: db.prefs.myGrid });
    }
    const result = DB.importQsos(db, r.qsos, data.container, { mergeQsl: true, source: PLATFORMS[id].name });
    const entry = { container: data.container, station: data.station, remember: data.remember === 'on', last: Date.now(), lastAdded: result.added };
    if (entry.remember) entry.secret = await backend.encrypt(JSON.stringify(creds));
    db.platforms[id] = entry;
    persist();
    renderHeader();
    status.textContent = t('platformResult', { added: result.added, skipped: result.skipped, merged: result.merged });
    toast(t('platformResult', { added: result.added, skipped: result.skipped, merged: result.merged }));
  } catch (e) {
    status.textContent = t('platformError', { e: e.message });
  } finally { button.disabled = false; }
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
      <label><span>${esc(t('moveTo'))}</span><select name="moveTo"><option value=""></option>${options(db.containers.map(c => c.id), '', containerName)}</select></label>
      <div class="formActions"><button type="submit" class="primary">${esc(t('applyChanges'))}</button><button type="button" class="dangerButton" id="deleteSelected">${esc(t('deleteSelected'))}</button></div>
    </form><p class="help">${esc(t('ctyVersion', { v: cty?.version || '—' }))}</p></section>`;
};

PAGES.copyfilter = () => {
  const n = filteredQsos().length;
  return `<section class="page wide">${head('logs', 'page_copyfilter', 'copyHelp')}${filterBar()}
    <p class="pill">${esc(t('selectedQsos', { n }))} · ${esc(filterSummary())}</p>
    <form id="copyForm" class="fields"><label><span>${esc(t('newContainerName'))}</span><input name="name" required maxlength="60"></label>
      <label class="check"><input type="checkbox" name="removeDupes"> ${esc(t('removeDupesOnCopy'))}</label>
      <div class="formActions"><button type="submit" class="primary">${esc(t('copyFilterRun'))}</button></div></form></section>`;
};

PAGES.search = () => {
  const q = ui.searchText;
  const results = q ? S.byTime(DB.applyFilter(db.qsos, { call: q })).reverse() : [];
  const rows = results.slice(0, 1000).map(x => [fmtDateTime(x.ts), x.call, x.band, x.mode, x.freq ? x.freq.toFixed(3) : '', x.rstS, x.rstR, x.station, x.operator, containerName(x.c), x.country, x.grid, (x.lotwRcvd === 'Y' ? 'L' : '') + (x.eqslRcvd === 'Y' ? 'E' : '') + (x.qslRcvd === 'Y' ? 'P' : ''), x.name]);
  return `<section class="page wide">${head('logs', 'page_search', 'searchHelp')}
    <form id="searchForm" class="inline"><input id="searchInput" value="${esc(q)}" placeholder="PY2* · *VHF · K?ABC" autofocus><button type="submit">${esc(t('search'))}</button></form>
    ${q ? `<p class="pill">${esc(t('resultsN', { n: results.length }))}</p>` + table([t('date'), t('call'), t('band'), t('mode'), 'MHz', 'S', 'R', t('station'), t('operator'), t('container'), t('country'), t('locator'), 'QSL', t('name')], rows) : ''}</section>`;
};

function statPage(page) {
  const qsos = filteredQsos();
  const p = ui.params[page.id] ||= defaultParams(page);
  let result;
  try { result = page.render(statContext(qsos), p); } catch (e) { console.error(e); result = { html: `<p class="notice">${esc(e.message)}</p>`, tables: [] }; }
  lastResult = { page: page.id, ...result };
  const kml = page.id === 'kml' ? `<form id="kmlForm" class="paramsBar"><strong>KML/KMZ</strong><label class="check"><input type="checkbox" name="dxcc" checked> DXCC</label><label class="check"><input type="checkbox" name="grids" checked> ${esc(t('locators'))}</label><label class="check"><input type="checkbox" name="lines"> ${esc(t('qsoLines'))}</label><label class="check"><input type="checkbox" name="timeline"> ${esc(t('logReplay'))}</label><button type="submit" class="primary">${esc(t('exportKml'))}</button></form>` : '';
  const group = page.id === 'qsl' ? 'qsl' : 'stats';
  return `<section class="page wide">${head(group, 'page_' + page.id, 'help_' + page.id)}${filterBar()}${paramsBar(page)}${kml}
    <div class="resultHead"><span class="pill">${esc(t('qsosInFilter', { n: qsos.length.toLocaleString() }))} · ${esc(filterSummary())}</span>${resultToolbar()}</div>
    <div id="result">${qsos.length ? result.html : `<p class="notice">${esc(t('noQsosFilter'))}</p>`}</div></section>`;
}
for (const p of STAT_PAGES) PAGES[p.id] = () => statPage(p);
PAGES.qsl = () => statPage(QSL_PAGE);

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
    const ctrls = page.params.map(def => def.type === 'select' ? `<select data-sparam="${i}:${def.id}" title="${esc(t(def.label))}">${options(def.options, params[def.id], o => t('opt_' + o) === 'opt_' + o ? o : t('opt_' + o))}</select>` : `<input type="number" data-sparam="${i}:${def.id}" value="${esc(params[def.id])}" min="${def.min}" max="${def.max}" title="${esc(t(def.label))}">`).join('');
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
      <div class="formActions"><button type="button" id="resetReport">${esc(t('resetReport'))}</button><button type="submit">${esc(t('updatePreview'))}</button></div>
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
  if (cfg.cover) parts.push(`<section class="rCover"><small>PT2VHF QSL ANALYZER</small><h1>${esc(cfg.title)}</h1>${cfg.subtitle ? `<h2>${esc(cfg.subtitle)}</h2>` : ''}<p>${esc(cfg.author)}</p><p>${esc(t('generatedAt', { d: fmtDateTime(Date.now()) + ' UTC' }))}</p><div class="tiles">${tile(t('qsos'), b.qsos.toLocaleString())}${tile(t('uniqueCalls'), b.uniqueCalls.toLocaleString())}${tile(t('dxccEntities'), b.dxcc)}${tile(t('period'), fmtDate(b.first) + ' → ' + fmtDate(b.last))}</div>${cfg.filters ? `<p class="rFilters">${esc(filterSummary(filter))}</p>` : ''}</section>`);
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
    const out = await backend.printPdf({ landscape: cfg.orientation === 'landscape', pageSize: cfg.paper, name, footer: cfg.footer || 'PT2VHF QSL Analyzer' });
    if (out && out !== 'print') toast(t('savedTo', { p: out }));
  } catch (e) { toast(e.message, true); }
  finally { document.body.classList.remove('printing', 'printLight'); document.documentElement.style.background = ''; document.documentElement.style.colorScheme = ''; document.body.style.background = ''; style.remove(); root.innerHTML = ''; }
}

function reportHtmlDocument(cfg, html) {
  const css = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
  return `<!doctype html><html lang="${db.prefs.language}" data-theme="${cfg.lightPrint ? 'light' : db.prefs.theme}"><head><meta charset="utf-8"><title>${esc(cfg.title)}</title><style>${css}</style></head><body class="standalone"><div class="printDoc ${cfg.orientation}">${html}</div></body></html>`;
}

PAGES.compare = () => {
  const sel = ui.compareSel || db.containers.slice(0, 3).map(c => 'c:' + c.id);
  const items = [...db.containers.map(c => ['c:' + c.id, t('container') + ': ' + c.name]), ...DB.stations(db).map(s => ['s:' + s.station, t('station') + ': ' + (s.station || '—')])];
  const groups = sel.map(k => { const [type, id] = [k.slice(0, 1), k.slice(2)]; const f = type === 'c' ? { containers: [id] } : { stations: [id] }; return { key: k, label: items.find(i => i[0] === k)?.[1] || k, qsos: filteredQsos({ ...ui.filter, ...f }) }; }).filter(g => g.label);
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
  return `<section class="page wide">${head('export', 'page_exportlogs', 'exportHelp')}${filterBar()}<p class="pill">${esc(t('selectedQsos', { n }))} · ${esc(filterSummary())}</p>
    <form id="exportForm" class="fields"><label><span>${esc(t('format'))}</span><select name="format"><option value="adif">ADIF v3 (.adi)</option><option value="csv">CSV</option><option value="cabrillo">Cabrillo 3.0</option><option value="kml">KML (Google Earth)</option></select></label>
      <label><span>${esc(t('cabrilloContest'))}</span><input name="contest" maxlength="40" placeholder="CQ-WW-SSB"></label>
      <label><span>${esc(t('cabrilloCall'))}</span><input name="call" maxlength="20" value="${esc(db.prefs.myCall)}"></label>
      <div class="formActions"><button type="submit" class="primary">${esc(t('export'))}</button></div></form></section>`;
};

PAGES.backup = () => `<section class="page wide">${head('export', 'page_backup', 'backupHelp')}
  <div class="formActions left"><button id="backupDb" class="primary">${esc(t('backupDb'))}</button><button id="restoreDb">${esc(t('restoreDb'))}</button></div></section>`;

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
      <div class="formActions"><span id="prefsError" class="error"></span><button type="submit" class="primary">${esc(t('save'))}</button></div></form>
    <p class="help">${esc(t('dataDir', { d: info.dataDir || '—' }))}</p></section>`;
};

PAGES.database = () => {
  const scope = ui.dbScope || '';
  const list = DB.stations(db, scope || null);
  const rows = list.map(s => `<tr><td><label class="check"><input type="checkbox" class="stationCheck" value="${esc(s.station)}"> <strong>${esc(s.station || '—')}</strong></label></td><td class="num">${s.count.toLocaleString()}</td><td>${esc(s.containers.map(containerName).join(', '))}</td><td>${esc(fmtDate(s.first))} → ${esc(fmtDate(s.last))}</td></tr>`).join('');
  return `<section class="page">${head('settings', 'page_database', 'databaseHelp')}
    <div class="tiles">${tile(t('qsos'), db.qsos.length.toLocaleString())}${tile(t('stationsCount'), DB.stations(db).length)}${tile(t('containers'), db.containers.length)}${tile(t('uploadQueue'), db.uploads.length)}</div>
    <h2>${esc(t('clearByCall'))}</h2><p class="help">${esc(t('clearByCallHelp'))}</p>
    <label class="inline"><span>${esc(t('restrictContainer'))}</span><select id="dbScope"><option value="">${esc(t('allContainers'))}</option>${options(db.containers.map(c => c.id), scope, containerName)}</select></label>
    ${list.length ? `<div class="tableWrap"><table><thead><tr><th><label class="check"><input type="checkbox" id="checkAllStations"> ${esc(t('station'))}</label></th><th class="num">${esc(t('qsos'))}</th><th>${esc(t('containers'))}</th><th>${esc(t('period'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="formActions"><button class="dangerButton" id="deleteStations">${esc(t('deleteSelectedCalls'))}</button></div>` : `<p class="help">${esc(t('emptyDbTitle'))}</p>`}
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

const diagnostics = () => `PT2VHF QSL Analyzer ${info.version || APP_VERSION}\n${isDesktop ? 'Desktop' : 'Browser'} · ${navigator.userAgent}\nQSOs: ${db.qsos.length} · containers: ${db.containers.length} · CTY: ${cty?.version || '—'}\nLanguage: ${db.prefs.language}`;

PAGES.help = () => `<section class="page">${head('help', 'page_help')}${['Start', 'Logs', 'Platforms', 'Stats', 'Qsl', 'Reports', 'Database', 'Formats'].map(k => `<article><h2>${esc(t('helpT' + k))}</h2><p>${esc(t('helpB' + k))}</p></article>`).join('')}</section>`;

PAGES.about = () => `<section class="page">${head('about', 'page_about')}<h2>PT2VHF QSL Analyzer v${esc(info.version || APP_VERSION)}</h2><p>${esc(t('aboutText'))}</p><p>${esc(t('author'))}</p>
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
    drop.addEventListener('drop', async e => { e.preventDefault(); drop.classList.remove('over'); const files = await Promise.all([...e.dataTransfer.files].map(async f => ({ name: f.name, size: f.size, text: await f.text() }))); addUploads(files); });
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
  const base = `QSL-Analyzer-${lastResult.page}-${stamp()}`;
  if (kind === 'csv') {
    const rows = [];
    for (const tb of lastResult.tables) { if (lastResult.tables.length > 1) rows.push([tb.title]); rows.push(tb.head, ...tb.rows, []); }
    return saved(await backend.saveFile(base + '.csv', toCsvRows(rows), 'csv'));
  }
  if (kind === 'txt') return saved(await backend.saveFile(base + '.txt', `PT2VHF QSL Analyzer — ${t('page_' + lastResult.page)}\n${filterSummary()}\n\n` + lastResult.tables.map(tableToText).join('\n'), 'txt'));
  if (kind === 'png') {
    const svg = document.querySelector('#result svg.chart');
    if (!svg) return toast(t('noChart'), true);
    return saved(await backend.saveBinary(base + '.png', await svgToPng(svg), 'png'));
  }
  if (kind === 'pdf') {
    const cfg = { ...reportCfg(), cover: false, sections: [], breakEach: false };
    const html = `<header class="rHead"><small>PT2VHF QSL ANALYZER</small><h1>${esc(t('page_' + lastResult.page))}</h1><p class="rFilters">${esc(filterSummary())} · ${esc(fmtDateTime(Date.now()))} UTC</p></header>` + $('#result').innerHTML;
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
  const act = el.dataset.act;
  if (act === 'rename') {
    const c = db.containers.find(x => x.id === el.dataset.id), name = prompt(t('newName'), c.name);
    if (name === null) return;
    const notes = prompt(t('notes'), c.notes || '');
    try { DB.renameContainer(db, c.id, name, notes ?? c.notes); persist(); render(); } catch (err) { toast(t('err_' + err.message), true); }
    return;
  }
  if (act === 'delete') { const c = db.containers.find(x => x.id === el.dataset.id); if (confirm(t('confirmDeleteContainer', { name: c.name }))) { const n = DB.deleteContainer(db, c.id); persist(); toast(t('removedN', { n })); render(); } return; }
  if (act === 'dedupe') { const n = DB.removeDupes(db, el.dataset.id); persist(); toast(t('removedN', { n })); return render(); }
  if (act === 'open') { ui.filter = { containers: [el.dataset.id] }; return go('stats', 'basic'); }
  if (act === 'remove-upload') { db.uploads.splice(Number(el.dataset.i), 1); persist(); return render(); }
  if (act === 'import-upload') { ui.importSel = Number(el.dataset.i); ui.importPreview = null; ui.importReport = null; return go('logs', 'import'); }
  if (el.id === 'pickFiles') return addUploads(await backend.openFiles());
  if (el.id === 'pasteAdd') { const text = $('#pasteText').value; if (text.trim()) addUploads([{ name: 'colado-' + stamp() + '.adi', text, size: text.length }]); return; }
  if (el.id === 'previewImport') {
    const opts = readImportForm();
    const r = parseUploads(opts);
    const target = opts.container === '__new' ? null : opts.container;
    ui.importPreview = { total: r.total, valid: r.qsos.length, errors: r.errors, existing: target ? previewExisting(r.qsos, target) : 0, fresh: target ? r.qsos.length - previewExisting(r.qsos, target) : r.qsos.length, sample: r.qsos.slice(0, 25) };
    ui.importReport = null; ui.importSel = opts.upload === 'all' ? 'all' : Number(opts.upload); ui.importContainer = opts.container; ui.importStation = opts.station;
    return render();
  }
  if (el.id === 'deleteSelected') {
    const list = filteredQsos();
    if (!list.length || !confirm(t('confirmDeleteQsos', { n: list.length }))) return;
    toast(t('removedN', { n: DB.deleteQsos(db, list.map(q => q.id)) })); persist(); return render();
  }
  if (el.id === 'checkAllStations') { document.querySelectorAll('.stationCheck').forEach(c => (c.checked = el.checked)); return; }
  if (el.id === 'deleteStations') {
    const list = [...document.querySelectorAll('.stationCheck:checked')].map(c => c.value);
    if (!list.length) return toast(t('selectCalls'), true);
    const scope = ui.dbScope || null;
    if (!confirm(t('confirmDeleteCalls', { calls: list.map(s => s || '—').join(', '), scope: scope ? containerName(scope) : t('allContainers') }))) return;
    const n = DB.deleteByStations(db, list, scope);
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
  if (el.id === 'backupDb') return saved(await backend.saveFile(`QSL-Analyzer-backup-${stamp()}.json`, JSON.stringify(db), 'json'));
  if (el.id === 'restoreDb') {
    const files = await backend.openFiles();
    if (!files?.length) return;
    try { const data = JSON.parse(files[0].text); if (!Array.isArray(data.qsos)) throw new Error('format'); if (!confirm(t('confirmRestore', { n: data.qsos.length }))) return; db = DB.migrate(data); DB.logActivity(db, 'restore', files[0].name); await persist(true); toast(t('restored')); render(); } catch { toast(t('invalidBackup'), true); }
    return;
  }
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
    if (el.id === 'reportPdf') return exportReportPdf(cfg, buildReport(cfg), `QSL-Analyzer-${(cfg.title || 'report').replace(/[^\p{L}\p{N}-]+/gu, '_')}-${stamp()}.pdf`);
    if (el.id === 'reportHtml') return saved(await backend.saveFile(`QSL-Analyzer-${(cfg.title || 'report').replace(/[^\p{L}\p{N}-]+/gu, '_')}-${stamp()}.html`, reportHtmlDocument(cfg, buildReport(cfg)), 'html'));
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
  if (form.id === 'newContainer') {
    const f = new FormData(form);
    try { DB.createContainer(db, f.get('name'), f.get('notes')); persist(); render(); } catch (err) { toast(t('err_' + err.message), true); }
    return;
  }
  if (form.id === 'importForm') {
    const opts = readImportForm();
    let target;
    try { target = resolveTargetContainer(opts); } catch (err) { return toast(t('err_' + err.message), true); }
    const r = parseUploads(opts);
    const res = DB.importQsos(db, r.qsos, target, { mergeQsl: opts.mergeQsl, source: r.files.join(', ') });
    ui.importReport = { ...res, errors: r.errors.length };
    ui.importPreview = null; ui.importContainer = target;
    // Arquivos importados saem da fila (o QScope também separa upload de importação).
    if (opts.upload === 'all') db.uploads = []; else db.uploads.splice(Number(opts.upload), 1);
    ui.importSel = 'all';
    await persist(true);
    toast(t('importDone', { added: res.added, skipped: res.skipped }));
    return render();
  }
  if (form.dataset.platform) return runPlatform(form);
  if (form.id === 'modifyForm') {
    const f = new FormData(form), list = filteredQsos();
    if (!list.length) return toast(t('noQsosFilter'), true);
    const ops = { countryFile: f.get('countryFile'), bandFromFreq: f.get('bandFromFreq') === 'on', modeMap: [{ from: f.get('modeFrom'), to: String(f.get('modeTo') || '').trim() }].filter(m => m.from && m.to), setStation: String(f.get('setStation') || '').trim(), setOperator: String(f.get('setOperator') || '').trim(), setMyGrid: String(f.get('setMyGrid') || '').trim(), moveTo: f.get('moveTo') };
    if (!confirm(t('confirmModify', { n: list.length }))) return;
    const r = DB.reprocess(db, ui.filter, ops, cty);
    persist(); toast(t('modifyDone', { m: r.matched, c: r.changed })); return render();
  }
  if (form.id === 'copyForm') {
    const f = new FormData(form);
    const sources = ui.filter.containers?.length ? ui.filter.containers : db.containers.map(c => c.id);
    try { const r = DB.copyFilter(db, sources, f.get('name'), { ...ui.filter, containers: undefined }, { removeDupes: f.get('removeDupes') === 'on' }); persist(); toast(t('copyDone', { n: r.count, name: r.container.name })); go('logs', 'containers'); } catch (err) { toast(t('err_' + err.message), true); }
    return;
  }
  if (form.id === 'searchForm') { ui.searchText = $('#searchInput').value.trim(); return render(); }
  if (form.id === 'reportForm') { readReportForm(); return render(); }
  if (form.id === 'compareForm') { ui.compareSel = [...form.querySelectorAll('input:checked')].map(i => i.value); return render(); }
  if (form.id === 'exportForm') {
    const f = new FormData(form), list = filteredQsos();
    if (!list.length) return toast(t('noQsosFilter'), true);
    const fmt = f.get('format'), base = `QSL-Analyzer-${stamp()}`;
    let content, name;
    if (fmt === 'adif') { content = toAdif(list, info.version || APP_VERSION); name = base + '.adi'; }
    if (fmt === 'csv') { content = toCsv(list); name = base + '.csv'; }
    if (fmt === 'cabrillo') { content = toCabrillo(list, { call: String(f.get('call') || '').toUpperCase(), contest: f.get('contest'), operators: [...S.distinct(list, q => q.operator)].join(' '), grid: db.prefs.myGrid, version: info.version || APP_VERSION }); name = base + '.log'; }
    if (fmt === 'kml') { content = toKml(list, { title: 'PT2VHF QSL Analyzer', home: homePosition(), layers: ['dxcc', 'grids'] }); name = base + '.kml'; }
    DB.logActivity(db, 'export', `${fmt}: ${list.length}`); persist();
    return saved(await backend.saveFile(name, content, fmt));
  }
  if (form.id === 'kmlForm') {
    const f = new FormData(form), layers = ['dxcc', 'grids', 'lines'].filter(k => f.get(k) === 'on');
    const content = toKml(filteredQsos(), { title: 'PT2VHF QSL Analyzer · ' + filterSummary(), home: homePosition(), layers, timeline: f.get('timeline') === 'on' });
    return saved(await backend.saveFile(`QSL-Analyzer-${stamp()}.kml`, content, 'kml'));
  }
  if (form.id === 'prefsForm') {
    const f = new FormData(form), grid = String(f.get('myGrid') || '').trim();
    if (grid && !gridValid(grid)) { $('#prefsError').textContent = t('invalidGrid'); return; }
    Object.assign(db.prefs, { myCall: String(f.get('myCall') || '').trim().toUpperCase(), myGrid: grid, pauseMinutes: Number(f.get('pauseMinutes')) || 15, pointsRule: f.get('pointsRule'), palette: f.get('palette'), theme: f.get('theme'), mergeQsl: f.get('mergeQsl') === 'on', recalcOnImport: f.get('recalcOnImport') === 'on' });
    persist(); toast(t('saved')); return render();
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'dbScope') { ui.dbScope = e.target.value; render(); }
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

async function loadCountryFile() {
  let text = await backend.loadCty();
  if (!text) text = await (await fetch('../src/data/cty.dat')).text();
  const table = await (await fetch('../src/data/dxcc.json')).json();
  cty = attachDxcc(parseCty(text), table);
}

async function checkUpdate(manual = false) {
  if (!isDesktop) return;
  const btn = $('#updateButton');
  try {
    const r = await backend.checkUpdate();
    if (r?.available) {
      btn.textContent = t('updateAvailable', { v: r.latest }); btn.className = 'updateButton available';
      if (manual) return backend.openExternal(r.url);
      $('#updateNoticeTitle').textContent = t('newVersionTitle');
      $('#updateNoticeMessage').textContent = t('newVersionMessage', { v: r.latest, current: info.version });
      $('#updateNoticeNotes').textContent = r.notes || '';
      $('#updateNoticeLater').textContent = t('later');
      $('#updateNoticeOpen').textContent = t('openDownloadPage');
      $('#updateNoticeOpen').onclick = () => { $('#updateNotice').close(); backend.openExternal(r.url); };
      $('#updateNoticeLater').onclick = () => $('#updateNotice').close();
      $('#updateNotice').showModal();
    } else { btn.textContent = t('upToDate'); btn.className = 'updateButton current'; if (manual) toast(t('upToDate')); }
  } catch { btn.textContent = t('checkUpdate'); if (manual) toast(t('updateCheckFailed'), true); }
}

// Aviso do site oficial a cada abertura; a verificação de versão nova vem logo depois de fechá-lo.
function siteNotice() {
  const dlg = $('#siteNotice');
  $('#siteNoticeTitle').textContent = t('siteNoticeTitle');
  $('#siteNoticeMessage').textContent = t('siteNoticeMessage');
  $('#siteNoticeOpen').textContent = t('siteNoticeOpen');
  $('#siteNoticeOk').textContent = t('continue');
  $('#siteNoticeOpen').onclick = () => backend.openExternal('https://www.pt2vhf.com/qsl');
  $('#siteNoticeOk').onclick = () => dlg.close();
  dlg.addEventListener('close', () => checkUpdate(false), { once: true });
  dlg.showModal();
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
}

start().catch(e => { console.error(e); view.innerHTML = `<section class="page"><p class="notice">${esc(e.message)}</p></section>`; });
