const {contextBridge,ipcRenderer}=require('electron');
const call=(name,...args)=>ipcRenderer.invoke(name,...args);
contextBridge.exposeInMainWorld('qslAnalyzer',{
  info:()=>call('info'),
  loadDb:()=>call('load-db'),
  saveDb:json=>call('save-db',json),
  openFiles:()=>call('open-files'),
  saveFile:payload=>call('save-file',payload),
  printPdf:options=>call('print-pdf',options),
  fetchPlatform:request=>call('fetch-platform',request),
  encrypt:text=>call('encrypt',text),
  decrypt:text=>call('decrypt',text),
  loadCty:()=>call('load-cty'),
  saveCty:text=>call('save-cty',text),
  openExternal:url=>call('open-external',url),
  factoryReset:()=>call('factory-reset'),
  checkUpdate:()=>call('check-update'),
  lookup:request=>call('lookup',request),
  downloadUpdate:()=>call('download-update'),
  installUpdate:()=>call('install-update'),
  takeNews:()=>call('take-news'),
  onUpdateProgress:callback=>{const handler=(_,p)=>callback(p);ipcRenderer.on('update-progress',handler);return ()=>ipcRenderer.removeListener('update-progress',handler);}
});
