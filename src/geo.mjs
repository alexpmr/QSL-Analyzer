// Geodésia básica: Maidenhead, distância e azimute (grande círculo).
const R = 6371.0088;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

export function gridValid(grid) {
  return /^[A-R]{2}(\d{2}([A-X]{2}(\d{2})?)?)?$/i.test(String(grid || '').trim());
}

export function gridToLatLon(grid) {
  const g = String(grid || '').trim().toUpperCase();
  if (!gridValid(g) || g.length < 4) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180, lat = (g.charCodeAt(1) - 65) * 10 - 90;
  lon += Number(g[2]) * 2; lat += Number(g[3]);
  let w = 2, h = 1;
  if (g.length >= 6) { w = 2 / 24; h = 1 / 24; lon += (g.charCodeAt(4) - 65) * w; lat += (g.charCodeAt(5) - 65) * h; }
  if (g.length >= 8) { w /= 10; h /= 10; lon += Number(g[6]) * w; lat += Number(g[7]) * h; }
  return { lat: lat + h / 2, lon: lon + w / 2 };
}

export function latLonToGrid(lat, lon, precision = 6) {
  let x = Number(lon) + 180, y = Number(lat) + 90;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
  x = Math.min(Math.max(x, 0), 359.9999); y = Math.min(Math.max(y, 0), 179.9999);
  let out = String.fromCharCode(65 + Math.floor(x / 20)) + String.fromCharCode(65 + Math.floor(y / 10));
  out += Math.floor((x % 20) / 2) + '' + Math.floor(y % 10);
  if (precision >= 6) out += String.fromCharCode(97 + Math.floor((x % 2) * 12)) + String.fromCharCode(97 + Math.floor((y % 1) * 24));
  return out;
}

export function distanceKm(a, b) {
  if (!a || !b) return null;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a, b) {
  if (!a || !b) return null;
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Parse de latitude/longitude no formato ADIF (XDDD MM.MMM).
export function adifCoord(value) {
  const m = String(value || '').trim().match(/^([NSEW])(\d{1,3})\s+(\d{1,2}(?:\.\d+)?)$/i);
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3]) / 60;
  return /[SW]/i.test(m[1]) ? -v : v;
}
