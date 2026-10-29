// Gráficos SVG sem dependências externas. Todos retornam strings SVG/HTML com dicas (data-tip) para o hover.
export const PALETTES = {
  default: { dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'], light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] },
  pt2vhf: { dark: ['#69e1c2', '#3987e5', '#c98500', '#d55181', '#9085e9', '#d95926', '#008300', '#e66767'], light: ['#1f9f80', '#2a78d6', '#eda100', '#e87ba4', '#6250d6', '#eb6834', '#008300', '#e34948'] },
  mono: { dark: ['#5598e7', '#86b6ef', '#256abf', '#b7d3f6', '#184f95', '#3987e5', '#9ec5f4', '#1c5cab'], light: ['#256abf', '#5598e7', '#104281', '#86b6ef', '#1c5cab', '#3987e5', '#184f95', '#6da7ec'] },
};
export const SEQUENTIAL = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

let palette = PALETTES.default.dark;
export function setPalette(name, theme) { palette = (PALETTES[name] || PALETTES.default)[theme === 'light' ? 'light' : 'dark']; }
export const color = i => palette[i % palette.length];

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = v => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(v));

// Escala "redonda"; contagens pequenas usam no mínimo 4 para evitar marcas fracionárias.
function niceMax(v, integer = true) {
  if (integer && v <= 4) return 4;
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const ticks = (max, n = 4) => Array.from({ length: n + 1 }, (_, i) => (max / n) * i);

// Barras verticais (poucas categorias) ou horizontais (rótulos longos / muitas categorias).
const drillAttr = (key, value) => (key && value !== undefined && value !== null && value !== '' && value !== '—' ? ` data-drill="${esc(key + '=' + value)}"` : '');

export function bars(data, { title = '', horizontal = null, height = 260, valueFormat = fmt, colorIndex = 0, unit = '', max: forcedMax = null, labelEvery = null, drill = null, width = 640 } = {}) {
  if (!data.length) return emptyChart(title);
  const horiz = horizontal ?? (data.length > 14 || data.some(([l]) => String(l).length > 6));
  const max = niceMax(forcedMax ?? Math.max(...data.map(d => d[1])));
  const fill = color(colorIndex);
  if (horiz) {
    const rowH = 22, labelW = Math.min(170, 12 + 7 * Math.max(...data.map(([l]) => String(l).length))), w = width, plotW = w - labelW - 60, h = data.length * rowH + 28;
    let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">`;
    for (const t of ticks(max)) { const x = labelW + (t / max) * plotW; svg += `<line class="grid" x1="${x}" x2="${x}" y1="4" y2="${h - 22}"/><text class="axis" x="${x}" y="${h - 6}" text-anchor="middle">${esc(valueFormat(t))}</text>`; }
    data.forEach(([label, v], i) => {
      const y = 6 + i * rowH, bw = Math.max(v > 0 ? 2 : 0, (v / max) * plotW);
      svg += `<g class="mark"${drillAttr(drill, data[i][2] ?? label)} data-tip="${esc(label)}: ${esc(valueFormat(v))}${esc(unit)}" style="--i:${i}"><rect class="hit" x="0" y="${y - 2}" width="${w}" height="${rowH}"/><text class="label" x="${labelW - 8}" y="${y + 13}" text-anchor="end">${esc(label)}</text><path class="bh" d="${roundedBarH(labelW, y + 3, bw, 13)}" fill="${fill}"/><text class="value" x="${labelW + bw + 6}" y="${y + 13}">${esc(valueFormat(v))}</text></g>`;
    });
    return wrap(title, svg + '</svg>');
  }
  const w = width, h = height, left = 46, bottom = 34, plotH = h - bottom - 14, plotW = w - left - 10, slot = plotW / data.length, bw = Math.max(2, Math.min(42, slot - 2));
  const every = labelEvery || Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / (Math.max(...data.map(([l]) => String(l).length)) * 6 + 10)))));
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">`;
  for (const t of ticks(max)) { const y = 14 + plotH - (t / max) * plotH; svg += `<line class="grid" x1="${left}" x2="${w - 10}" y1="${y}" y2="${y}"/><text class="axis" x="${left - 6}" y="${y + 4}" text-anchor="end">${esc(valueFormat(t))}</text>`; }
  data.forEach(([label, v], i) => {
    const x = left + i * slot + (slot - bw) / 2, bh = Math.max(v > 0 ? 2 : 0, (v / max) * plotH), y = 14 + plotH - bh;
    svg += `<g class="mark"${drillAttr(drill, data[i][2] ?? label)} data-tip="${esc(label)}: ${esc(valueFormat(v))}${esc(unit)}" style="--i:${i}"><rect class="hit" x="${left + i * slot}" y="14" width="${slot}" height="${plotH}"/><path class="bv" d="${roundedBarV(x, y, bw, bh)}" fill="${fill}"/>${data.length <= 16 && v > 0 ? `<text class="value" x="${x + bw / 2}" y="${y - 4}" text-anchor="middle">${esc(valueFormat(v))}</text>` : ''}</g>`;
    if (i % every === 0) svg += `<text class="axis" x="${x + bw / 2}" y="${h - bottom + 16}" text-anchor="middle">${esc(label)}</text>`;
  });
  svg += `<line class="baseline" x1="${left}" x2="${w - 10}" y1="${14 + plotH}" y2="${14 + plotH}"/>`;
  return wrap(title, svg + '</svg>');
}

function roundedBarV(x, y, w, h) { const r = Math.min(4, w / 2, h); return h <= 0 ? '' : `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
function roundedBarH(x, y, w, h) { const r = Math.min(4, h / 2, w); return w <= 0 ? '' : `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`; }

// Barras agrupadas/empilhadas para várias séries (ex.: QSOs por banda × ano).
export function stacked(categories, series, { title = '', height = 280, valueFormat = fmt, drill = null, drillValues = null, width = 640 } = {}) {
  if (!categories.length || !series.length) return emptyChart(title);
  const shown = series.slice(0, 7);
  if (series.length > 7) shown.push({ name: '…', values: categories.map((_, i) => series.slice(7).reduce((s, x) => s + (x.values[i] || 0), 0)) });
  const totals = categories.map((_, i) => shown.reduce((s, x) => s + (x.values[i] || 0), 0));
  const max = niceMax(Math.max(...totals)), w = width, h = height, left = 46, bottom = 34, plotH = h - bottom - 14, plotW = w - left - 10, slot = plotW / categories.length, bw = Math.max(3, Math.min(42, slot - 3));
  const every = Math.max(1, Math.ceil(categories.length / Math.max(1, Math.floor(plotW / (Math.max(...categories.map(c => String(c).length)) * 6 + 10)))));
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">`;
  for (const t of ticks(max)) { const y = 14 + plotH - (t / max) * plotH; svg += `<line class="grid" x1="${left}" x2="${w - 10}" y1="${y}" y2="${y}"/><text class="axis" x="${left - 6}" y="${y + 4}" text-anchor="end">${esc(valueFormat(t))}</text>`; }
  categories.forEach((c, i) => {
    let acc = 0;
    const x = left + i * slot + (slot - bw) / 2;
    const tip = `${c}: ` + shown.map(s => `${s.name} ${valueFormat(s.values[i] || 0)}`).join(' · ');
    svg += `<g class="mark"${drillAttr(drill, drillValues ? drillValues[i] : c)} data-tip="${esc(tip)}" style="--i:${i}"><rect class="hit" x="${left + i * slot}" y="14" width="${slot}" height="${plotH}"/>`;
    shown.forEach((s, k) => {
      const v = s.values[i] || 0;
      if (!v) return;
      const bh = (v / max) * plotH, y = 14 + plotH - acc - bh;
      svg += `<rect class="bv" data-s="${k}" x="${x}" y="${y}" width="${bw}" height="${Math.max(1, bh - (acc ? 1 : 0))}" fill="${color(k)}" rx="${acc + bh >= (totals[i] / max) * plotH - 0.5 ? 2 : 0}"/>`;
      acc += bh;
    });
    svg += '</g>';
    if (i % every === 0) svg += `<text class="axis" x="${x + bw / 2}" y="${h - bottom + 16}" text-anchor="middle">${esc(c)}</text>`;
  });
  svg += `<line class="baseline" x1="${left}" x2="${w - 10}" y1="${14 + plotH}" y2="${14 + plotH}"/></svg>`;
  return wrap(title, svg, legend(shown.map(s => s.name)));
}

export function legend(names) {
  if (names.length < 2) return '';
  return `<div class="legend">${names.map((n, i) => `<button type="button" class="legendItem" data-series="${i}" aria-pressed="true"><i style="background:${color(i)}"></i>${esc(n)}</button>`).join('')}</div>`;
}

// Linhas no tempo (taxa de QSO, acumulados). x em ms UTC.
export function lines(x, series, { title = '', height = 260, xFormat = v => new Date(v).toISOString().slice(5, 16).replace('T', ' '), valueFormat = fmt, area = false, width = 640 } = {}) {
  if (!x.length || !series.length) return emptyChart(title);
  const w = width, h = height, left = 46, bottom = 34, plotH = h - bottom - 14, plotW = w - left - 14;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const x0 = x[0], x1 = x[x.length - 1] === x0 ? x0 + 1 : x[x.length - 1];
  const px = v => left + ((v - x0) / (x1 - x0)) * plotW, py = v => 14 + plotH - (v / max) * plotH;
  let svg = `<svg class="chart lineChart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" data-brush="${x0},${x1},${left},${plotW}">`;
  for (const t of ticks(max)) svg += `<line class="grid" x1="${left}" x2="${w - 14}" y1="${py(t)}" y2="${py(t)}"/><text class="axis" x="${left - 6}" y="${py(t) + 4}" text-anchor="end">${esc(valueFormat(t))}</text>`;
  for (let k = 0; k <= 5; k++) { const v = x0 + ((x1 - x0) * k) / 5; svg += `<text class="axis" x="${px(v)}" y="${h - bottom + 16}" text-anchor="${k === 0 ? 'start' : k === 5 ? 'end' : 'middle'}">${esc(xFormat(v))}</text>`; }
  series.forEach((s, k) => {
    const pts = s.values.map((v, i) => `${px(x[i]).toFixed(1)},${py(v).toFixed(1)}`);
    if (area && series.length === 1) svg += `<path class="area" data-s="${k}" d="M${px(x[0])},${py(0)}L${pts.join('L')}L${px(x[x.length - 1])},${py(0)}Z" fill="${color(k)}"/>`;
    svg += `<path class="line" data-s="${k}" pathLength="1" d="M${pts.join('L')}" fill="none" stroke="${color(k)}" stroke-width="2" stroke-linejoin="round"/>`;
  });
  // Faixas de hover: uma por ponto (limitadas) com o valor de todas as séries.
  const stride = Math.max(1, Math.ceil(x.length / 300));
  for (let i = 0; i < x.length; i += stride) {
    const a = i === 0 ? left : (px(x[i]) + px(x[i - stride] ?? x[i])) / 2, b = i + stride >= x.length ? w - 14 : (px(x[i]) + px(x[Math.min(x.length - 1, i + stride)])) / 2;
    const tip = `${xFormat(x[i])} · ` + series.map(s => `${series.length > 1 ? s.name + ' ' : ''}${valueFormat(s.values[i])}`).join(' · ');
    svg += `<rect class="hit band" x="${a}" y="14" width="${Math.max(1, b - a)}" height="${plotH}" data-tip="${esc(tip)}" data-cx="${px(x[i])}"/>`;
  }
  svg += `<rect class="brush" x="0" y="14" width="0" height="${plotH}"/><line class="crosshair" x1="0" x2="0" y1="14" y2="${14 + plotH}"/><line class="baseline" x1="${left}" x2="${w - 14}" y1="${py(0)}" y2="${py(0)}"/></svg>`;
  return wrap(title, svg, legend(series.map(s => s.name)));
}

// Grade de calor (mapa de atividade): linhas × colunas.
export function heatGrid(rows, colLabels, { title = '', labelEvery = null, rowDrill = null, colRanges = null } = {}) {
  if (!rows.length || !colLabels.length) return emptyChart(title);
  const max = Math.max(1, ...rows.flatMap(r => r.values));
  const labelW = 90, cell = Math.max(6, Math.min(30, Math.floor(1100 / colLabels.length))), w = labelW + cell * colLabels.length + 10, h = rows.length * 22 + 40;
  const every = labelEvery || Math.max(1, Math.ceil(colLabels.length / Math.floor((cell * colLabels.length) / 70)));
  let svg = `<svg class="chart heat" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">`;
  rows.forEach((r, i) => {
    const y = 4 + i * 22;
    svg += `<text class="label${rowDrill ? ' drillable' : ''}" x="${labelW - 8}" y="${y + 14}" text-anchor="end"${rowDrill && r.key !== '—' ? ` data-drill="${esc(rowDrill + '=' + r.key)}"` : ''}>${esc(r.key)}</text>`;
    r.values.forEach((v, j) => {
      const idx = v ? Math.min(SEQUENTIAL.length - 1, 2 + Math.floor((v / max) * (SEQUENTIAL.length - 3))) : -1;
      const drills = [rowDrill && r.key !== '—' ? rowDrill + '=' + r.key : '', colRanges ? 'range=' + colRanges[j] : ''].filter(Boolean).join(';');
      svg += `<rect class="cell${drills && v ? ' drillable' : ''}" x="${labelW + j * cell}" y="${y}" width="${cell - 1}" height="20" rx="2" fill="${idx < 0 ? 'var(--cellEmpty)' : SEQUENTIAL[idx]}" data-tip="${esc(r.key)} · ${esc(colLabels[j])}: ${v}"${drills && v ? ` data-drill="${esc(drills)}"` : ''}/>`;
    });
  });
  colLabels.forEach((c, j) => { if (j % every === 0) svg += `<text class="axis" x="${labelW + j * cell}" y="${h - 18}">${esc(c)}</text>`; });
  svg += '</svg>';
  const scale = `<div class="heatScale"><span>0</span><i style="background:linear-gradient(90deg,${SEQUENTIAL.slice(2).join(',')})"></i><span>${max}</span></div>`;
  return wrap(title, `<div class="scrollX">${svg}</div>`, scale);
}

// Rosa polar de azimutes (setores iguais, 0° = norte).
export function rose(values, { title = '' } = {}) {
  const n = values.length, max = Math.max(1, ...values), size = 340, c = size / 2, r = c - 34;
  let svg = `<svg class="chart rose" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(title)}">`;
  for (const f of [0.25, 0.5, 0.75, 1]) svg += `<circle class="grid" cx="${c}" cy="${c}" r="${r * f}" fill="none"/>`;
  values.forEach((v, i) => {
    const a0 = ((i - 0.5) * 360) / n, a1 = ((i + 0.5) * 360) / n, rr = (v / max) * r;
    const p = a => [c + rr * Math.sin((a * Math.PI) / 180), c - rr * Math.cos((a * Math.PI) / 180)];
    const [x0, y0] = p(a0 + 1), [x1, y1] = p(a1 - 1);
    svg += `<path class="mark" d="M${c},${c}L${x0},${y0}A${rr},${rr} 0 0 1 ${x1},${y1}Z" fill="${color(0)}" data-tip="${Math.round((i * 360) / n)}° ±${Math.round(180 / n)}°: ${v}"/>`;
  });
  for (const [a, l] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) svg += `<text class="axis" x="${c + (r + 16) * Math.sin((a * Math.PI) / 180)}" y="${c - (r + 16) * Math.cos((a * Math.PI) / 180) + 4}" text-anchor="middle">${l}</text>`;
  return wrap(title, svg + '</svg>');
}

let landPath = null;
export async function loadLand() {
  if (landPath !== null) return landPath;
  try {
    const geo = await (await fetch('land.geojson')).json();
    const parts = [];
    for (const f of geo.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) parts.push('M' + ring.map(([lon, lat]) => `${((lon + 180) * 2).toFixed(1)},${((90 - lat) * 2).toFixed(1)}`).join('L') + 'Z');
    }
    landPath = parts.join('');
  } catch { landPath = ''; }
  return landPath;
}

// Mapa-múndi equiretangular com pontos (entidades/quadrículas) e linhas a partir do QTH.
export function worldMap(points, { title = '', home = null, lines: drawLines = false } = {}) {
  const max = Math.max(1, ...points.map(p => p.value || 1));
  const X = lon => (lon + 180) * 2, Y = lat => (90 - lat) * 2;
  let svg = `<svg class="chart map" viewBox="0 0 720 360" role="img" aria-label="${esc(title)}"><rect class="ocean" width="720" height="360"/><path class="land" d="${landPath || ''}"/>`;
  for (let lon = -150; lon <= 150; lon += 30) svg += `<line class="grid" x1="${X(lon)}" x2="${X(lon)}" y1="0" y2="360"/>`;
  for (let lat = -60; lat <= 60; lat += 30) svg += `<line class="grid" x1="0" x2="720" y1="${Y(lat)}" y2="${Y(lat)}"/>`;
  if (home && drawLines) for (const p of points.slice(0, 3000)) svg += `<line class="qsoLine" x1="${X(home.lon)}" y1="${Y(home.lat)}" x2="${X(p.lon)}" y2="${Y(p.lat)}"/>`;
  for (const p of points) {
    const r = 2 + Math.sqrt((p.value || 1) / max) * 7;
    if (p.rect) svg += `<rect class="mark" x="${X(p.lon - 1)}" y="${Y(p.lat + 0.5)}" width="4" height="2" fill="${color(0)}" data-tip="${esc(p.label)}"${p.drill ? ` data-drill="${esc(p.drill)}"` : ''}/>`;
    else svg += `<circle class="mark dot" cx="${X(p.lon)}" cy="${Y(p.lat)}" r="${r.toFixed(1)}" fill="${color(0)}" data-tip="${esc(p.label)}"${p.drill ? ` data-drill="${esc(p.drill)}"` : ''}/>`;
  }
  if (home) svg += `<circle class="home" cx="${X(home.lon)}" cy="${Y(home.lat)}" r="5"/>`;
  return wrap(title, svg + '</svg>');
}

export function emptyChart(title) {
  return wrap(title, '<div class="chartEmpty">—</div>');
}

function wrap(title, body, after = '') {
  return `<figure class="chartBox">${title ? `<figcaption>${esc(title)}</figcaption>` : ''}${body}${after}</figure>`;
}

// Tabela HTML simples (dados exportáveis ficam separados no objeto de resultado).
export function table(head, rows, { numeric = [], max = 2000, className = '' } = {}) {
  const num = new Set(numeric);
  const body = rows.slice(0, max).map(r => `<tr>${r.map((c, i) => `<td${num.has(i) ? ' class="num"' : ''}>${c === null || c === undefined ? '' : typeof c === 'object' && 'html' in c ? c.html : esc(fmtCell(c))}</td>`).join('')}</tr>`).join('');
  const more = rows.length > max ? `<tr><td colspan="${head.length}" class="more">+ ${rows.length - max}</td></tr>` : '';
  return `<div class="tableWrap ${className}"><table><thead><tr>${head.map((h, i) => `<th${num.has(i) ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}${more}</tbody></table></div>`;
}

const fmtCell = c => (typeof c === 'number' ? c.toLocaleString(undefined, { maximumFractionDigits: 2 }) : c);

export function tile(label, value, sub = '') {
  return `<div class="tile"><small>${esc(label)}</small><strong${String(value).length > 12 ? ' class="long"' : ''}>${esc(value)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
}

export { esc };
