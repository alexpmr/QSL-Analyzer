// Páginas de estatística: cada uma declara parâmetros e um renderizador usado na tela e nos relatórios.
import * as S from '../src/stats.mjs';
import { bars, stacked, lines, heatGrid, rose, worldMap, table, tile, esc, entityLink } from './charts.mjs';
import * as A from '../src/awards.mjs';
import * as I from '../src/insights.mjs';
import { gridToLatLon } from '../src/geo.mjs';

export const fmtDate = ts => (ts === null || ts === undefined ? '—' : new Date(ts).toISOString().slice(0, 10));
export const fmtDateTime = ts => (ts === null || ts === undefined ? '—' : new Date(ts).toISOString().slice(0, 16).replace('T', ' '));
export const fmtDur = ms => { if (!ms) return '0m'; const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); return (d ? d + 'd ' : '') + (h || d ? h + 'h ' : '') + (m % 60) + 'm'; };
const hours = ms => +(ms / 3600000).toFixed(2);

const DIM_OPTIONS = ['band', 'mode', 'operator', 'station', 'cont', 'radio'];
const dimParam = (def = 'band', options = DIM_OPTIONS) => ({ id: 'dim', type: 'select', options, default: def, label: 'groupBy' });
const pauseParam = def => ({ id: 'pause', type: 'number', min: 1, max: 240, default: def, label: 'pauseMinutes' });
const unitParam = { id: 'unit', type: 'select', options: ['auto', 'hour', 'day', 'month', 'year'], default: 'auto', label: 'timeUnit' };
const topParam = { id: 'top', type: 'number', min: 5, max: 200, default: 25, label: 'topN' };

const unitLabel = (ts, unit) => unit === 'hour' ? new Date(ts).toISOString().slice(5, 13).replace('T', ' ') + 'h' : unit === 'day' ? new Date(ts).toISOString().slice(0, 10) : unit === 'month' ? new Date(ts).toISOString().slice(0, 7) : new Date(ts).toISOString().slice(0, 4);
const pairs = list => list.map(([k, v]) => [String(k), v]);
// Chave do filtro correspondente a cada dimensão (usada no clique de detalhamento dos gráficos).
export const DIM_FILTER = { band: 'bands', mode: 'modes', operator: 'operators', station: 'stations', cont: 'conts', radio: 'radios' };
const span = (ts, unit) => ts + '~' + S.nextBucket(ts, unit);
const twoCol = (a, b) => `<div class="grid2">${a}${b}</div>`;

export const STAT_PAGES = [
  {
    id: 'basic', params: [pauseParam(15)],
    render(ctx, p) {
      const { t, qsos } = ctx, b = S.basic(qsos, { pauseMin: p.pause, points: ctx.points });
      const rows = [
        [t('qsos'), b.qsos], [t('dupes'), b.dupes], [t('validQsos'), b.valid], [t('points'), b.points], [t('uniqueCalls'), b.uniqueCalls],
        [t('dxccEntities'), b.dxcc], [t('cqZones'), b.cqz], [t('ituZones'), b.ituz], [t('prefixes'), b.prefixes], [t('locators'), b.grids],
        [t('continents'), b.conts], [t('bands'), b.bands], [t('modes'), b.modes], [t('operators'), b.operators], [t('stationsCount'), b.stations],
        [t('firstQso'), fmtDateTime(b.first)], [t('lastQso'), fmtDateTime(b.last)], [t('operatingTime'), fmtDur(b.operatingMs)], [t('avgRate'), b.avgRate + ' /h'],
        [t('maxRateN', { n: 10 }), `${b.max10.count} (${b.max10.perHour}/h) · ${fmtDateTime(b.max10.start)}`], [t('maxRateN', { n: 30 }), `${b.max30.count} (${b.max30.perHour}/h) · ${fmtDateTime(b.max30.start)}`],
        [t('maxRateN', { n: 60 }), `${b.max60.count} (${b.max60.perHour}/h) · ${fmtDateTime(b.max60.start)}`], [t('confirmedQsos'), b.confirmed],
      ];
      const tiles = `<div class="tiles">${tile(t('qsos'), b.qsos.toLocaleString(), t('dupesN', { n: b.dupes }))}${tile(t('uniqueCalls'), b.uniqueCalls.toLocaleString())}${tile(t('dxccEntities'), b.dxcc)}${tile(t('operatingTime'), fmtDur(b.operatingMs), b.avgRate + ' QSO/h')}${tile(t('maxRateN', { n: 60 }), b.max60.count, fmtDateTime(b.max60.start))}${tile(t('points'), b.points.toLocaleString())}</div>`;
      return { html: tiles + table([t('metric'), t('value')], rows, { numeric: [1] }), tables: [{ title: t('page_basic'), head: [t('metric'), t('value')], rows }] };
    },
  },
  {
    id: 'stations', params: [{ id: 'sort', type: 'select', options: ['qsos', 'call', 'slots', 'dupes', 'first'], default: 'qsos', label: 'sortBy' }],
    render(ctx, p) {
      const { t } = ctx;
      let list = S.stationsWorked(ctx.qsos);
      if (p.sort === 'call') list.sort((a, b) => a.call.localeCompare(b.call));
      if (p.sort === 'slots') list.sort((a, b) => b.slots - a.slots);
      if (p.sort === 'dupes') list.sort((a, b) => b.dupes - a.dupes);
      if (p.sort === 'first') list.sort((a, b) => a.first - b.first);
      const head = [t('call'), t('qsos'), t('bands'), t('modes'), t('slots'), t('dupes'), t('country'), t('cont'), t('firstQso'), t('lastQso'), 'QSL'];
      const rows = list.map(s => [s.call, s.qsos, s.bands.join(' '), s.modes.join(' '), s.slots, s.dupes, s.country, s.cont, fmtDateTime(s.first), fmtDateTime(s.last), s.confirmed ? '✓' : '']);
      return { html: `<p class="help">${t('stationsSummary', { n: list.length })}</p>` + table(head, rows, { numeric: [1, 4, 5], max: ctx.report ? 300 : 3000, links: { 0: 'call', 6: 'country', 7: 'cont' } }), tables: [{ title: t('page_stations'), head, rows }] };
    },
  },
  {
    id: 'activity', params: [dimParam('band'), { ...unitParam, options: ['auto', 'hour', 'day', 'month'] }],
    render(ctx, p) {
      const { t } = ctx, m = S.activityMatrix(ctx.qsos, p.dim, p.unit), labels = m.cols.map(c => unitLabel(c, m.unit));
      const head = [t('dim_' + p.dim), ...labels, t('total')], rows = m.rows.map(r => [r.key, ...r.values, r.total]);
      // Melhor faixa de tempo por linha: onde aquela banda/modo/operador foi mais produtivo.
      const best = m.rows.map(r => { const i = r.values.indexOf(Math.max(...r.values)); return [r.key, r.total, labels[i], r.values[i]]; });
      return {
        html: heatGrid(m.rows, labels, { title: t('activityTitle', { dim: t('dim_' + p.dim), unit: t('unit_' + m.unit) }), rowDrill: DIM_FILTER[p.dim], colRanges: m.cols.map(c => span(c, m.unit)) }) + table([t('dim_' + p.dim), t('qsos'), t('bestPeriod'), t('qsos')], best, { numeric: [1, 3] }),
        tables: [{ title: t('page_activity'), head, rows }],
      };
    },
  },
  {
    id: 'bandsmodes', params: [],
    render(ctx) {
      const { t } = ctx, r = S.bandsModes(ctx.qsos);
      const head = [t('band'), ...r.modes.flatMap(m => [m + ' QSOs', m + ' ' + t('calls')]), t('qsos'), t('calls'), 'DXCC', t('multiWorked')];
      const rows = r.rows.map(x => [x.band, ...r.modes.flatMap(m => [x.modes[m].qsos, x.modes[m].calls]), x.total.qsos, x.total.calls, x.total.dxcc, x.total.multi]);
      rows.push([t('total'), ...r.modes.flatMap(m => [r.totalModes[m].qsos, r.totalModes[m].calls]), r.total.qsos, r.total.calls, r.total.dxcc, r.total.multi]);
      const numeric = head.map((_, i) => i).slice(1);
      const distHead = [t('qsosPerStation'), t('stationsCount')], distRows = r.distribution.map(d => [d.qsos, d.stations]);
      return {
        html: table(head, rows, { numeric }) + twoCol(stacked(r.bands, r.modes.map(m => ({ name: m, values: r.rows.map(x => x.modes[m].qsos) })), { title: t('qsosPerBandMode'), drill: 'bands' }), bars(distRows.map(([a, b]) => [a + '×', b]), { title: t('stationsByQsoCount'), horizontal: false })),
        tables: [{ title: t('page_bandsmodes'), head, rows }, { title: t('stationsByQsoCount'), head: distHead, rows: distRows }],
      };
    },
  },
  {
    id: 'dxccfirst', params: [{ id: 'perBand', type: 'select', options: ['no', 'yes'], default: 'no', label: 'perBand' }],
    render(ctx, p) {
      const { t } = ctx, list = S.firstWorked(ctx.qsos, S.dxccKey, p.perBand === 'yes');
      const head = ['#', t('date'), t('call'), t('band'), t('mode'), t('country'), 'DXCC', t('cont')];
      const rows = list.map(x => [x.n, fmtDateTime(x.ts), x.call, x.band, x.mode, x.country, x.dxcc ?? '', x.cont]);
      const cum = list.map((x, i) => [x.ts, i + 1]);
      const chart = cum.length > 1 ? lines(cum.map(c => c[0]), [{ name: 'DXCC', values: cum.map(c => c[1]) }], { title: t('dxccCumulative'), xFormat: v => fmtDate(v), area: true, width: 1240 }) : '';
      return { html: chart + table(head, rows, { numeric: [0, 6], links: { 2: 'call', 5: 'country', 7: 'cont' } }), tables: [{ title: t('page_dxccfirst'), head, rows }] };
    },
  },
  {
    id: 'bandchanges', params: [{ id: 'dim', type: 'select', options: ['all', 'operator', 'radio', 'station'], default: 'all', label: 'groupBy' }],
    render(ctx, p) {
      const { t } = ctx, r = S.bandChanges(ctx.qsos, p.dim === 'all' ? null : S.DIMENSIONS[p.dim]);
      const head = [t('band'), t('stints'), t('qsos'), t('avgStay'), t('maxStay'), t('totalTime')];
      const rows = r.perBand.map(b => [b.band, b.stints, b.qsos, fmtDur(b.avgMs), fmtDur(b.maxMs), fmtDur(b.totalMs)]);
      const stintHead = [t('group'), t('start'), t('end'), t('band'), t('qsos'), t('duration')];
      const stintRows = r.stints.map(s => [s.group === '*' ? '' : s.group, fmtDateTime(s.start), fmtDateTime(s.end), s.band, s.qsos, fmtDur(s.end - s.start + 60000)]);
      const perHour = r.perHour.sort((a, b) => a[0] - b[0]).map(([k, v]) => [fmtDateTime(Number(k)).slice(5, 13) + 'h', v]);
      return {
        html: `<div class="tiles">${tile(t('bandChanges'), r.changes)}${tile(t('stints'), r.stints.length)}</div>` + table(head, rows, { numeric: [1, 2] }) + (perHour.length ? bars(perHour, { title: t('changesPerHour'), horizontal: false, width: 1240 }) : '') + `<h3>${esc(t('stintList'))}</h3>` + table(stintHead, stintRows, { numeric: [4], max: ctx.report ? 200 : 2000 }),
        tables: [{ title: t('page_bandchanges'), head, rows }, { title: t('stintList'), head: stintHead, rows: stintRows }],
      };
    },
  },
  {
    id: 'pauses', params: [pauseParam(30), { id: 'dim', type: 'select', options: ['all', 'operator', 'radio', 'station'], default: 'all', label: 'groupBy' }],
    render(ctx, p) {
      const { t } = ctx, list = S.pauses(ctx.qsos, p.pause, p.dim === 'all' ? null : S.DIMENSIONS[p.dim]);
      const head = [t('group'), t('start'), t('end'), t('duration'), t('lastBefore'), t('firstAfter')];
      const rows = list.map(x => [x.group === '*' ? '' : x.group, fmtDateTime(x.start), fmtDateTime(x.end), fmtDur(x.duration), x.before, x.after]);
      const total = list.reduce((s, x) => s + x.duration, 0);
      return { html: `<div class="tiles">${tile(t('pausesCount'), list.length)}${tile(t('pausesTotal'), fmtDur(total))}</div>` + table(head, rows, { links: { 4: 'call', 5: 'call' } }), tables: [{ title: t('page_pauses'), head, rows }] };
    },
  },
  {
    id: 'qsocharts', params: [topParam],
    render(ctx, p) {
      const { t, qsos } = ctx, top = S.groupCount(qsos, q => q.call).slice(0, p.top);
      const band = S.groupCount(qsos, q => q.band), mode = S.groupCount(qsos, q => q.mode), cont = S.groupCount(qsos, q => q.cont), op = S.groupCount(qsos, q => q.operator);
      const bandSorted = S.sortKeys('band', band.map(b => b[0])).map(k => [k, band.find(b => b[0] === k)[1]]);
      return {
        html: bars(pairs(top), { title: t('topStations', { n: p.top }), drill: 'call', width: 1240 }) + twoCol(bars(bandSorted, { title: t('qsosPerBand'), drill: 'bands' }), bars(pairs(mode), { title: t('qsosPerMode'), colorIndex: 1, drill: 'modes' })) + twoCol(bars(pairs(cont), { title: t('qsosPerCont'), colorIndex: 2, drill: 'conts' }), bars(pairs(op), { title: t('qsosPerOperator'), colorIndex: 6, drill: 'operators' })),
        tables: [{ title: t('topStations', { n: p.top }), head: [t('call'), t('qsos')], rows: top }, { title: t('qsosPerBand'), head: [t('band'), t('qsos')], rows: bandSorted }, { title: t('qsosPerMode'), head: [t('mode'), t('qsos')], rows: mode }, { title: t('qsosPerCont'), head: [t('cont'), t('qsos')], rows: cont }, { title: t('qsosPerOperator'), head: [t('operator'), t('qsos')], rows: op }],
      };
    },
  },
  {
    id: 'dupes', params: [topParam],
    render(ctx, p) {
      const { t } = ctx, d = S.dupesBreakdown(ctx.qsos);
      const listHead = [t('date'), t('call'), t('band'), t('mode'), t('operator')], listRows = d.list.map(q => [fmtDateTime(q.ts), q.call, q.band, q.mode, q.operator]);
      return {
        html: `<div class="tiles">${tile(t('dupes'), d.total)}</div>` + twoCol(bars(pairs(d.byCall.slice(0, p.top)), { title: t('topDupeStations'), drill: 'call' }), bars(pairs(d.byDxcc.slice(0, p.top)), { title: t('topDupeDxcc'), colorIndex: 1, drill: 'countries' }))
          + twoCol(bars(pairs(d.byBand), { title: t('dupesPerBand'), colorIndex: 2, drill: 'bands' }), bars(pairs(d.byMode), { title: t('dupesPerMode'), colorIndex: 3, drill: 'modes' })) + twoCol(bars(pairs(d.byCont), { title: t('dupesPerCont'), colorIndex: 4, drill: 'conts' }), bars(pairs(d.byOperator), { title: t('dupesPerOperator'), colorIndex: 6, drill: 'operators' }))
          + table(listHead, listRows, { max: ctx.report ? 100 : 2000, links: { 1: 'call' } }),
        tables: [{ title: t('page_dupes'), head: listHead, rows: listRows }, { title: t('topDupeStations'), head: [t('call'), t('dupes')], rows: d.byCall }],
      };
    },
  },
  {
    id: 'points', params: [topParam],
    render(ctx, p) {
      const { t } = ctx, r = S.pointsBreakdown(ctx.qsos, ctx.points);
      return {
        html: `<div class="tiles">${tile(t('points'), r.total.toLocaleString())}${tile(t('pointsRule'), t('rule_' + ctx.prefs.pointsRule))}</div>` + bars(pairs(r.byCall.slice(0, p.top)), { title: t('pointsPerCall', { n: p.top }), drill: 'call', width: 1240 })
          + twoCol(bars(pairs(r.byBand), { title: t('pointsPerBand'), colorIndex: 1, drill: 'bands' }), bars(pairs(r.byMode), { title: t('pointsPerMode'), colorIndex: 2, drill: 'modes' })) + twoCol(bars(pairs(r.byOperator), { title: t('pointsPerOperator'), colorIndex: 6, drill: 'operators' }), bars(pairs(r.byCont), { title: t('pointsPerCont'), colorIndex: 3, drill: 'conts' })),
        tables: [{ title: t('pointsPerCall', { n: p.top }), head: [t('call'), t('points')], rows: r.byCall }, { title: t('pointsPerBand'), head: [t('band'), t('points')], rows: r.byBand }, { title: t('pointsPerMode'), head: [t('mode'), t('points')], rows: r.byMode }, { title: t('pointsPerOperator'), head: [t('operator'), t('points')], rows: r.byOperator }],
      };
    },
  },
  {
    id: 'zones', params: [],
    render(ctx) {
      const { t } = ctx, z = S.zones(ctx.qsos);
      const cq = z.cq.map((v, i) => [String(i + 1), v]), itu = z.itu.map((v, i) => [String(i + 1), v]);
      return {
        html: `<div class="tiles">${tile(t('cqZones'), z.cq.filter(Boolean).length + ' / 40')}${tile(t('ituZones'), z.itu.filter(Boolean).length + ' / 90')}</div>` + bars(cq, { title: t('qsosPerCq'), horizontal: false, labelEvery: 2, drill: 'cqz', width: 1240 }) + bars(itu, { title: t('qsosPerItu'), horizontal: false, colorIndex: 1, labelEvery: 5, drill: 'ituz', width: 1240 }),
        tables: [{ title: t('qsosPerCq'), head: ['CQ', t('qsos')], rows: cq }, { title: t('qsosPerItu'), head: ['ITU', t('qsos')], rows: itu }],
      };
    },
  },
  {
    id: 'dxcclocator', params: [topParam],
    render(ctx, p) {
      const { t } = ctx, r = S.dxccLocator(ctx.qsos);
      const perBand = r.perBand.map(x => [x.key, x.dxcc, x.grids]), perMode = r.perMode.map(x => [x.key, x.dxcc, x.grids]);
      return {
        html: `<div class="tiles">${tile(t('dxccEntities'), r.byDxcc.length)}${tile(t('locators'), r.byGrid.length)}${tile(t('fields'), r.byField.length)}</div>` + twoCol(bars(pairs(r.byDxcc.slice(0, p.top)), { title: t('qsosPerDxcc', { n: p.top }), drill: 'countries' }), bars(pairs(r.byGrid.slice(0, p.top)), { title: t('qsosPerGrid', { n: p.top }), colorIndex: 1, drill: 'grids' }))
          + twoCol(table([t('band'), 'DXCC', t('locators')], perBand, { numeric: [1, 2] }), table([t('mode'), 'DXCC', t('locators')], perMode, { numeric: [1, 2] })),
        tables: [{ title: t('qsosPerDxcc', { n: '' }), head: ['DXCC', t('qsos')], rows: r.byDxcc }, { title: t('qsosPerGrid', { n: '' }), head: [t('locator'), t('qsos')], rows: r.byGrid }, { title: t('perBand'), head: [t('band'), 'DXCC', t('locators')], rows: perBand }, { title: t('perMode'), head: [t('mode'), 'DXCC', t('locators')], rows: perMode }],
      };
    },
  },
  {
    id: 'kml', params: [{ id: 'layer', type: 'select', options: ['dxcc', 'grids', 'lines'], default: 'dxcc', label: 'mapLayer' }],
    render(ctx, p) {
      const { t, qsos } = ctx;
      let points = [];
      if (p.layer === 'dxcc' || p.layer === 'lines') {
        const ent = new Map();
        for (const q of qsos) if (Number.isFinite(q.elat)) { const e = ent.get(q.country) || { lat: q.elat, lon: q.elon, value: 0, country: q.country }; e.value++; ent.set(q.country, e); }
        points = [...ent.values()].map(e => ({ ...e, label: `${e.country}: ${e.value} QSOs`, drill: 'countries=' + e.country }));
      }
      if (p.layer === 'grids') points = S.groupCount(qsos, S.grid4).map(([g, n]) => { const c = gridToLatLon(g); return c && { ...c, value: n, rect: true, label: `${g}: ${n}`, drill: 'grids=' + g }; }).filter(Boolean);
      const rows = points.map(x => [x.label.split(':')[0], x.value, x.lat.toFixed(2), x.lon.toFixed(2)]);
      return {
        html: worldMap(points, { title: t('mapOf', { layer: t('layer_' + p.layer) }), home: ctx.home, lines: p.layer === 'lines' }) + `<div class="kmlActions" data-kml-actions></div>` + (ctx.report ? '' : table([t('name'), t('qsos'), 'Lat', 'Lon'], rows, { numeric: [1], links: { 0: p.layer === 'grids' ? 'grid' : 'country' } })),
        tables: [{ title: t('page_kml'), head: [t('name'), t('qsos'), 'Lat', 'Lon'], rows }],
      };
    },
  },
  {
    id: 'azidist', params: [{ id: 'step', type: 'number', min: 50, max: 5000, default: 500, label: 'distanceStep' }, { id: 'sectors', type: 'select', options: ['8', '16', '36'], default: '16', label: 'sectors' }],
    render(ctx, p) {
      const { t } = ctx, r = S.azimuthDistance(ctx.qsos, ctx.home, { distStep: Number(p.step), sectors: Number(p.sectors) });
      const dist = r.distribution.map(([k, v]) => [`${k}–${k + r.distStep}`, v]);
      const az = r.azimuth.map((v, i) => [`${Math.round((i * 360) / r.azimuth.length)}°`, v]);
      const longHead = [t('call'), t('date'), t('band'), t('mode'), 'km', 'Az', t('locator'), t('country')], longRows = r.longest.map(x => [x.call, fmtDateTime(x.ts), x.band, x.mode, x.km, x.az, x.grid, x.country]);
      const note = !ctx.home && r.skipped ? `<p class="notice">${esc(t('needHome'))}</p>` : '';
      return {
        html: note + `<div class="tiles">${tile(t('measured'), r.measured)}${tile(t('withoutPosition'), r.skipped)}${tile(t('longest'), r.longest[0] ? r.longest[0].km.toLocaleString() + ' km' : '—', r.longest[0]?.call || '')}</div>` + twoCol(bars(dist, { title: t('qsosPerDistance'), unit: '' }), rose(r.azimuth, { title: t('qsosPerAzimuth') })) + `<h3>${esc(t('longestQsos'))}</h3>` + table(longHead, longRows, { numeric: [4, 5], links: { 0: 'call', 6: 'grid', 7: 'country' } }),
        tables: [{ title: t('qsosPerDistance'), head: ['km', t('qsos')], rows: dist }, { title: t('qsosPerAzimuth'), head: ['Az', t('qsos')], rows: az }, { title: t('longestQsos'), head: longHead, rows: longRows }],
      };
    },
  },
  {
    id: 'time', params: [{ ...unitParam, options: ['auto', 'hour', 'day', 'month'] }],
    render(ctx, p) {
      const { t } = ctx, s = S.timeSeries(ctx.qsos, p.unit, ctx.points), labels = s.cols.map(c => unitLabel(c, s.unit));
      const head = [t('period'), t('qsos'), t('points'), t('newCq'), t('newItu'), t('newDxcc'), t('newPrefixes'), t('newLocators')];
      const rows = s.cols.map((_, i) => [labels[i], s.qsos[i], s.points[i], s.newCqz[i], s.newItuz[i], s.newDxcc[i], s.newPfx[i], s.newGrid[i]]);
      const xf = v => unitLabel(v, s.unit);
      return {
        html: twoCol(bars(labels.map((l, i) => [l, s.qsos[i], span(s.cols[i], s.unit)]), { title: t('qsosPer', { unit: t('unit_' + s.unit) }), horizontal: false, drill: 'range' }), bars(labels.map((l, i) => [l, s.points[i], span(s.cols[i], s.unit)]), { title: t('pointsPer', { unit: t('unit_' + s.unit) }), horizontal: false, colorIndex: 1, drill: 'range' }))
          + twoCol(lines(s.cols, [{ name: 'CQ', values: s.cum.newCqz }, { name: 'ITU', values: s.cum.newItuz }], { title: t('newZonesCum'), xFormat: xf }), lines(s.cols, [{ name: 'DXCC', values: s.cum.newDxcc }, { name: t('prefixes'), values: s.cum.newPfx }], { title: t('newDxccPfxCum'), xFormat: xf }))
          + lines(s.cols, [{ name: 'DXCC', values: s.cum.newDxcc }, { name: t('locators'), values: s.cum.newGrid }], { title: t('newDxccGridCum'), xFormat: xf, width: 1240 }) + table(head, rows, { numeric: [1, 2, 3, 4, 5, 6, 7], max: ctx.report ? 120 : 3000 }),
        tables: [{ title: t('page_time'), head, rows }],
      };
    },
  },
  {
    id: 'historical', params: [],
    render(ctx) {
      const { t } = ctx, h = S.historical(ctx.qsos);
      const wd = t('weekdays').split(','), mo = t('months').split(',');
      return {
        html: twoCol(bars(h.years, { title: t('qsosPerYear'), horizontal: false, drill: 'year' }), bars(h.dxccYear, { title: t('dxccPerYear'), horizontal: false, colorIndex: 2 }))
          + stacked(h.yearList, h.bandYear.map(b => ({ name: b.key, values: b.values })), { title: t('bandsPerYear'), drill: 'year', width: 1240 })
          + bars(h.months, { title: t('qsosPerMonth'), horizontal: false, drill: 'month', width: 1240 })
          + twoCol(bars(h.hourOfDay.map((v, i) => [String(i).padStart(2, '0'), v, i]), { title: t('qsosPerHourUtc'), horizontal: false, colorIndex: 1, drill: 'hours' }), bars(h.weekday.map((v, i) => [wd[i], v, i]), { title: t('qsosPerWeekday'), horizontal: false, colorIndex: 3, drill: 'weekdays' }))
          + bars(h.monthOfYear.map((v, i) => [mo[i], v]), { title: t('qsosPerMonthOfYear'), horizontal: false, colorIndex: 6, width: 1240 }),
        tables: [{ title: t('qsosPerYear'), head: [t('year'), t('qsos')], rows: h.years }, { title: t('qsosPerMonth'), head: [t('month'), t('qsos')], rows: h.months }, { title: t('bandsPerYear'), head: [t('band'), ...h.yearList], rows: h.bandYear.map(b => [b.key, ...b.values]) }, { title: t('qsosPerHourUtc'), head: ['UTC', t('qsos')], rows: h.hourOfDay.map((v, i) => [i, v]) }],
      };
    },
  },
  {
    id: 'optime', params: [dimParam('band'), pauseParam(15)],
    render(ctx, p) {
      const { t } = ctx, list = S.operatingTimeBy(ctx.qsos, p.dim, p.pause), total = S.operatingTime(ctx.qsos, p.pause);
      const head = [t('dim_' + p.dim), t('qsos'), t('operatingTime'), t('hours')], rows = list.map(x => [x.key, x.qsos, fmtDur(x.ms), hours(x.ms)]);
      return { html: `<div class="tiles">${tile(t('operatingTime'), fmtDur(total))}</div>` + bars(list.map(x => [x.key, hours(x.ms)]), { title: t('opTimePer', { dim: t('dim_' + p.dim) }), unit: ' h', drill: DIM_FILTER[p.dim], width: 1240 }) + table(head, rows, { numeric: [1, 3] }), tables: [{ title: t('page_optime'), head, rows }] };
    },
  },
  {
    id: 'qsorate', params: [{ id: 'dim', type: 'select', options: ['all', 'band', 'mode', 'operator', 'radio'], default: 'all', label: 'groupBy' }, { id: 'sample', type: 'number', min: 5, max: 60, default: 60, label: 'sampleMinutes' }],
    render(ctx, p) {
      const { t } = ctx, series = S.rateSeriesBy(ctx.qsos, p.dim, p.sample);
      if (!series.length || !series[0].series.length) return { html: lines([], []), tables: [] };
      // Alinha as séries num eixo comum.
      const all = [...new Set(series.flatMap(s => s.series.map(x => x.t)))].sort((a, b) => a - b);
      const sampled = all.length > 800 ? all.filter((_, i) => i % Math.ceil(all.length / 800) === 0) : all;
      const lookup = series.map(s => new Map(s.series.map(x => [x.t, x.rate])));
      const data = series.map((s, k) => ({ name: s.key === 'all' ? t('allLog') : s.key, values: sampled.map(x => lookup[k].get(x) ?? 0) }));
      const head = [t('time'), ...data.map(d => d.name)], rows = sampled.map((x, i) => [fmtDateTime(x), ...data.map(d => d.values[i])]);
      return { html: lines(sampled, data, { title: t('rateChartTitle', { n: p.sample }), xFormat: v => fmtDateTime(v).slice(5), width: 1240 }), tables: [{ title: t('page_qsorate'), head, rows }] };
    },
  },
  {
    id: 'maxrates', params: [dimParam('band'), { id: 'window', type: 'number', min: 1, max: 60, default: 60, label: 'windowMinutes' }],
    render(ctx, p) {
      const { t } = ctx, list = S.maxRatesBy(ctx.qsos, p.dim, p.window), all = S.maxRate(ctx.qsos, p.window);
      const head = [t('dim_' + p.dim), t('qsos'), t('maxInWindow', { n: p.window }), 'QSO/h', t('start')], rows = list.map(x => [x.key, x.qsos, x.count, x.perHour, fmtDateTime(x.start)]);
      return { html: `<div class="tiles">${tile(t('maxInWindow', { n: p.window }), all.count, `${all.perHour}/h · ${fmtDateTime(all.start)}`)}</div>` + bars(list.map(x => [x.key, x.count]), { title: t('maxRatePer', { dim: t('dim_' + p.dim), n: p.window }), drill: DIM_FILTER[p.dim], width: 1240 }) + table(head, rows, { numeric: [1, 2, 3] }), tables: [{ title: t('page_maxrates'), head, rows }] };
    },
  },
  {
    id: 'avgrates', params: [dimParam('band'), pauseParam(15)],
    render(ctx, p) {
      const { t } = ctx, list = S.avgRatesBy(ctx.qsos, p.dim, p.pause);
      const head = [t('dim_' + p.dim), t('qsos'), t('operatingTime'), 'QSO/h'], rows = list.map(x => [x.key, x.qsos, fmtDur(x.ms), x.rate]);
      return { html: bars(list.map(x => [x.key, x.rate]), { title: t('avgRatePer', { dim: t('dim_' + p.dim) }), unit: ' /h', drill: DIM_FILTER[p.dim], width: 1240 }) + table(head, rows, { numeric: [1, 3] }), tables: [{ title: t('page_avgrates'), head, rows }] };
    },
  },
  {
    id: 'propagation', params: [{ id: 'band', type: 'select', optionsFn: qsos => ['', ...S.sortKeys('band', [...S.distinct(qsos, q => q.band)])], default: '', label: 'band' }, { id: 'esKm', type: 'number', min: 100, max: 5000, default: 500, label: 'openingKm' }],
    render(ctx, p) {
      const { t } = ctx, r = I.propagation(ctx.qsos, { band: p.band, home: ctx.home, esKm: Number(p.esKm) });
      const bandLabel = p.band || t('allBands');
      const cols = r.months, distRows = r.distance.map(d => [d.month, d.n, d.avg, d.max, d.dir]);
      const openRows = r.openings.map(o => [o.day, o.band, o.qsos.length, o.maxKm, { html: o.qsos.slice(0, 8).map(l => entityLink('call', l.q.call)).join(' ') }]);
      return {
        html: `<p class="help">${esc(t('propagationNote'))}</p>`
          + heatGrid(r.byCont.map(x => ({ key: x.key, values: x.values })), cols, { title: t('propContMonth', { band: bandLabel }), rowDrill: 'conts' })
          + heatGrid(r.byCountry.map(x => ({ key: x.key, values: x.values })), cols, { title: t('propCountryMonth', { band: bandLabel }), rowDrill: 'countries' })
          + heatGrid(r.hourMonth, cols, { title: t('propHourMonth', { band: bandLabel }), labelEvery: null })
          + lines(r.distance.map(d => Date.parse(d.month + '-01T00:00:00Z')), [{ name: t('avgKm'), values: r.distance.map(d => d.avg) }, { name: t('maxKm'), values: r.distance.map(d => d.max) }], { title: t('propDistance', { band: bandLabel }), xFormat: v => new Date(v).toISOString().slice(0, 7), width: 1240 })
          + table([t('month'), t('measured'), t('avgKm'), t('maxKm'), t('mainDirection')], distRows, { numeric: [1, 2, 3] })
          + `<h3>${esc(t('openingsTitle', { km: p.esKm }))}</h3>` + (openRows.length ? table([t('date'), t('band'), t('qsos'), t('maxKm'), t('stations')], openRows, { numeric: [2, 3] }) : `<p class="help">${esc(t('noOpenings'))}</p>`)
          + `<h3>${esc(t('yearCompare'))}</h3>` + table([t('year'), t('qsos'), 'DXCC', t('continents')], r.years.map(y => [y.year, y.qsos, y.dxcc, y.conts]), { numeric: [1, 2, 3] }),
        tables: [{ title: t('propContMonth', { band: bandLabel }), head: [t('cont'), ...cols], rows: r.byCont.map(x => [x.key, ...x.values]) }, { title: t('propCountryMonth', { band: bandLabel }), head: [t('country'), ...cols], rows: r.byCountry.map(x => [x.key, ...x.values]) }, { title: t('propDistance', { band: bandLabel }), head: [t('month'), t('measured'), t('avgKm'), t('maxKm'), t('mainDirection')], rows: distRows }],
      };
    },
  },
  {
    id: 'periods', params: [{ id: 'preset', type: 'select', options: ['yearVsLast', 'lastYearVsBefore', 'monthVsLastYear', 'monthVsPrevious'], default: 'yearVsLast', label: 'comparison' }],
    render(ctx, p) {
      const { t } = ctx, pr = I.periodPresets(ctx.now)[p.preset], r = I.comparePeriods(ctx.qsos, pr.a, pr.b);
      const la = `${fmtDate(pr.a[0])} → ${fmtDate(pr.a[1] - 1)}`, lb = `${fmtDate(pr.b[0])} → ${fmtDate(pr.b[1] - 1)}`;
      const delta = (a, b) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : a ? '+' : '—');
      const keys = [['qsos', 'qsos'], ['uniqueCalls', 'calls'], ['dxccEntities', 'dxcc'], ['locators', 'grids'], ['bands', 'bands'], ['confirmedQsos', 'confirmed'], ['maxRate60', 'max60']];
      const rows = keys.map(([label, k]) => [t(label), r.a[k], r.b[k], delta(r.a[k], r.b[k])]);
      rows.push([t('operatingTime'), fmtDur(r.a.operatingMs), fmtDur(r.b.operatingMs), delta(r.a.operatingMs, r.b.operatingMs)]);
      const head = [t('metric'), la, lb, t('change')];
      return {
        html: `<div class="tiles">${tile(t('newCallsIn'), r.newCalls)}${tile(t('newDxccIn'), r.newDxcc.length)}${tile(t('newGridsIn'), r.newGrids)}</div>` + table(head, rows, { numeric: [1, 2, 3] })
          + twoCol(stacked(r.perBand.map(x => x.band), [{ name: la, values: r.perBand.map(x => x.a) }, { name: lb, values: r.perBand.map(x => x.b) }], { title: t('qsosPerBand') }), stacked(r.perMode.map(x => x.mode), [{ name: la, values: r.perMode.map(x => x.a) }, { name: lb, values: r.perMode.map(x => x.b) }], { title: t('qsosPerMode') }))
          + `<h3>${esc(t('newDxccList'))}</h3>` + table([t('date'), t('country'), t('call'), t('band'), t('mode')], r.newDxcc.map(q => [fmtDateTime(q.ts), q.country, q.call, q.band, q.mode]), { links: { 1: 'country', 2: 'call' } }),
        tables: [{ title: t('page_periods'), head, rows }],
      };
    },
  },
  {
    id: 'friends', params: [{ id: 'min', type: 'number', min: 2, max: 100, default: 3, label: 'minQsos' }, { id: 'months', type: 'number', min: 1, max: 120, default: 12, label: 'monthsAway' }, topParam],
    render(ctx, p) {
      const { t } = ctx, r = I.friends(ctx.qsos, { minQsos: Number(p.min), months: Number(p.months), now: ctx.now });
      const head = [t('call'), t('qsos'), t('bands'), t('country'), t('firstQso'), t('lastQso')];
      const row = f => [f.call, f.qsos, f.bands.join(' '), f.country, fmtDate(f.first), fmtDate(f.last)];
      return {
        html: bars(r.frequent.slice(0, p.top).map(f => [f.call, f.qsos]), { title: t('frequentTitle', { n: p.top }), drill: 'call', width: 1240 })
          + `<h3>${esc(t('frequentList'))}</h3>` + table(head, r.frequent.map(row), { numeric: [1], links: { 0: 'call', 3: 'country' }, max: ctx.report ? 100 : 2000 })
          + `<h3>${esc(t('missingFriends', { m: p.months }))}</h3>` + (r.missing.length ? table(head, r.missing.map(row), { numeric: [1], links: { 0: 'call', 3: 'country' } }) : `<p class="help">${esc(t('noneFound'))}</p>`),
        tables: [{ title: t('frequentList'), head, rows: r.frequent.map(row) }, { title: t('missingFriends', { m: p.months }), head, rows: r.missing.map(row) }],
      };
    },
  },
  {
    id: 'newcalls', params: [{ id: 'unit', type: 'select', options: ['month', 'year'], default: 'month', label: 'timeUnit' }],
    render(ctx, p) {
      const { t } = ctx, r = I.newCallsPerPeriod(ctx.qsos, p.unit);
      const head = [t('period'), t('qsos'), t('newCalls'), t('newDxcc'), t('cumulative')], rows = r.map(x => [x.period, x.qsos, x.newCalls, x.newDxcc, x.cumulative]);
      return {
        html: bars(r.map(x => [x.period, x.newCalls, x.period]), { title: t('newCallsTitle'), horizontal: false, drill: p.unit, width: 1240 })
          + lines(r.map(x => Date.parse((p.unit === 'year' ? x.period + '-01' : x.period) + '-01T00:00:00Z')), [{ name: t('cumulative'), values: r.map(x => x.cumulative) }], { title: t('newCallsCumulative'), xFormat: v => new Date(v).toISOString().slice(0, p.unit === 'year' ? 4 : 7), area: true, width: 1240 })
          + table(head, rows, { numeric: [1, 2, 3, 4] }),
        tables: [{ title: t('page_newcalls'), head, rows }],
      };
    },
  },
  {
    id: 'contest', params: [{ id: 'key', type: 'select', optionsFn: qsos => I.contests(qsos).map(c => c.key), default: '', label: 'contestLabel' }],
    render(ctx, p) {
      const { t } = ctx, list = I.contests(ctx.qsos);
      if (!list.length) return { html: `<p class="notice">${esc(t('noContests'))}</p>`, tables: [] };
      const key = p.key && list.some(c => c.key === p.key) ? p.key : list[0].key;
      const r = I.contestAnalysis(ctx.qsos, key, ctx.points), c = r.current, prev = r.previous;
      const metric = (label, f) => [label, c ? f(c) : '—', prev ? f(prev) : '—'];
      const rows = [metric(t('period'), x => `${fmtDateTime(x.start)} → ${fmtDateTime(x.end)}`), metric(t('qsos'), x => x.qsos), metric(t('dupes'), x => x.dupes), metric(t('points'), x => x.points),
        metric(t('multDxcc'), x => x.mults.dxcc), metric(t('multCq'), x => x.mults.cqz), metric(t('prefixes'), x => x.mults.pfx), metric(t('operatingTime'), x => fmtDur(x.operatingMs)), metric(t('maxRateN', { n: 60 }), x => x.max60),
        metric(t('scoreDxcc'), x => x.scoreDxcc.toLocaleString()), metric(t('scoreCq'), x => x.scoreCq.toLocaleString())];
      const head = [t('metric'), String(r.year), String(r.year - 1)];
      return {
        html: `<p class="help">${esc(t('contestNote', { id: r.id }))}</p>` + table(head, rows, { numeric: [1, 2] })
          + twoCol(bars(c.hours.map(([h, n]) => [fmtDateTime(Number(h)).slice(5, 13) + 'h', n, Number(h) + '~' + (Number(h) + 3600000)]), { title: t('qsosPerHourContest'), horizontal: false, drill: 'range' }), table([t('band'), t('qsos'), 'DXCC', 'CQ'], c.perBand.map(b => [b.band, b.qsos, b.dxcc, b.cqz]), { numeric: [1, 2, 3] })),
        tables: [{ title: `${r.id} ${r.year}`, head, rows }],
      };
    },
  },
];

// Página de QSL (confirmações), também disponível como seção de relatório.
export const QSL_PAGE = {
  id: 'qsl', params: [{ id: 'show', type: 'select', options: ['matrix', 'unconfirmed'], default: 'matrix', label: 'view' }],
  render(ctx, p) {
    const { t } = ctx, r = S.qslStatus(ctx.qsos), pct = n => (r.total ? Math.round((n / r.total) * 100) + '%' : '—');
    const tiles = `<div class="tiles">${tile(t('confirmedQsos'), r.any.toLocaleString(), pct(r.any))}${tile('LoTW', r.lotw.toLocaleString(), pct(r.lotw))}${tile('eQSL', r.eqsl.toLocaleString(), pct(r.eqsl))}${tile(t('paperQsl'), r.paper.toLocaleString(), pct(r.paper))}${tile(t('dxccWorked'), r.dxccWorked)}${tile(t('dxccConfirmed'), r.dxccConfirmed)}</div>`;
    const perBand = r.perBand.map(b => [b.band, b.worked, b.confirmed]);
    const chart = stacked(r.bands, [{ name: t('confirmed'), values: r.perBand.map(b => b.confirmed) }, { name: t('workedOnly'), values: r.perBand.map(b => b.worked - b.confirmed) }], { title: t('dxccPerBandStatus'), drill: 'bands' });
    const head = [t('country'), 'DXCC', t('cont'), t('qsos'), ...r.bands];
    const mark = (e, b) => (e.confirmed.includes(b) ? 'C' : e.worked.includes(b) ? 'W' : '');
    const list = p.show === 'unconfirmed' ? r.entities.filter(e => !e.confirmed.length) : r.entities;
    const rows = list.map(e => [e.country, e.dxcc ?? '', e.cont, e.qsos, ...r.bands.map(b => mark(e, b))]);
    const htmlRows = list.map(e => [e.country, e.dxcc ?? '', e.cont, e.qsos, ...r.bands.map(b => ({ html: mark(e, b) === 'C' ? '<b class="qslC">C</b>' : mark(e, b) === 'W' ? '<span class="qslW">W</span>' : '' }))]);
    const sent = `<p class="help">${esc(t('qslSentSummary', { paper: r.paperSent, lotw: r.lotwSent, eqsl: r.eqslSent }))}</p>`;
    return {
      html: tiles + sent + twoCol(chart, table([t('band'), t('worked'), t('confirmed')], perBand, { numeric: [1, 2] })) + `<p class="help">${esc(t('qslLegend'))}</p>` + table(head, htmlRows, { className: 'matrix', links: { 0: 'country', 2: 'cont' } }),
      tables: [{ title: t('dxccMatrix'), head, rows }, { title: t('dxccPerBandStatus'), head: [t('band'), t('worked'), t('confirmed')], rows: perBand }],
    };
  },
};


const acceptParam = { id: 'accept', type: 'select', options: ['lotw-paper', 'any'], default: 'lotw-paper', label: 'acceptConfirmations' };
const pct = (n, total) => (total ? Math.round((n / total) * 100) + '%' : '—');

export const AWARDS_PAGE = {
  id: 'awards', params: [acceptParam],
  render(ctx, p) {
    const { t } = ctx, d = A.dxccAward(ctx.qsos, ctx.cty, p.accept), was = A.wasAward(ctx.qsos, p.accept), waz = A.wazAward(ctx.qsos, p.accept), wpx = A.wpxAward(ctx.qsos, p.accept), vucc = A.vuccAward(ctx.qsos, p.accept), iota = A.iotaAward(ctx.qsos, p.accept);
    const bar = (label, worked, confirmed, total) => `<div class="award"><div class="awardHead"><strong>${esc(label)}</strong><span>${confirmed} ${esc(t('confirmedShort'))} · ${worked} ${esc(t('workedShort'))}${total ? ' / ' + total : ''}</span></div><div class="awardBar"><i class="w" style="width:${total ? Math.min(100, (worked / total) * 100) : 0}%"></i><i class="c" style="width:${total ? Math.min(100, (confirmed / total) * 100) : 0}%"></i></div></div>`;
    const dxccRows = d.categories.map(c => [t('dxcc_' + c.key), c.worked, c.confirmed, d.total - c.worked, pct(c.confirmed, d.total)]);
    const missing = d.categories[0].missing;
    const cells = (rows, type) => `<div class="awardGrid">${rows.map(r => `<span class="${r.confirmed ? 'c' : r.worked ? 'w' : ''}" title="${esc(r.qso ? r.qso.call + ' · ' + fmtDate(r.qso.ts) : '')}">${esc(r.key)}</span>`).join('')}</div>`;
    return {
      html: `<p class="help">${esc(t('awardsNote'))}</p>`
        + d.categories.map(c => bar('DXCC ' + t('dxcc_' + c.key), c.worked, c.confirmed, d.total)).join('')
        + table(['DXCC', t('worked'), t('confirmed'), t('missing'), '%'], dxccRows, { numeric: [1, 2, 3, 4] })
        + `<h3>${esc(t('dxccPerBandAward'))}</h3>` + table([t('band'), t('worked'), t('confirmed')], d.perBand.map(b => [b.band, b.worked, b.confirmed]), { numeric: [1, 2] })
        + `<h3>WAZ — ${esc(t('cqZones'))}</h3>` + bar('WAZ', waz.rows.filter(r => r.worked).length, waz.rows.filter(r => r.confirmed).length, 40) + cells(waz.rows)
        + `<h3>WAS — ${esc(t('usStates'))}</h3>` + bar('WAS', was.rows.filter(r => r.worked).length, was.rows.filter(r => r.confirmed).length, 50) + cells(was.rows)
        + `<h3>WPX</h3>` + bar('WPX', wpx.worked, wpx.confirmed, wpx.targets.find(x => x > wpx.confirmed) || wpx.confirmed)
        + `<h3>VUCC</h3>` + (vucc.length ? vucc.map(v => bar('VUCC ' + v.band, v.worked, v.confirmed, v.target)).join('') : `<p class="help">${esc(t('noVhfGrids'))}</p>`)
        + `<h3>IOTA</h3>` + bar('IOTA', iota.worked, iota.confirmed, 0)
        + `<h3>${esc(t('dxccMissingList', { n: missing.length }))}</h3>` + `<p class="help">${missing.map(e => esc(e.name)).join(' · ')}</p>`,
      tables: [{ title: 'DXCC', head: ['DXCC', t('worked'), t('confirmed'), t('missing'), '%'], rows: dxccRows }, { title: t('dxccMissingList', { n: missing.length }), head: [t('country'), t('cont')], rows: missing.map(e => [e.name, e.cont]) }],
    };
  },
};

export const UNCONFIRMED_PAGE = {
  id: 'unconfirmed', params: [{ id: 'perBand', type: 'select', options: ['no', 'yes'], default: 'no', label: 'perBand' }, acceptParam],
  render(ctx, p) {
    const { t } = ctx, list = A.unconfirmed(ctx.qsos, { perBand: p.perBand === 'yes', accept: p.accept });
    const head = [t('country'), t('band'), t('cont'), t('attempts'), t('bestQso'), t('date'), t('mode'), 'LoTW'];
    const rows = list.map(x => [x.country, x.band || '—', x.cont, x.attempts, x.best.call, fmtDateTime(x.best.ts), x.best.mode, x.best.lotwSent === 'Y' ? t('sent') : '']);
    return { html: `<p class="help">${esc(t('unconfirmedNote'))}</p><div class="tiles">${tile(t('toConfirm'), list.length)}</div>` + table(head, rows, { numeric: [3], links: { 0: 'country', 2: 'cont', 4: 'call' } }), tables: [{ title: t('page_unconfirmed'), head, rows }] };
  },
};

export const RARE_PAGE = {
  id: 'rare', params: [],
  render(ctx) {
    const { t } = ctx, list = A.rareWorked(ctx.qsos, ctx.cty), got = list.filter(x => x.qsos);
    const head = ['#', t('country'), 'DXCC', t('qsos'), t('confirmed'), t('firstQso')];
    const rows = list.map(x => [x.rank, x.name, x.dxcc, x.qsos || '', x.qsos ? (x.confirmed ? '✓' : '—') : '', x.first ? fmtDate(x.first) : '']);
    return { html: `<p class="help">${esc(t('rareNote'))}</p><div class="tiles">${tile(t('rareWorked'), got.length + ' / ' + list.length)}</div>` + table(head, rows, { numeric: [0, 2, 3], links: { 1: 'country' } }), tables: [{ title: t('page_rare'), head, rows }] };
  },
};

export const QSL_PAGES = [QSL_PAGE, AWARDS_PAGE, UNCONFIRMED_PAGE, RARE_PAGE];
export const ALL_SECTIONS = [...STAT_PAGES, ...QSL_PAGES];
export const sectionById = id => ALL_SECTIONS.find(s => s.id === id);
export const defaultParams = page => Object.fromEntries(page.params.map(p => [p.id, p.default]));
