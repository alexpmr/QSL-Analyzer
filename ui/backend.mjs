// Ponte com o processo principal (Electron) ou, no navegador, implementação local equivalente.
const api = globalThis.qslAnalyzer;
export const isDesktop = Boolean(api);

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('qsl-analyzer', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode), store = tx.objectStore('kv'), req = fn(store);
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

function pickFiles(accept, binary = false) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = !binary; input.accept = accept;
    input.onchange = async () => resolve(await Promise.all([...input.files].map(async f => {
      if (!binary) return { name: f.name, size: f.size, text: await f.text() };
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { name: f.name, size: f.size, base64: btoa(bin) };
    })));
    input.click();
  });
}

function download(name, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return name;
}

export const backend = isDesktop ? {
  info: () => api.info(),
  loadDb: () => api.loadDb(),
  saveDb: json => api.saveDb(json),
  openFiles: (options = {}) => api.openFiles(options),
  saveFile: (name, content, kind) => api.saveFile({ name, content, kind }),
  saveBinary: (name, base64, kind) => api.saveFile({ name, content: base64, kind, base64: true }),
  printPdf: opts => api.printPdf(opts),
  fetchPlatform: request => api.fetchPlatform(request),
  encrypt: text => api.encrypt(text),
  decrypt: text => api.decrypt(text),
  loadCty: () => api.loadCty(),
  saveCty: text => api.saveCty(text),
  openExternal: url => api.openExternal(url),
  factoryReset: () => api.factoryReset(),
  checkUpdate: () => api.checkUpdate(),
  lookup: (url, binary = false) => api.lookup({ url, binary }),
  downloadUpdate: () => api.downloadUpdate(),
  installUpdate: () => api.installUpdate(),
  takeNews: () => api.takeNews(),
  takeMigration: () => api.takeMigration(),
  cloudFolders: () => api.cloudFolders(),
  onUpdateProgress: cb => api.onUpdateProgress(cb),
  tqslUpload: request => api.tqslUpload(request),
  backupWrite: request => api.backupWrite(request),
  backupDir: folder => api.backupDir(folder),
  chooseFolder: () => api.chooseFolder(),
} : {
  info: async () => ({ version: null, dataDir: 'IndexedDB (navegador)', portable: false, desktop: false }),
  loadDb: async () => { try { return (await kv('readonly', s => s.get('db'))) || null; } catch { return null; } },
  saveDb: async json => { await kv('readwrite', s => s.put(json, 'db')); return true; },
  openFiles: (options = {}) => (options.backup ? pickFiles('.qslbackup,.json', true) : pickFiles('.adi,.adif,.adx,.log,.cbr,.edi,.csv,.txt,.tsv')),
  saveFile: async (name, content) => download(name, content),
  saveBinary: async (name, base64) => { const bin = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); return download(name, new Blob([bin])); },
  printPdf: async () => { window.print(); return 'print'; },
  fetchPlatform: async request => {
    const res = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
    return { status: res.status, text: await res.text() };
  },
  encrypt: async text => text,
  decrypt: async text => text,
  loadCty: async () => { try { return (await kv('readonly', s => s.get('cty'))) || null; } catch { return null; } },
  saveCty: async text => { await kv('readwrite', s => s.put(text, 'cty')); return true; },
  openExternal: async url => { window.open(url, '_blank', 'noopener'); return true; },
  factoryReset: async () => { await kv('readwrite', s => s.clear()); location.reload(); return true; },
  checkUpdate: async () => null,
  downloadUpdate: async () => false,
  installUpdate: async () => false,
  takeNews: async () => null,
  takeMigration: async () => null,
  cloudFolders: async () => [],
  onUpdateProgress: () => () => {},
  tqslUpload: async () => ({ code: -1, error: 'TQSL_NOT_FOUND' }),
  backupWrite: async ({ name, base64 }) => { const bin = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); return download(name, new Blob([bin])); },
  backupDir: async () => 'Downloads',
  chooseFolder: async () => null,
  lookup: async (url, binary = false) => {
    const res = await fetch(url);
    if (!binary) return { status: res.status, text: await res.text() };
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { status: res.status, base64: btoa(bin), type: res.headers.get('content-type') || 'image/jpeg' };
  },
};
