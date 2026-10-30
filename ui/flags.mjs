// Bandeira do país a partir do nome da entidade (CTY/QRZ): ISO 3166 pelo nome em inglês, mais apelidos do CTY.DAT.
const ALIASES = {
  'united states': 'us', 'usa': 'us', 'alaska': 'us', 'hawaii': 'us', 'puerto rico': 'pr', 'fed. rep. of germany': 'de', 'federal republic of germany': 'de',
  'european russia': 'ru', 'asiatic russia': 'ru', 'kaliningrad': 'ru', 'russia': 'ru', 'england': 'gb-eng', 'scotland': 'gb-sct', 'wales': 'gb-wls',
  'northern ireland': 'gb-nir', 'isle of man': 'im', 'guernsey': 'gg', 'jersey': 'je', 'shetland islands': 'gb-sct', 'sardinia': 'it', 'sicily': 'it',
  'balearic islands': 'es', 'canary islands': 'es', 'ceuta & melilla': 'es', 'azores': 'pt', 'madeira islands': 'pt', 'corsica': 'fr',
  'republic of korea': 'kr', 'south korea': 'kr', 'dprk (north korea)': 'kp', 'czech republic': 'cz', 'slovak republic': 'sk', 'bosnia-herzegovina': 'ba',
  'north macedonia': 'mk', 'macedonia': 'mk', 'vatican city': 'va', 'netherlands': 'nl', 'the netherlands': 'nl', 'bonaire': 'bq', 'curacao': 'cw',
  'sint maarten': 'sx', 'aruba': 'aw', 'fernando de noronha': 'br', 'st. peter & st. paul rocks': 'br', 'trindade & martim vaz': 'br',
  'galapagos islands': 'ec', 'easter island': 'cl', 'juan fernandez islands': 'cl', 'antarctica': 'aq', 'south shetland islands': 'aq',
  'falkland islands': 'fk', 'trinidad & tobago': 'tt', 'antigua & barbuda': 'ag', 'st. kitts & nevis': 'kn', 'st. lucia': 'lc', 'st. vincent': 'vc',
  'turks & caicos islands': 'tc', 'us virgin islands': 'vi', 'british virgin islands': 'vg', 'cote d\'ivoire': 'ci', 'dem. rep. of the congo': 'cd',
  'republic of the congo': 'cg', 'ivory coast': 'ci', 'taiwan': 'tw', 'hong kong': 'hk', 'macao': 'mo', 'vietnam': 'vn', 'viet nam': 'vn',
  'united arab emirates': 'ae', 'iran': 'ir', 'syria': 'sy', 'moldova': 'md', 'west malaysia': 'my', 'east malaysia': 'my', 'svalbard': 'sj',
  'jan mayen': 'sj', 'mexico': 'mx', 'united kingdom': 'gb', 'kosovo': 'xk', 'eswatini': 'sz', 'swaziland': 'sz', 'timor - leste': 'tl',
};
let byName = null;
function table() {
  if (byName) return byName;
  byName = new Map();
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b), name = dn.of(code);
      if (name && name !== code) byName.set(name.toLowerCase(), code.toLowerCase());
    }
  } catch { /* sem Intl: só os apelidos */ }
  return byName;
}
export function isoForCountry(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  return ALIASES[n] || table().get(n) || table().get(n.replace(/^(the|rep\. of|republic of) /, '')) || '';
}
export const flagUrl = iso => `https://flagcdn.com/w40/${iso}.png`;
